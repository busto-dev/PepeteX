<script setup lang="ts">
import type { AdminJobSummary } from '~/types'

definePageMeta({ middleware: 'admin' })

const jobs = ref<AdminJobSummary[]>([])
const loading = ref(false)
const queueFilter = ref('all')

const queueOptions = [
  { value: 'all', label: 'All queues' },
  { value: 'generation', label: 'Generation' },
  { value: 'export', label: 'Export' }
]

async function load() {
  loading.value = true
  try {
    const query = queueFilter.value !== 'all' ? { queue: queueFilter.value } : {}
    const data = await $fetch<{ jobs: AdminJobSummary[] }>('/api/admin/jobs', { query })
    jobs.value = data.jobs
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(queueFilter, load)

function statusTone(status: string): 'neutral' | 'accent' | 'success' | 'danger' | 'warning' {
  if (status === 'active') return 'accent'
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'delayed') return 'warning'
  return 'neutral'
}

function formatDate(v: string | number) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Job queue"
      description="Monitor BullMQ background jobs."
      :back="{ to: '/admin' }"
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <PxSelect v-model="queueFilter" :options="queueOptions" size="sm" />
          <PxButton variant="ghost" icon="i-heroicons-arrow-path" @click="load">Refresh</PxButton>
        </div>
      </template>
    </PxPageHeader>

    <div class="overflow-hidden rounded-xl border border-border bg-surface">
      <table class="w-full text-sm">
        <thead class="border-b border-border bg-bg-subtle/50 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            <th class="px-4 py-3 text-left">Job ID</th>
            <th class="px-4 py-3 text-left">Queue</th>
            <th class="px-4 py-3 text-left">Name</th>
            <th class="px-4 py-3 text-left">Status</th>
            <th class="px-4 py-3 text-left">Created</th>
            <th class="px-4 py-3 text-left">Attempts</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="j in jobs" :key="j.id" class="hover:bg-bg-subtle/50">
            <td class="px-4 py-3 font-mono text-xs text-fg-muted">{{ j.id }}</td>
            <td class="px-4 py-3 text-fg">{{ j.queue }}</td>
            <td class="px-4 py-3 text-fg">{{ j.name }}</td>
            <td class="px-4 py-3">
              <PxBadge :tone="statusTone(j.status)" variant="soft" size="xs">{{ j.status }}</PxBadge>
            </td>
            <td class="px-4 py-3 text-xs text-fg-muted">{{ j.createdAt ? formatDate(j.createdAt) : '—' }}</td>
            <td class="px-4 py-3 text-fg-muted">{{ j.attemptsMade }} / {{ j.maxAttempts }}</td>
          </tr>
          <tr v-if="loading">
            <td colspan="6" class="px-4 py-10 text-center text-fg-muted">Loading…</td>
          </tr>
          <tr v-else-if="jobs.length === 0">
            <td colspan="6" class="px-4 py-10 text-center text-fg-muted">No jobs found.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
