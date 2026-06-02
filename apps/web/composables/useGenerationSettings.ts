import type { CustomPromptSummary, DesignSystemSummary, ModelDescriptor, ProviderSummary } from '~/types'

export function useGenerationSettings() {
  const providers = ref<ProviderSummary[]>([])
  const models = ref<ModelDescriptor[]>([])
  const customPrompts = ref<CustomPromptSummary[]>([])
  const designSystems = ref<Array<Pick<DesignSystemSummary, 'id' | 'name'>>>([])
  const defaultModelId = ref<string | null>(null)
  const loadingProviders = ref(false)
  const loadingModels = ref(false)
  const configError = ref<string | null>(null)

  const selectedProviderId = ref<string | null>(null)
  const selectedModelId = ref<string | null>(null)
  const selectedCustomPromptId = ref<string | null>(null)
  const selectedDesignSystemId = ref<string | null>(null)
  const language = ref<'en' | 'id'>('en')
  const enableImageGen = ref(false)
  const selectedImageProviderId = ref<string | null>(null)
  const selectedImageModelId = ref<string | null>(null)

  const selectedProvider = computed(
    () => providers.value.find((provider) => provider.id === selectedProviderId.value) ?? null
  )
  const selectedModel = computed(
    () => models.value.find((model) => model.id === selectedModelId.value) ?? null
  )

  async function loadWorkspaceSettings(workspaceId: string) {
    loadingProviders.value = true
    try {
      const [pData, cpData, dsData] = await Promise.all([
        $fetch<{ providers: ProviderSummary[] }>('/api/providers', { query: { workspaceId } }),
        $fetch<{ customPrompts: CustomPromptSummary[] }>(`/api/custom-prompts?workspaceId=${workspaceId}`),
        $fetch<{ designSystems: Array<Pick<DesignSystemSummary, 'id' | 'name'>> }>(
          `/api/design-systems?workspaceId=${workspaceId}`
        ).catch(() => ({ designSystems: [] }))
      ])

      providers.value = pData.providers
      customPrompts.value = cpData.customPrompts
      designSystems.value = dsData.designSystems

      if (!providers.value.some((provider) => provider.id === selectedProviderId.value)) {
        selectedProviderId.value = providers.value[0]?.id ?? null
      }
      if (
        selectedCustomPromptId.value &&
        !customPrompts.value.some((prompt) => prompt.id === selectedCustomPromptId.value)
      ) {
        selectedCustomPromptId.value = null
      }
      if (
        selectedDesignSystemId.value &&
        !designSystems.value.some((designSystem) => designSystem.id === selectedDesignSystemId.value)
      ) {
        selectedDesignSystemId.value = null
      }
      if (
        selectedImageProviderId.value &&
        !providers.value.some((provider) => provider.id === selectedImageProviderId.value)
      ) {
        selectedImageProviderId.value = null
      }
    } finally {
      loadingProviders.value = false
    }
  }

  async function loadProviderModels(workspaceId: string | null, providerId: string | null) {
    if (!providerId) {
      models.value = []
      defaultModelId.value = null
      selectedModelId.value = null
      return
    }

    loadingModels.value = true
    configError.value = null
    try {
      const data = await $fetch<{
        result: {
          models: ModelDescriptor[]
          defaultModelId: string | null
          configurationError?: string
        }
      }>(`/api/providers/${providerId}/models`, {
        query: workspaceId ? { workspaceId } : undefined
      })

      models.value = data.result.models
      defaultModelId.value = data.result.defaultModelId
      configError.value = data.result.configurationError ?? null
      selectedModelId.value = pickPreferredModelId(data.result.models, data.result.defaultModelId, selectedModelId.value)
    } catch (error: unknown) {
      configError.value =
        (error as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Could not load models.'
      models.value = []
      defaultModelId.value = null
      selectedModelId.value = null
    } finally {
      loadingModels.value = false
    }
  }

  return {
    providers,
    models,
    customPrompts,
    designSystems,
    defaultModelId,
    loadingProviders,
    loadingModels,
    configError,
    selectedProviderId,
    selectedModelId,
    selectedCustomPromptId,
    selectedDesignSystemId,
    language,
    enableImageGen,
    selectedImageProviderId,
    selectedImageModelId,
    selectedProvider,
    selectedModel,
    loadWorkspaceSettings,
    loadProviderModels
  }
}

function pickPreferredModelId(
  models: ModelDescriptor[],
  defaultModelId: string | null,
  currentModelId: string | null
): string | null {
  if (currentModelId && models.some((model) => model.id === currentModelId)) return currentModelId
  if (defaultModelId && models.some((model) => model.id === defaultModelId)) return defaultModelId
  return models[0]?.id ?? null
}
