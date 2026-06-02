import { createError } from 'h3';

import {
  isDesignSystemScopeInput,
  migrateLegacyDesignSystemDocument,
  normalizeDesignSystemComponents,
  normalizeDesignSystemDocument,
  normalizeDesignSystemDocumentV2,
  projectV2ToLegacyDocument,
  normalizeDesignSystemExampleSlides,
  normalizeDesignSystemArchetypes,
  normalizeDesignSystemRules,
  normalizeDesignSystemTokens,
  summarizeDesignSystemDocument,
  type DesignSystemComponent,
  type DesignSystemDocument,
  type DesignSystemExampleSlide,
  type DesignSystemRule,
  type DesignSystemScopeInput,
  type DesignSystemDocumentV2,
  type DesignSystemSlideArchetype,
  type DesignSystemTokenSet
} from '@pepetex/design-systems';
import { Prisma, prisma, type DesignSystemScope } from '@pepetex/db';
import { canManageWorkspaceSettings } from '@pepetex/rbac';

import { getWorkspaceForUser } from './workspaces';

export interface DesignSystemVersionSummary {
  id: string;
  versionNumber: number;
  label: string;
  summary: string | null;
  createdAt: string;
  createdByUser: {
    id: string;
    email: string;
    name: string | null;
  };
  counts: {
    colorCount: number;
    typographyCount: number;
    spacingCount: number;
    componentCount: number;
    exampleSlideCount: number;
    archetypeCount: number;
    ruleCount: number;
  };
}

export interface DesignSystemVersionDetail extends DesignSystemVersionSummary {
  document: DesignSystemDocument;
}

export interface DesignSystemSummary {
  id: string;
  scope: DesignSystemScopeInput;
  name: string;
  description: string | null;
  isEnabled: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  currentVersionNumber: number;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
  currentVersion: DesignSystemVersionSummary;
}

export interface DesignSystemDetail extends DesignSystemSummary {
  currentVersion: DesignSystemVersionDetail;
  versions: DesignSystemVersionSummary[];
  documentV2: DesignSystemDocumentV2 | null;
}

export interface CreateDesignSystemInput {
  scope: DesignSystemScopeInput;
  workspaceId?: string;
  name: string;
  description?: string;
  isEnabled?: boolean;
  versionLabel?: string;
  versionSummary?: string;
  tokens: DesignSystemTokenSet;
  components: DesignSystemComponent[];
  exampleSlides: DesignSystemExampleSlide[];
  archetypes?: DesignSystemSlideArchetype[];
  rules?: DesignSystemRule[];
}

export interface UpdateDesignSystemInput {
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  versionLabel?: string;
  versionSummary?: string | null;
  tokens?: DesignSystemTokenSet;
  components?: DesignSystemComponent[];
  exampleSlides?: DesignSystemExampleSlide[];
  archetypes?: DesignSystemSlideArchetype[];
  rules?: DesignSystemRule[];
}

export interface DuplicateDesignSystemInput {
  scope?: DesignSystemScopeInput;
  workspaceId?: string;
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  versionLabel?: string;
  versionSummary?: string | null;
}

export interface DesignSystemExportPayload {
  format: 'pepetex-design-system';
  version: 1;
  exportedAt: string;
  source: {
    id: string;
    scope: DesignSystemScopeInput;
    workspaceId: string | null;
    workspaceName: string | null;
    name: string;
    description: string | null;
    isEnabled: boolean;
    currentVersionNumber: number;
  };
  currentVersion: {
    versionNumber: number;
    label: string;
    summary: string | null;
    document: DesignSystemDocument;
  };
}

export interface ImportDesignSystemInput {
  scope?: DesignSystemScopeInput;
  workspaceId?: string;
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  versionLabel?: string;
  versionSummary?: string | null;
  exportPayload: DesignSystemExportPayload;
}

const DESIGN_SYSTEM_EXPORT_FORMAT = 'pepetex-design-system' as const;
const DESIGN_SYSTEM_EXPORT_VERSION = 1 as const;
const EMPTY_DESIGN_SYSTEM_TOKENS: DesignSystemTokenSet = {
  colors: [],
  typography: [],
  spacing: []
};
const EMPTY_DESIGN_SYSTEM_COMPONENTS: DesignSystemComponent[] = [];
const EMPTY_DESIGN_SYSTEM_EXAMPLE_SLIDES: DesignSystemExampleSlide[] = [];

export function assertCreateDesignSystemInput(input: unknown): CreateDesignSystemInput {
  const candidate = input as Record<string, unknown> | null;

  if (!candidate || typeof candidate !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system input is required.'
    });
  }

  const workspaceId = normalizeOptionalId(candidate.workspaceId);
  let scope: DesignSystemScopeInput;

  if (candidate.scope === undefined || candidate.scope === null || candidate.scope === '') {
    scope = workspaceId ? 'workspace' : 'personal';
  } else if (typeof candidate.scope === 'string') {
    scope = assertDesignSystemScope(candidate.scope);
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system scope must be a string.'
    });
  }

  if (scope === 'workspace' && !workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is required for workspace design systems.'
    });
  }

  if (scope !== 'workspace' && workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is allowed only for workspace design systems.'
    });
  }

  return {
    scope,
    ...(workspaceId ? { workspaceId } : {}),
    name: normalizeRequiredText(candidate.name, 'Design system name', 120),
    ...(normalizeOptionalText(candidate.description, 'Description', 500) !== undefined
      ? { description: normalizeOptionalText(candidate.description, 'Description', 500)! }
      : {}),
    ...(candidate.isEnabled !== undefined ? { isEnabled: normalizeBoolean(candidate.isEnabled, 'isEnabled') } : {}),
    ...(normalizeOptionalText(candidate.versionLabel, 'Version label', 120) !== undefined
      ? { versionLabel: normalizeOptionalText(candidate.versionLabel, 'Version label', 120)! }
      : {}),
    ...(normalizeOptionalText(candidate.versionSummary, 'Version summary', 500) !== undefined
      ? { versionSummary: normalizeOptionalText(candidate.versionSummary, 'Version summary', 500)! }
      : {}),
    tokens: normalizeTokens(candidate.tokens ?? EMPTY_DESIGN_SYSTEM_TOKENS),
    components: normalizeComponents(candidate.components ?? EMPTY_DESIGN_SYSTEM_COMPONENTS),
    exampleSlides: normalizeExampleSlides(candidate.exampleSlides ?? EMPTY_DESIGN_SYSTEM_EXAMPLE_SLIDES),
    ...(candidate.archetypes !== undefined
      ? { archetypes: normalizeArchetypes(candidate.archetypes) }
      : {}),
    ...(candidate.rules !== undefined ? { rules: normalizeRules(candidate.rules) } : {})
  };
}

export function assertUpdateDesignSystemInput(input: unknown): UpdateDesignSystemInput {
  const candidate = input as Record<string, unknown> | null;

  if (!candidate || typeof candidate !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system update input is required.'
    });
  }

  if ('scope' in candidate || 'workspaceId' in candidate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system scope cannot be changed.'
    });
  }

  const update: UpdateDesignSystemInput = {};

  if ('name' in candidate) {
    update.name = normalizeRequiredText(candidate.name, 'Design system name', 120);
  }

  if ('description' in candidate) {
    update.description = normalizeNullableTextForUpdate(candidate.description, 'Description', 500);
  }

  if ('isEnabled' in candidate) {
    update.isEnabled = normalizeBoolean(candidate.isEnabled, 'isEnabled');
  }

  if ('versionLabel' in candidate) {
    update.versionLabel = normalizeRequiredText(candidate.versionLabel, 'Version label', 120);
  }

  if ('versionSummary' in candidate) {
    update.versionSummary = normalizeNullableTextForUpdate(
      candidate.versionSummary,
      'Version summary',
      500
    );
  }

  if ('tokens' in candidate) {
    update.tokens = normalizeTokens(candidate.tokens);
  }

  if ('components' in candidate) {
    update.components = normalizeComponents(candidate.components);
  }

  if ('exampleSlides' in candidate) {
    update.exampleSlides = normalizeExampleSlides(candidate.exampleSlides);
  }

  if ('archetypes' in candidate) {
    update.archetypes = normalizeArchetypes(candidate.archetypes);
  }

  if ('rules' in candidate) {
    update.rules = normalizeRules(candidate.rules);
  }

  if (Object.keys(update).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one design system field must be updated.'
    });
  }

  return update;
}

export function assertDesignSystemId(input: string | undefined): string {
  const designSystemId = input?.trim();

  if (!designSystemId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system id is required.'
    });
  }

  return designSystemId;
}

export function assertDuplicateDesignSystemInput(input: unknown): DuplicateDesignSystemInput {
  if (input === undefined || input === null || input === '') {
    return {};
  }

  const candidate = input as Record<string, unknown> | null;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Duplicate design system input must be an object.'
    });
  }

  const workspaceId = normalizeOptionalId(candidate.workspaceId);
  const scope = normalizeOptionalScope(candidate.scope, workspaceId ? 'workspace' : undefined);

  if (scope !== undefined && scope !== 'workspace' && workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is allowed only for workspace design systems.'
    });
  }

  return {
    ...(scope !== undefined ? { scope } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(normalizeOptionalText(candidate.name, 'Design system name', 120) !== undefined
      ? { name: normalizeOptionalText(candidate.name, 'Design system name', 120)! }
      : {}),
    ...('description' in candidate
      ? {
          description: normalizeNullableTextForUpdate(candidate.description, 'Description', 500)
        }
      : {}),
    ...(candidate.isEnabled !== undefined ? { isEnabled: normalizeBoolean(candidate.isEnabled, 'isEnabled') } : {}),
    ...(normalizeOptionalText(candidate.versionLabel, 'Version label', 120) !== undefined
      ? { versionLabel: normalizeOptionalText(candidate.versionLabel, 'Version label', 120)! }
      : {}),
    ...('versionSummary' in candidate
      ? {
          versionSummary: normalizeNullableTextForUpdate(
            candidate.versionSummary,
            'Version summary',
            500
          )
        }
      : {})
  };
}

export function assertImportDesignSystemInput(input: unknown): ImportDesignSystemInput {
  const candidate = input as Record<string, unknown> | null;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system import input is required.'
    });
  }

  const workspaceId = normalizeOptionalId(candidate.workspaceId);
  const scope = normalizeOptionalScope(candidate.scope, workspaceId ? 'workspace' : undefined);

  if (scope !== undefined && scope !== 'workspace' && workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is allowed only for workspace design systems.'
    });
  }

  return {
    ...(scope !== undefined ? { scope } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(normalizeOptionalText(candidate.name, 'Design system name', 120) !== undefined
      ? { name: normalizeOptionalText(candidate.name, 'Design system name', 120)! }
      : {}),
    ...('description' in candidate
      ? {
          description: normalizeNullableTextForUpdate(candidate.description, 'Description', 500)
        }
      : {}),
    ...(candidate.isEnabled !== undefined ? { isEnabled: normalizeBoolean(candidate.isEnabled, 'isEnabled') } : {}),
    ...(normalizeOptionalText(candidate.versionLabel, 'Version label', 120) !== undefined
      ? { versionLabel: normalizeOptionalText(candidate.versionLabel, 'Version label', 120)! }
      : {}),
    ...('versionSummary' in candidate
      ? {
          versionSummary: normalizeNullableTextForUpdate(
            candidate.versionSummary,
            'Version summary',
            500
          )
        }
      : {}),
    exportPayload: normalizeDesignSystemExportPayload(candidate.exportPayload)
  };
}

export async function listDesignSystemsForUser(
  userId: string,
  options: {
    workspaceId?: string;
  } = {}
): Promise<DesignSystemSummary[]> {
  if (options.workspaceId) {
    await getWorkspaceForUser(options.workspaceId, userId);
  }

  const systems = await prisma.designSystem.findMany({
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
    include: designSystemSummaryInclude
  });

  return systems.map(mapDesignSystemSummary);
}

export async function getDesignSystemForUser(
  designSystemId: string,
  userId: string
): Promise<DesignSystemDetail> {
  const designSystem = await prisma.designSystem.findUnique({
    where: { id: designSystemId },
    include: designSystemDetailInclude
  });

  if (!designSystem) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Design system not found.'
    });
  }

  await assertCanReadDesignSystem(designSystem, userId);

  return mapDesignSystemDetail(designSystem);
}

export async function assertCanManageDesignSystemForUser(
  designSystemId: string,
  actorUserId: string,
  isGlobalAdmin: boolean
): Promise<void> {
  const designSystem = await prisma.designSystem.findUnique({
    where: { id: designSystemId },
    select: {
      scope: true,
      ownerUserId: true,
      workspaceId: true
    }
  });

  if (!designSystem) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Design system not found.'
    });
  }

  await assertCanManageDesignSystem(designSystem, actorUserId, isGlobalAdmin);
}

export async function createDesignSystem(
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: CreateDesignSystemInput
): Promise<DesignSystemDetail> {
  await assertCanManageDesignSystemScope(input.scope, input.workspaceId, actorUserId, isGlobalAdmin);

  const created = await prisma.designSystem.create({
    data: {
      scope: toPrismaDesignSystemScope(input.scope),
      ...(input.scope === 'personal' ? { ownerUserId: actorUserId } : {}),
      ...(input.scope === 'workspace' ? { workspaceId: input.workspaceId } : {}),
      name: input.name,
      description: input.description ?? null,
      isEnabled: input.isEnabled ?? true,
      currentVersionNumber: 1,
      versions: {
        create: {
          versionNumber: 1,
          label: input.versionLabel ?? 'Initial version',
          summary: input.versionSummary ?? null,
          documentJson: migrateLegacyDesignSystemDocument({
            tokens: input.tokens,
            components: input.components,
            exampleSlides: input.exampleSlides,
            archetypes: input.archetypes ?? [],
            rules: input.rules ?? []
          }) as unknown as Prisma.InputJsonValue,
          createdByUserId: actorUserId
        }
      }
    },
    include: designSystemDetailInclude
  });

  return mapDesignSystemDetail(created);
}

export async function updateDesignSystem(
  designSystemId: string,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: UpdateDesignSystemInput
): Promise<DesignSystemDetail> {
  const existing = await prisma.designSystem.findUnique({
    where: { id: designSystemId },
    include: designSystemDetailInclude
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Design system not found.'
    });
  }

  await assertCanManageDesignSystem(existing, actorUserId, isGlobalAdmin);

  const includesContentUpdate =
    input.tokens !== undefined || input.components !== undefined || input.exampleSlides !== undefined || input.archetypes !== undefined || input.rules !== undefined;

  if (!includesContentUpdate && (input.versionLabel !== undefined || input.versionSummary !== undefined)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Version metadata can be changed only when creating a new design system version.'
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (!includesContentUpdate) {
      return tx.designSystem.update({
        where: { id: designSystemId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {})
        },
        include: designSystemDetailInclude
      });
    }

    const currentVersion = existing.versions[0];

    if (!currentVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Current design system version is missing.'
      });
    }

    const currentDocument = documentFromVersionRecord(currentVersion);
    const nextDocument: DesignSystemDocument = {
      tokens: input.tokens ?? currentDocument.tokens,
      components: input.components ?? currentDocument.components,
      exampleSlides: input.exampleSlides ?? currentDocument.exampleSlides,
      archetypes: input.archetypes ?? currentDocument.archetypes,
      rules: input.rules ?? currentDocument.rules
    };
    const nextVersionNumber = existing.currentVersionNumber + 1;

    await tx.designSystem.update({
      where: { id: designSystemId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
        currentVersionNumber: nextVersionNumber,
        versions: {
          create: {
            versionNumber: nextVersionNumber,
            label: input.versionLabel ?? `Version ${nextVersionNumber}`,
            summary: input.versionSummary ?? null,
            documentJson: migrateLegacyDesignSystemDocument(nextDocument) as unknown as Prisma.InputJsonValue,
            createdByUserId: actorUserId
          }
        }
      }
    });

    const reloaded = await tx.designSystem.findUnique({
      where: { id: designSystemId },
      include: designSystemDetailInclude
    });

    if (!reloaded) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Design system not found.'
      });
    }

    return reloaded;
  });

  return mapDesignSystemDetail(updated);
}

export async function deleteDesignSystem(
  designSystemId: string,
  actorUserId: string,
  isGlobalAdmin: boolean
): Promise<void> {
  const existing = await prisma.designSystem.findUnique({
    where: { id: designSystemId },
    include: {
      workspace: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Design system not found.'
    });
  }

  await assertCanManageDesignSystem(existing, actorUserId, isGlobalAdmin);

  await prisma.designSystem.delete({
    where: { id: designSystemId }
  });
}

export async function duplicateDesignSystem(
  designSystemId: string,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: DuplicateDesignSystemInput
): Promise<DesignSystemDetail> {
  const source = await getDesignSystemForUser(designSystemId, actorUserId);
  const targetScope = input.scope ?? getDefaultDuplicateScope(source.scope);
  const targetWorkspaceId = resolveTargetWorkspaceId(
    targetScope,
    input.workspaceId,
    source.workspaceId ?? undefined
  );

  return createDesignSystem(actorUserId, isGlobalAdmin, {
    scope: targetScope,
    ...(targetWorkspaceId ? { workspaceId: targetWorkspaceId } : {}),
    name: input.name ?? buildDuplicateName(source.name),
    description:
      input.description !== undefined ? input.description ?? undefined : source.description ?? undefined,
    isEnabled: input.isEnabled ?? source.isEnabled,
    versionLabel: input.versionLabel ?? buildDerivedVersionLabel('Duplicated from', source.name),
    versionSummary:
      input.versionSummary !== undefined
        ? input.versionSummary ?? undefined
        : source.currentVersion.summary ?? `Duplicated from ${source.name}.`,
    tokens: source.currentVersion.document.tokens,
    components: source.currentVersion.document.components,
    exampleSlides: source.currentVersion.document.exampleSlides,
    archetypes: source.currentVersion.document.archetypes,
    rules: source.currentVersion.document.rules
  });
}

export async function exportDesignSystemForUser(
  designSystemId: string,
  userId: string
): Promise<DesignSystemExportPayload> {
  const designSystem = await getDesignSystemForUser(designSystemId, userId);

  return {
    format: DESIGN_SYSTEM_EXPORT_FORMAT,
    version: DESIGN_SYSTEM_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      id: designSystem.id,
      scope: designSystem.scope,
      workspaceId: designSystem.workspaceId,
      workspaceName: designSystem.workspaceName,
      name: designSystem.name,
      description: designSystem.description,
      isEnabled: designSystem.isEnabled,
      currentVersionNumber: designSystem.currentVersionNumber
    },
    currentVersion: {
      versionNumber: designSystem.currentVersion.versionNumber,
      label: designSystem.currentVersion.label,
      summary: designSystem.currentVersion.summary,
      document: designSystem.currentVersion.document
    }
  };
}

export async function importDesignSystem(
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: ImportDesignSystemInput
): Promise<DesignSystemDetail> {
  const targetScope = input.scope ?? 'personal';
  const targetWorkspaceId = resolveTargetWorkspaceId(targetScope, input.workspaceId);
  const exported = input.exportPayload;

  return createDesignSystem(actorUserId, isGlobalAdmin, {
    scope: targetScope,
    ...(targetWorkspaceId ? { workspaceId: targetWorkspaceId } : {}),
    name: input.name ?? exported.source.name,
    description:
      input.description !== undefined
        ? input.description ?? undefined
        : exported.source.description ?? undefined,
    isEnabled: input.isEnabled ?? exported.source.isEnabled,
    versionLabel: input.versionLabel ?? exported.currentVersion.label,
    versionSummary:
      input.versionSummary !== undefined
        ? input.versionSummary ?? undefined
        : exported.currentVersion.summary ?? undefined,
    tokens: exported.currentVersion.document.tokens,
    components: exported.currentVersion.document.components,
    exampleSlides: exported.currentVersion.document.exampleSlides,
    archetypes: exported.currentVersion.document.archetypes,
    rules: exported.currentVersion.document.rules
  });
}

const designSystemSummaryInclude = {
  workspace: {
    select: {
      id: true,
      name: true
    }
  },
  versions: {
    orderBy: [{ versionNumber: 'desc' }],
    take: 1,
    include: {
      createdByUser: {
        include: {
          profile: true
        }
      }
    }
  },
  _count: {
    select: {
      versions: true
    }
  }
} satisfies Prisma.DesignSystemInclude;

const designSystemDetailInclude = {
  workspace: {
    select: {
      id: true,
      name: true
    }
  },
  versions: {
    orderBy: [{ versionNumber: 'desc' }],
    include: {
      createdByUser: {
        include: {
          profile: true
        }
      }
    }
  },
  _count: {
    select: {
      versions: true
    }
  }
} satisfies Prisma.DesignSystemInclude;

async function assertCanReadDesignSystem(
  designSystem: {
    scope: DesignSystemScope;
    ownerUserId: string | null;
    workspaceId: string | null;
  },
  userId: string
): Promise<void> {
  switch (designSystem.scope) {
    case 'GLOBAL':
      return;
    case 'PERSONAL':
      if (designSystem.ownerUserId === userId) {
        return;
      }
      break;
    case 'WORKSPACE':
      if (designSystem.workspaceId) {
        await getWorkspaceForUser(designSystem.workspaceId, userId);
        return;
      }
      break;
  }

  throw createError({
    statusCode: 404,
    statusMessage: 'Design system not found.'
  });
}

async function assertCanManageDesignSystem(
  designSystem: {
    scope: DesignSystemScope;
    ownerUserId: string | null;
    workspaceId: string | null;
  },
  actorUserId: string,
  isGlobalAdmin: boolean
): Promise<void> {
  switch (designSystem.scope) {
    case 'GLOBAL':
      assertGlobalAdminAccess(isGlobalAdmin);
      return;
    case 'PERSONAL':
      if (designSystem.ownerUserId !== actorUserId) {
        throw createError({
          statusCode: 403,
          statusMessage: 'You can manage only your own personal design systems.'
        });
      }
      return;
    case 'WORKSPACE':
      if (!designSystem.workspaceId) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Workspace design system is missing its workspace.'
        });
      }

      await assertCanManageWorkspaceDesignSystems(designSystem.workspaceId, actorUserId);
      return;
  }
}

async function assertCanManageDesignSystemScope(
  scope: DesignSystemScopeInput,
  workspaceId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean
): Promise<void> {
  switch (scope) {
    case 'global':
      assertGlobalAdminAccess(isGlobalAdmin);
      return;
    case 'personal':
      return;
    case 'workspace':
      await assertCanManageWorkspaceDesignSystems(workspaceId!, actorUserId);
  }
}

async function assertCanManageWorkspaceDesignSystems(
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

function assertDesignSystemScope(value: string): DesignSystemScopeInput {
  if (isDesignSystemScopeInput(value)) {
    return value;
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Design system scope must be one of: personal, workspace, global.'
  });
}

function normalizeOptionalScope(
  value: unknown,
  fallback?: DesignSystemScopeInput
): DesignSystemScopeInput | undefined {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Design system scope must be a string.'
    });
  }

  return assertDesignSystemScope(value);
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

function normalizeDesignSystemExportPayload(value: unknown): DesignSystemExportPayload {
  const candidate = value as Record<string, unknown> | null;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'exportPayload is required.'
    });
  }

  if (candidate.format !== DESIGN_SYSTEM_EXPORT_FORMAT) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported design system export format.'
    });
  }

  if (candidate.version !== DESIGN_SYSTEM_EXPORT_VERSION) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported design system export version.'
    });
  }

  const source = asRecordForImport(candidate.source, 'Design system export source is required.');
  const currentVersion = asRecordForImport(
    candidate.currentVersion,
    'Design system export currentVersion is required.'
  );
  const workspaceId = normalizeOptionalId(source.workspaceId);

  return {
    format: DESIGN_SYSTEM_EXPORT_FORMAT,
    version: DESIGN_SYSTEM_EXPORT_VERSION,
    exportedAt: normalizeIsoTimestamp(candidate.exportedAt, 'Design system export exportedAt'),
    source: {
      id: normalizeRequiredText(source.id, 'Design system export source id', 191),
      scope: assertDesignSystemScope(normalizeRequiredText(source.scope, 'Design system export source scope', 32)),
      workspaceId: workspaceId ?? null,
      workspaceName: normalizeNullableTextForUpdate(
        source.workspaceName,
        'Design system export workspaceName',
        120
      ),
      name: normalizeRequiredText(source.name, 'Design system export source name', 120),
      description: normalizeNullableTextForUpdate(
        source.description,
        'Design system export source description',
        500
      ),
      isEnabled: normalizeBoolean(source.isEnabled, 'Design system export source isEnabled'),
      currentVersionNumber: normalizePositiveInteger(
        source.currentVersionNumber,
        'Design system export source currentVersionNumber'
      )
    },
    currentVersion: {
      versionNumber: normalizePositiveInteger(
        currentVersion.versionNumber,
        'Design system export currentVersion versionNumber'
      ),
      label: normalizeRequiredText(
        currentVersion.label,
        'Design system export currentVersion label',
        120
      ),
      summary: normalizeNullableTextForUpdate(
        currentVersion.summary,
        'Design system export currentVersion summary',
        500
      ),
      document: normalizeDesignSystemDocument(currentVersion.document)
    }
  };
}

function normalizeBoolean(value: unknown, fieldLabel: string): boolean {
  if (typeof value !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be a boolean.`
    });
  }

  return value;
}

function normalizePositiveInteger(value: unknown, fieldLabel: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be a positive integer.`
    });
  }

  return value;
}

function normalizeIsoTimestamp(value: unknown, fieldLabel: string): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be a string.`
    });
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldLabel} must be a valid ISO timestamp.`
    });
  }

  return date.toISOString();
}

function normalizeTokens(value: unknown): DesignSystemTokenSet {
  try {
    return normalizeDesignSystemTokens(value);
  } catch (error) {
    throw mapValidationError(error);
  }
}

function normalizeComponents(
  value: unknown,
  options?: { enforceQuality?: boolean }
): DesignSystemComponent[] {
  try {
    return normalizeDesignSystemComponents(value, options);
  } catch (error) {
    throw mapValidationError(error);
  }
}

function normalizeExampleSlides(
  value: unknown,
  options?: { enforceQuality?: boolean }
): DesignSystemExampleSlide[] {
  try {
    return normalizeDesignSystemExampleSlides(value, options);
  } catch (error) {
    throw mapValidationError(error);
  }
}

function normalizeArchetypes(value: unknown): DesignSystemSlideArchetype[] {
  try {
    return normalizeDesignSystemArchetypes(value);
  } catch (error) {
    throw mapValidationError(error);
  }
}

function normalizeRules(value: unknown): DesignSystemRule[] {
  try {
    return normalizeDesignSystemRules(value);
  } catch (error) {
    throw mapValidationError(error);
  }
}

function mapValidationError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Design system content is invalid.';

  return createError({
    statusCode: 400,
    statusMessage: message
  });
}

function mapDesignSystemSummary(
  designSystem: {
    id: string;
    scope: DesignSystemScope;
    name: string;
    description: string | null;
    isEnabled: boolean;
    currentVersionNumber: number;
    createdAt: Date;
    updatedAt: Date;
    workspace: {
      id: string;
      name: string;
    } | null;
    versions: DesignSystemVersionRecord[];
    _count: {
      versions: number;
    };
  }
): DesignSystemSummary {
  const currentVersion = designSystem.versions[0];

  if (!currentVersion) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Design system version history is missing.'
    });
  }

  return {
    id: designSystem.id,
    scope: fromPrismaDesignSystemScope(designSystem.scope),
    name: designSystem.name,
    description: designSystem.description,
    isEnabled: designSystem.isEnabled,
    workspaceId: designSystem.workspace?.id ?? null,
    workspaceName: designSystem.workspace?.name ?? null,
    currentVersionNumber: designSystem.currentVersionNumber,
    versionCount: designSystem._count.versions,
    createdAt: designSystem.createdAt.toISOString(),
    updatedAt: designSystem.updatedAt.toISOString(),
    currentVersion: mapVersionSummary(currentVersion)
  };
}

function mapDesignSystemDetail(
  designSystem: {
    id: string;
    scope: DesignSystemScope;
    name: string;
    description: string | null;
    isEnabled: boolean;
    currentVersionNumber: number;
    createdAt: Date;
    updatedAt: Date;
    workspace: {
      id: string;
      name: string;
    } | null;
    versions: DesignSystemVersionRecord[];
    _count: {
      versions: number;
    };
  }
): DesignSystemDetail {
  const summary = mapDesignSystemSummary(designSystem);
  const currentVersion = designSystem.versions[0];

  if (!currentVersion) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Design system version history is missing.'
    });
  }

  return {
    ...summary,
    currentVersion: mapVersionDetail(currentVersion),
    versions: designSystem.versions.map(mapVersionSummary),
    documentV2: documentV2FromVersionRecord(currentVersion)
  };
}

type DesignSystemVersionRecord = {
  id: string;
  versionNumber: number;
  label: string;
  summary: string | null;
  documentJson: Prisma.JsonValue;
  createdAt: Date;
  createdByUser: {
    id: string;
    email: string;
    profile: {
      name: string;
    } | null;
  };
};

/** Resolves the canonical V2 bucketed document for a version. */
function documentV2FromVersionRecord(version: DesignSystemVersionRecord): DesignSystemDocumentV2 | null {
  if (!version.documentJson) return null;
  try {
    return normalizeDesignSystemDocumentV2(version.documentJson, { enforceQuality: false });
  } catch {
    return null;
  }
}

function mapVersionSummary(version: DesignSystemVersionRecord): DesignSystemVersionSummary {
  const document = documentFromVersionRecord(version);
  const counts = summarizeDesignSystemDocument(document);

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    label: version.label,
    summary: version.summary,
    createdAt: version.createdAt.toISOString(),
    createdByUser: {
      id: version.createdByUser.id,
      email: version.createdByUser.email,
      name: version.createdByUser.profile?.name ?? null
    },
    counts
  };
}

function mapVersionDetail(version: DesignSystemVersionRecord): DesignSystemVersionDetail {
  return {
    ...mapVersionSummary(version),
    document: documentFromVersionRecord(version)
  };
}

/**
 * Legacy-shaped projection of a version's V2 document, used for the version counts and
 * the legacy `document` field on DesignSystemVersionDetail / export payloads. The studio
 * UI consumes documentV2 directly; this is a flattened convenience view.
 */
function documentFromVersionRecord(version: { documentJson: Prisma.JsonValue }): DesignSystemDocument {
  if (!version.documentJson) {
    return { tokens: { colors: [], typography: [], spacing: [] }, components: [], exampleSlides: [], archetypes: [], rules: [] };
  }
  try {
    return projectV2ToLegacyDocument(normalizeDesignSystemDocumentV2(version.documentJson, { enforceQuality: false }));
  } catch {
    return { tokens: { colors: [], typography: [], spacing: [] }, components: [], exampleSlides: [], archetypes: [], rules: [] };
  }
}

function toPrismaDesignSystemScope(scope: DesignSystemScopeInput): DesignSystemScope {
  switch (scope) {
    case 'personal':
      return 'PERSONAL';
    case 'workspace':
      return 'WORKSPACE';
    case 'global':
      return 'GLOBAL';
  }
}

function fromPrismaDesignSystemScope(scope: DesignSystemScope): DesignSystemScopeInput {
  switch (scope) {
    case 'PERSONAL':
      return 'personal';
    case 'WORKSPACE':
      return 'workspace';
    case 'GLOBAL':
      return 'global';
  }
}

function getDefaultDuplicateScope(sourceScope: DesignSystemScopeInput): DesignSystemScopeInput {
  return sourceScope === 'global' ? 'personal' : sourceScope;
}

function resolveTargetWorkspaceId(
  scope: DesignSystemScopeInput,
  requestedWorkspaceId: string | undefined,
  fallbackWorkspaceId?: string
): string | undefined {
  if (scope !== 'workspace') {
    return undefined;
  }

  const workspaceId = requestedWorkspaceId ?? fallbackWorkspaceId;

  if (!workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspaceId is required for workspace design systems.'
    });
  }

  return workspaceId;
}

function buildDuplicateName(name: string): string {
  return truncateText(`${name} Copy`, 120);
}

function buildDerivedVersionLabel(prefix: string, sourceName: string): string {
  return truncateText(`${prefix} ${sourceName}`, 120);
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd();
}

function asRecordForImport(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: message
    });
  }

  return value as Record<string, unknown>;
}
