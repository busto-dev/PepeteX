import { createError } from 'h3';

import { prisma, type ImageProviderKind as PrismaImageProviderKind } from '@pepetex/db';
import { canManageWorkspaceSettings } from '@pepetex/rbac';

import { getWorkspaceForUser } from './workspaces';

const GLOBAL_IMAGE_GENERATION_SETTINGS_ID = 'global';
const MAX_IMAGE_MODEL_LENGTH = 200;

const imageProviderKinds = [
  'imagen',
  'gemini-image',
  'gpt-image-2',
  'openai-compatible'
] as const;

export type ImageProviderKind = (typeof imageProviderKinds)[number];

export interface GlobalImageGenerationSettingsInput {
  isEnabled: boolean;
  providerKind: ImageProviderKind | null;
  model: string | null;
}

export interface WorkspaceImageGenerationSettingsInput {
  isEnabled: boolean | null;
  providerKind: ImageProviderKind | null;
  model: string | null;
}

export interface GlobalImageGenerationSettingsSummary {
  isEnabled: boolean;
  providerKind: ImageProviderKind | null;
  model: string | null;
  updatedAt: string | null;
}

export interface WorkspaceImageGenerationSettingsSummary {
  workspaceId: string;
  isEnabled: boolean | null;
  providerKind: ImageProviderKind | null;
  model: string | null;
  updatedAt: string | null;
}

export interface EffectiveImageGenerationSettingsSummary {
  workspaceId: string;
  isEnabled: boolean;
  providerKind: ImageProviderKind | null;
  model: string | null;
}

export function assertGlobalImageGenerationSettingsInput(
  input: unknown
): GlobalImageGenerationSettingsInput {
  const candidate = input as Partial<GlobalImageGenerationSettingsInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.isEnabled !== 'boolean'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Image generation settings require isEnabled, providerKind, and model.'
    });
  }

  const providerKind = normalizeImageProviderKind(candidate.providerKind, 'providerKind');
  const model = normalizeImageModel(candidate.model, 'model');

  assertProviderModelPair(providerKind, model);

  if (candidate.isEnabled && (!providerKind || !model)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Image provider and model are required when image generation is enabled globally.'
    });
  }

  return {
    isEnabled: candidate.isEnabled,
    providerKind,
    model
  };
}

export function assertWorkspaceImageGenerationSettingsInput(
  input: unknown
): WorkspaceImageGenerationSettingsInput {
  const candidate = input as Partial<WorkspaceImageGenerationSettingsInput> | null;

  if (!candidate || typeof candidate !== 'object' || !('isEnabled' in candidate)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace image generation settings require isEnabled, providerKind, and model.'
    });
  }

  const isEnabled = normalizeNullableBoolean(candidate.isEnabled, 'isEnabled');
  const providerKind = normalizeImageProviderKind(candidate.providerKind, 'providerKind');
  const model = normalizeImageModel(candidate.model, 'model');

  assertProviderModelPair(providerKind, model);

  return {
    isEnabled,
    providerKind,
    model
  };
}

export async function getGlobalImageGenerationSettings(): Promise<GlobalImageGenerationSettingsSummary> {
  const settings = await prisma.globalImageGenerationSettings.findUnique({
    where: {
      id: GLOBAL_IMAGE_GENERATION_SETTINGS_ID
    }
  });

  if (!settings) {
    return {
      isEnabled: false,
      providerKind: null,
      model: null,
      updatedAt: null
    };
  }

  return mapGlobalSettings(settings);
}

export async function updateGlobalImageGenerationSettings(
  input: GlobalImageGenerationSettingsInput
): Promise<GlobalImageGenerationSettingsSummary> {
  const settings = await prisma.globalImageGenerationSettings.upsert({
    where: {
      id: GLOBAL_IMAGE_GENERATION_SETTINGS_ID
    },
    update: {
      isEnabled: input.isEnabled,
      defaultProviderKind: toPrismaImageProviderKind(input.providerKind),
      defaultModel: input.model
    },
    create: {
      id: GLOBAL_IMAGE_GENERATION_SETTINGS_ID,
      isEnabled: input.isEnabled,
      defaultProviderKind: toPrismaImageProviderKind(input.providerKind),
      defaultModel: input.model
    }
  });

  return mapGlobalSettings(settings);
}

export async function getWorkspaceImageGenerationSettings(
  workspaceId: string,
  userId: string
): Promise<{
  settings: WorkspaceImageGenerationSettingsSummary;
  effectiveSettings: EffectiveImageGenerationSettingsSummary;
}> {
  await getWorkspaceForUser(workspaceId, userId);

  const [globalSettings, workspaceSettings] = await Promise.all([
    getGlobalImageGenerationSettings(),
    prisma.workspaceImageGenerationSettings.findUnique({
      where: {
        workspaceId
      }
    })
  ]);

  const settings = workspaceSettings
    ? mapWorkspaceSettings(workspaceSettings)
    : {
        workspaceId,
        isEnabled: null,
        providerKind: null,
        model: null,
        updatedAt: null
      };

  return {
    settings,
    effectiveSettings: {
      workspaceId,
      isEnabled: settings.isEnabled ?? globalSettings.isEnabled,
      providerKind: settings.providerKind ?? globalSettings.providerKind,
      model: settings.model ?? globalSettings.model
    }
  };
}

export async function replaceWorkspaceImageGenerationSettings(
  workspaceId: string,
  userId: string,
  input: WorkspaceImageGenerationSettingsInput
): Promise<{
  settings: WorkspaceImageGenerationSettingsSummary;
  effectiveSettings: EffectiveImageGenerationSettingsSummary;
}> {
  const workspace = await getWorkspaceForUser(workspaceId, userId);

  if (!canManageWorkspaceSettings(workspace.currentUserRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const globalSettings = await getGlobalImageGenerationSettings();
  const effectiveIsEnabled = input.isEnabled ?? globalSettings.isEnabled;
  const effectiveProviderKind = input.providerKind ?? globalSettings.providerKind;
  const effectiveModel = input.model ?? globalSettings.model;

  if (effectiveIsEnabled && (!effectiveProviderKind || !effectiveModel)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Image provider and model are required when image generation is enabled for a workspace.'
    });
  }

  if (input.isEnabled === null && input.providerKind === null && input.model === null) {
    await prisma.workspaceImageGenerationSettings.deleteMany({
      where: {
        workspaceId
      }
    });

    return getWorkspaceImageGenerationSettings(workspaceId, userId);
  }

  await prisma.workspaceImageGenerationSettings.upsert({
    where: {
      workspaceId
    },
    update: {
      isEnabled: input.isEnabled,
      preferredProviderKind: toPrismaImageProviderKind(input.providerKind),
      preferredModel: input.model
    },
    create: {
      workspaceId,
      isEnabled: input.isEnabled,
      preferredProviderKind: toPrismaImageProviderKind(input.providerKind),
      preferredModel: input.model
    }
  });

  return getWorkspaceImageGenerationSettings(workspaceId, userId);
}

function normalizeNullableBoolean(value: unknown, fieldName: string): boolean | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a boolean or null.`
    });
  }

  return value;
}

function normalizeImageProviderKind(
  value: unknown,
  fieldName: string
): ImageProviderKind | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a supported image provider kind or null.`
    });
  }

  const normalized = value.trim();

  if (!imageProviderKinds.includes(normalized as ImageProviderKind)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'providerKind must be one of imagen, gemini-image, gpt-image-2, or openai-compatible.'
    });
  }

  return normalized as ImageProviderKind;
}

function normalizeImageModel(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a string or null.`
    });
  }

  const normalized = value.trim();

  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} cannot be empty when provided.`
    });
  }

  if (normalized.length > MAX_IMAGE_MODEL_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be ${MAX_IMAGE_MODEL_LENGTH} characters or fewer.`
    });
  }

  return normalized;
}

function assertProviderModelPair(
  providerKind: ImageProviderKind | null,
  model: string | null
): void {
  if ((providerKind === null) !== (model === null)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'providerKind and model must either both be set or both be null.'
    });
  }
}

function mapGlobalSettings(settings: {
  isEnabled: boolean;
  defaultProviderKind: PrismaImageProviderKind | null;
  defaultModel: string | null;
  updatedAt: Date;
}): GlobalImageGenerationSettingsSummary {
  return {
    isEnabled: settings.isEnabled,
    providerKind: fromPrismaImageProviderKind(settings.defaultProviderKind),
    model: settings.defaultModel,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function mapWorkspaceSettings(settings: {
  workspaceId: string;
  isEnabled: boolean | null;
  preferredProviderKind: PrismaImageProviderKind | null;
  preferredModel: string | null;
  updatedAt: Date;
}): WorkspaceImageGenerationSettingsSummary {
  return {
    workspaceId: settings.workspaceId,
    isEnabled: settings.isEnabled,
    providerKind: fromPrismaImageProviderKind(settings.preferredProviderKind),
    model: settings.preferredModel,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toPrismaImageProviderKind(
  kind: ImageProviderKind | null
): PrismaImageProviderKind | null {
  switch (kind) {
    case 'imagen':
      return 'IMAGEN';
    case 'gemini-image':
      return 'GEMINI_IMAGE';
    case 'gpt-image-2':
      return 'GPT_IMAGE_2';
    case 'openai-compatible':
      return 'OPENAI_COMPATIBLE';
    case null:
      return null;
  }
}

function fromPrismaImageProviderKind(
  kind: PrismaImageProviderKind | null
): ImageProviderKind | null {
  switch (kind) {
    case 'IMAGEN':
      return 'imagen';
    case 'GEMINI_IMAGE':
      return 'gemini-image';
    case 'GPT_IMAGE_2':
      return 'gpt-image-2';
    case 'OPENAI_COMPATIBLE':
      return 'openai-compatible';
    case null:
      return null;
  }
}