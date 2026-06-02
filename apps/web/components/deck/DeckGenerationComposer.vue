<script setup lang="ts">

const props = defineProps<{
  workspaceId: string | null
  deckId: string | null
  selectedProviderId: string | null
  selectedModelId: string | null
  selectedCustomPromptId: string | null
  submitting: boolean
  variant?: 'setup' | 'chat'
  initialBrief?: string | null
  initialDesignSystemId?: string | null
  initialLanguage?: 'en' | 'id' | null
  initialEnableImageGeneration?: boolean
  initialImageProviderId?: string | null
  initialImageModelId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:selectedProviderId', v: string | null): void
  (e: 'update:selectedModelId', v: string | null): void
  (e: 'update:selectedCustomPromptId', v: string | null): void
  (e: 'generate', payload: GeneratePayload): void
}>()

export interface GeneratePayload {
  kind: 'AGENT_COMMAND'
  manualInstruction: string
  languageCode: string
  textProviderId: string | null
  textModelId: string | null
  customPromptId: string | null
  designSystemId: string | null
  enableImageGeneration: boolean
  imageProviderId: string | null
  imageModelId: string | null
  commandContextJson?: Record<string, unknown>
  attachments?: Array<{ mimeType: string; dataBase64: string }>
}

const {
  providers,
  models,
  customPrompts,
  designSystems,
  loadingProviders,
  loadingModels,
  configError,
  selectedModelId: settingsSelectedModelId,
  selectedDesignSystemId,
  language,
  enableImageGen,
  selectedImageProviderId,
  selectedImageModelId,
  loadWorkspaceSettings,
  loadProviderModels
} = useGenerationSettings()

const brief = ref(props.initialBrief ?? '')
const configOpen = ref(false)
const applyingInitialSettings = ref(false)
const providerModelLoadId = ref(0)

if (props.initialDesignSystemId) selectedDesignSystemId.value = props.initialDesignSystemId
if (props.initialLanguage) language.value = props.initialLanguage
if (props.initialEnableImageGeneration) enableImageGen.value = true
if (props.initialImageProviderId) selectedImageProviderId.value = props.initialImageProviderId
if (props.initialImageModelId) selectedImageModelId.value = props.initialImageModelId

watch(() => props.initialBrief, (next) => {
  brief.value = next ?? ''
})
watch(() => props.initialDesignSystemId, (next) => {
  selectedDesignSystemId.value = next ?? null
})
watch(() => props.initialLanguage, (next) => {
  if (next) language.value = next
})
watch(() => props.initialEnableImageGeneration, (next) => {
  enableImageGen.value = next === true
})
watch(() => props.initialImageProviderId, (next) => {
  selectedImageProviderId.value = next ?? null
})
watch(() => props.initialImageModelId, (next) => {
  selectedImageModelId.value = next ?? null
})

const sampleBriefs = [
  'Pitch deck for an AI reporting product, executive tone, 10 slides.',
  'Quarterly performance update with charts, risks, and next steps.',
  'Indonesian market launch deck with bold telco visuals.'
]

const selectedProvider = computed(() => providers.value.find((p) => p.id === props.selectedProviderId) ?? null)
const selectedModelDescriptor = computed(() => models.value.find((m) => m.id === props.selectedModelId) ?? null)
const visionAllowed = computed(() => {
  const kind = selectedProvider.value?.kind
  return kind === 'gemini' || kind === 'cliproxyapi' || selectedModelDescriptor.value?.supportsFileUpload === true
})

// Ephemeral chat image attachments (vision) — not stored as reference files.
const attachedImages = ref<Array<{ mimeType: string; dataBase64: string; url: string }>>([])
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
async function addAttachment(file: File) {
  if (!file.type.startsWith('image/')) return
  const dataUrl = await readAsDataUrl(file)
  attachedImages.value.push({ mimeType: file.type, dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1), url: dataUrl })
}
async function onAttachFiles(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of Array.from(input.files ?? [])) await addAttachment(file)
  input.value = ''
}
function onPasteImage(event: ClipboardEvent) {
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) void addAttachment(file)
    }
  }
}
function removeAttachment(index: number) {
  attachedImages.value.splice(index, 1)
}

watch(() => props.workspaceId, async (wid) => {
  if (!wid) return
  await loadWorkspaceSettings(wid)
  if (props.selectedProviderId) return
  if (!providers.value.find((p) => p.id === props.selectedProviderId)) {
    emit('update:selectedProviderId', providers.value[0]?.id ?? null)
  }
}, { immediate: true })

watch([() => props.selectedProviderId, () => props.workspaceId], async ([pid, wid]) => {
  const loadId = ++providerModelLoadId.value
  applyingInitialSettings.value = true
  try {
    settingsSelectedModelId.value = props.selectedModelId
    await loadProviderModels(wid, pid)
    if (
      loadId !== providerModelLoadId.value ||
      pid !== props.selectedProviderId ||
      wid !== props.workspaceId
    ) {
      return
    }
    emit('update:selectedModelId', settingsSelectedModelId.value)
  } finally {
    if (loadId === providerModelLoadId.value) {
      applyingInitialSettings.value = false
    }
  }
}, { immediate: true })

watch(() => props.selectedModelId, (modelId) => {
  if (applyingInitialSettings.value) return
  settingsSelectedModelId.value = modelId
})

function onGenerate() {
  if (!props.selectedProviderId || !props.selectedModelId) return
  const hasImages = attachedImages.value.length > 0
  if (hasImages && !visionAllowed.value) return
  const manualInstruction = brief.value.trim()
  const attachments = attachedImages.value.map((a) => ({ mimeType: a.mimeType, dataBase64: a.dataBase64 }))
  emit('generate', {
    kind: 'AGENT_COMMAND',
    manualInstruction: manualInstruction || 'Use the attached image(s).',
    languageCode: language.value,
    textProviderId: props.selectedProviderId,
    textModelId: props.selectedModelId,
    customPromptId: props.selectedCustomPromptId,
    designSystemId: selectedDesignSystemId.value,
    enableImageGeneration: enableImageGen.value,
    imageProviderId: enableImageGen.value ? selectedImageProviderId.value : null,
    imageModelId: enableImageGen.value ? selectedImageModelId.value : null,
    ...(attachments.length > 0 ? { attachments } : {})
  })
  if (props.variant === 'chat') {
    brief.value = ''
    attachedImages.value = []
  }
}

const canGenerate = computed(
  () =>
    !!props.workspaceId &&
    !!props.selectedProviderId &&
    !!props.selectedModelId &&
    (brief.value.trim().length > 0 || attachedImages.value.length > 0) &&
    !(attachedImages.value.length > 0 && !visionAllowed.value) &&
    !props.submitting
)
</script>

<template>
  <div v-if="variant === 'chat'" class="space-y-3">
    <div v-if="attachedImages.length" class="flex flex-wrap gap-2">
      <div v-for="(img, i) in attachedImages" :key="i" class="relative">
        <img :src="img.url" class="h-14 w-14 rounded-xl border border-border object-cover" alt="attachment" />
        <button type="button" class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-fg text-[10px] text-bg" @click="removeAttachment(i)">×</button>
      </div>
    </div>
    <textarea
      v-model="brief"
      rows="4"
      class="w-full resize-none rounded-3xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-4 focus:ring-accent-soft"
      placeholder="Ask PepeteX to build a story, add a slide like an attached image, rewrite copy, apply feedback, or regenerate the selected slide..."
      @keydown.meta.enter.prevent="onGenerate"
      @keydown.ctrl.enter.prevent="onGenerate"
      @paste="onPasteImage"
    />

    <div class="grid grid-cols-[auto_1fr_auto] gap-2">
      <label
        class="px-focus-ring flex cursor-pointer items-center rounded-2xl border border-border bg-surface px-3 text-xs font-black text-fg-muted transition hover:bg-bg-subtle hover:text-fg"
        :class="{ 'cursor-not-allowed opacity-40': !visionAllowed }"
        :title="visionAllowed ? 'Attach image(s) for the model to see' : 'Select a vision-capable model (e.g. Gemini) to attach images'"
      >
        <input type="file" accept="image/*" multiple class="hidden" :disabled="!visionAllowed" @change="onAttachFiles" />
        📎
      </label>
      <button type="button" class="px-focus-ring rounded-2xl border border-border bg-surface px-3 text-xs font-black text-fg-muted transition hover:bg-bg-subtle hover:text-fg" @click="configOpen = !configOpen">
        Config
      </button>
      <button type="button" class="px-focus-ring rounded-2xl bg-fg px-4 text-xs font-black text-bg shadow-sm disabled:bg-bg-muted disabled:text-fg-subtle" :disabled="!canGenerate" @click="onGenerate">
        {{ submitting ? 'Sending…' : 'Send' }}
      </button>
    </div>
    <p v-if="attachedImages.length && !visionAllowed" class="text-[11px] font-semibold text-warning">
      This model can't read images — switch to a vision model (e.g. Gemini) to send attachments.
    </p>

    <p v-if="configError" class="rounded-2xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
      {{ configError }}
    </p>

    <div v-if="configOpen" class="space-y-3 rounded-3xl border border-border bg-surface p-3 shadow-sm">
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="pepetex-label">Provider</label>
          <select class="pepetex-field" :value="selectedProviderId ?? ''" :disabled="loadingProviders || providers.length === 0" @change="emit('update:selectedProviderId', ($event.target as HTMLSelectElement).value || null)">
            <option value="">{{ loadingProviders ? 'Loading...' : 'Select provider' }}</option>
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <label class="pepetex-label">Model</label>
          <select class="pepetex-field" :value="selectedModelId ?? ''" :disabled="loadingModels || models.length === 0" @change="emit('update:selectedModelId', ($event.target as HTMLSelectElement).value || null)">
            <option value="">{{ loadingModels ? 'Loading...' : 'Select model' }}</option>
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="pepetex-label">Prompt</label>
          <select class="pepetex-field" :value="selectedCustomPromptId ?? ''" @change="emit('update:selectedCustomPromptId', ($event.target as HTMLSelectElement).value || null)">
            <option value="">None</option>
            <option v-for="cp in customPrompts" :key="cp.id" :value="cp.id">{{ cp.title }}</option>
          </select>
        </div>
        <div>
          <label class="pepetex-label">Design</label>
          <select v-model="selectedDesignSystemId" class="pepetex-field">
            <option :value="null">None</option>
            <option v-for="ds in designSystems" :key="ds.id" :value="ds.id">{{ ds.name }}</option>
          </select>
        </div>
      </div>

      <div>
        <label class="pepetex-label">Language</label>
        <select v-model="language" class="pepetex-field">
          <option value="en">English</option>
          <option value="id">Indonesian</option>
        </select>
      </div>
    </div>
  </div>

  <div v-else class="space-y-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="pepetex-label">AI brief</p>
        <h3 class="mt-1 text-xl font-black text-fg">Describe the deck to generate</h3>
      </div>
      <span class="pepetex-pill">{{ selectedProvider?.name ?? 'No provider' }}</span>
    </div>

    <div>
      <textarea v-model="brief" rows="5" class="pepetex-field min-h-36 resize-none rounded-3xl" placeholder="Describe the audience, tone, sections, source material, desired visuals, and any constraints..." />
      <div class="mt-3 flex flex-wrap gap-2">
        <button v-for="sample in sampleBriefs" :key="sample" type="button" class="px-focus-ring rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs font-semibold text-fg-muted shadow-xs transition hover:border-border-strong hover:text-fg" @click="brief = sample">
          {{ sample }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="pepetex-label">Provider</label>
        <select class="pepetex-field" :value="selectedProviderId ?? ''" :disabled="loadingProviders || providers.length === 0" @change="emit('update:selectedProviderId', ($event.target as HTMLSelectElement).value || null)">
          <option value="">{{ loadingProviders ? 'Loading...' : 'Select provider' }}</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div>
        <label class="pepetex-label">Model</label>
        <select class="pepetex-field" :value="selectedModelId ?? ''" :disabled="loadingModels || models.length === 0" @change="emit('update:selectedModelId', ($event.target as HTMLSelectElement).value || null)">
          <option value="">{{ loadingModels ? 'Loading...' : 'Select model' }}</option>
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>
    </div>

    <p v-if="configError" class="rounded-2xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
      {{ configError }}
    </p>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="pepetex-label">Prompt preset</label>
        <select class="pepetex-field" :value="selectedCustomPromptId ?? ''" @change="emit('update:selectedCustomPromptId', ($event.target as HTMLSelectElement).value || null)">
          <option value="">None</option>
          <option v-for="cp in customPrompts" :key="cp.id" :value="cp.id">{{ cp.title }}</option>
        </select>
      </div>
      <div>
        <label class="pepetex-label">Design system</label>
        <select v-model="selectedDesignSystemId" class="pepetex-field">
          <option :value="null">None</option>
          <option v-for="ds in designSystems" :key="ds.id" :value="ds.id">{{ ds.name }}</option>
        </select>
      </div>
    </div>

    <div>
      <label class="pepetex-label">Language</label>
      <select v-model="language" class="pepetex-field">
        <option value="en">English</option>
        <option value="id">Indonesian</option>
      </select>
    </div>

    <div class="rounded-3xl border border-border bg-bg-subtle p-4">
      <label class="flex cursor-pointer items-start gap-2 text-sm font-bold text-fg">
        <input v-model="enableImageGen" type="checkbox" class="mt-0.5 h-4 w-4 rounded" />
        <span>Generate supporting images<span class="block text-xs font-medium text-fg-subtle">Optional. Uses the selected image provider and model.</span></span>
      </label>
      <div v-if="enableImageGen" class="mt-3 grid gap-2">
        <select v-model="selectedImageProviderId" class="pepetex-field">
          <option :value="null">Select image provider</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <input v-model="selectedImageModelId" type="text" placeholder="Image model ID, for example imagen-3.0-generate" class="pepetex-field" />
      </div>
    </div>

    <button type="button" class="pepetex-btn-primary w-full px-4 py-3 text-sm" :disabled="!canGenerate" @click="onGenerate">
      {{ submitting ? 'Submitting…' : deckId ? 'Generate update' : 'Generate new deck' }}
    </button>
  </div>
</template>
