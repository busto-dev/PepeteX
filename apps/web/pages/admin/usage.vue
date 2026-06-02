<script setup lang="ts">
import type { UsageStats } from '~/types'

definePageMeta({ middleware: 'admin' })

const data = ref<UsageStats | null>(null)
const loading = ref(false)
const period = ref<'day' | 'week' | 'month' | 'all'>('month')

const periodOptions = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' }
]

async function load() {
  loading.value = true
  try {
    const result = await $fetch<{ stats: UsageStats }>('/api/admin/usage', { query: { period: period.value } })
    data.value = result.stats
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(period, load)

function formatCost(v?: number | null) {
  if (v == null) return '—'
  return v.toFixed(4)
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Usage statistics"
      description="Platform usage metrics by period."
      :back="{ to: '/admin' }"
    >
      <template #actions>
        <PxSelect v-model="period" :options="periodOptions" size="sm" />
      </template>
    </PxPageHeader>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <PxSkeleton v-for="i in 5" :key="i" class="h-24" />
    </div>
    <div v-else-if="data" class="space-y-6">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <PxCard padding="md">
          <p class="text-2xl font-semibold text-fg">{{ data.generationRuns ?? 0 }}</p>
          <p class="mt-1 text-xs text-fg-muted">Generation runs</p>
        </PxCard>
        <PxCard padding="md">
          <p class="text-2xl font-semibold text-fg">{{ data.pptxExports ?? 0 }}</p>
          <p class="mt-1 text-xs text-fg-muted">PPTX exports</p>
        </PxCard>
        <PxCard padding="md">
          <p class="text-2xl font-semibold text-fg">{{ data.activeUsers ?? 0 }}</p>
          <p class="mt-1 text-xs text-fg-muted">Active users</p>
        </PxCard>
        <PxCard padding="md">
          <p class="text-2xl font-semibold text-fg">{{ data.tokensUsed ?? 0 }}</p>
          <p class="mt-1 text-xs text-fg-muted">Tokens used</p>
        </PxCard>
        <PxCard
          padding="md"
          class="bg-[color:color-mix(in_oklab,var(--px-accent-500)_8%,transparent)] [border-color:color-mix(in_oklab,var(--px-accent-500)_30%,var(--px-border))]"
        >
          <p class="text-2xl font-semibold text-accent">${{ formatCost(data.totalCostUsd) }}</p>
          <p class="mt-1 text-xs text-fg-muted">Estimated cost (USD)</p>
        </PxCard>
      </div>

      <PxCard v-if="data.byProvider && data.byProvider.length > 0" padding="md">
        <h3 class="mb-3 text-sm font-semibold text-fg">By provider</h3>
        <table class="w-full text-sm">
          <thead class="text-xs font-medium uppercase tracking-wide text-fg-muted">
            <tr>
              <th class="pb-2 text-left">Provider</th>
              <th class="pb-2 text-right">Runs</th>
              <th class="pb-2 text-right">Tokens</th>
              <th class="pb-2 text-right">Est. cost (USD)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="row in data.byProvider" :key="row.providerId">
              <td class="py-2 text-fg">{{ row.providerName }}</td>
              <td class="py-2 text-right text-fg-muted">{{ row.runs }}</td>
              <td class="py-2 text-right text-fg-muted">{{ row.tokens }}</td>
              <td class="py-2 text-right font-medium text-accent">${{ formatCost(row.costUsd) }}</td>
            </tr>
          </tbody>
        </table>
      </PxCard>
    </div>
    <PxEmptyState
      v-else
      icon="i-heroicons-chart-bar"
      title="No usage data"
      description="No usage has been recorded for this period."
    />
  </div>
</template>
