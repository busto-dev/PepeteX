<script setup lang="ts">
import type { AuditLogEntry } from '~/types'

definePageMeta({ middleware: 'admin' })

const entries = ref<AuditLogEntry[]>([])
const loading = ref(false)
const actionFilter = ref('')
const cursor = ref<string | undefined>(undefined)
const hasMore = ref(true)

async function load(reset = false) {
  if (reset) { entries.value = []; cursor.value = undefined; hasMore.value = true }
  loading.value = true
  try {
    const query: Record<string, string> = {}
    if (actionFilter.value) query.action = actionFilter.value
    if (cursor.value) query.cursor = cursor.value
    const data = await $fetch<{ entries: AuditLogEntry[]; nextCursor?: string }>('/api/admin/audit-logs', { query })
    entries.value.push(...data.entries)
    cursor.value = data.nextCursor
    hasMore.value = !!data.nextCursor
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))
let filterTimer: ReturnType<typeof setTimeout> | null = null
watch(actionFilter, () => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => load(true), 400)
})

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Audit logs"
      description="Track all administrative and user actions."
      :back="{ to: '/admin' }"
    />

    <div class="mb-4 max-w-sm">
      <PxInput
        v-model="actionFilter"
        placeholder="Filter by action…"
        icon="i-heroicons-magnifying-glass"
      />
    </div>

    <div class="overflow-hidden rounded-xl border border-border bg-surface">
      <table class="w-full text-sm">
        <thead class="border-b border-border bg-bg-subtle/50 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            <th class="px-4 py-3 text-left">Timestamp</th>
            <th class="px-4 py-3 text-left">Actor</th>
            <th class="px-4 py-3 text-left">Action</th>
            <th class="px-4 py-3 text-left">Resource</th>
            <th class="px-4 py-3 text-left">Details</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="e in entries" :key="e.id" class="hover:bg-bg-subtle/50">
            <td class="whitespace-nowrap px-4 py-3 text-xs text-fg-muted">{{ formatDate(e.createdAt) }}</td>
            <td class="px-4 py-3 text-xs text-fg">{{ e.actorEmail ?? '—' }}</td>
            <td class="px-4 py-3">
              <PxBadge tone="neutral" variant="soft" size="xs">{{ e.action }}</PxBadge>
            </td>
            <td class="px-4 py-3 text-xs text-fg-muted">
              {{ e.resourceType }}
              <span v-if="e.resourceId" class="ml-1 font-mono">{{ e.resourceId.slice(0, 8) }}…</span>
            </td>
            <td class="max-w-xs truncate px-4 py-3 text-xs text-fg-muted">{{ e.details ? JSON.stringify(e.details) : '—' }}</td>
          </tr>
          <tr v-if="loading">
            <td colspan="5" class="px-4 py-6 text-center text-fg-muted">Loading…</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-fg-muted">No audit log entries.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="hasMore && !loading" class="mt-4 flex justify-center">
      <PxButton variant="outline" @click="load()">Load more</PxButton>
    </div>
  </div>
</template>
