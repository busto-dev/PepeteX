<script setup lang="ts">
import type { ExampleSummary } from '~/types'
import type { InitialGenerationSettings } from '~/lib/initial-generation-settings'
import { serializeInitialGenerationQuery, storeInitialGenerationSettings } from '~/lib/initial-generation-settings'

interface InstantiateResult {
  deckId: string
  initialGenerationSettings: {
    manualInstruction: string
    textProviderId: string | null
    textModelId: string | null
    customPromptId: string | null
    designSystemId: string | null
    languageCode: string
    enableImageGeneration: boolean
    imageProviderId: string | null
    imageModelId: string | null
  }
}

const router = useRouter()
const toast = useToast()
const { currentWorkspaceId } = useWorkspaces()
const examples = ref<ExampleSummary[]>([])
const loading = ref(false)
const search = ref('')
const categoryFilter = ref<string>('all')
const instantiatingId = ref<string | null>(null)
const initialGenerationByDeck = useState<Record<string, InitialGenerationSettings>>(
  'deck:initial-generation-settings',
  () => ({})
)

async function load() {
  loading.value = true
  try {
    const query: Record<string, string> = {}
    if (categoryFilter.value !== 'all') query.category = categoryFilter.value
    if (search.value) query.q = search.value
    const data = await $fetch<{ examples: ExampleSummary[] }>('/api/examples', { query })
    examples.value = data.examples
  } finally {
    loading.value = false
  }
}

onMounted(load)

let filterTimer: ReturnType<typeof setTimeout> | null = null
watch([search, categoryFilter], () => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(load, 350)
})

const categories = computed<string[]>(() => {
  const cats = new Set(examples.value.map((e) => e.category).filter(Boolean) as string[])
  return Array.from(cats).sort()
})

async function useExample(e: ExampleSummary) {
  if (!currentWorkspaceId.value) {
    toast.add({
      title: 'Select a workspace first',
      description: 'Open the workspace switcher and pick a workspace before using a template.',
      color: 'warning'
    })
    return
  }
  if (instantiatingId.value) return

  instantiatingId.value = e.id
  try {
    const result = await $fetch<InstantiateResult>(`/api/examples/${e.id}/instantiate`, {
      method: 'POST',
      body: { workspaceId: currentWorkspaceId.value }
    })
    const initialGenerationSettings = {
      ...result.initialGenerationSettings,
      prefillOnly: true
    }
    initialGenerationByDeck.value = {
      ...initialGenerationByDeck.value,
      [result.deckId]: initialGenerationSettings
    }
    storeInitialGenerationSettings(result.deckId, initialGenerationSettings)
    const query = serializeInitialGenerationQuery(initialGenerationSettings)
    await router.push({ path: `/decks/${result.deckId}`, query })
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Could not start from template',
      description: err?.data?.statusMessage ?? 'Please try again or contact an admin.',
      color: 'error'
    })
  } finally {
    instantiatingId.value = null
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl pb-12">
    <PxPageHeader
      title="Example prompts"
      description="Curated prompts to get started quickly."
    />

    <div class="mb-5 flex flex-wrap items-center gap-3">
      <PxInput
        v-model="search"
        type="search"
        placeholder="Search examples..."
        icon="i-heroicons-magnifying-glass"
        class="sm:w-72"
      />
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="px-focus-ring rounded-full border px-3 py-1 text-xs font-semibold shadow-xs transition-all"
          :class="categoryFilter === 'all' ? 'border-accent text-white shadow-[0_2px_8px_var(--px-accent-glow)]' : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-raised hover:text-fg'"
          :style="categoryFilter === 'all' ? 'background: var(--px-accent-grad)' : undefined"
          @click="categoryFilter = 'all'"
        >All</button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="px-focus-ring rounded-full border px-3 py-1 text-xs font-semibold shadow-xs transition-all"
          :class="categoryFilter === cat ? 'border-accent text-white shadow-[0_2px_8px_var(--px-accent-glow)]' : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-raised hover:text-fg'"
          :style="categoryFilter === cat ? 'background: var(--px-accent-grad)' : undefined"
          @click="categoryFilter = cat"
        >{{ cat }}</button>
      </div>
    </div>

    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <PxSkeleton v-for="i in 6" :key="i" class="h-40" />
    </div>
    <PxEmptyState
      v-else-if="examples.length === 0"
      icon="i-heroicons-light-bulb"
      title="No examples found"
      :description="search ? 'Try different keywords.' : 'Examples will appear here once seeded.'"
    />
    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <PxCard
        v-for="e in examples"
        :key="e.id"
        hoverable
        class="group flex h-full flex-col gap-3"
      >
        <div class="flex-1 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <h3 class="line-clamp-1 text-sm font-semibold text-fg">{{ e.title }}</h3>
            <PxBadge v-if="e.category" tone="neutral" variant="soft" size="xs">{{ e.category }}</PxBadge>
          </div>
          <p v-if="e.promptEn ?? e.promptText" class="line-clamp-3 text-xs leading-relaxed text-fg-muted">
            {{ e.promptEn ?? e.promptText }}
          </p>
          <div v-if="(e.referenceFiles?.length ?? 0) > 0 || e.imageEnabled || e.designSystemId || e.customPromptId" class="flex flex-wrap gap-1.5 pt-1">
            <PxBadge v-if="e.designSystemId" tone="neutral" variant="soft" size="xs">design system</PxBadge>
            <PxBadge v-if="e.customPromptId" tone="neutral" variant="soft" size="xs">prompt preset</PxBadge>
            <PxBadge v-if="e.imageEnabled" tone="neutral" variant="soft" size="xs">generate images</PxBadge>
            <PxBadge
              v-if="(e.referenceFiles?.length ?? 0) > 0"
              tone="neutral"
              variant="soft"
              size="xs"
            >
              {{ e.referenceFiles?.length }} file{{ (e.referenceFiles?.length ?? 0) === 1 ? '' : 's' }}
            </PxBadge>
          </div>
        </div>
        <PxButton
          variant="primary"
          size="sm"
          class="mt-auto self-start"
          trailing-icon="i-heroicons-arrow-right"
          :loading="instantiatingId === e.id"
          :disabled="instantiatingId !== null && instantiatingId !== e.id"
          @click="useExample(e)"
        >
          Use this prompt
        </PxButton>
      </PxCard>
    </div>
  </div>
</template>
