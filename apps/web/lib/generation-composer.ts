export interface ProviderCredentialSummary {
  id: string;
  scope: 'user' | 'system';
  label: string;
  apiKeyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderDefinitionSummary {
  id: string;
  name: string;
  kind: 'gemini' | 'openai-compatible' | 'cliproxyapi';
  enabled: boolean;
  allowUserCredentials: boolean;
  baseUrl: string | null;
  hasSystemCredential: boolean;
  userCredentials: ProviderCredentialSummary[];
}

export interface ProviderModelDescriptor {
  id: string;
  label: string;
  supportsFileUpload?: boolean;
}

export interface ProviderModelsResult {
  providerId: string;
  kind: ProviderDefinitionSummary['kind'];
  credentialScope: 'user' | 'system';
  models: ProviderModelDescriptor[];
  defaultModelId: string | null;
  configurationError?: string;
  cliproxyRouteKind?: 'openai-compatible' | 'gemini-compatible' | 'claude-compatible' | 'unknown';
}

export interface ReferenceFileSummary {
  id: string;
  deckId: string;
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

export interface GenerationComposerSummary {
  readiness: 'blocked' | 'missing_instruction' | 'missing_provider' | 'missing_model' | 'ready';
  headline: string;
  detail: string;
  instructionPreview: string;
  selectedProviderLabel: string;
  selectedModelLabel: string;
  selectedDesignSystemLabel: string;
  referenceFileCount: number;
  languageLabel: 'English' | 'Indonesian';
  fileCapabilityWarning: string | null;
}

export interface BuildGenerationComposerSummaryInput {
  selectedDeckTitle: string | null;
  instruction: string;
  selectedProvider: ProviderDefinitionSummary | null;
  selectedModel: ProviderModelDescriptor | null;
  selectedDesignSystemLabel: string;
  language: 'en' | 'id';
  referenceFiles: ReferenceFileSummary[];
}

export function buildGenerationComposerSummary(
  input: BuildGenerationComposerSummaryInput
): GenerationComposerSummary {
  const trimmedInstruction = input.instruction.trim();
  const referenceFileCount = input.referenceFiles.length;

  if (!input.selectedDeckTitle) {
    return {
      readiness: 'blocked',
      headline: 'Select a deck first',
      detail: 'The composer attaches provider choice, uploads, and prompt context to a concrete deck.',
      instructionPreview: 'No generation brief yet.',
      selectedProviderLabel: 'No provider selected',
      selectedModelLabel: 'No model selected',
      selectedDesignSystemLabel: input.selectedDesignSystemLabel,
      referenceFileCount,
      languageLabel: toLanguageLabel(input.language),
      fileCapabilityWarning: null
    };
  }

  if (!trimmedInstruction) {
    return {
      readiness: 'missing_instruction',
      headline: 'Add the generation brief',
      detail: `Describe what "${input.selectedDeckTitle}" should communicate before the generation workflow is wired to submission.`,
      instructionPreview: 'No generation brief yet.',
      selectedProviderLabel: formatProviderLabel(input.selectedProvider),
      selectedModelLabel: formatModelLabel(input.selectedModel),
      selectedDesignSystemLabel: input.selectedDesignSystemLabel,
      referenceFileCount,
      languageLabel: toLanguageLabel(input.language),
      fileCapabilityWarning: null
    };
  }

  if (!input.selectedProvider) {
    return {
      readiness: 'missing_provider',
      headline: 'Choose a provider',
      detail: 'PepeteX needs a provider before this composer can become a generation-ready request.',
      instructionPreview: truncatePreview(trimmedInstruction),
      selectedProviderLabel: 'No provider selected',
      selectedModelLabel: formatModelLabel(input.selectedModel),
      selectedDesignSystemLabel: input.selectedDesignSystemLabel,
      referenceFileCount,
      languageLabel: toLanguageLabel(input.language),
      fileCapabilityWarning: null
    };
  }

  if (!input.selectedModel) {
    return {
      readiness: 'missing_model',
      headline: 'Choose a model',
      detail: `The provider "${input.selectedProvider.name}" is selected, but the generation target model is still missing.`,
      instructionPreview: truncatePreview(trimmedInstruction),
      selectedProviderLabel: formatProviderLabel(input.selectedProvider),
      selectedModelLabel: 'No model selected',
      selectedDesignSystemLabel: input.selectedDesignSystemLabel,
      referenceFileCount,
      languageLabel: toLanguageLabel(input.language),
      fileCapabilityWarning: null
    };
  }

  return {
    readiness: 'ready',
    headline: 'Composer is generation-ready',
    detail: `The selected deck, prompt brief, provider, model, and uploaded references are now captured in one place.`,
    instructionPreview: truncatePreview(trimmedInstruction),
    selectedProviderLabel: formatProviderLabel(input.selectedProvider),
    selectedModelLabel: formatModelLabel(input.selectedModel),
    selectedDesignSystemLabel: input.selectedDesignSystemLabel,
    referenceFileCount,
    languageLabel: toLanguageLabel(input.language),
    fileCapabilityWarning:
      referenceFileCount > 0 && input.selectedModel.supportsFileUpload === false
        ? 'This model does not advertise reference-file upload support, so uploaded files may not be usable during generation.'
        : null
  };
}

export function describeProviderCredentialAvailability(
  provider: ProviderDefinitionSummary | null
): string {
  if (!provider) {
    return 'Choose a provider to inspect credential readiness.';
  }

  if (provider.userCredentials.length > 0 && provider.hasSystemCredential) {
    return 'Personal credentials exist and a system credential is also available.';
  }

  if (provider.userCredentials.length > 0) {
    return 'Your saved credential is available for this provider.';
  }

  if (provider.hasSystemCredential) {
    return 'A shared system credential is available for this provider.';
  }

  if (provider.allowUserCredentials) {
    return 'No credential is configured yet. Add a personal credential before generating.';
  }

  return 'A global admin must configure a system credential before this provider can be used.';
}

export function formatProviderKindLabel(
  kind: ProviderDefinitionSummary['kind']
): string {
  switch (kind) {
    case 'gemini':
      return 'Gemini';
    case 'openai-compatible':
      return 'OpenAI-compatible';
    case 'cliproxyapi':
      return 'CLIProxyAPI';
  }
}

export function pickPreferredModelId(
  result: ProviderModelsResult | null,
  currentModelId: string | null
): string | null {
  if (!result || result.models.length === 0) {
    return null;
  }

  if (currentModelId && result.models.some((model) => model.id === currentModelId)) {
    return currentModelId;
  }

  if (result.defaultModelId && result.models.some((model) => model.id === result.defaultModelId)) {
    return result.defaultModelId;
  }

  return result.models[0]?.id ?? null;
}

export function formatReferenceFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) {
    return `${Math.max(0, Math.round(sizeBytes))} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProviderLabel(provider: ProviderDefinitionSummary | null): string {
  return provider ? `${provider.name} (${formatProviderKindLabel(provider.kind)})` : 'No provider selected';
}

function formatModelLabel(model: ProviderModelDescriptor | null): string {
  return model ? model.label : 'No model selected';
}

function toLanguageLabel(value: 'en' | 'id'): 'English' | 'Indonesian' {
  return value === 'id' ? 'Indonesian' : 'English';
}

function truncatePreview(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
