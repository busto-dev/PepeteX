import { createError } from 'h3';

import { Prisma, prisma, type CustomPromptScope } from '@pepetex/db';
import { canManageWorkspaceSettings } from '@pepetex/rbac';

import { getWorkspaceForUser } from './workspaces';

export const customPromptScopes = ['personal', 'workspace', 'global'] as const;
export const customPromptLanguageCodePattern = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;

export type CustomPromptScopeInput = (typeof customPromptScopes)[number];

export interface CustomPromptVariantInput {
  languageCode: string;
  instruction: string;
}

export interface CreateCustomPromptInput {
  scope: CustomPromptScopeInput;
  workspaceId?: string;
  title: string;
  description?: string;
  category?: string;
  tags: string[];
  variants: CustomPromptVariantInput[];
}

export interface UpdateCustomPromptInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  variants?: CustomPromptVariantInput[];
}

export interface CustomPromptVariantSummary {
  id: string;
  languageCode: string;
  instruction: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomPromptSummary {
  id: string;
  scope: CustomPromptScopeInput;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
  updatedAt: string;
  variants: CustomPromptVariantSummary[];
}

export function assertCreateCustomPromptInput(input: unknown): CreateCustomPromptInput {
  const candidate = input as Partial<CreateCustomPromptInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.scope !== 'string' ||
    typeof candidate.title !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom prompt scope and title are required.'
    });
  }

  const scope = assertCustomPromptScope(candidate.scope);
  const title = normalizeRequiredText(candidate.title, 'Custom prompt title', 120);
  const description = normalizeOptionalText(candidate.description, 'Description', 500);
  const category = normalizeOptionalText(candidate.category, 'Category', 80);
  const workspaceId = normalizeOptionalId(candidate.workspaceId);
  const tags = normalizeTags(candidate.tags);
  const variants = normalizeVariants(candidate.variants, 'create');

  if (scope === 'workspace' && !workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is required for workspace custom prompts.'
    });
  }

  if (scope !== 'workspace' && workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is allowed only for workspace custom prompts.'
    });
  }

  return {
    scope,
    ...(workspaceId ? { workspaceId } : {}),
    title,
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    tags,
    variants
  };
}

export function assertUpdateCustomPromptInput(input: unknown): UpdateCustomPromptInput {
  const candidate = input as Partial<CreateCustomPromptInput> | null;

  if (!candidate || typeof candidate !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom prompt update input is required.'
    });
  }

  if ('scope' in candidate || 'workspaceId' in candidate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom prompt scope cannot be changed.'
    });
  }

  const update: UpdateCustomPromptInput = {};

  if ('title' in candidate) {
    update.title = normalizeRequiredText(candidate.title, 'Custom prompt title', 120);
  }

  if ('description' in candidate) {
    update.description = normalizeNullableTextForUpdate(candidate.description, 'Description', 500);
  }

  if ('category' in candidate) {
    update.category = normalizeNullableTextForUpdate(candidate.category, 'Category', 80);
  }

  if ('tags' in candidate) {
    update.tags = normalizeTags(candidate.tags);
  }

  if ('variants' in candidate) {
    update.variants = normalizeVariants(candidate.variants, 'update');
  }

  if (Object.keys(update).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one custom prompt field must be updated.'
    });
  }

  return update;
}

export function assertCustomPromptId(input: string | undefined): string {
  const customPromptId = input?.trim();

  if (!customPromptId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom prompt id is required.'
    });
  }

  return customPromptId;
}

export async function listCustomPromptsForUser(
  userId: string,
  options: {
    workspaceId?: string;
  } = {}
): Promise<CustomPromptSummary[]> {
  if (options.workspaceId) {
    await getWorkspaceForUser(options.workspaceId, userId);
  }

  const prompts = await prisma.customPrompt.findMany({
    where: {
      OR: [
        { scope: 'GLOBAL' },
        {
          scope: 'PERSONAL',
          ownerUserId: userId
        },
        ...(options.workspaceId
          ? [
              {
                scope: 'WORKSPACE' as const,
                workspaceId: options.workspaceId
              }
            ]
          : [])
      ]
    },
    orderBy: [{ createdAt: 'desc' }],
    include: customPromptInclude
  });

  return prompts.map(mapCustomPromptSummary);
}

export async function getCustomPromptForUser(
  customPromptId: string,
  userId: string
): Promise<CustomPromptSummary> {
  const prompt = await prisma.customPrompt.findUnique({
    where: { id: customPromptId },
    include: customPromptInclude
  });

  if (!prompt) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Custom prompt not found.'
    });
  }

  await assertCanReadCustomPrompt(prompt, userId);

  return mapCustomPromptSummary(prompt);
}

export async function createCustomPrompt(
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: CreateCustomPromptInput
): Promise<CustomPromptSummary> {
  if (input.scope === 'global') {
    assertGlobalAdminAccess(isGlobalAdmin);
  }

  if (input.scope === 'workspace') {
    await assertCanManageWorkspaceCustomPrompts(input.workspaceId!, actorUserId);
  }

  const created = await prisma.customPrompt.create({
    data: {
      scope: toPrismaCustomPromptScope(input.scope),
      ...(input.scope === 'personal' ? { ownerUserId: actorUserId } : {}),
      ...(input.scope === 'workspace' ? { workspaceId: input.workspaceId } : {}),
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      tagsJson: toTagsJson(input.tags),
      variants: {
        create: input.variants.map((variant) => ({
          languageCode: variant.languageCode,
          instruction: variant.instruction
        }))
      }
    },
    include: customPromptInclude
  });

  return mapCustomPromptSummary(created);
}

export async function updateCustomPrompt(
  customPromptId: string,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: UpdateCustomPromptInput
): Promise<CustomPromptSummary> {
  const existing = await prisma.customPrompt.findUnique({
    where: { id: customPromptId },
    include: customPromptInclude
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Custom prompt not found.'
    });
  }

  await assertCanManageCustomPrompt(existing, actorUserId, isGlobalAdmin);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.customPrompt.update({
      where: { id: customPromptId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.category !== undefined ? { category: input.category ?? null } : {}),
        ...(input.tags !== undefined ? { tagsJson: toTagsJson(input.tags) } : {})
      }
    });

    if (input.variants !== undefined) {
      await tx.customPromptVariant.deleteMany({
        where: {
          customPromptId
        }
      });

      await tx.customPromptVariant.createMany({
        data: input.variants.map((variant) => ({
          customPromptId,
          languageCode: variant.languageCode,
          instruction: variant.instruction
        }))
      });
    }

    const prompt = await tx.customPrompt.findUnique({
      where: { id: customPromptId },
      include: customPromptInclude
    });

    if (!prompt) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Custom prompt not found.'
      });
    }

    return prompt;
  });

  return mapCustomPromptSummary(updated);
}

export async function deleteCustomPrompt(
  customPromptId: string,
  actorUserId: string,
  isGlobalAdmin: boolean
): Promise<void> {
  const existing = await prisma.customPrompt.findUnique({
    where: { id: customPromptId },
    include: {
      workspace: {
        select: {
          id: true,
          name: true
        }
      },
      variants: {
        orderBy: [{ languageCode: 'asc' }]
      }
    }
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Custom prompt not found.'
    });
  }

  await assertCanManageCustomPrompt(existing, actorUserId, isGlobalAdmin);

  await prisma.customPrompt.delete({
    where: { id: customPromptId }
  });
}

const customPromptInclude = {
  workspace: {
    select: {
      id: true,
      name: true
    }
  },
  variants: {
    orderBy: [{ languageCode: 'asc' }]
  }
} satisfies Prisma.CustomPromptInclude;

async function assertCanReadCustomPrompt(
  prompt: {
    scope: CustomPromptScope;
    ownerUserId: string | null;
    workspaceId: string | null;
  },
  userId: string
): Promise<void> {
  switch (prompt.scope) {
    case 'GLOBAL':
      return;
    case 'PERSONAL':
      if (prompt.ownerUserId === userId) {
        return;
      }
      break;
    case 'WORKSPACE':
      if (prompt.workspaceId) {
        await getWorkspaceForUser(prompt.workspaceId, userId);
        return;
      }
      break;
  }

  throw createError({
    statusCode: 404,
    statusMessage: 'Custom prompt not found.'
  });
}

async function assertCanManageCustomPrompt(
  prompt: {
    scope: CustomPromptScope;
    ownerUserId: string | null;
    workspaceId: string | null;
  },
  actorUserId: string,
  isGlobalAdmin: boolean
): Promise<void> {
  switch (prompt.scope) {
    case 'GLOBAL':
      assertGlobalAdminAccess(isGlobalAdmin);
      return;
    case 'PERSONAL':
      if (prompt.ownerUserId !== actorUserId) {
        throw createError({
          statusCode: 403,
          statusMessage: 'You can manage only your own personal custom prompts.'
        });
      }
      return;
    case 'WORKSPACE':
      if (!prompt.workspaceId) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Workspace custom prompt is missing its workspace.'
        });
      }
      await assertCanManageWorkspaceCustomPrompts(prompt.workspaceId, actorUserId);
      return;
  }
}

async function assertCanManageWorkspaceCustomPrompts(
  workspaceId: string,
  actorUserId: string
): Promise<void> {
  const workspace = await getWorkspaceForUser(workspaceId, actorUserId);

  if (!canManageWorkspaceSettings(workspace.currentUserRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }
}

function assertGlobalAdminAccess(isGlobalAdmin: boolean): void {
  if (!isGlobalAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Global admin access is required.'
    });
  }
}

function assertCustomPromptScope(value: string): CustomPromptScopeInput {
  if (customPromptScopes.includes(value as CustomPromptScopeInput)) {
    return value as CustomPromptScopeInput;
  }

  throw createError({
    statusCode: 400,
    statusMessage: `Custom prompt scope must be one of: ${customPromptScopes.join(', ')}.`
  });
}

function normalizeRequiredText(value: unknown, fieldLabel: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} is required.`
    });
  }

  const normalized = value.trim();

  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} is required.`
    });
  }

  if (normalized.length > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be ${maxLength} characters or fewer.`
    });
  }

  return normalized;
}

function normalizeOptionalText(
  value: unknown,
  fieldLabel: string,
  maxLength: number
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be a string.`
    });
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be ${maxLength} characters or fewer.`
    });
  }

  return normalized;
}

function normalizeNullableTextForUpdate(
  value: unknown,
  fieldLabel: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be a string.`
    });
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be ${maxLength} characters or fewer.`
    });
  }

  return normalized;
}

function normalizeOptionalId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId must be a string.'
    });
  }

  const normalized = value.trim();

  return normalized || undefined;
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'tags must be an array of strings.'
    });
  }

  const normalized = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'tags must be an array of strings.'
      });
    }

    const trimmed = entry.trim();

    if (!trimmed) {
      throw createError({
        statusCode: 400,
        statusMessage: 'tags must not contain empty values.'
      });
    }

    if (trimmed.length > 40) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Each tag must be 40 characters or fewer.'
      });
    }

    return trimmed;
  });

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function normalizeVariants(
  value: unknown,
  mode: 'create' | 'update'
): CustomPromptVariantInput[] {
  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'variants must be provided as an array.'
    });
  }

  if (value.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        mode === 'create'
          ? 'At least one language variant is required.'
          : 'variants must contain at least one language variant.'
    });
  }

  const variants = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: `Language variant #${index + 1} is invalid.`
      });
    }

    const candidate = entry as Partial<CustomPromptVariantInput>;

    if (typeof candidate.languageCode !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: `Language variant #${index + 1} must include a languageCode.`
      });
    }

    if (typeof candidate.instruction !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: `Language variant #${index + 1} must include an instruction.`
      });
    }

    const languageCode = candidate.languageCode.trim().toLowerCase();

    if (!customPromptLanguageCodePattern.test(languageCode)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Language variant #${index + 1} has an invalid languageCode.`
      });
    }

    const instruction = candidate.instruction.trim();

    if (!instruction) {
      throw createError({
        statusCode: 400,
        statusMessage: `Language variant #${index + 1} instruction is required.`
      });
    }

    return {
      languageCode,
      instruction
    };
  });

  if (new Set(variants.map((variant) => variant.languageCode)).size !== variants.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Language variants must use unique languageCode values.'
    });
  }

  return variants.sort((left, right) => left.languageCode.localeCompare(right.languageCode));
}

function toPrismaCustomPromptScope(scope: CustomPromptScopeInput): CustomPromptScope {
  switch (scope) {
    case 'personal':
      return 'PERSONAL';
    case 'workspace':
      return 'WORKSPACE';
    case 'global':
      return 'GLOBAL';
  }
}

function fromPrismaCustomPromptScope(scope: CustomPromptScope): CustomPromptScopeInput {
  switch (scope) {
    case 'PERSONAL':
      return 'personal';
    case 'WORKSPACE':
      return 'workspace';
    case 'GLOBAL':
      return 'global';
  }
}

function parseTagsJson(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toTagsJson(tags: string[]): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return tags.length > 0 ? (tags as Prisma.InputJsonValue) : Prisma.DbNull;
}

function mapCustomPromptSummary(prompt: {
  id: string;
  scope: CustomPromptScope;
  title: string;
  description: string | null;
  category: string | null;
  tagsJson: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  workspace: {
    id: string;
    name: string;
  } | null;
  variants: Array<{
    id: string;
    languageCode: string;
    instruction: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): CustomPromptSummary {
  return {
    id: prompt.id,
    scope: fromPrismaCustomPromptScope(prompt.scope),
    title: prompt.title,
    description: prompt.description,
    category: prompt.category,
    tags: parseTagsJson(prompt.tagsJson),
    workspaceId: prompt.workspace?.id ?? null,
    workspaceName: prompt.workspace?.name ?? null,
    createdAt: prompt.createdAt.toISOString(),
    updatedAt: prompt.updatedAt.toISOString(),
    variants: prompt.variants.map((variant) => ({
      id: variant.id,
      languageCode: variant.languageCode,
      instruction: variant.instruction,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString()
    }))
  };
}
