<script setup lang="ts">
import type {
  DesignSystemDetail,
  DesignSystemDocumentV2,
  DesignSystemGenerationRunSummary,
  DesignSystemReferenceFileSummary,
  DesignSystemV2Item,
  ModelDescriptor,
  ProviderSummary
} from '~/types'

const route = useRoute()
const designSystemId = computed(() => String(route.params.id))

const {
  activeRun,
  activeTimeline,
  submitting,
  submitGeneration,
  resumeAskMode,
  cancelGeneration,
  loadHistory,
  stopPolling,
  clearRun
} = useDesignSystemGeneration()

const detail = ref<DesignSystemDetail | null>(null)
const document = ref<DesignSystemDocumentV2 | null>(null)
const loading = ref(true)
const errorMessage = ref<string | null>(null)

const providers = ref<ProviderSummary[]>([])
const models = ref<ModelDescriptor[]>([])
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const loadingProviders = ref(false)
const loadingModels = ref(false)

const message = ref('')
const askAnswer = ref('')

// Ephemeral chat image attachments (vision) — not stored as reference files.
const attachedImages = ref<Array<{ mimeType: string; dataBase64: string; url: string }>>([])
const selectedProvider = computed(() => providers.value.find((p) => p.id === selectedProviderId.value) ?? null)
const selectedModel = computed(() => models.value.find((m) => m.id === selectedModelId.value) ?? null)
const visionAllowed = computed(() => {
  const kind = selectedProvider.value?.kind
  return kind === 'gemini' || kind === 'cliproxyapi' || selectedModel.value?.supportsFileUpload === true
})

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

const referenceFiles = ref<DesignSystemReferenceFileSummary[]>([])
const assets = ref<DesignSystemReferenceFileSummary[]>([])
const uploading = ref(false)
const showConfig = ref(false)
// 'logo'/'image'/'font' upload as design-system ASSETS; 'reference' = context only.
const uploadKind = ref<'logo' | 'image' | 'font' | 'reference'>('logo')
const uploadAccept = computed(() => {
  if (uploadKind.value === 'font') return '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'
  if (uploadKind.value === 'reference') return '.pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp'
  return '.png,.jpg,.jpeg,.webp,.svg,image/*'
})

const feedbackOpen = ref(false)
const feedbackText = ref('')
const feedbackScope = ref<{ bucketId: string; subCategoryId?: string; itemId?: string; label: string } | null>(null)
const previewOpen = ref(false)
const previewTarget = ref<{ bucketKind: string; item: DesignSystemV2Item } | null>(null)

const isBusy = computed(() => {
  const status = activeRun.value?.status
  return submitting.value || status === 'PENDING' || status === 'RUNNING'
})
const isWaitingAsk = computed(() => activeRun.value?.status === 'WAITING_ASK')

const liveDocument = computed<DesignSystemDocumentV2 | null>(() => {
  const checkpointDoc = activeRun.value?.latestCheckpoint?.documentJson
  if (checkpointDoc && Array.isArray(checkpointDoc.buckets)) return checkpointDoc
  return document.value
})

async function loadDetail() {
  loading.value = true
  errorMessage.value = null
  try {
    const data = await $fetch<DesignSystemDetail>(`/api/design-systems/${designSystemId.value}`)
    detail.value = data
    document.value = data.documentV2 ?? null
    await Promise.all([loadProviders(data.workspaceId ?? null), loadReferenceFiles()])
    await loadHistory(designSystemId.value)
  } catch (err) {
    errorMessage.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Could not load design system.'
  } finally {
    loading.value = false
  }
}

async function loadProviders(workspaceId: string | null) {
  loadingProviders.value = true
  try {
    const data = await $fetch<{ providers: ProviderSummary[] }>('/api/providers', { query: workspaceId ? { workspaceId } : {} })
    providers.value = data.providers
    selectedProviderId.value = data.providers[0]?.id ?? null
    if (selectedProviderId.value) await loadModels(selectedProviderId.value)
  } catch {
    providers.value = []
  } finally {
    loadingProviders.value = false
  }
}

async function loadModels(providerId: string) {
  loadingModels.value = true
  models.value = []
  try {
    const data = await $fetch<{ result: { models: ModelDescriptor[]; defaultModelId: string | null } }>(`/api/providers/${providerId}/models`)
    models.value = data.result.models
    selectedModelId.value = data.result.defaultModelId ?? data.result.models[0]?.id ?? null
  } catch {
    models.value = []
  } finally {
    loadingModels.value = false
  }
}

watch(selectedProviderId, (id) => { if (id) void loadModels(id) })

async function loadReferenceFiles() {
  try {
    const [refs, assetData] = await Promise.all([
      $fetch<{ referenceFiles: DesignSystemReferenceFileSummary[] }>(`/api/design-systems/${designSystemId.value}/reference-files`),
      $fetch<{ assets: DesignSystemReferenceFileSummary[] }>(`/api/design-systems/${designSystemId.value}/assets`)
    ])
    referenceFiles.value = refs.referenceFiles
    assets.value = assetData.assets
  } catch {
    referenceFiles.value = []
    assets.value = []
  }
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    if (uploadKind.value === 'reference') {
      // Context-only reference (e.g. brand-guideline PDF). Not placed into slides.
      form.append('role', file.type.startsWith('image/') ? 'brand-image' : 'other')
      await $fetch(`/api/design-systems/${designSystemId.value}/reference-files`, { method: 'POST', body: form })
    } else {
      // Placeable brand asset (logo/image) — usable directly in generated decks.
      form.append('assetRole', uploadKind.value)
      await $fetch(`/api/design-systems/${designSystemId.value}/assets`, { method: 'POST', body: form })
    }
    await loadReferenceFiles()
  } catch (err) {
    errorMessage.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Upload failed.'
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function onRunComplete(run: DesignSystemGenerationRunSummary) {
  if (run.status === 'COMPLETED') void loadDetail()
}

async function send() {
  const text = message.value.trim()
  const hasImages = attachedImages.value.length > 0
  if ((!text && !hasImages) || !selectedProviderId.value || !selectedModelId.value) return
  if (hasImages && !visionAllowed.value) {
    errorMessage.value = 'The selected model cannot read images. Pick a vision-capable model (e.g. Gemini) to attach images.'
    return
  }
  const attachments = attachedImages.value.map((a) => ({ mimeType: a.mimeType, dataBase64: a.dataBase64 }))
  message.value = ''
  attachedImages.value = []
  await submitGeneration({
    designSystemId: designSystemId.value,
    kind: 'DS_AGENT_COMMAND',
    textProviderId: selectedProviderId.value,
    textModelId: selectedModelId.value,
    manualInstruction: text || 'Use the attached image(s).',
    ...(attachments.length > 0 ? { attachments } : {})
  }, onRunComplete)
}

async function sendAnswer() {
  const text = askAnswer.value.trim()
  if (!text || !activeRun.value) return
  askAnswer.value = ''
  await resumeAskMode(designSystemId.value, activeRun.value.id, text, onRunComplete)
}

async function cancel() {
  if (activeRun.value) await cancelGeneration(designSystemId.value, activeRun.value.id)
}

function openFeedback(scope: { bucketId: string; subCategoryId?: string; itemId?: string; label: string }) {
  feedbackScope.value = scope
  feedbackText.value = ''
  feedbackOpen.value = true
}

async function submitFeedback() {
  const text = feedbackText.value.trim()
  if (!text || !feedbackScope.value || !selectedProviderId.value || !selectedModelId.value) return
  const scope = feedbackScope.value
  feedbackOpen.value = false
  await submitGeneration({
    designSystemId: designSystemId.value,
    kind: 'DS_AGENT_COMMAND',
    textProviderId: selectedProviderId.value,
    textModelId: selectedModelId.value,
    manualInstruction: `Feedback for "${scope.label}": ${text}`,
    feedbackContext: { bucketId: scope.bucketId, subCategoryId: scope.subCategoryId, itemId: scope.itemId }
  }, onRunComplete)
}

const previewAssetUrls = computed<Record<string, string>>(() => {
  const entries = [...assets.value, ...referenceFiles.value]
    .filter((file) => typeof file.previewUrl === 'string' && file.previewUrl.length > 0)
    .map((file) => [file.id, file.previewUrl as string] as const)
  return Object.fromEntries(entries)
})

function openPreview(bucketKind: string, item: DesignSystemV2Item) {
  if (!itemPreviewHtml(item, 'modal')) return
  previewTarget.value = { bucketKind, item }
  previewOpen.value = true
}

function itemPreviewHtml(item: DesignSystemV2Item, size: 'card' | 'modal' = 'card'): string | null {
  const record = item as { html?: unknown; css?: unknown }
  if (typeof record.html === 'string' && typeof record.css === 'string') {
    const scale = size === 'modal' ? 0.52 : 0.125
    const viewportWidth = Math.ceil(1920 * scale)
    const viewportHeight = Math.ceil(1080 * scale)
    const html = rewritePreviewAssetUrls(record.html)
    const css = rewritePreviewAssetUrls(record.css)
    return [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<style>',
      `html,body{margin:0;padding:0;width:${viewportWidth}px;height:${viewportHeight}px;overflow:hidden;background:#fff;}`,
      `.ds-preview-scale{width:1920px;height:1080px;transform:scale(${scale});transform-origin:top left;overflow:hidden;background:#fff;}`,
      '.pepetex-slide{width:1920px!important;height:1080px!important;position:relative;overflow:hidden;}',
      'img{max-width:100%;}',
      css,
      '</style></head><body><div class="ds-preview-scale">',
      html,
      '</div></body></html>'
    ].join('')
  }
  return null
}

function rewritePreviewAssetUrls(value: string): string {
  return value.replace(/pepetex:\/\/asset\/([A-Za-z0-9_-]+)/g, (_match, assetId: string) => {
    return previewAssetUrls.value[assetId] ?? _match
  })
}

function itemSummary(bucketKind: string, item: DesignSystemV2Item): string {
  const r = item as unknown as Record<string, unknown>
  switch (bucketKind) {
    case 'color': return String(r.value ?? '')
    case 'typography': return `${String(r.fontFamily ?? '')} · ${String(r.fontSizePx ?? '')}px${r.fontAssetId ? ' · uploaded font' : ''}`
    case 'spacing': return `${String(r.valuePx ?? '')}px`
    case 'asset': return `${String(r.assetKind ?? 'asset')} · ${String(r.source ?? '')}`
    case 'custom': return String(r.description ?? r.value ?? '')
    default: return String(r.description ?? r.purpose ?? '')
  }
}

onMounted(() => { void loadDetail() })
onBeforeUnmount(() => { stopPolling(); clearRun() })
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)] gap-4 p-4">
    <!-- Left: chat + config + references -->
    <div class="flex w-[440px] shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
      <div class="border-b border-slate-200 p-3">
        <NuxtLink to="/design-systems" class="text-sm text-slate-500 hover:text-slate-800">← Design systems</NuxtLink>
        <h1 class="mt-1 truncate text-lg font-semibold text-slate-900">{{ detail?.name ?? 'Design System Studio' }}</h1>
        <p v-if="detail?.description" class="truncate text-xs text-slate-400">{{ detail.description }}</p>
      </div>

      <!-- Transcript -->
      <div class="flex-1 space-y-3 overflow-y-auto p-3">
        <p v-if="!activeRun" class="text-sm text-slate-400">
          Describe the design system you want, or ask for changes. The agent remembers this design system across messages.
        </p>
        <div v-for="run in activeTimeline" :key="run.id" class="space-y-2">
          <div v-for="m in run.messages" :key="m.id" class="text-sm">
            <div v-if="m.role === 'USER'" class="ml-8 rounded-lg bg-indigo-600 px-3 py-2 text-white">{{ m.content }}</div>
            <div v-else-if="m.role === 'ASSISTANT'" class="mr-8 whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-slate-800">{{ m.content }}</div>
            <div v-else class="mx-4 text-center text-xs text-slate-400">{{ m.content }}</div>
          </div>
          <div v-for="t in run.toolCalls" :key="t.id" class="mr-8 flex items-center gap-2 text-xs text-slate-500">
            <span :class="t.status === 'FAILED' ? 'text-rose-500' : t.status === 'RUNNING' ? 'text-amber-500' : 'text-emerald-500'">●</span>
            <span>{{ t.label }}</span>
            <span v-if="t.errorMessage" class="text-rose-500">— {{ t.errorMessage }}</span>
          </div>
        </div>
        <div v-if="activeRun?.errorMessage" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ activeRun.errorMessage }}</div>
      </div>

      <!-- Ask mode -->
      <div v-if="isWaitingAsk" class="border-t border-amber-200 bg-amber-50 p-3">
        <p class="mb-2 text-sm font-medium text-amber-900">{{ activeRun?.askQuestion }}</p>
        <div v-if="activeRun?.askOptionsJson?.length" class="mb-2 flex flex-wrap gap-2">
          <button v-for="opt in activeRun.askOptionsJson" :key="opt.id" class="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs text-amber-900 hover:bg-amber-100" @click="askAnswer = String(opt.value ?? opt.label); void sendAnswer()">{{ opt.label }}</button>
        </div>
        <div class="flex gap-2">
          <input v-model="askAnswer" class="flex-1 rounded-lg border border-amber-300 px-2 py-1 text-sm" placeholder="Type your answer..." @keydown.enter.prevent="sendAnswer" />
          <button class="rounded-lg bg-amber-600 px-3 py-1 text-sm text-white" @click="sendAnswer">Send</button>
        </div>
      </div>

      <!-- Composer -->
      <div class="border-t border-slate-200 p-3">
        <div v-if="attachedImages.length" class="mb-2 flex flex-wrap gap-2">
          <div v-for="(img, i) in attachedImages" :key="i" class="relative">
            <img :src="img.url" class="h-14 w-14 rounded border border-slate-200 object-cover" alt="attachment" />
            <button class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] text-white" @click="removeAttachment(i)">×</button>
          </div>
        </div>
        <textarea v-model="message" rows="3" class="w-full resize-none rounded-lg border border-slate-300 p-2 text-sm" placeholder="Ask the studio to build or change the design system... (paste or attach an image)" :disabled="isBusy" @keydown.enter.exact.prevent="send" @paste="onPasteImage" />
        <div class="mt-2 grid grid-cols-2 gap-2">
          <select v-model="selectedProviderId" :disabled="loadingProviders" class="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            <option :value="null">{{ loadingProviders ? 'Loading...' : 'Provider' }}</option>
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select v-model="selectedModelId" :disabled="loadingModels" class="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            <option :value="null">{{ loadingModels ? 'Loading...' : 'Model' }}</option>
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
        <div class="mt-2 flex gap-2">
          <label
            class="flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            :class="{ 'cursor-not-allowed opacity-40': !visionAllowed || isBusy }"
            :title="visionAllowed ? 'Attach image(s) for the model to see' : 'Select a vision-capable model (e.g. Gemini) to attach images'"
          >
            <input type="file" accept="image/*" multiple class="hidden" :disabled="isBusy || !visionAllowed" @change="onAttachFiles" />
            📎
          </label>
          <button class="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" :disabled="isBusy || !selectedModelId || (!message.trim() && attachedImages.length === 0)" @click="send">Send</button>
          <button v-if="isBusy" class="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-600" @click="cancel">Stop</button>
        </div>
        <p v-if="attachedImages.length && !visionAllowed" class="mt-1 text-[11px] text-rose-500">This model can't read images — switch to a vision model (e.g. Gemini) to send attachments.</p>
        <p v-else-if="!isBusy" class="mt-1 text-[11px] text-slate-400">Tip: ask anything, attach/paste a reference image, or say "fully rebuild it from scratch".</p>

        <!-- References & assets below chat -->
        <button class="mt-3 flex w-full items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-800" @click="showConfig = !showConfig">
          <span>Brand references &amp; assets ({{ assets.length + referenceFiles.length }})</span>
          <span>{{ showConfig ? '▾' : '▸' }}</span>
        </button>
        <div v-if="showConfig" class="mt-2 space-y-2">
          <div class="flex items-center gap-2">
            <select v-model="uploadKind" class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
              <option value="logo">Logo (asset)</option>
              <option value="image">Image (asset)</option>
              <option value="font">Font (asset)</option>
              <option value="reference">Reference doc</option>
            </select>
            <label class="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
              <input type="file" class="hidden" :accept="uploadAccept" :disabled="uploading" @change="onUpload" />
              {{ uploading ? 'Uploading...' : '+ Upload' }}
            </label>
          </div>
          <p class="text-[11px] text-slate-400">Logos and images can be placed in decks. Fonts attach to typography tokens and render in decks that use this design system. "Reference doc" is context only (e.g. brand-guideline PDF).</p>
          <div v-for="file in assets" :key="file.id" class="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-1.5 text-xs">
            <img v-if="file.previewUrl" :src="file.previewUrl" class="h-8 w-8 rounded object-cover" :alt="file.originalFilename" />
            <span class="truncate text-slate-700">{{ file.originalFilename }}</span>
            <span class="ml-auto rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">{{ (file.assetRole || 'asset').toLowerCase() }}</span>
          </div>
          <div v-for="file in referenceFiles" :key="file.id" class="flex items-center gap-2 rounded-lg border border-slate-100 p-1.5 text-xs">
            <img v-if="file.previewUrl" :src="file.previewUrl" class="h-8 w-8 rounded object-cover" :alt="file.originalFilename" />
            <span class="truncate text-slate-600">{{ file.originalFilename }}</span>
            <span class="ml-auto text-slate-400">reference</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: canvas -->
    <div class="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div v-if="loading" class="text-slate-400">Loading...</div>
      <div v-else-if="errorMessage" class="text-rose-600">{{ errorMessage }}</div>
      <div v-else-if="!liveDocument || liveDocument.buckets.length === 0" class="text-slate-400">No design system content yet. Use the chat to generate one.</div>
      <div v-else class="space-y-6">
        <section v-for="bucket in liveDocument.buckets" :key="bucket.id" class="rounded-xl border border-slate-200 bg-white p-4">
          <header class="mb-3 flex items-center justify-between">
            <div>
              <h2 class="text-base font-semibold text-slate-900">{{ bucket.label }}</h2>
              <p class="text-xs uppercase tracking-wide text-slate-400">{{ bucket.kind }}</p>
            </div>
            <button class="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" @click="openFeedback({ bucketId: bucket.id, label: bucket.label })">Feedback</button>
          </header>
          <div v-for="sub in bucket.subCategories" :key="sub.id" class="mb-4">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-sm font-medium text-slate-700">{{ sub.label }} <span class="text-slate-400">({{ sub.items.length }})</span></h3>
              <button class="text-xs text-slate-400 hover:text-slate-700" @click="openFeedback({ bucketId: bucket.id, subCategoryId: sub.id, label: `${bucket.label} / ${sub.label}` })">Feedback</button>
            </div>
            <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div v-for="item in sub.items" :key="item.id" class="group rounded-lg border border-slate-200 p-2">
                <div v-if="bucket.kind === 'color'" class="mb-1 h-10 rounded" :style="{ backgroundColor: itemSummary('color', item) }" />
                <button
                  v-else-if="itemPreviewHtml(item)"
                  type="button"
                  class="relative mb-1 block h-32 w-full overflow-hidden rounded border border-slate-100 bg-white text-left"
                  title="Open larger preview"
                  @click="openPreview(bucket.kind, item)"
                >
                  <iframe :srcdoc="itemPreviewHtml(item) || ''" class="h-full w-full pointer-events-none bg-white" sandbox="" loading="lazy" />
                  <span class="absolute right-2 top-2 rounded bg-white/90 px-2 py-1 text-[10px] font-medium text-slate-600 opacity-0 shadow-sm transition group-hover:opacity-100">Open</span>
                </button>
                <div class="flex items-start justify-between gap-1">
                  <div class="min-w-0">
                    <p class="truncate text-xs font-medium text-slate-800">{{ item.label }}</p>
                    <p class="truncate text-[11px] text-slate-400">{{ itemSummary(bucket.kind, item) }}</p>
                  </div>
                  <button class="text-[11px] text-indigo-500 opacity-0 transition group-hover:opacity-100" @click="openFeedback({ bucketId: bucket.id, subCategoryId: sub.id, itemId: item.id, label: item.label })">Edit</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Large preview modal -->
    <div v-if="previewOpen && previewTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6" @click.self="previewOpen = false">
      <div class="flex max-h-[92vh] w-[min(1180px,94vw)] flex-col rounded-xl bg-white shadow-2xl">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold text-slate-900">{{ previewTarget.item.label }}</h3>
            <p class="text-xs uppercase tracking-wide text-slate-400">{{ previewTarget.bucketKind }}</p>
          </div>
          <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50" @click="previewOpen = false">Close</button>
        </div>
        <div class="overflow-auto bg-slate-100 p-4">
          <iframe
            :srcdoc="itemPreviewHtml(previewTarget.item, 'modal') || ''"
            class="mx-auto block h-[562px] w-[999px] rounded-lg border border-slate-200 bg-white shadow-sm"
            sandbox=""
          />
        </div>
      </div>
    </div>

    <!-- Feedback modal -->
    <div v-if="feedbackOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="feedbackOpen = false">
      <div class="w-[480px] rounded-xl bg-white p-4 shadow-xl">
        <h3 class="mb-1 text-base font-semibold text-slate-900">Feedback</h3>
        <p class="mb-3 text-sm text-slate-500">Scoped to: <span class="font-medium text-slate-700">{{ feedbackScope?.label }}</span></p>
        <textarea v-model="feedbackText" rows="4" class="w-full resize-none rounded-lg border border-slate-300 p-2 text-sm" placeholder="Describe the change you want for this..." @keydown.enter.exact.prevent="submitFeedback" />
        <div class="mt-3 flex justify-end gap-2">
          <button class="rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="feedbackOpen = false">Cancel</button>
          <button class="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50" :disabled="!feedbackText.trim() || !selectedModelId" @click="submitFeedback">Send to chat</button>
        </div>
      </div>
    </div>
  </div>
</template>
