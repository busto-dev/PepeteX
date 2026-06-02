import { randomUUID } from 'node:crypto';

import { createError } from 'h3';

import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';
import {
  assertAssetUpload,
  assertFontAssetUpload,
  assertReferenceFileUpload,
  extractAssetMetadata,
  extractFontAssetMetadata,
  extractReferenceFileMetadata
} from '@pepetex/storage';

import { getDesignSystemForUser } from './design-systems';
import { getCachedObjectStorageAdapter } from './object-storage';

export const designSystemReferenceFileRoles = ['logo', 'brand-image', 'font', 'pdf', 'other'] as const;
export type DesignSystemReferenceFileRole = (typeof designSystemReferenceFileRoles)[number];

export const designSystemAssetRoles = ['logo', 'image', 'font', 'other'] as const;
export type DesignSystemAssetRole = (typeof designSystemAssetRoles)[number];

export interface DesignSystemReferenceFileSummary {
  id: string;
  designSystemId: string;
  purpose: string;
  assetRole: string | null;
  role: DesignSystemReferenceFileRole;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  storageBucket: string;
  storageObjectPath: string;
  /**
   * Short-lived signed read URL for image MIME types so the UI can show inline
   * thumbnails. Null for non-image files (PDFs, text, etc.). Expires after 15
   * minutes; clients should re-fetch the listing if they need to refresh.
   */
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const PREVIEW_URL_TTL_MS = 15 * 60 * 1000;

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

async function buildPreviewUrl(
  storageBucket: string,
  storageObjectPath: string,
  mimeType: string
): Promise<string | null> {
  if (!isImageMimeType(mimeType)) {
    return null;
  }
  try {
    const adapter = getCachedObjectStorageAdapter(storageBucket);
    return await adapter.createSignedReadUrl({
      objectPath: storageObjectPath,
      expiresAt: new Date(Date.now() + PREVIEW_URL_TTL_MS)
    });
  } catch {
    return null;
  }
}

async function withPreviewUrls(
  files: DesignSystemReferenceFileSummary[]
): Promise<DesignSystemReferenceFileSummary[]> {
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      previewUrl: await buildPreviewUrl(file.storageBucket, file.storageObjectPath, file.mimeType)
    }))
  );
}

export function assertDesignSystemReferenceFileId(input: string | undefined): string {
  const fileId = input?.trim();

  if (!fileId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Reference file id is required.'
    });
  }

  return fileId;
}

export async function listDesignSystemReferenceFiles(
  designSystemId: string,
  userId: string
): Promise<DesignSystemReferenceFileSummary[]> {
  await getDesignSystemForUser(designSystemId, userId);

  const files = await prisma.designSystemReferenceFile.findMany({
    where: { designSystemId, purpose: 'REFERENCE' },
    orderBy: { createdAt: 'asc' }
  });

  return withPreviewUrls(files.map(mapDesignSystemReferenceFileSummary));
}

export async function listDesignSystemAssets(
  designSystemId: string,
  userId: string
): Promise<DesignSystemReferenceFileSummary[]> {
  await getDesignSystemForUser(designSystemId, userId);

  const files = await prisma.designSystemReferenceFile.findMany({
    where: { designSystemId, purpose: 'ASSET' },
    orderBy: { createdAt: 'asc' }
  });

  return withPreviewUrls(files.map(mapDesignSystemReferenceFileSummary));
}

export async function uploadDesignSystemReferenceFile(
  designSystemId: string,
  userId: string,
  role: DesignSystemReferenceFileRole,
  file: File
): Promise<DesignSystemReferenceFileSummary> {
  const ds = await prisma.designSystem.findUnique({
    where: { id: designSystemId },
    select: {
      id: true,
      scope: true,
      ownerUserId: true,
      workspaceId: true,
      workspace: {
        select: {
          members: {
            where: { userId },
            select: { userId: true }
          }
        }
      }
    }
  });

  if (!ds) {
    throw createError({ statusCode: 404, statusMessage: 'Design system not found.' });
  }

  const canAccess =
    ds.scope === 'GLOBAL' ||
    (ds.scope === 'PERSONAL' && ds.ownerUserId === userId) ||
    (ds.scope === 'WORKSPACE' && (ds.workspace?.members ?? []).length > 0);

  if (!canAccess) {
    throw createError({ statusCode: 404, statusMessage: 'Design system not found.' });
  }

  const config = loadConfig(process.env);
  const body = new Uint8Array(await file.arrayBuffer());

  try {
    assertReferenceFileUpload({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size || body.byteLength,
      maxSizeBytes: config.maxUploadFileBytes
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'File upload validation failed.'
    });
  }

  let metadata;

  try {
    metadata = await extractReferenceFileMetadata({
      filename: file.name,
      mimeType: file.type,
      body
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : 'File metadata extraction failed.'
    });
  }

  const objectStorage = getCachedObjectStorageAdapter(config.gcsBucket);
  const objectPath = `design-systems/${designSystemId}/refs/${randomUUID()}.${metadata.extension}`;

  const storedObject = await objectStorage.putObject({
    objectPath,
    body,
    contentType: metadata.mimeType,
    contentDisposition: `inline; filename="${encodeURIComponent(metadata.originalFilename)}"`,
    metadata: {
      designSystemId,
      uploadedByUserId: userId,
      role
    }
  });

  try {
    const referenceFile = await prisma.designSystemReferenceFile.create({
      data: {
        designSystemId,
        uploadedByUserId: userId,
        purpose: 'REFERENCE',
        role,
        originalFilename: metadata.originalFilename,
        mimeType: metadata.mimeType,
        extension: metadata.extension,
        sizeBytes: metadata.sizeBytes,
        pageCount: metadata.pageCount ?? null,
        imageWidth: metadata.imageWidth ?? null,
        imageHeight: metadata.imageHeight ?? null,
        storageBucket: storedObject.bucket,
        storageObjectPath: storedObject.objectPath
      }
    });

    return mapDesignSystemReferenceFileSummary(referenceFile);
  } catch (error) {
    try {
      await objectStorage.deleteObject({
        objectPath: storedObject.objectPath,
        ignoreIfMissing: true
      });
    } catch {
      // best-effort storage cleanup
    }
    throw error;
  }
}

export async function uploadDesignSystemAsset(
  designSystemId: string,
  userId: string,
  assetRole: DesignSystemAssetRole,
  file: File
): Promise<DesignSystemReferenceFileSummary> {
  const ds = await prisma.designSystem.findUnique({
    where: { id: designSystemId },
    select: {
      id: true,
      scope: true,
      ownerUserId: true,
      workspaceId: true,
      workspace: {
        select: {
          members: {
            where: { userId },
            select: { userId: true }
          }
        }
      }
    }
  });

  if (!ds) {
    throw createError({ statusCode: 404, statusMessage: 'Design system not found.' });
  }

  const canAccess =
    ds.scope === 'GLOBAL' ||
    (ds.scope === 'PERSONAL' && ds.ownerUserId === userId) ||
    (ds.scope === 'WORKSPACE' && (ds.workspace?.members ?? []).length > 0);

  if (!canAccess) {
    throw createError({ statusCode: 404, statusMessage: 'Design system not found.' });
  }

  const config = loadConfig(process.env);
  const body = new Uint8Array(await file.arrayBuffer());

  try {
    const assertUpload = assetRole === 'font' ? assertFontAssetUpload : assertAssetUpload;
    assertUpload({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size || body.byteLength,
      maxSizeBytes: config.maxUploadFileBytes
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'File upload validation failed.'
    });
  }

  let metadata;

  try {
    metadata = await (assetRole === 'font' ? extractFontAssetMetadata : extractAssetMetadata)({
      filename: file.name,
      mimeType: file.type,
      body
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : 'File metadata extraction failed.'
    });
  }

  const objectStorage = getCachedObjectStorageAdapter(config.gcsBucket);
  const objectPath = `design-systems/${designSystemId}/assets/${randomUUID()}.${metadata.extension}`;

  const storedObject = await objectStorage.putObject({
    objectPath,
    body: metadata.body,
    contentType: metadata.mimeType,
    contentDisposition: `inline; filename="${encodeURIComponent(metadata.originalFilename)}"`,
    metadata: {
      designSystemId,
      uploadedByUserId: userId,
      role: assetRole
    }
  });

  try {
    const normalizedRole =
      assetRole === 'image' ? 'brand-image' : assetRole;

    const asset = await prisma.designSystemReferenceFile.create({
      data: {
        designSystemId,
        uploadedByUserId: userId,
        purpose: 'ASSET',
        assetRole: assetRole.toUpperCase() as 'LOGO' | 'IMAGE' | 'FONT' | 'OTHER',
        role: normalizedRole,
        originalFilename: metadata.originalFilename,
        mimeType: metadata.mimeType,
        extension: metadata.extension,
        sizeBytes: metadata.sizeBytes,
        pageCount: metadata.pageCount ?? null,
        imageWidth: metadata.imageWidth ?? null,
        imageHeight: metadata.imageHeight ?? null,
        storageBucket: storedObject.bucket,
        storageObjectPath: storedObject.objectPath
      }
    });

    return mapDesignSystemReferenceFileSummary(asset);
  } catch (error) {
    try {
      await objectStorage.deleteObject({
        objectPath: storedObject.objectPath,
        ignoreIfMissing: true
      });
    } catch {
      // best-effort storage cleanup
    }
    throw error;
  }
}

export async function deleteDesignSystemReferenceFile(
  designSystemId: string,
  fileId: string,
  userId: string
): Promise<void> {
  const file = await prisma.designSystemReferenceFile.findFirst({
    where: {
      id: fileId,
      designSystemId,
      purpose: 'REFERENCE',
      designSystem: {
        OR: [
          { scope: 'GLOBAL' },
          { scope: 'PERSONAL', ownerUserId: userId },
          {
            scope: 'WORKSPACE',
            workspace: {
              members: {
                some: { userId }
              }
            }
          }
        ]
      }
    },
    select: {
      id: true,
      storageBucket: true,
      storageObjectPath: true
    }
  });

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'Reference file not found.' });
  }

  await prisma.designSystemReferenceFile.delete({ where: { id: file.id } });

  try {
    const objectStorage = getCachedObjectStorageAdapter(file.storageBucket);
    await objectStorage.deleteObject({
      objectPath: file.storageObjectPath,
      ignoreIfMissing: true
    });
  } catch {
    // best-effort storage cleanup
  }
}

export async function deleteDesignSystemAsset(
  designSystemId: string,
  fileId: string,
  userId: string
): Promise<void> {
  const file = await prisma.designSystemReferenceFile.findFirst({
    where: {
      id: fileId,
      designSystemId,
      purpose: 'ASSET',
      designSystem: {
        OR: [
          { scope: 'GLOBAL' },
          { scope: 'PERSONAL', ownerUserId: userId },
          {
            scope: 'WORKSPACE',
            workspace: {
              members: {
                some: { userId }
              }
            }
          }
        ]
      }
    },
    select: {
      id: true,
      storageBucket: true,
      storageObjectPath: true
    }
  });

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'Asset not found.' });
  }

  await prisma.designSystemReferenceFile.delete({ where: { id: file.id } });

  try {
    const objectStorage = getCachedObjectStorageAdapter(file.storageBucket);
    await objectStorage.deleteObject({
      objectPath: file.storageObjectPath,
      ignoreIfMissing: true
    });
  } catch {
    // best-effort storage cleanup
  }
}

export function normalizeDesignSystemReferenceFileRole(
  value: unknown
): DesignSystemReferenceFileRole {
  if (typeof value === 'string' && designSystemReferenceFileRoles.includes(value as DesignSystemReferenceFileRole)) {
    return value as DesignSystemReferenceFileRole;
  }

  return 'other';
}

function mapDesignSystemReferenceFileSummary(file: {
  id: string;
  designSystemId: string;
  purpose: string;
  assetRole: string | null;
  role: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  storageBucket: string;
  storageObjectPath: string;
  createdAt: Date;
  updatedAt: Date;
}): DesignSystemReferenceFileSummary {
  return {
    id: file.id,
    designSystemId: file.designSystemId,
    purpose: file.purpose,
    assetRole: file.assetRole,
    role: (designSystemReferenceFileRoles.includes(file.role as DesignSystemReferenceFileRole)
      ? file.role
      : 'other') as DesignSystemReferenceFileRole,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    pageCount: file.pageCount,
    imageWidth: file.imageWidth,
    imageHeight: file.imageHeight,
    storageBucket: file.storageBucket,
    storageObjectPath: file.storageObjectPath,
    // Populated by `withPreviewUrls` for image MIME types after listing.
    previewUrl: null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString()
  };
}
