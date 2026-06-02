<script setup lang="ts">
import type { DeckSummary } from '~/types'
import { serializeInitialGenerationQuery } from '~/lib/initial-generation-settings'

const router = useRouter()
const toast = useToast()
const {
  currentWorkspaceId,
  currentWorkspace,
  load: loadWorkspaces
} = useWorkspaces()
const { isAuthenticated, user } = useSession()
const { decks, loadingDecks, loadDecks, createDeck } = useDeck()

const prompt = ref('')
const creatingDeck = ref(false)
const pendingReferenceFiles = ref<File[]>([])
const pendingAssetFiles = ref<File[]>([])
const uploadingFiles = ref(false)
const settingsOpen = ref(false)
const {
  providers,
  models,
  customPrompts,
  designSystems,
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
  loadWorkspaceSettings,
  loadProviderModels
} = useGenerationSettings()

const recentDecks = computed(() =>
  [...decks.value]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)
)

const displayName = computed(() => user.value?.profile?.name?.split(' ')[0] ?? 'there')

const providerOptions = computed(() => providers.value.map((p) => ({ value: p.id, label: p.name })))
const modelOptions = computed(() => models.value.map((m) => ({ value: m.id, label: m.label })))
const customPromptOptions = computed(() => [
  { value: '', label: 'No prompt preset' },
  ...customPrompts.value.map((p) => ({ value: p.id, label: p.title }))
])
const designSystemOptions = computed(() => [
  { value: '', label: 'No design system' },
  ...designSystems.value.map((d) => ({ value: d.id, label: d.name }))
])
const canOpenStudio = computed(() =>
  !!currentWorkspaceId.value && !creatingDeck.value
)

const canStartDeck = computed(() =>
  !!currentWorkspaceId.value &&
  !!prompt.value.trim() &&
  !!selectedProviderId.value &&
  !!selectedModelId.value &&
  !creatingDeck.value
)

watch(currentWorkspaceId, async (workspaceId) => {
  if (!workspaceId) return
  await Promise.all([loadDecks(workspaceId), loadWorkspaceSettings(workspaceId)])
}, { immediate: true })

watch([currentWorkspaceId, selectedProviderId], async ([workspaceId, providerId]) => {
  await loadProviderModels(workspaceId, providerId)
}, { immediate: true })

onMounted(async () => {
  if (!isAuthenticated.value) return
  await loadWorkspaces()
})

async function startDeck() {
  if (!canOpenStudio.value || !currentWorkspaceId.value) return
  const initialPrompt = prompt.value.trim()
  const hasGenerationSettings =
    !!initialPrompt && !!selectedProviderId.value && !!selectedModelId.value
  // The full prompt is passed separately as manualInstruction; the worker sets a
  // proper LLM-generated title after generation, so create with a safe provisional
  // title rather than the (possibly >160 char) prompt.
  const title = 'Untitled deck'
  creatingDeck.value = true
  uploadingFiles.value = true
  try {
    const deck = await createDeck(currentWorkspaceId.value, title)
    const deckId = deck.id

    await uploadPendingFiles(deckId)

    prompt.value = ''
    pendingReferenceFiles.value = []
    pendingAssetFiles.value = []

    if (hasGenerationSettings) {
      await router.push({
        path: `/decks/${deckId}`,
        query: serializeInitialGenerationQuery({
          manualInstruction: initialPrompt,
          textProviderId: selectedProviderId.value,
          textModelId: selectedModelId.value,
          customPromptId: selectedCustomPromptId.value,
          designSystemId: selectedDesignSystemId.value,
          languageCode: language.value,
          enableImageGeneration: enableImageGen.value,
          imageProviderId: selectedImageProviderId.value,
          imageModelId: selectedImageModelId.value
        })
      })
    } else {
      await router.push(`/decks/${deckId}`)
    }
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Could not create deck', description: err?.data?.statusMessage ?? 'Please check your workspace access.', color: 'error' })
  } finally {
    creatingDeck.value = false
  }
}

function openDeck(deck: DeckSummary) {
  void router.push(`/decks/${deck.id}`)
}

function formatRelative(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr
  if (diff < min) return 'just now'
  if (diff < hr) return `${Math.floor(diff / min)}m ago`
  if (diff < day) return `${Math.floor(diff / hr)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
}

const suggestionChips = [
  { label: 'Pitch deck for Series A fundraise', icon: 'i-heroicons-rocket-launch' },
  { label: 'Q3 board update', icon: 'i-heroicons-presentation-chart-line' },
  { label: 'Product launch announcement', icon: 'i-heroicons-megaphone' },
  { label: 'Internal training on data privacy', icon: 'i-heroicons-academic-cap' }
]

const templateCards = [
  { title: 'Business Review', meta: '16 slides', color: 'from-slate-900 to-blue-800' },
  { title: 'Marketing Plan', meta: '20 slides', color: 'from-slate-800 to-cyan-800' },
  { title: 'Project Proposal', meta: '18 slides', color: 'from-slate-900 to-indigo-800' }
]

const quickActions = [
  { label: 'Import existing deck', hint: 'Upload a PPTX or PDF', icon: 'i-heroicons-arrow-up-tray' },
  { label: 'Create from knowledge', hint: 'Use your documents', icon: 'i-heroicons-book-open' },
  { label: 'Browse templates', hint: 'Pick a layout to start', icon: 'i-heroicons-table-cells' }
]

function applyChip(label: string) {
  prompt.value = label
}

function onSelectReferences(event: Event) {
  const files = (event.target as HTMLInputElement).files
  if (files) {
    pendingReferenceFiles.value = [...pendingReferenceFiles.value, ...Array.from(files)]
  }
}

function onSelectAssets(event: Event) {
  const files = (event.target as HTMLInputElement).files
  if (files) {
    pendingAssetFiles.value = [...pendingAssetFiles.value, ...Array.from(files)]
  }
}

function removePendingReference(index: number) {
  pendingReferenceFiles.value.splice(index, 1)
}

function removePendingAsset(index: number) {
  pendingAssetFiles.value.splice(index, 1)
}

async function uploadPendingFiles(deckId: string) {
  for (const file of pendingReferenceFiles.value) {
    try {
      const form = new FormData()
      form.set('file', file)
      await $fetch(`/api/decks/${deckId}/reference-files`, { method: 'POST', body: form })
    } catch {
      // best-effort; don't block navigation
    }
  }
  for (const file of pendingAssetFiles.value) {
    try {
      const form = new FormData()
      form.set('file', file)
      await $fetch(`/api/decks/${deckId}/assets`, { method: 'POST', body: form })
    } catch {
      // best-effort; don't block navigation
    }
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
    <section class="border-b border-border pb-5">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-fg">Good morning, {{ displayName }}</h1>
          <p class="mt-1 text-sm text-fg-muted">Create a new deck with AI. Start with a prompt, upload reference, or pick a template.</p>
        </div>
        <PxBadge v-if="currentWorkspace" tone="neutral" variant="soft" size="sm" icon="i-heroicons-square-3-stack-3d">
          {{ currentWorkspace.name }}
        </PxBadge>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="space-y-4">
      <div class="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-fg">New deck</h2>
            <p class="mt-0.5 text-xs text-fg-muted">Describe the deck you want to generate.</p>
          </div>
          <span class="text-xs text-fg-subtle">{{ prompt.length }} / 2000</span>
        </div>
        <PxTextarea
          v-model="prompt"
          placeholder="e.g. Build a 10-slide investor update for a B2B SaaS analytics platform, executive tone, Indonesian language."
          :rows="5"
          autoresize
          class="!border-0 !bg-transparent !shadow-none"
          @submit="startDeck"
        />
        <div class="mt-2 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <button
              v-for="chip in suggestionChips"
              :key="chip.label"
              type="button"
              class="px-focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:border-border-strong hover:text-fg"
              @click="applyChip(chip.label)"
            >
              <UIcon :name="chip.icon" class="h-3.5 w-3.5" />
              {{ chip.label }}
            </button>
          </div>
          <div class="flex items-center gap-2">
            <PxButton variant="secondary" size="lg" icon="i-heroicons-adjustments-horizontal" @click="settingsOpen = !settingsOpen">
              Settings
            </PxButton>
            <PxButton
              variant="primary"
              size="lg"
              icon="i-heroicons-arrow-up-right"
              :loading="creatingDeck"
              :disabled="!canOpenStudio"
              @click="startDeck"
            >
              {{ canStartDeck ? 'Generate' : 'Open studio' }}
            </PxButton>
          </div>
        </div>
      </div>

      <div v-if="settingsOpen" class="mt-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-fg">Generation settings</h2>
            <p class="mt-0.5 text-xs text-fg-muted">Provider, design, language, and evidence used for this deck.</p>
          </div>
          <PxButton variant="ghost" size="sm" icon="i-heroicons-x-mark" square aria-label="Close generation settings" @click="settingsOpen = false" />
        </div>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PxSelect
            v-model="selectedProviderId"
            :options="providerOptions"
            placeholder="Select provider"
            label="Provider"
            size="sm"
            :disabled="loadingProviders || providerOptions.length === 0"
          />
          <PxSelect
            v-model="selectedModelId"
            :options="modelOptions"
            placeholder="Select model"
            label="Model"
            size="sm"
            :disabled="loadingModels || modelOptions.length === 0"
          />
          <PxSelect
            v-model="selectedCustomPromptId"
            :options="customPromptOptions"
            label="Prompt preset"
            size="sm"
          />
          <PxSelect
            v-model="selectedDesignSystemId"
            :options="designSystemOptions"
            label="Design system"
            size="sm"
            :disabled="designSystemOptions.length === 1"
          />
          <PxSelect
            v-model="language"
            :options="[{ value: 'en', label: 'English' }, { value: 'id', label: 'Indonesian' }]"
            label="Language"
            size="sm"
          />
          <label class="flex h-full min-h-16 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm font-semibold text-fg">
            <input v-model="enableImageGen" type="checkbox" class="h-4 w-4 rounded" />
            <span>Generate images</span>
          </label>
          <div v-if="enableImageGen" class="grid gap-2 md:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
            <PxSelect
              v-model="selectedImageProviderId"
              :options="providerOptions"
              placeholder="Image provider"
              size="sm"
              :disabled="loadingProviders || providerOptions.length === 0"
            />
            <PxInput v-model="selectedImageModelId" placeholder="Image model ID" size="sm" />
          </div>
        </div>
        <p v-if="configError" class="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          {{ configError }}
        </p>
        <div class="hidden">
          <div class="space-y-2">
            <p class="text-[11px] font-bold uppercase tracking-wider text-fg-muted">Reference files</p>
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
              class="block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-fg file:px-2 file:py-1 file:text-xs file:font-medium file:text-surface"
              @change="onSelectReferences"
            />
            <div v-if="pendingReferenceFiles.length > 0" class="flex flex-wrap gap-1.5">
              <PxBadge
                v-for="(file, i) in pendingReferenceFiles"
                :key="i"
                tone="neutral"
                variant="soft"
                size="sm"
                class="cursor-pointer"
                @click="removePendingReference(i)"
              >
                {{ file.name }} ×
              </PxBadge>
            </div>
          </div>
          <div class="space-y-2">
            <p class="text-[11px] font-bold uppercase tracking-wider text-fg-muted">Assets</p>
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.svg"
              class="block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-fg file:px-2 file:py-1 file:text-xs file:font-medium file:text-surface"
              @change="onSelectAssets"
            />
            <div v-if="pendingAssetFiles.length > 0" class="flex flex-wrap gap-1.5">
              <PxBadge
                v-for="(file, i) in pendingAssetFiles"
                :key="i"
                tone="neutral"
                variant="soft"
                size="sm"
                class="cursor-pointer"
                @click="removePendingAsset(i)"
              >
                {{ file.name }} ×
              </PxBadge>
            </div>
          </div>
        </div>

        <div class="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-2">
          <PxUploadZone label="Reference files" description="PDF, text, CSV, or image evidence for generation." multiple accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" :files="pendingReferenceFiles" @select="onSelectReferences" @remove="removePendingReference" />
          <PxUploadZone label="Assets" description="Reusable images or SVGs that can be placed in slides." multiple accept=".png,.jpg,.jpeg,.webp,.svg" :files="pendingAssetFiles" @select="onSelectAssets" @remove="removePendingAsset" />
        </div>

      </div>
      </div>

      <aside class="grid gap-4">
        <div class="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-fg">Start with a template</h2>
            <NuxtLink to="/examples" class="text-xs font-medium text-fg-muted hover:text-fg">View all</NuxtLink>
          </div>
          <div class="divide-y divide-border">
            <button
              v-for="template in templateCards"
              :key="template.title"
              type="button"
              class="flex w-full items-center gap-3 py-3 text-left"
              @click="applyChip(template.title)"
            >
              <span :class="['h-12 w-20 rounded-md bg-gradient-to-br shadow-sm', template.color]" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-fg">{{ template.title }}</span>
                <span class="block text-xs text-fg-subtle">{{ template.meta }}</span>
              </span>
            </button>
          </div>
        </div>
        <div class="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 class="mb-3 text-sm font-semibold text-fg">Quick actions</h2>
          <div class="grid gap-2">
            <button
              v-for="action in quickActions"
              :key="action.label"
              type="button"
              class="flex items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-left transition hover:border-border-strong"
            >
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-fg-muted">
                <UIcon :name="action.icon" class="h-4 w-4" />
              </span>
              <span>
                <span class="block text-sm font-medium text-fg">{{ action.label }}</span>
                <span class="block text-xs text-fg-subtle">{{ action.hint }}</span>
              </span>
            </button>
          </div>
        </div>
      </aside>
      </div>
    </section>

    <section>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-fg">Recent decks</h2>
        <NuxtLink to="/workspaces" class="text-xs font-semibold text-accent hover:underline">View all →</NuxtLink>
      </div>

      <div v-if="loadingDecks" class="grid gap-2">
        <PxSkeleton v-for="i in 4" :key="i" class="h-14 rounded-lg" />
      </div>
      <div v-else class="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <table class="w-full text-sm">
          <thead class="border-b border-border bg-bg-subtle text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            <tr>
              <th class="w-10 px-3 py-2 text-left"></th>
              <th class="px-3 py-2 text-left">Name</th>
              <th class="hidden px-3 py-2 text-left sm:table-cell">Status</th>
              <th class="hidden px-3 py-2 text-left md:table-cell">Slides</th>
              <th class="hidden px-3 py-2 text-left lg:table-cell">Updated</th>
              <th class="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="deck in recentDecks" :key="deck.id" class="cursor-pointer hover:bg-bg-subtle/60" @click="openDeck(deck)">
              <td class="px-3 py-2">
                <div class="flex h-8 w-10 items-center justify-center rounded border border-border bg-surface-raised">
                  <UIcon name="i-heroicons-presentation-chart-bar" class="h-4 w-4 text-fg-subtle" />
                </div>
              </td>
              <td class="min-w-0 px-3 py-2">
                <p class="truncate font-medium text-fg">{{ deck.title }}</p>
                <p class="text-xs text-fg-subtle">Updated {{ formatRelative(deck.updatedAt) }}</p>
              </td>
              <td class="hidden px-3 py-2 sm:table-cell"><PxBadge tone="success" variant="soft" size="xs">Ready</PxBadge></td>
              <td class="hidden px-3 py-2 text-fg-muted md:table-cell">{{ deck.slideCount ?? '-' }}</td>
              <td class="hidden px-3 py-2 text-fg-muted lg:table-cell">{{ formatRelative(deck.updatedAt) }}</td>
              <td class="px-3 py-2 text-right"><UIcon name="i-heroicons-ellipsis-horizontal" class="ml-auto h-4 w-4 text-fg-subtle" /></td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="flex w-full items-center justify-center gap-2 border-t border-border px-3 py-3 text-sm font-medium text-fg-muted hover:text-accent" :disabled="!canOpenStudio" @click="startDeck">
          <UIcon name="i-heroicons-plus" class="h-4 w-4" />
          New deck
        </button>
      </div>
    </section>
  </div>
</template>
