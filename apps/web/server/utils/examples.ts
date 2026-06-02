import { randomUUID } from 'node:crypto';

import { createError } from 'h3';
import type { Prisma } from '@prisma/client';

import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';
import {
  assertAssetUpload,
  assertReferenceFileUpload,
  extractAssetMetadata,
  extractReferenceFileMetadata
} from '@pepetex/storage';

import { getCachedObjectStorageAdapter } from './object-storage';
import { listProviderModels } from './providers';

export interface PromptExampleReferenceFileSummary {
  id: string;
  promptExampleId: string;
  purpose: 'REFERENCE' | 'ASSET';
  assetRole: 'LOGO' | 'IMAGE' | 'FONT' | 'OTHER' | null;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  storageBucket: string;
  storageObjectPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptExampleSummary {
  id: string;
  title: string;
  category: string;
  promptEn: string;
  promptId: string;
  isEnabled: boolean;
  thumbnailUrl: string | null;
  sortOrder: number;
  designSystemId: string | null;
  customPromptId: string | null;
  textProviderKind: string | null;
  textModelId: string | null;
  imageEnabled: boolean;
  imageProviderKind: string | null;
  imageModelId: string | null;
  referenceFiles: PromptExampleReferenceFileSummary[];
  createdAt: string;
  updatedAt: string;
}

async function buildThumbnailUrl(
  gcsBucket: string | null,
  gcsPath: string | null
): Promise<string | null> {
  if (!gcsBucket || !gcsPath) return null;
  try {
    const storage = getCachedObjectStorageAdapter(gcsBucket);
    return await storage.createSignedReadUrl({
      objectPath: gcsPath,
      expiresAt: new Date(Date.now() + 900_000)
    });
  } catch {
    return null;
  }
}

interface PromptExampleRecord {
  id: string;
  title: string;
  category: string;
  promptEn: string;
  promptId: string;
  isEnabled: boolean;
  thumbnailGcsBucket: string | null;
  thumbnailGcsPath: string | null;
  sortOrder: number;
  designSystemId: string | null;
  customPromptId: string | null;
  textProviderKind: string | null;
  textModelId: string | null;
  imageEnabled: boolean;
  imageProviderKind: string | null;
  imageModelId: string | null;
  createdAt: Date;
  updatedAt: Date;
  referenceFiles?: PromptExampleReferenceFileRecord[];
}

interface PromptExampleReferenceFileRecord {
  id: string;
  promptExampleId: string;
  purpose: 'REFERENCE' | 'ASSET';
  assetRole: 'LOGO' | 'IMAGE' | 'FONT' | 'OTHER' | null;
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
}

function toReferenceFileSummary(
  file: PromptExampleReferenceFileRecord
): PromptExampleReferenceFileSummary {
  return {
    id: file.id,
    promptExampleId: file.promptExampleId,
    purpose: file.purpose,
    assetRole: file.assetRole,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    pageCount: file.pageCount,
    imageWidth: file.imageWidth,
    imageHeight: file.imageHeight,
    storageBucket: file.storageBucket,
    storageObjectPath: file.storageObjectPath,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString()
  };
}

function toExampleSummary(
  ex: PromptExampleRecord,
  thumbnailUrl: string | null
): PromptExampleSummary {
  return {
    id: ex.id,
    title: ex.title,
    category: ex.category,
    promptEn: ex.promptEn,
    promptId: ex.promptId,
    isEnabled: ex.isEnabled,
    thumbnailUrl,
    sortOrder: ex.sortOrder,
    designSystemId: ex.designSystemId,
    customPromptId: ex.customPromptId,
    textProviderKind: ex.textProviderKind,
    textModelId: ex.textModelId,
    imageEnabled: ex.imageEnabled,
    imageProviderKind: ex.imageProviderKind,
    imageModelId: ex.imageModelId,
    referenceFiles: (ex.referenceFiles ?? []).map(toReferenceFileSummary),
    createdAt: ex.createdAt.toISOString(),
    updatedAt: ex.updatedAt.toISOString()
  };
}

const promptExampleInclude = {
  referenceFiles: {
    orderBy: [{ purpose: 'asc' as const }, { createdAt: 'asc' as const }]
  }
};

// ---------------------------------------------------------------------------
// Public: enabled examples only
// ---------------------------------------------------------------------------

export async function listEnabledExamples(_language?: string): Promise<PromptExampleSummary[]> {
  const examples = await prisma.promptExample.findMany({
    where: { isEnabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: promptExampleInclude
  });

  return Promise.all(
    examples.map(async (ex) => {
      const thumbnailUrl = await buildThumbnailUrl(ex.thumbnailGcsBucket, ex.thumbnailGcsPath);
      return toExampleSummary(ex as PromptExampleRecord, thumbnailUrl);
    })
  );
}

// ---------------------------------------------------------------------------
// Admin: all examples
// ---------------------------------------------------------------------------

export async function listAllExamples(): Promise<PromptExampleSummary[]> {
  const examples = await prisma.promptExample.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: promptExampleInclude
  });

  return Promise.all(
    examples.map(async (ex) => {
      const thumbnailUrl = await buildThumbnailUrl(ex.thumbnailGcsBucket, ex.thumbnailGcsPath);
      return toExampleSummary(ex as PromptExampleRecord, thumbnailUrl);
    })
  );
}

export async function getExample(id: string): Promise<PromptExampleSummary> {
  const ex = await prisma.promptExample.findUnique({
    where: { id },
    include: promptExampleInclude
  });
  if (!ex) throw createError({ statusCode: 404, statusMessage: 'Example not found.' });
  const thumbnailUrl = await buildThumbnailUrl(ex.thumbnailGcsBucket, ex.thumbnailGcsPath);
  return toExampleSummary(ex as PromptExampleRecord, thumbnailUrl);
}

export interface CreateExampleInput {
  title: string;
  category: string;
  promptEn: string;
  promptId: string;
  isEnabled?: boolean;
  sortOrder?: number;
  designSystemId?: string | null;
  customPromptId?: string | null;
  textProviderKind?: string | null;
  textModelId?: string | null;
  imageEnabled?: boolean;
  imageProviderKind?: string | null;
  imageModelId?: string | null;
}

const ALLOWED_TEXT_PROVIDER_KINDS = ['gemini', 'openai-compatible', 'cliproxyapi'] as const;
const ALLOWED_IMAGE_PROVIDER_KINDS = [
  'gemini',
  'openai-compatible',
  'cliproxyapi',
  'imagen',
  'gemini-image',
  'gpt-image-2'
] as const;

function normalizeProviderKind(value: string | null | undefined, allowed: readonly string[]): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!allowed.includes(trimmed)) {
    throw createError({
      statusCode: 422,
      statusMessage: `Unsupported provider kind "${trimmed}". Allowed: ${allowed.join(', ')}.`
    });
  }
  return trimmed;
}

async function assertGlobalDesignSystem(id: string | null): Promise<void> {
  if (!id) return;
  const ds = await prisma.designSystem.findUnique({
    where: { id },
    select: { id: true, scope: true, isEnabled: true }
  });
  if (!ds) throw createError({ statusCode: 422, statusMessage: 'Selected design system not found.' });
  if (ds.scope !== 'GLOBAL') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Templates can only reference globally-scoped design systems.'
    });
  }
}

async function assertGlobalCustomPrompt(id: string | null): Promise<void> {
  if (!id) return;
  const cp = await prisma.customPrompt.findUnique({
    where: { id },
    select: { id: true, scope: true }
  });
  if (!cp) throw createError({ statusCode: 422, statusMessage: 'Selected prompt preset not found.' });
  if (cp.scope !== 'GLOBAL') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Templates can only reference globally-scoped prompt presets.'
    });
  }
}

export async function createExample(
  input: CreateExampleInput
): Promise<PromptExampleSummary> {
  const title = input.title?.trim();
  const category = input.category?.trim();
  const promptEn = input.promptEn?.trim();
  const promptId = input.promptId?.trim();

  if (!title || !category || !promptEn || !promptId) {
    throw createError({ statusCode: 400, statusMessage: 'title, category, promptEn, and promptId are required.' });
  }

  const designSystemId = input.designSystemId?.trim() || null;
  const customPromptId = input.customPromptId?.trim() || null;
  const textProviderKind = normalizeProviderKind(input.textProviderKind, ALLOWED_TEXT_PROVIDER_KINDS);
  const textModelId = input.textModelId?.trim() || null;
  const imageEnabled = input.imageEnabled === true;
  const imageProviderKind = normalizeProviderKind(input.imageProviderKind, ALLOWED_IMAGE_PROVIDER_KINDS);
  const imageModelId = input.imageModelId?.trim() || null;

  await assertGlobalDesignSystem(designSystemId);
  await assertGlobalCustomPrompt(customPromptId);

  const ex = await prisma.promptExample.create({
    data: {
      title,
      category,
      promptEn,
      promptId,
      isEnabled: input.isEnabled ?? true,
      sortOrder: input.sortOrder ?? 0,
      designSystemId,
      customPromptId,
      textProviderKind,
      textModelId,
      imageEnabled,
      imageProviderKind,
      imageModelId
    },
    include: promptExampleInclude
  });

  return toExampleSummary(ex as PromptExampleRecord, null);
}

export interface UpdateExampleInput {
  title?: string;
  category?: string;
  promptEn?: string;
  promptId?: string;
  isEnabled?: boolean;
  sortOrder?: number;
  designSystemId?: string | null;
  customPromptId?: string | null;
  textProviderKind?: string | null;
  textModelId?: string | null;
  imageEnabled?: boolean;
  imageProviderKind?: string | null;
  imageModelId?: string | null;
}

export async function updateExample(
  id: string,
  input: UpdateExampleInput
): Promise<PromptExampleSummary> {
  const ex = await prisma.promptExample.findUnique({ where: { id } });
  if (!ex) throw createError({ statusCode: 404, statusMessage: 'Example not found.' });

  const data: Prisma.PromptExampleUpdateInput = {};
  if (typeof input.title === 'string' && input.title.trim()) data.title = input.title.trim();
  if (typeof input.category === 'string' && input.category.trim()) data.category = input.category.trim();
  if (typeof input.promptEn === 'string' && input.promptEn.trim()) data.promptEn = input.promptEn.trim();
  if (typeof input.promptId === 'string' && input.promptId.trim()) data.promptId = input.promptId.trim();
  if (typeof input.isEnabled === 'boolean') data.isEnabled = input.isEnabled;
  if (typeof input.sortOrder === 'number') data.sortOrder = input.sortOrder;

  if (input.designSystemId !== undefined) {
    const designSystemId = input.designSystemId?.trim() || null;
    await assertGlobalDesignSystem(designSystemId);
    data.designSystem = designSystemId
      ? { connect: { id: designSystemId } }
      : { disconnect: true };
  }

  if (input.customPromptId !== undefined) {
    const customPromptId = input.customPromptId?.trim() || null;
    await assertGlobalCustomPrompt(customPromptId);
    data.customPrompt = customPromptId
      ? { connect: { id: customPromptId } }
      : { disconnect: true };
  }

  if (input.textProviderKind !== undefined) {
    data.textProviderKind = normalizeProviderKind(input.textProviderKind, ALLOWED_TEXT_PROVIDER_KINDS);
  }
  if (input.textModelId !== undefined) {
    data.textModelId = input.textModelId?.trim() || null;
  }
  if (typeof input.imageEnabled === 'boolean') data.imageEnabled = input.imageEnabled;
  if (input.imageProviderKind !== undefined) {
    data.imageProviderKind = normalizeProviderKind(input.imageProviderKind, ALLOWED_IMAGE_PROVIDER_KINDS);
  }
  if (input.imageModelId !== undefined) {
    data.imageModelId = input.imageModelId?.trim() || null;
  }

  const updated = await prisma.promptExample.update({
    where: { id },
    data,
    include: promptExampleInclude
  });
  const thumbnailUrl = await buildThumbnailUrl(updated.thumbnailGcsBucket, updated.thumbnailGcsPath);
  return toExampleSummary(updated as PromptExampleRecord, thumbnailUrl);
}

export async function deleteExample(id: string): Promise<void> {
  const ex = await prisma.promptExample.findUnique({
    where: { id },
    include: { referenceFiles: true }
  });
  if (!ex) throw createError({ statusCode: 404, statusMessage: 'Example not found.' });

  // Best-effort cleanup of any stored files before deleting the row (cascade handles rows).
  for (const file of ex.referenceFiles) {
    try {
      const storage = getCachedObjectStorageAdapter(file.storageBucket);
      await storage.deleteObject({
        objectPath: file.storageObjectPath,
        ignoreIfMissing: true
      });
    } catch {
      // Ignore — DB delete still proceeds.
    }
  }

  await prisma.promptExample.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Reference files / assets attached to a template
// ---------------------------------------------------------------------------

function buildInlineContentDisposition(filename: string): string {
  return `inline; filename="${filename.replace(/["\r\n]/g, '_')}"`;
}

function createTemplateFileObjectPath(
  exampleId: string,
  purpose: 'REFERENCE' | 'ASSET',
  extension: string
): string {
  const day = new Date().toISOString().slice(0, 10);
  const folder = purpose === 'ASSET' ? 'assets' : 'references';
  return `prompt-examples/${exampleId}/${folder}/${day}/${randomUUID()}.${extension}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Template file upload failed.';
}

export async function uploadPromptExampleReferenceFile(
  exampleId: string,
  purpose: 'REFERENCE' | 'ASSET',
  file: File
): Promise<PromptExampleReferenceFileSummary> {
  const example = await prisma.promptExample.findUnique({
    where: { id: exampleId },
    select: { id: true }
  });
  if (!example) {
    throw createError({ statusCode: 404, statusMessage: 'Example not found.' });
  }

  const config = loadConfig(process.env);
  const body = new Uint8Array(await file.arrayBuffer());

  try {
    if (purpose === 'ASSET') {
      assertAssetUpload({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size || body.byteLength,
        maxSizeBytes: config.maxUploadFileBytes
      });
    } else {
      assertReferenceFileUpload({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size || body.byteLength,
        maxSizeBytes: config.maxUploadFileBytes
      });
    }
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: getErrorMessage(error) });
  }

  let metadata: {
    originalFilename: string;
    mimeType: string;
    extension: string;
    sizeBytes: number;
    pageCount?: number;
    imageWidth?: number;
    imageHeight?: number;
  };
  let uploadBody: Uint8Array;
  try {
    if (purpose === 'ASSET') {
      const assetMeta = await extractAssetMetadata({
        filename: file.name,
        mimeType: file.type,
        body
      });
      metadata = assetMeta;
      uploadBody = assetMeta.body;
    } else {
      metadata = await extractReferenceFileMetadata({
        filename: file.name,
        mimeType: file.type,
        body
      });
      uploadBody = body;
    }
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: getErrorMessage(error) });
  }

  const objectStorage = getCachedObjectStorageAdapter(config.gcsBucket);
  const objectPath = createTemplateFileObjectPath(example.id, purpose, metadata.extension);
  const storedObject = await objectStorage.putObject({
    objectPath,
    body: uploadBody,
    contentType: metadata.mimeType,
    contentDisposition: buildInlineContentDisposition(metadata.originalFilename),
    metadata: { promptExampleId: example.id }
  });

  try {
    const record = await prisma.promptExampleReferenceFile.create({
      data: {
        promptExampleId: example.id,
        purpose,
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
    return toReferenceFileSummary(record as PromptExampleReferenceFileRecord);
  } catch (error) {
    try {
      await objectStorage.deleteObject({
        objectPath: storedObject.objectPath,
        ignoreIfMissing: true
      });
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

type LowercaseTextKind = 'gemini' | 'openai-compatible' | 'cliproxyapi';

function toPrismaProviderKind(kind: string): 'GEMINI' | 'OPENAI_COMPATIBLE' | 'CLIPROXYAPI' | null {
  switch (kind as LowercaseTextKind) {
    case 'gemini':
      return 'GEMINI';
    case 'openai-compatible':
      return 'OPENAI_COMPATIBLE';
    case 'cliproxyapi':
      return 'CLIPROXYAPI';
    default:
      return null;
  }
}

export async function resolveWorkspaceProviderForKind(
  workspaceId: string,
  providerKind: string | null,
  options: {
    preferredModelId?: string | null;
    actorUserId?: string;
    isGlobalAdmin?: boolean;
    requirePreferredModel?: boolean;
  } = {}
): Promise<string | null> {
  if (!providerKind) return null;
  const prismaKind = toPrismaProviderKind(providerKind);
  if (!prismaKind) return null;

  const preferredModelId = options.preferredModelId?.trim() || null;

  const policies = await prisma.workspaceProviderPolicy.findMany({
    where: {
      workspaceId,
      providerDefinition: { kind: prismaKind, enabled: true }
    },
    select: { providerDefinitionId: true },
    orderBy: { createdAt: 'desc' }
  });

  if (preferredModelId && options.actorUserId) {
    const policyProviderIds = policies.map((policy) => policy.providerDefinitionId);
    const candidateProviderIds =
      policyProviderIds.length > 0
        ? policyProviderIds
        : (
            await prisma.providerDefinition.findMany({
              where: { kind: prismaKind, enabled: true },
              select: { id: true },
              orderBy: { createdAt: 'desc' }
            })
          ).map((definition) => definition.id);

    for (const providerDefinitionId of candidateProviderIds) {
      if (
        await providerOffersModel(
          providerDefinitionId,
          workspaceId,
          options.actorUserId,
          options.isGlobalAdmin === true,
          preferredModelId
        )
      ) {
        return providerDefinitionId;
      }
    }

    if (options.requirePreferredModel === true) {
      return null;
    }
  }

  const policy = policies[0];
  if (policy) return policy.providerDefinitionId;

  // Fall back to any enabled definition with that kind. The generation run
  // will re-check workspace policy at submit time and surface a clearer
  // error if the workspace cannot use it.
  const def = await prisma.providerDefinition.findFirst({
    where: { kind: prismaKind, enabled: true },
    select: { id: true },
    orderBy: { createdAt: 'desc' }
  });
  return def?.id ?? null;
}

async function providerOffersModel(
  providerDefinitionId: string,
  workspaceId: string,
  actorUserId: string,
  isGlobalAdmin: boolean,
  modelId: string
): Promise<boolean> {
  try {
    const result = await listProviderModels(providerDefinitionId, actorUserId, isGlobalAdmin, {
      workspaceId
    });
    return result.models.some((model) => model.id === modelId);
  } catch {
    return false;
  }
}

export async function deletePromptExampleReferenceFile(
  exampleId: string,
  fileId: string
): Promise<void> {
  const file = await prisma.promptExampleReferenceFile.findFirst({
    where: { id: fileId, promptExampleId: exampleId }
  });
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'File not found.' });
  }

  await prisma.promptExampleReferenceFile.delete({ where: { id: file.id } });

  try {
    const storage = getCachedObjectStorageAdapter(file.storageBucket);
    await storage.deleteObject({
      objectPath: file.storageObjectPath,
      ignoreIfMissing: true
    });
  } catch {
    // best effort
  }
}
