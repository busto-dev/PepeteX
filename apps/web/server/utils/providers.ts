import { createHash } from 'node:crypto';

import { createError } from 'h3';

import type { CreateAuditLogInput } from '@pepetex/audit';
import { loadConfig } from '@pepetex/config';
import { Prisma, prisma, type ProviderKind } from '@pepetex/db';
import {
  type CostEstimateResult,
  createTextProviderAdapter,
  decryptProviderCredentialPayload,
  encryptProviderCredentialPayload,
  inferCLIProxyRouteKind,
  maskSecret,
  type ManualModelDescriptor,
  type ProviderFileRef,
  stableProviderHeaderHash,
  textProviderKinds,
  type ModelDescriptor,
  type ProviderHealth,
  type ProviderFileUploadInput,
  type ProviderCredentialPayload,
  type TextProviderKind
} from '@pepetex/providers';

import { getWorkspaceProviderPolicyRestrictions } from './workspaces';

export interface ProviderCredentialSummary {
  id: string;
  scope: 'user' | 'system';
  label: string;
  apiKeyPreview: string;
  manualModels?: ManualModelDescriptor[];
  createdAt: string;
  updatedAt: string;
}

export interface RevealedProviderCredential {
  id: string;
  providerDefinitionId: string;
  scope: 'user' | 'system';
  label: string;
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  customHeaders?: Record<string, string>;
  manualModels?: ManualModelDescriptor[];
}

export interface ProviderDefinitionSummary {
  id: string;
  name: string;
  kind: TextProviderKind;
  enabled: boolean;
  allowUserCredentials: boolean;
  baseUrl: string | null;
  hasSystemCredential: boolean;
  userCredentials: ProviderCredentialSummary[];
  systemCredentials?: ProviderCredentialSummary[];
}

export interface ProviderModelsResult {
  providerId: string;
  kind: TextProviderKind;
  credentialScope: 'user' | 'system';
  models: ModelDescriptor[];
  defaultModelId: string | null;
  configurationError?: string;
  cliproxyRouteKind?: ReturnType<typeof inferCLIProxyRouteKind>;
}

export interface ProviderConnectionTestResult extends ProviderHealth {
  providerId: string;
  kind: TextProviderKind;
  credentialScope: 'user' | 'system';
  retryable?: boolean;
}

export interface ProviderCostEstimateResult extends CostEstimateResult {
  providerId: string;
  kind: TextProviderKind;
  cliproxyRouteKind?: ReturnType<typeof inferCLIProxyRouteKind>;
}

export interface ProviderReferenceFileBridgeInput extends ProviderFileUploadInput {
  credentialId?: string;
  workspaceId?: string;
}

export interface ProviderReferenceFileBridgeResult extends ProviderFileRef {
  providerId: string;
  kind: TextProviderKind;
  credentialScope: 'user' | 'system';
  cliproxyRouteKind?: ReturnType<typeof inferCLIProxyRouteKind>;
}

export interface ProviderReferenceFileDeleteInput {
  providerFileId: string;
  credentialId?: string;
  workspaceId?: string;
}

const PROVIDER_MODEL_CACHE_TTL_MS = 15 * 60 * 1000;

export interface CreateProviderDefinitionInput {
  name: string;
  kind: TextProviderKind;
  enabled: boolean;
  allowUserCredentials: boolean;
  baseUrl: string | null;
}

export interface UpdateProviderDefinitionInput {
  providerId: string;
  name?: string;
  enabled?: boolean;
  allowUserCredentials?: boolean;
  baseUrl?: string | null;
}

export interface UpsertProviderCredentialPayloadInput {
  providerDefinitionId?: string;
  label?: string;
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
  customHeaders?: Record<string, string>;
  manualModels?: ManualModelDescriptor[];
  scope?: 'user' | 'system';
}

export interface ValidatedUpsertProviderCredentialInput {
  providerDefinitionId?: string;
  label: string;
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  customHeaders?: Record<string, string>;
  manualModels?: ManualModelDescriptor[];
  scope: 'user' | 'system';
}

export interface ProviderCostEstimateInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  workspaceId?: string;
}

export function assertCreateProviderDefinitionInput(
  input: unknown
): CreateProviderDefinitionInput {
  const candidate = input as Partial<CreateProviderDefinitionInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.kind !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider name and kind are required.'
    });
  }

  const name = candidate.name.trim();
  const kind = assertProviderKind(candidate.kind);
  const baseUrl = normalizeOptionalUrl(candidate.baseUrl);

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider name is required.'
    });
  }

  if ((kind === 'openai-compatible' || kind === 'cliproxyapi') && !baseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Base URL is required for OpenAI-compatible and CLIProxyAPI providers.'
    });
  }

  return {
    name,
    kind,
    enabled: candidate.enabled ?? true,
    allowUserCredentials: candidate.allowUserCredentials ?? false,
    baseUrl
  };
}

export function assertUpdateProviderDefinitionInput(
  providerId: string | undefined,
  input: unknown
): UpdateProviderDefinitionInput {
  const normalizedProviderId = providerId?.trim();
  const candidate = input as Partial<CreateProviderDefinitionInput> | null;

  if (!normalizedProviderId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider id is required.'
    });
  }

  if (!candidate || typeof candidate !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider update input is required.'
    });
  }

  const update: UpdateProviderDefinitionInput = {
    providerId: normalizedProviderId
  };

  if ('name' in candidate) {
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Provider name must be a non-empty string.'
      });
    }

    update.name = candidate.name.trim();
  }

  if ('enabled' in candidate) {
    if (typeof candidate.enabled !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Enabled must be a boolean.'
      });
    }

    update.enabled = candidate.enabled;
  }

  if ('allowUserCredentials' in candidate) {
    if (typeof candidate.allowUserCredentials !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'allowUserCredentials must be a boolean.'
      });
    }

    update.allowUserCredentials = candidate.allowUserCredentials;
  }

  if ('baseUrl' in candidate) {
    update.baseUrl = normalizeOptionalUrl(candidate.baseUrl);
  }

  if (Object.keys(update).length === 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one provider field must be updated.'
    });
  }

  return update;
}

export function assertUpsertProviderCredentialInput(
  input: unknown,
  mode: 'create' | 'update'
): ValidatedUpsertProviderCredentialInput {
  const candidate = input as UpsertProviderCredentialPayloadInput | null;

  if (!candidate || typeof candidate !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Credential input is required.'
    });
  }

  const providerDefinitionId = candidate.providerDefinitionId?.trim();
  const label = candidate.label?.trim();
  const apiKey = candidate.apiKey?.trim();

  if (mode === 'create' && !providerDefinitionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider definition id is required.'
    });
  }

  if (!label) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Credential label is required.'
    });
  }

  if (!apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider API key is required.'
    });
  }

  return {
    providerDefinitionId,
    label,
    apiKey,
    organizationId: normalizeOptionalText(candidate.organizationId),
    projectId: normalizeOptionalText(candidate.projectId),
    customHeaders: normalizeCustomHeaders(candidate.customHeaders),
    manualModels: normalizeManualModels(candidate.manualModels),
    scope: candidate.scope === 'system' ? 'system' : 'user'
  };
}

export function assertProviderCostEstimateInput(input: unknown): ProviderCostEstimateInput {
  const candidate = input as Partial<ProviderCostEstimateInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.model !== 'string' ||
    candidate.model.trim().length === 0
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Model is required.'
    });
  }

  const inputTokens = assertNonNegativeTokenCount(candidate.inputTokens, 'inputTokens');
  const outputTokens = assertNonNegativeTokenCount(candidate.outputTokens, 'outputTokens');
  const workspaceId =
    typeof candidate.workspaceId === 'string' && candidate.workspaceId.trim()
      ? candidate.workspaceId.trim()
      : undefined;

  return {
    model: candidate.model.trim(),
    inputTokens,
    outputTokens,
    ...(workspaceId ? { workspaceId } : {})
  };
}

export async function listProvidersForUser(
  userId: string,
  isGlobalAdmin: boolean,
  options: {
    workspaceId?: string;
  } = {}
): Promise<ProviderDefinitionSummary[]> {
  const workspacePolicyRestrictions = options.workspaceId
    ? await getWorkspaceProviderPolicyRestrictions(options.workspaceId, userId)
    : null;
  const definitions = await prisma.providerDefinition.findMany({
    where: {
      ...(options.workspaceId || !isGlobalAdmin ? { enabled: true } : {}),
      ...(workspacePolicyRestrictions
        ? {
            id: {
              in: [...workspacePolicyRestrictions.keys()]
            }
          }
        : {})
    },
    orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    include: {
      credentials: {
        where: isGlobalAdmin
          ? {
              OR: [{ scope: 'SYSTEM' }, { ownerUserId: userId }]
            }
          : {
              ownerUserId: userId
            },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  const systemCredentialCounts = await Promise.all(
    definitions.map((definition) =>
      isGlobalAdmin && definition.credentials.some((credential) => credential.scope === 'SYSTEM')
        ? Promise.resolve(1)
        : prisma.providerCredential.count({
            where: {
              providerDefinitionId: definition.id,
              scope: 'SYSTEM'
            }
          })
    )
  );

  return definitions.map((definition, index) => ({
    id: definition.id,
    name: definition.name,
    kind: fromPrismaProviderKind(definition.kind),
    enabled: definition.enabled,
    allowUserCredentials: definition.allowUserCredentials,
    baseUrl: definition.baseUrl,
    hasSystemCredential: (systemCredentialCounts[index] ?? 0) > 0,
    userCredentials: definition.credentials
      .filter((credential) => credential.scope === 'USER')
      .map(mapProviderCredentialSummary),
    systemCredentials: isGlobalAdmin
      ? definition.credentials
          .filter((credential) => credential.scope === 'SYSTEM')
          .map(mapProviderCredentialSummary)
      : undefined
  }));
}

export async function createProviderDefinition(
  input: CreateProviderDefinitionInput
): Promise<ProviderDefinitionSummary> {
  try {
    const provider = await prisma.providerDefinition.create({
      data: {
        name: input.name,
        kind: toPrismaProviderKind(input.kind),
        enabled: input.enabled,
        allowUserCredentials: input.allowUserCredentials,
        baseUrl: input.baseUrl
      },
      include: {
        credentials: {
          where: {
            scope: 'SYSTEM'
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    return {
      id: provider.id,
      name: provider.name,
      kind: fromPrismaProviderKind(provider.kind),
      enabled: provider.enabled,
      allowUserCredentials: provider.allowUserCredentials,
      baseUrl: provider.baseUrl,
      hasSystemCredential: provider.credentials.length > 0,
      userCredentials: [],
      systemCredentials: provider.credentials.map(mapProviderCredentialSummary)
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'A provider definition with that name already exists.'
      });
    }

    throw error;
  }
}

export async function updateProviderDefinition(
  input: UpdateProviderDefinitionInput
): Promise<ProviderDefinitionSummary> {
  const existing = await prisma.providerDefinition.findUnique({
    where: { id: input.providerId },
    select: {
      id: true,
      kind: true,
      baseUrl: true
    }
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider definition not found.'
    });
  }

  const kind = fromPrismaProviderKind(existing.kind);
  const nextBaseUrl = input.baseUrl !== undefined ? input.baseUrl : existing.baseUrl;

  if ((kind === 'openai-compatible' || kind === 'cliproxyapi') && !nextBaseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Base URL is required for OpenAI-compatible and CLIProxyAPI providers.'
    });
  }

  try {
    const provider = await prisma.providerDefinition.update({
      where: { id: input.providerId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.allowUserCredentials !== undefined
          ? { allowUserCredentials: input.allowUserCredentials }
          : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {})
      },
      include: {
        credentials: {
          where: {
            scope: 'SYSTEM'
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    return {
      id: provider.id,
      name: provider.name,
      kind: fromPrismaProviderKind(provider.kind),
      enabled: provider.enabled,
      allowUserCredentials: provider.allowUserCredentials,
      baseUrl: provider.baseUrl,
      hasSystemCredential: provider.credentials.length > 0,
      userCredentials: [],
      systemCredentials: provider.credentials.map(mapProviderCredentialSummary)
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'A provider definition with that name already exists.'
      });
    }

    throw error;
  }
}

export async function createProviderCredential(
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: ValidatedUpsertProviderCredentialInput
): Promise<ProviderCredentialSummary> {
  const providerDefinition = await prisma.providerDefinition.findUnique({
    where: { id: input.providerDefinitionId },
    select: {
      id: true,
      enabled: true,
      allowUserCredentials: true
    }
  });

  if (!providerDefinition) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider definition not found.'
    });
  }

  if (input.scope === 'system' && !isGlobalAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Global admin access is required for system provider credentials.'
    });
  }

  if (input.scope === 'user' && !providerDefinition.allowUserCredentials) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provider does not allow user-managed credentials.'
    });
  }

  if (input.scope === 'user' && !providerDefinition.enabled) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot add user credentials for a disabled provider.'
    });
  }

  const credential = await prisma.providerCredential.create({
    data: createProviderCredentialCreateInput(actorUserId, input)
  });

  return mapProviderCredentialSummary(credential);
}

export async function updateProviderCredential(
  credentialId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: ValidatedUpsertProviderCredentialInput
): Promise<ProviderCredentialSummary> {
  const normalizedCredentialId = credentialId?.trim();

  if (!normalizedCredentialId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider credential id is required.'
    });
  }

  const existing = await prisma.providerCredential.findUnique({
    where: { id: normalizedCredentialId },
    include: {
      providerDefinition: {
        select: {
          enabled: true,
          allowUserCredentials: true
        }
      }
    }
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider credential not found.'
    });
  }

  if (existing.scope === 'SYSTEM') {
    if (!isGlobalAdmin) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Global admin access is required for system provider credentials.'
      });
    }
  } else if (existing.ownerUserId !== actorUserId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You can update only your own provider credentials.'
    });
  }

  if (existing.scope === 'USER' && !existing.providerDefinition.allowUserCredentials) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provider does not allow user-managed credentials.'
    });
  }

  if (existing.scope === 'USER' && !existing.providerDefinition.enabled) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot update user credentials for a disabled provider.'
    });
  }

  const previousPayload = decryptProviderCredentialPayload(
    existing.encryptedPayload,
    requireProviderCredentialEncryptionKey()
  );
  const nextPayload: ProviderCredentialPayload = {
    apiKey: input.apiKey,
    organizationId: input.organizationId ?? previousPayload.organizationId,
    projectId: input.projectId ?? previousPayload.projectId,
    customHeaders: input.customHeaders ?? previousPayload.customHeaders,
    manualModels: input.manualModels ?? previousPayload.manualModels
  };

  const updated = await prisma.providerCredential.update({
    where: { id: normalizedCredentialId },
    data: {
      label: input.label,
      encryptedPayload: encryptProviderCredentialPayload(
        nextPayload,
        requireProviderCredentialEncryptionKey()
      ),
      apiKeyPreview: maskSecret(nextPayload.apiKey),
      customHeadersHash: stableProviderHeaderHash(nextPayload.customHeaders)
    }
  });

  return mapProviderCredentialSummary(updated);
}

export async function updateProviderCredentialManualModels(
  credentialId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  manualModels: ManualModelDescriptor[]
): Promise<ProviderCredentialSummary> {
  const normalizedCredentialId = credentialId?.trim();

  if (!normalizedCredentialId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider credential id is required.'
    });
  }

  const existing = await prisma.providerCredential.findUnique({
    where: { id: normalizedCredentialId },
    select: {
      id: true,
      scope: true,
      ownerUserId: true,
      label: true,
      encryptedPayload: true,
      apiKeyPreview: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider credential not found.'
    });
  }

  if (existing.scope === 'SYSTEM') {
    if (!isGlobalAdmin) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Global admin access is required for system provider credentials.'
      });
    }
  } else if (existing.ownerUserId !== actorUserId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You can update only your own provider credentials.'
    });
  }

  const previousPayload = decryptProviderCredentialPayload(
    existing.encryptedPayload,
    requireProviderCredentialEncryptionKey()
  );
  const nextPayload: ProviderCredentialPayload = {
    ...previousPayload,
    manualModels: normalizeManualModels(manualModels)
  };

  const updated = await prisma.providerCredential.update({
    where: { id: normalizedCredentialId },
    data: {
      encryptedPayload: encryptProviderCredentialPayload(
        nextPayload,
        requireProviderCredentialEncryptionKey()
      )
    }
  });

  return mapProviderCredentialSummary(updated);
}

export async function revealProviderCredential(
  credentialId: string | undefined,
  actorUserId: string
): Promise<RevealedProviderCredential> {
  const normalizedCredentialId = credentialId?.trim();

  if (!normalizedCredentialId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider credential id is required.'
    });
  }

  const credential = await prisma.providerCredential.findUnique({
    where: { id: normalizedCredentialId },
    select: {
      id: true,
      providerDefinitionId: true,
      scope: true,
      ownerUserId: true,
      label: true,
      encryptedPayload: true
    }
  });

  if (!credential) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider credential not found.'
    });
  }

  const payload = decryptProviderCredentialPayload(
    credential.encryptedPayload,
    requireProviderCredentialEncryptionKey()
  );

  await prisma.auditLog.create({
    data: createAuditLogInput({
      actorUserId,
      action: 'admin.provider-credential.reveal',
      targetType: 'provider_credential',
      targetId: credential.id,
      metadata: {
        providerDefinitionId: credential.providerDefinitionId,
        scope: credential.scope === 'SYSTEM' ? 'system' : 'user',
        ownerUserId: credential.ownerUserId,
        label: credential.label
      }
    })
  });

  return {
    id: credential.id,
    providerDefinitionId: credential.providerDefinitionId,
    scope: credential.scope === 'SYSTEM' ? 'system' : 'user',
    label: credential.label,
    apiKey: payload.apiKey,
    ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
    ...(payload.customHeaders ? { customHeaders: payload.customHeaders } : {}),
    ...(payload.manualModels ? { manualModels: payload.manualModels } : {})
  };
}

export async function listProviderModels(
  providerId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  options: {
    credentialId?: string;
    manualModelIds?: string[];
    workspaceId?: string;
  } = {}
): Promise<ProviderModelsResult> {
  const workspacePolicyRestrictions = options.workspaceId
    ? await getWorkspaceProviderPolicyRestrictions(options.workspaceId, actorUserId)
    : null;
  try {
    const resolved = await resolveProviderExecutionContext(
      providerId,
      actorUserId,
      isGlobalAdmin,
      options.credentialId
    );
    assertWorkspaceProviderIsAllowed(
      workspacePolicyRestrictions,
      resolved.definition.id,
      resolved.definition.enabled,
      options.workspaceId
    );
    const manualModels = normalizeManualModels([
      ...(resolved.payload.manualModels ?? []),
      ...normalizeManualModelIdsForCache(options.manualModelIds).map((id) => ({ id, label: id }))
    ]);
    const cacheKey = createProviderModelCacheKey(resolved, manualModels);
    const cachedModels = await readProviderModelCache(resolved.definition.id, cacheKey);
    const models =
      cachedModels ??
      (await fetchAndCacheProviderModels({
        cacheKey,
        resolved,
        manualModels
      }));
    const filteredModels = filterModelsForWorkspacePolicy(
      models,
      workspacePolicyRestrictions,
      resolved.definition.id
    );

    return createProviderModelsResult(resolved, filteredModels);
  } catch (error) {
    throwFriendlyProviderFailure(error, {
      operation: 'model-discovery',
      isGlobalAdmin
    });
  }
}

export async function testProviderConnection(
  providerId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  options: {
    credentialId?: string;
    workspaceId?: string;
  } = {}
): Promise<ProviderConnectionTestResult> {
  const workspacePolicyRestrictions = options.workspaceId
    ? await getWorkspaceProviderPolicyRestrictions(options.workspaceId, actorUserId)
    : null;
  try {
    const resolved = await resolveProviderExecutionContext(
      providerId,
      actorUserId,
      isGlobalAdmin,
      options.credentialId
    );
    assertWorkspaceProviderIsAllowed(
      workspacePolicyRestrictions,
      resolved.definition.id,
      resolved.definition.enabled,
      options.workspaceId
    );
    const health = await resolved.adapter.testConnection({
      baseUrl: resolved.definition.baseUrl,
      credential: resolved.payload
    });
    const result: ProviderConnectionTestResult = {
      providerId: resolved.definition.id,
      kind: resolved.kind,
      credentialScope: resolved.credentialScope,
      ...health
    };

    if (!health.ok) {
      const friendlyFailure = classifyProviderFailure(
        health.diagnostic ?? health.message,
        'connection-test'
      );

      result.message = friendlyFailure.statusMessage;
      result.retryable = friendlyFailure.retryable;

      if (!isGlobalAdmin) {
        delete result.diagnostic;
      }
    }

    return result;
  } catch (error) {
    throwFriendlyProviderFailure(error, {
      operation: 'connection-test',
      isGlobalAdmin
    });
  }
}

export async function estimateProviderCost(
  providerId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: ProviderCostEstimateInput
): Promise<ProviderCostEstimateResult> {
  const workspacePolicyRestrictions = input.workspaceId
    ? await getWorkspaceProviderPolicyRestrictions(input.workspaceId, actorUserId)
    : null;
  const normalizedProviderId = providerId?.trim();

  if (!normalizedProviderId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider id is required.'
    });
  }

  const definition = await prisma.providerDefinition.findUnique({
    where: { id: normalizedProviderId },
    select: {
      id: true,
      kind: true,
      enabled: true,
      baseUrl: true
    }
  });

  if (!definition) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider definition not found.'
    });
  }

  assertProviderIsEnabledForUser(definition.enabled, isGlobalAdmin);
  assertWorkspaceProviderIsAllowed(
    workspacePolicyRestrictions,
    definition.id,
    definition.enabled,
    input.workspaceId
  );
  assertWorkspaceModelIsAllowed(
    workspacePolicyRestrictions,
    definition.id,
    input.model,
    input.workspaceId
  );

  const kind = fromPrismaProviderKind(definition.kind);
  const estimate = await createTextProviderAdapter(kind).estimateCost(
    {
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens
    },
    {
      baseUrl: definition.baseUrl,
      credential: {
        apiKey: '__unused_for_cost_estimation__'
      }
    }
  );

  return {
    providerId: definition.id,
    kind,
    ...estimate,
    ...(kind === 'cliproxyapi'
      ? {
          cliproxyRouteKind: inferCLIProxyRouteKind(definition.baseUrl ?? '')
        }
      : {})
  };
}

export async function uploadProviderReferenceFile(
  providerId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: ProviderReferenceFileBridgeInput
): Promise<ProviderReferenceFileBridgeResult> {
  const workspacePolicyRestrictions = input.workspaceId
    ? await getWorkspaceProviderPolicyRestrictions(input.workspaceId, actorUserId)
    : null;

  try {
    const resolved = await resolveProviderExecutionContext(
      providerId,
      actorUserId,
      isGlobalAdmin,
      input.credentialId
    );

    assertWorkspaceProviderIsAllowed(
      workspacePolicyRestrictions,
      resolved.definition.id,
      resolved.definition.enabled,
      input.workspaceId
    );

    if (!resolved.adapter.uploadReferenceFile) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'This provider does not support reference-file uploads in the current PepeteX implementation.'
      });
    }

    const providerFile = await resolved.adapter.uploadReferenceFile(
      {
        filename: input.filename,
        mimeType: input.mimeType,
        content: input.content
      },
      {
        baseUrl: resolved.definition.baseUrl,
        credential: resolved.payload
      }
    );

    return {
      providerId: resolved.definition.id,
      kind: resolved.kind,
      credentialScope: resolved.credentialScope,
      ...providerFile,
      ...(resolved.kind === 'cliproxyapi'
        ? {
            cliproxyRouteKind: inferCLIProxyRouteKind(resolved.definition.baseUrl ?? '')
          }
        : {})
    };
  } catch (error) {
    throwFriendlyProviderFailure(error, {
      operation: 'file-upload',
      isGlobalAdmin
    });
  }
}

export async function deleteProviderReferenceFile(
  providerId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  input: ProviderReferenceFileDeleteInput
): Promise<void> {
  const workspacePolicyRestrictions = input.workspaceId
    ? await getWorkspaceProviderPolicyRestrictions(input.workspaceId, actorUserId)
    : null;

  try {
    const resolved = await resolveProviderExecutionContext(
      providerId,
      actorUserId,
      isGlobalAdmin,
      input.credentialId
    );

    assertWorkspaceProviderIsAllowed(
      workspacePolicyRestrictions,
      resolved.definition.id,
      resolved.definition.enabled,
      input.workspaceId
    );

    if (!resolved.adapter.deleteReferenceFile) {
      return;
    }

    await resolved.adapter.deleteReferenceFile(
      {
        providerFileId: input.providerFileId
      },
      {
        baseUrl: resolved.definition.baseUrl,
        credential: resolved.payload
      }
    );
  } catch (error) {
    throwFriendlyProviderFailure(error, {
      operation: 'file-delete',
      isGlobalAdmin
    });
  }
}

function createProviderCredentialCreateInput(
  actorUserId: string,
  input: ValidatedUpsertProviderCredentialInput
): Prisma.ProviderCredentialUncheckedCreateInput {
  const payload: ProviderCredentialPayload = {
    apiKey: input.apiKey,
    organizationId: input.organizationId,
    projectId: input.projectId,
    customHeaders: input.customHeaders,
    manualModels: input.manualModels
  };

  return {
    providerDefinitionId: input.providerDefinitionId!,
    scope: input.scope === 'system' ? 'SYSTEM' : 'USER',
    ownerUserId: input.scope === 'system' ? null : actorUserId,
    label: input.label,
    encryptedPayload: encryptProviderCredentialPayload(
      payload,
      requireProviderCredentialEncryptionKey()
    ),
    apiKeyPreview: maskSecret(input.apiKey),
    customHeadersHash: stableProviderHeaderHash(input.customHeaders)
  };
}

function mapProviderCredentialSummary(credential: {
  id: string;
  scope: 'USER' | 'SYSTEM';
  label: string;
  apiKeyPreview: string;
  encryptedPayload?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProviderCredentialSummary {
  const manualModels = readCredentialManualModels(credential.encryptedPayload);
  return {
    id: credential.id,
    scope: credential.scope === 'SYSTEM' ? 'system' : 'user',
    label: credential.label,
    apiKeyPreview: credential.apiKeyPreview,
    ...(manualModels.length > 0 ? { manualModels } : {}),
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString()
  };
}

function readCredentialManualModels(encryptedPayload: string | null | undefined): ManualModelDescriptor[] {
  if (!encryptedPayload) return [];
  try {
    const payload = decryptProviderCredentialPayload(
      encryptedPayload,
      requireProviderCredentialEncryptionKey()
    );
    return normalizeManualModels(payload.manualModels);
  } catch {
    return [];
  }
}

function createAuditLogInput(input: CreateAuditLogInput): Prisma.AuditLogUncheckedCreateInput {
  const auditLog: Prisma.AuditLogUncheckedCreateInput = {
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId
  };

  if (input.metadata) {
    auditLog.metadata = input.metadata as Prisma.InputJsonValue;
  }

  return auditLog;
}

export interface WorkflowProviderContextLike {
  kind: TextProviderKind;
  baseUrl: string | null;
  credential: {
    apiKey: string;
    organizationId?: string;
    projectId?: string;
    customHeaders?: Record<string, string>;
  };
  model: string;
}

/**
 * Resolves a provider definition + credential and returns a context suitable
 * for handing to a Mastra workflow's `provider` input. Decrypts credentials
 * server-side; the decrypted payload must not be logged or returned to clients.
 */
export async function resolveTextProviderForWorkflow(input: {
  providerId: string;
  modelId: string;
  actorUserId: string;
  isGlobalAdmin: boolean;
  credentialId?: string;
}): Promise<WorkflowProviderContextLike> {
  const resolved = await resolveProviderExecutionContext(
    input.providerId,
    input.actorUserId,
    input.isGlobalAdmin,
    input.credentialId
  );

  const trimmedModel = input.modelId.trim();
  if (!trimmedModel) {
    throw createError({ statusCode: 400, statusMessage: 'Model id is required.' });
  }

  const credential: WorkflowProviderContextLike['credential'] = {
    apiKey: resolved.payload.apiKey
  };
  if (resolved.payload.organizationId) credential.organizationId = resolved.payload.organizationId;
  if (resolved.payload.projectId) credential.projectId = resolved.payload.projectId;
  if (resolved.payload.customHeaders) credential.customHeaders = resolved.payload.customHeaders;

  return {
    kind: resolved.kind,
    baseUrl: resolved.definition.baseUrl,
    credential,
    model: trimmedModel
  };
}

async function resolveProviderExecutionContext(
  providerId: string | undefined,
  actorUserId: string,
  isGlobalAdmin: boolean,
  credentialId?: string
): Promise<{
  definition: {
    id: string;
    kind: ProviderKind;
    enabled: boolean;
    baseUrl: string | null;
    updatedAt: Date;
  };
  kind: TextProviderKind;
  credential: {
    id: string;
    updatedAt: Date;
  };
  credentialScope: 'user' | 'system';
  payload: ProviderCredentialPayload;
  adapter: ReturnType<typeof createTextProviderAdapter>;
}> {
  const normalizedProviderId = providerId?.trim();

  if (!normalizedProviderId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider id is required.'
    });
  }

  const definition = await prisma.providerDefinition.findUnique({
    where: { id: normalizedProviderId },
    select: {
      id: true,
      kind: true,
      enabled: true,
      baseUrl: true,
      updatedAt: true
    }
  });

  if (!definition) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider definition not found.'
    });
  }

  assertProviderIsEnabledForUser(definition.enabled, isGlobalAdmin);

  const credential = credentialId?.trim()
    ? await resolveExplicitProviderCredential(credentialId, definition.id, actorUserId, isGlobalAdmin)
    : await resolvePreferredProviderCredential(definition.id, actorUserId, isGlobalAdmin);

  const payload = decryptProviderCredentialPayload(
    credential.encryptedPayload,
    requireProviderCredentialEncryptionKey()
  );
  const kind = fromPrismaProviderKind(definition.kind);

  return {
    definition,
    kind,
    credential: {
      id: credential.id,
      updatedAt: credential.updatedAt
    },
    credentialScope: credential.scope === 'SYSTEM' ? 'system' : 'user',
    payload,
    adapter: createTextProviderAdapter(kind)
  };
}

async function resolveExplicitProviderCredential(
  credentialId: string,
  providerDefinitionId: string,
  actorUserId: string,
  isGlobalAdmin: boolean
) {
  const credential = await prisma.providerCredential.findUnique({
    where: { id: credentialId.trim() },
    select: {
      id: true,
      providerDefinitionId: true,
      scope: true,
      ownerUserId: true,
      encryptedPayload: true,
      updatedAt: true
    }
  });

  if (!credential || credential.providerDefinitionId !== providerDefinitionId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider credential not found.'
    });
  }

  if (!isGlobalAdmin && credential.scope === 'USER' && credential.ownerUserId !== actorUserId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You can use only your own provider credentials.'
    });
  }

  return credential;
}

async function resolvePreferredProviderCredential(
  providerDefinitionId: string,
  actorUserId: string,
  isGlobalAdmin: boolean
) {
  const preferred = isGlobalAdmin
    ? await prisma.providerCredential.findFirst({
        where: {
          providerDefinitionId,
          scope: 'SYSTEM'
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          providerDefinitionId: true,
          scope: true,
          ownerUserId: true,
          encryptedPayload: true,
          updatedAt: true
        }
      })
    : await prisma.providerCredential.findFirst({
        where: {
          providerDefinitionId,
          ownerUserId: actorUserId
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          providerDefinitionId: true,
          scope: true,
          ownerUserId: true,
          encryptedPayload: true,
          updatedAt: true
        }
      });

  if (preferred) {
    return preferred;
  }

  const fallback = isGlobalAdmin
    ? await prisma.providerCredential.findFirst({
        where: {
          providerDefinitionId,
          ownerUserId: actorUserId
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          providerDefinitionId: true,
          scope: true,
          ownerUserId: true,
          encryptedPayload: true,
          updatedAt: true
        }
      })
    : await prisma.providerCredential.findFirst({
        where: {
          providerDefinitionId,
          scope: 'SYSTEM'
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          providerDefinitionId: true,
          scope: true,
          ownerUserId: true,
          encryptedPayload: true,
          updatedAt: true
        }
      });

  if (fallback) {
    return fallback;
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'No usable provider credential is configured for this provider.'
  });
}

function requireProviderCredentialEncryptionKey(): string {
  const config = loadConfig(process.env);

  if (!config.providerCredentialEncryptionKey) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Provider credential encryption is not configured. Set PROVIDER_CREDENTIAL_ENCRYPTION_KEY.'
    });
  }

  return config.providerCredentialEncryptionKey;
}

async function readProviderModelCache(
  providerDefinitionId: string,
  cacheKey: string
): Promise<ModelDescriptor[] | null> {
  const cached = await prisma.providerModelCache.findFirst({
    where: {
      providerDefinitionId,
      cacheKey,
      expiresAt: {
        gt: new Date()
      }
    },
    select: {
      modelsJson: true
    }
  });

  if (!cached) {
    return null;
  }

  return parseModelDescriptorsFromCache(cached.modelsJson);
}

async function fetchAndCacheProviderModels(input: {
  cacheKey: string;
  resolved: Awaited<ReturnType<typeof resolveProviderExecutionContext>>;
  manualModels: ManualModelDescriptor[];
}): Promise<ModelDescriptor[]> {
  const models = await input.resolved.adapter.listModels({
    baseUrl: input.resolved.definition.baseUrl,
    credential: input.resolved.payload,
    manualModels: input.manualModels
  });
  const fetchedAt = new Date();

  await prisma.providerModelCache.upsert({
    where: {
      providerDefinitionId_cacheKey: {
        providerDefinitionId: input.resolved.definition.id,
        cacheKey: input.cacheKey
      }
    },
    create: {
      providerDefinitionId: input.resolved.definition.id,
      cacheKey: input.cacheKey,
      modelsJson: models as unknown as Prisma.InputJsonValue,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + PROVIDER_MODEL_CACHE_TTL_MS)
    },
    update: {
      modelsJson: models as unknown as Prisma.InputJsonValue,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + PROVIDER_MODEL_CACHE_TTL_MS)
    }
  });

  return models;
}

function createProviderModelsResult(
  resolved: Awaited<ReturnType<typeof resolveProviderExecutionContext>>,
  models: ModelDescriptor[]
): ProviderModelsResult {
  return {
    providerId: resolved.definition.id,
    kind: resolved.kind,
    credentialScope: resolved.credentialScope,
    models,
    defaultModelId: null,
    ...(resolved.kind === 'cliproxyapi'
      ? {
          cliproxyRouteKind: inferCLIProxyRouteKind(resolved.definition.baseUrl ?? '')
        }
      : {})
  };
}

function createProviderModelCacheKey(
  resolved: Awaited<ReturnType<typeof resolveProviderExecutionContext>>,
  manualModels: ManualModelDescriptor[]
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerDefinitionId: resolved.definition.id,
        providerUpdatedAt: resolved.definition.updatedAt.toISOString(),
        credentialId: resolved.credential.id,
        credentialUpdatedAt: resolved.credential.updatedAt.toISOString(),
        manualModelMode: 'override-v2',
        manualModels
      })
    )
    .digest('hex');
}

function normalizeManualModelIdsForCache(manualModelIds: string[] | undefined): string[] {
  return [...new Set((manualModelIds ?? []).map((entry) => entry.trim()).filter(Boolean))].sort();
}

function normalizeManualModels(value: unknown): ManualModelDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const models: ManualModelDescriptor[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const candidate = entry as { id?: unknown; label?: unknown };
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    models.push({
      id,
      label: label || id
    });
  }

  return models.sort((left, right) => left.id.localeCompare(right.id));
}

function assertWorkspaceProviderIsAllowed(
  workspacePolicyRestrictions: Map<string, string[]> | null,
  providerDefinitionId: string,
  providerEnabled: boolean,
  workspaceId: string | undefined
): void {
  if (!workspaceId) {
    return;
  }

  if (!providerEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provider is currently disabled.'
    });
  }

  if (workspacePolicyRestrictions && !workspacePolicyRestrictions.has(providerDefinitionId)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provider is not allowed in the selected workspace.'
    });
  }
}

function assertWorkspaceModelIsAllowed(
  workspacePolicyRestrictions: Map<string, string[]> | null,
  providerDefinitionId: string,
  modelId: string,
  workspaceId: string | undefined
): void {
  if (!workspaceId || !workspacePolicyRestrictions) {
    return;
  }

  const allowedModelIds = workspacePolicyRestrictions.get(providerDefinitionId) ?? [];

  if (allowedModelIds.length === 0) {
    return;
  }

  if (!allowedModelIds.includes(modelId)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This model is not allowed in the selected workspace.'
    });
  }
}

function filterModelsForWorkspacePolicy(
  models: ModelDescriptor[],
  workspacePolicyRestrictions: Map<string, string[]> | null,
  providerDefinitionId: string
): ModelDescriptor[] {
  if (!workspacePolicyRestrictions) {
    return models;
  }

  const allowedModelIds = workspacePolicyRestrictions.get(providerDefinitionId) ?? [];

  if (allowedModelIds.length === 0) {
    return models;
  }

  const allowedModelIdsSet = new Set(allowedModelIds);

  return models.filter((model) => allowedModelIdsSet.has(model.id));
}

function parseModelDescriptorsFromCache(value: Prisma.JsonValue): ModelDescriptor[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const models: ModelDescriptor[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return null;
    }

    const candidate = entry as {
      id?: unknown;
      label?: unknown;
      supportsFileUpload?: unknown;
    };

    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') {
      return null;
    }

    if (
      candidate.supportsFileUpload !== undefined &&
      typeof candidate.supportsFileUpload !== 'boolean'
    ) {
      return null;
    }

    models.push({
      id: candidate.id,
      label: candidate.label,
      ...(candidate.supportsFileUpload !== undefined
        ? { supportsFileUpload: candidate.supportsFileUpload }
        : {})
    });
  }

  return models;
}

function assertProviderIsEnabledForUser(providerEnabled: boolean, isGlobalAdmin: boolean): void {
  if (!isGlobalAdmin && !providerEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This provider is currently disabled.'
    });
  }
}

type ProviderFailureOperation =
  | 'model-discovery'
  | 'connection-test'
  | 'file-upload'
  | 'file-delete';

interface ClassifiedProviderFailure {
  statusCode: number;
  statusMessage: string;
  diagnostic: string;
  retryable: boolean;
}

function throwFriendlyProviderFailure(
  error: unknown,
  input: {
    operation: ProviderFailureOperation;
    isGlobalAdmin: boolean;
  }
): never {
  const statusCode = getErrorStatusCode(error);

  if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
    throw error;
  }

  const failure = classifyProviderFailure(error, input.operation);

  throw createError({
    statusCode: failure.statusCode,
    statusMessage: failure.statusMessage,
    data: {
      retryable: failure.retryable,
      ...(input.isGlobalAdmin ? { providerDiagnostic: failure.diagnostic } : {})
    }
  });
}

function classifyProviderFailure(
  error: unknown,
  operation: ProviderFailureOperation
): ClassifiedProviderFailure {
  const diagnostic = extractProviderFailureDiagnostic(error);
  const normalizedDiagnostic = diagnostic.toLowerCase();

  if (
    normalizedDiagnostic.includes('401') ||
    normalizedDiagnostic.includes('403') ||
    normalizedDiagnostic.includes('unauthorized') ||
    normalizedDiagnostic.includes('forbidden') ||
    normalizedDiagnostic.includes('invalid api key') ||
    normalizedDiagnostic.includes('api key') ||
    normalizedDiagnostic.includes('authentication')
  ) {
    return {
      statusCode: 502,
      statusMessage: `PepeteX could not authenticate with this provider during ${describeProviderOperation(operation)}. Check the configured credentials and retry.`,
      diagnostic,
      retryable: true
    };
  }

  if (
    normalizedDiagnostic.includes('429') ||
    normalizedDiagnostic.includes('rate limit') ||
    normalizedDiagnostic.includes('quota')
  ) {
    return {
      statusCode: 503,
      statusMessage: `This provider is rate limiting PepeteX during ${describeProviderOperation(operation)}. Retry in a moment.`,
      diagnostic,
      retryable: true
    };
  }

  if (
    normalizedDiagnostic.includes('timeout') ||
    normalizedDiagnostic.includes('timed out') ||
    normalizedDiagnostic.includes('fetch failed') ||
    normalizedDiagnostic.includes('network') ||
    normalizedDiagnostic.includes('econnreset') ||
    normalizedDiagnostic.includes('enotfound') ||
    normalizedDiagnostic.includes('eai_again')
  ) {
    return {
      statusCode: 503,
      statusMessage: `PepeteX could not reach this provider during ${describeProviderOperation(operation)}. Retry in a moment.`,
      diagnostic,
      retryable: true
    };
  }

  if (
    normalizedDiagnostic.includes('base url is not configured') ||
    normalizedDiagnostic.includes('provider credential encryption is not configured') ||
    normalizedDiagnostic.includes('provider credential payload format is invalid') ||
    normalizedDiagnostic.includes('must decode to exactly 32 bytes')
  ) {
    return {
      statusCode: 500,
      statusMessage: `This provider is not configured correctly for ${describeProviderOperation(operation)}. Ask an admin to review the provider settings.`,
      diagnostic,
      retryable: false
    };
  }

  return {
    statusCode: 502,
    statusMessage:
      operation === 'model-discovery'
        ? 'PepeteX could not load models from this provider. Retry, or ask an admin to review the provider settings.'
        : 'PepeteX could not verify this provider connection. Retry, or ask an admin to review the provider settings.',
    diagnostic,
    retryable: true
  };
}

function describeProviderOperation(operation: ProviderFailureOperation): string {
  switch (operation) {
    case 'model-discovery':
      return 'model discovery';
    case 'connection-test':
      return 'connection testing';
    case 'file-upload':
      return 'reference-file upload';
    case 'file-delete':
      return 'reference-file deletion';
  }
}

function extractProviderFailureDiagnostic(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    error &&
    typeof error === 'object' &&
    'statusMessage' in error &&
    typeof error.statusMessage === 'string' &&
    error.statusMessage.trim()
  ) {
    return error.statusMessage.trim();
  }

  return 'Provider request failed.';
}

function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return null;
  }

  const statusCode = error.statusCode;

  return typeof statusCode === 'number' && Number.isFinite(statusCode) ? statusCode : null;
}

function assertNonNegativeTokenCount(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `${fieldName} must be a non-negative integer.`
    });
  }

  return value;
}

function assertProviderKind(value: string): TextProviderKind {
  if (textProviderKinds.includes(value as TextProviderKind)) {
    return value as TextProviderKind;
  }

  throw createError({
    statusCode: 400,
    statusMessage: `Provider kind must be one of: ${textProviderKinds.join(', ')}.`
  });
}

function normalizeOptionalUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Base URL must be a string.'
    });
  }

  const normalized = value.trim();

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Base URL must be a valid http or https URL.'
    });
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Credential metadata values must be strings.'
    });
  }

  const normalized = value.trim();

  return normalized || undefined;
}

function normalizeCustomHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'customHeaders must be an object of string values.'
    });
  }

  const normalizedEntries = Object.entries(value).map(([key, entryValue]) => {
    if (typeof entryValue !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'customHeaders must be an object of string values.'
      });
    }

    return [key.trim(), entryValue.trim()] as const;
  });
  const customHeaders = Object.fromEntries(
    normalizedEntries.filter(([key, entryValue]) => key && entryValue)
  );

  return Object.keys(customHeaders).length > 0 ? customHeaders : undefined;
}

function toPrismaProviderKind(kind: TextProviderKind): ProviderKind {
  switch (kind) {
    case 'gemini':
      return 'GEMINI';
    case 'openai-compatible':
      return 'OPENAI_COMPATIBLE';
    case 'cliproxyapi':
      return 'CLIPROXYAPI';
  }
}

function fromPrismaProviderKind(kind: ProviderKind): TextProviderKind {
  switch (kind) {
    case 'GEMINI':
      return 'gemini';
    case 'OPENAI_COMPATIBLE':
      return 'openai-compatible';
    case 'CLIPROXYAPI':
      return 'cliproxyapi';
  }
}
