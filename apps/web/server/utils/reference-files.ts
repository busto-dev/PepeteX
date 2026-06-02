import { randomUUID } from 'node:crypto';

import { createError } from 'h3';

import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';
import {
  assertAssetUpload,
  assertReferenceFileUpload,
  extractAssetMetadata,
  extractReferenceFileMetadata
} from '@pepetex/storage';

import {
  deleteProviderReferenceFile,
  uploadProviderReferenceFile,
  type ProviderReferenceFileBridgeResult
} from './providers';
import { getCachedObjectStorageAdapter as getObjectStorageAdapter } from './object-storage';

export interface ReferenceFileSummary {
  id: string;
  deckId: string;
  purpose: string;
  assetRole: string | null;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  storageBucket: string;
  storageObjectPath: string;
  providerFileId: string | null;
  providerDefinitionId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceFileUsageSummary {
  id: string;
  referenceFileId: string;
  context: 'generation' | 'provider_bridge';
  contextId: string | null;
  createdAt: string;
}

export interface ReferenceFileBridgeInput {
  providerId: string;
  credentialId?: string;
}

export interface ReferenceFileBridgeResult {
  referenceFile: ReferenceFileSummary;
  providerFile: ProviderReferenceFileBridgeResult;
  usage: ReferenceFileUsageSummary;
}

interface AccessibleReferenceFileRecord {
  id: string;
  deckId: string;
  purpose: string;
  assetRole: string | null;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  storageBucket: string;
  storageObjectPath: string;
  providerFileId: string | null;
  providerDefinitionId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface AccessibleReferenceFileWithWorkspaceRecord extends AccessibleReferenceFileRecord {
  deck: {
    workspaceId: string;
  };
}

export function assertDeckId(input: string | undefined): string {
  const deckId = input?.trim();

  if (!deckId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Deck id is required.'
    });
  }

  return deckId;
}

export function assertReferenceFileId(input: string | undefined): string {
  const referenceFileId = input?.trim();

  if (!referenceFileId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Reference file id is required.'
    });
  }

  return referenceFileId;
}

export function assertReferenceFileBridgeInput(input: unknown): ReferenceFileBridgeInput {
  const candidate = input as Partial<ReferenceFileBridgeInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.providerId !== 'string' ||
    !candidate.providerId.trim()
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider id is required.'
    });
  }

  return {
    providerId: candidate.providerId.trim(),
    ...(typeof candidate.credentialId === 'string' && candidate.credentialId.trim()
      ? { credentialId: candidate.credentialId.trim() }
      : {})
  };
}

export function assertGenerationUsageInput(input: unknown): {
  generationId: string;
} {
  const candidate = input as {
    generationId?: unknown;
  } | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.generationId !== 'string' ||
    !candidate.generationId.trim()
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'generationId is required.'
    });
  }

  return {
    generationId: candidate.generationId.trim()
  };
}

export async function uploadDeckReferenceFile(
  deckId: string,
  userId: string,
  file: File
): Promise<ReferenceFileSummary> {
  const deck = await prisma.deck.findFirst({
    where: {
      id: deckId,
      workspace: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    select: {
      id: true
    }
  });

  if (!deck) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deck not found.'
    });
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
      statusMessage: getErrorMessage(error)
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
      statusMessage: getErrorMessage(error)
    });
  }

  const objectStorage = getObjectStorageAdapter(config.gcsBucket);
  const objectPath = createReferenceFileObjectPath(deck.id, metadata.extension);
  const expiresAt = new Date(
    Date.now() + config.referenceFileRetentionDays * 24 * 60 * 60 * 1000
  );
  const storedObject = await objectStorage.putObject({
    objectPath,
    body,
    contentType: metadata.mimeType,
    contentDisposition: buildInlineContentDisposition(metadata.originalFilename),
    metadata: {
      deckId: deck.id,
      uploadedByUserId: userId
    }
  });

  try {
    const referenceFile = await prisma.referenceFile.create({
      data: {
        deckId: deck.id,
        uploadedByUserId: userId,
        purpose: 'REFERENCE',
        originalFilename: metadata.originalFilename,
        mimeType: metadata.mimeType,
        extension: metadata.extension,
        sizeBytes: metadata.sizeBytes,
        pageCount: metadata.pageCount ?? null,
        imageWidth: metadata.imageWidth ?? null,
        imageHeight: metadata.imageHeight ?? null,
        storageBucket: storedObject.bucket,
        storageObjectPath: storedObject.objectPath,
        expiresAt
      }
    });

    return mapReferenceFileSummary(referenceFile);
  } catch (error) {
    try {
      await objectStorage.deleteObject({
        objectPath: storedObject.objectPath,
        ignoreIfMissing: true
      });
    } catch {
      // Preserve the original persistence failure if cleanup also fails.
    }

    throw error;
  }
}

export async function uploadDeckAsset(
  deckId: string,
  userId: string,
  assetRole: string,
  file: File
): Promise<ReferenceFileSummary> {
  const deck = await prisma.deck.findFirst({
    where: {
      id: deckId,
      workspace: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    select: {
      id: true
    }
  });

  if (!deck) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deck not found.'
    });
  }

  const config = loadConfig(process.env);
  const body = new Uint8Array(await file.arrayBuffer());

  try {
    assertAssetUpload({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size || body.byteLength,
      maxSizeBytes: config.maxUploadFileBytes
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: getErrorMessage(error)
    });
  }

  let metadata;

  try {
    metadata = await extractAssetMetadata({
      filename: file.name,
      mimeType: file.type,
      body
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: getErrorMessage(error)
    });
  }

  const objectStorage = getObjectStorageAdapter(config.gcsBucket);
  const objectPath = createAssetObjectPath(deck.id, metadata.extension);
  const expiresAt = new Date(
    Date.now() + config.referenceFileRetentionDays * 24 * 60 * 60 * 1000
  );
  const storedObject = await objectStorage.putObject({
    objectPath,
    body: metadata.body,
    contentType: metadata.mimeType,
    contentDisposition: buildInlineContentDisposition(metadata.originalFilename),
    metadata: {
      deckId: deck.id,
      uploadedByUserId: userId
    }
  });

  try {
    const normalizedRole =
      assetRole === 'logo' || assetRole === 'image' || assetRole === 'other'
        ? assetRole.toUpperCase()
        : 'OTHER';

    const asset = await prisma.referenceFile.create({
      data: {
        deckId: deck.id,
        uploadedByUserId: userId,
        purpose: 'ASSET',
        assetRole: normalizedRole as 'LOGO' | 'IMAGE' | 'OTHER',
        originalFilename: metadata.originalFilename,
        mimeType: metadata.mimeType,
        extension: metadata.extension,
        sizeBytes: metadata.sizeBytes,
        pageCount: metadata.pageCount ?? null,
        imageWidth: metadata.imageWidth ?? null,
        imageHeight: metadata.imageHeight ?? null,
        storageBucket: storedObject.bucket,
        storageObjectPath: storedObject.objectPath,
        expiresAt
      }
    });

    return mapReferenceFileSummary(asset);
  } catch (error) {
    try {
      await objectStorage.deleteObject({
        objectPath: storedObject.objectPath,
        ignoreIfMissing: true
      });
    } catch {
      // Preserve the original persistence failure if cleanup also fails.
    }

    throw error;
  }
}

export async function listDeckReferenceFiles(
  deckId: string,
  userId: string
): Promise<ReferenceFileSummary[]> {
  const deck = await prisma.deck.findFirst({
    where: {
      id: deckId,
      workspace: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    select: {
      id: true
    }
  });

  if (!deck) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deck not found.'
    });
  }

  const referenceFiles = await prisma.referenceFile.findMany({
    where: {
      deckId: deck.id,
      purpose: 'REFERENCE'
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      deckId: true,
      purpose: true,
      assetRole: true,
      originalFilename: true,
      mimeType: true,
      extension: true,
      sizeBytes: true,
      pageCount: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true,
      providerFileId: true,
      providerDefinitionId: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return referenceFiles.map(mapReferenceFileSummary);
}

export async function listDeckAssets(
  deckId: string,
  userId: string
): Promise<ReferenceFileSummary[]> {
  const deck = await prisma.deck.findFirst({
    where: {
      id: deckId,
      workspace: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    select: {
      id: true
    }
  });

  if (!deck) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deck not found.'
    });
  }

  const assets = await prisma.referenceFile.findMany({
    where: {
      deckId: deck.id,
      purpose: 'ASSET'
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      deckId: true,
      purpose: true,
      assetRole: true,
      originalFilename: true,
      mimeType: true,
      extension: true,
      sizeBytes: true,
      pageCount: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true,
      providerFileId: true,
      providerDefinitionId: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return assets.map(mapReferenceFileSummary);
}

export async function deleteDeckReferenceFile(
  deckId: string,
  referenceFileId: string,
  userId: string,
  isGlobalAdmin = false
): Promise<void> {
  const referenceFile = await findAccessibleReferenceFileWithWorkspace(
    deckId,
    referenceFileId,
    userId
  );

  await prisma.referenceFile.delete({
    where: {
      id: referenceFile.id
    }
  });

  if (referenceFile.providerDefinitionId && referenceFile.providerFileId) {
    try {
      await deleteProviderReferenceFile(referenceFile.providerDefinitionId, userId, isGlobalAdmin, {
        providerFileId: referenceFile.providerFileId,
        workspaceId: referenceFile.deck.workspaceId
      });
    } catch {
      // The app record is already gone; leave provider cleanup as best effort.
    }
  }

  try {
    await getObjectStorageAdapter(referenceFile.storageBucket).deleteObject({
      objectPath: referenceFile.storageObjectPath,
      ignoreIfMissing: true
    });
  } catch {
    // The app record is already gone; leave object cleanup as best effort.
  }
}

export async function deleteDeckAsset(
  deckId: string,
  assetId: string,
  userId: string,
  isGlobalAdmin = false
): Promise<void> {
  const asset = await findAccessibleReferenceFileWithWorkspace(
    deckId,
    assetId,
    userId
  );

  await prisma.referenceFile.delete({
    where: {
      id: asset.id
    }
  });

  if (asset.providerDefinitionId && asset.providerFileId) {
    try {
      await deleteProviderReferenceFile(asset.providerDefinitionId, userId, isGlobalAdmin, {
        providerFileId: asset.providerFileId,
        workspaceId: asset.deck.workspaceId
      });
    } catch {
      // The app record is already gone; leave provider cleanup as best effort.
    }
  }

  try {
    await getObjectStorageAdapter(asset.storageBucket).deleteObject({
      objectPath: asset.storageObjectPath,
      ignoreIfMissing: true
    });
  } catch {
    // The app record is already gone; leave object cleanup as best effort.
  }
}

export async function bridgeReferenceFileToProvider(
  deckId: string,
  referenceFileId: string,
  userId: string,
  isGlobalAdmin: boolean,
  input: ReferenceFileBridgeInput
): Promise<ReferenceFileBridgeResult> {
  const referenceFile = await findAccessibleReferenceFileWithWorkspace(
    deckId,
    referenceFileId,
    userId
  );
  const storedObject = await getObjectStorageAdapter(referenceFile.storageBucket).getObject({
    objectPath: referenceFile.storageObjectPath
  });
  const providerFile = await uploadProviderReferenceFile(
    input.providerId,
    userId,
    isGlobalAdmin,
    {
      filename: referenceFile.originalFilename,
      mimeType: referenceFile.mimeType,
      content: storedObject.body,
      workspaceId: referenceFile.deck.workspaceId,
      ...(input.credentialId ? { credentialId: input.credentialId } : {})
    }
  );
  const updatedReferenceFile = await prisma.referenceFile.update({
    where: {
      id: referenceFile.id
    },
    data: {
      providerDefinitionId: providerFile.providerId,
      providerFileId: providerFile.providerFileId
    }
  });
  const usage = await prisma.assetUsage.create({
    data: {
      referenceFileId: referenceFile.id,
      context: 'provider_bridge',
      contextId: providerFile.providerId
    }
  });

  return {
    referenceFile: mapReferenceFileSummary(updatedReferenceFile),
    providerFile,
    usage: mapReferenceFileUsageSummary(usage)
  };
}

export async function recordReferenceFileUsage(
  deckId: string,
  referenceFileId: string,
  userId: string,
  generationId: string
): Promise<ReferenceFileUsageSummary> {
  const referenceFile = await findAccessibleReferenceFile(deckId, referenceFileId, userId);
  const usage = await prisma.assetUsage.create({
    data: {
      referenceFileId: referenceFile.id,
      context: 'generation',
      contextId: generationId
    }
  });

  return mapReferenceFileUsageSummary(usage);
}

async function findAccessibleReferenceFile(
  deckId: string,
  referenceFileId: string,
  userId: string
): Promise<AccessibleReferenceFileRecord> {
  const referenceFile = await prisma.referenceFile.findFirst({
    where: {
      id: referenceFileId,
      deckId,
      deck: {
        workspace: {
          members: {
            some: {
              userId
            }
          }
        }
      }
    },
    select: {
      id: true,
      deckId: true,
      purpose: true,
      assetRole: true,
      originalFilename: true,
      mimeType: true,
      extension: true,
      sizeBytes: true,
      pageCount: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true,
      providerFileId: true,
      providerDefinitionId: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!referenceFile) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Reference file not found.'
    });
  }

  return referenceFile;
}

async function findAccessibleReferenceFileWithWorkspace(
  deckId: string,
  referenceFileId: string,
  userId: string
): Promise<AccessibleReferenceFileWithWorkspaceRecord> {
  const referenceFile = await prisma.referenceFile.findFirst({
    where: {
      id: referenceFileId,
      deckId,
      deck: {
        workspace: {
          members: {
            some: {
              userId
            }
          }
        }
      }
    },
    select: {
      id: true,
      deckId: true,
      purpose: true,
      assetRole: true,
      originalFilename: true,
      mimeType: true,
      extension: true,
      sizeBytes: true,
      pageCount: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true,
      providerFileId: true,
      providerDefinitionId: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      deck: {
        select: {
          workspaceId: true
        }
      }
    }
  });

  if (!referenceFile) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Reference file not found.'
    });
  }

  return referenceFile;
}

function mapReferenceFileSummary(referenceFile: {
  id: string;
  deckId: string;
  purpose: string;
  assetRole: string | null;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  storageBucket: string;
  storageObjectPath: string;
  providerFileId: string | null;
  providerDefinitionId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ReferenceFileSummary {
  return {
    id: referenceFile.id,
    deckId: referenceFile.deckId,
    purpose: referenceFile.purpose,
    assetRole: referenceFile.assetRole,
    originalFilename: referenceFile.originalFilename,
    mimeType: referenceFile.mimeType,
    extension: referenceFile.extension,
    sizeBytes: referenceFile.sizeBytes,
    pageCount: referenceFile.pageCount,
    imageWidth: referenceFile.imageWidth,
    imageHeight: referenceFile.imageHeight,
    storageBucket: referenceFile.storageBucket,
    storageObjectPath: referenceFile.storageObjectPath,
    providerFileId: referenceFile.providerFileId,
    providerDefinitionId: referenceFile.providerDefinitionId,
    expiresAt: referenceFile.expiresAt.toISOString(),
    createdAt: referenceFile.createdAt.toISOString(),
    updatedAt: referenceFile.updatedAt.toISOString()
  };
}

function mapReferenceFileUsageSummary(usage: {
  id: string;
  referenceFileId: string;
  context: string;
  contextId: string | null;
  createdAt: Date;
}): ReferenceFileUsageSummary {
  return {
    id: usage.id,
    referenceFileId: usage.referenceFileId,
    context: usage.context as 'generation' | 'provider_bridge',
    contextId: usage.contextId,
    createdAt: usage.createdAt.toISOString()
  };
}

function createReferenceFileObjectPath(deckId: string, extension: string): string {
  return `decks/${deckId}/references/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
}

function createAssetObjectPath(deckId: string, extension: string): string {
  return `decks/${deckId}/assets/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
}

function buildInlineContentDisposition(filename: string): string {
  const sanitizedFilename = filename.replace(/["\r\n]/g, '_');
  return `inline; filename="${sanitizedFilename}"`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Reference file upload failed.';
}
