<script setup lang="ts">
definePageMeta({ title: 'Search' })

interface SearchResult {
  id: string
  kind: 'deck' | 'slide' | 'prompt' | 'design-system'
  title: string
  subtitle?: string
  url: string
  workspaceName?: string
}

const query = ref('')
const results = ref<SearchResult[]>([])
const loading = ref(false)
const searched = ref(false)

let searchTimer: number | null = null
watch(query, (v) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  if (v.trim().length >= 2) {
    searchTimer = window.setTimeout(() => { void search() }, 400)
  } else {
    results.value = []
    searched.value = false
  }
})

async function search() {
  if (!query.value.trim()) return
  loading.value = true
  searched.value = true
  try {
    const data = await $fetch<{ results: SearchResult[] }>('/api/search', {
      query: { q: query.value.trim() }
    })
    results.value = data.results ?? []
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

const kindTone: Record<string, 'accent' | 'info' | 'success' | 'neutral'> = {
  deck: 'accent',
  slide: 'info',
  prompt: 'success',
  'design-system': 'neutral'
}

const kindIcon: Record<string, string> = {
  deck: 'i-heroicons-document-text',
  slide: 'i-heroicons-rectangle-stack',
  prompt: 'i-heroicons-chat-bubble-left-right',
  'design-system': 'i-heroicons-swatch'
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl pb-12">
    <PxPageHeader
      title="Search"
      description="Search across decks, slides, prompts, and design systems."
    />

    <PxInput
      v-model="query"
      type="search"
      placeholder="Type to search..."
      icon="i-heroicons-magnifying-glass"
      autofocus
      class="mb-6"
      @keydown.enter="search"
    />

    <div v-if="searched && !loading">
      <PxEmptyState
        v-if="results.length === 0"
        icon="i-heroicons-magnifying-glass"
        title="No results"
        :description="`Nothing matched “${query}”. Try different keywords.`"
      />
      <ul v-else class="flex flex-col gap-2">
        <li v-for="r in results" :key="r.id">
          <NuxtLink
            :to="r.url"
            class="px-focus-ring flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-fg-subtle"
          >
            <UIcon :name="kindIcon[r.kind] ?? 'i-heroicons-document'" class="h-5 w-5 shrink-0 text-fg-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ r.title }}</p>
              <p v-if="r.subtitle" class="truncate text-xs text-fg-muted">{{ r.subtitle }}</p>
            </div>
            <PxBadge :tone="kindTone[r.kind] ?? 'neutral'" variant="soft" size="xs">{{ r.kind }}</PxBadge>
            <span v-if="r.workspaceName" class="hidden shrink-0 text-xs text-fg-subtle sm:inline">{{ r.workspaceName }}</span>
          </NuxtLink>
        </li>
      </ul>
      <p class="mt-3 text-center text-xs text-fg-subtle">{{ results.length }} result{{ results.length !== 1 ? 's' : '' }}</p>
    </div>

    <div v-else-if="!searched" class="py-16 text-center text-sm text-fg-muted">
      Start typing to search
    </div>
  </div>
</template>