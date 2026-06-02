<script setup lang="ts">
import type { DashboardStats } from '~/types'

definePageMeta({ middleware: 'admin' })

const { data, refresh } = await useAsyncData('admin-dashboard', () =>
  $fetch<DashboardStats | { stats: DashboardStats }>('/api/admin/dashboard').then((response) =>
    'stats' in response ? response.stats : response
  )
)
const stats = computed(() => data.value)

const statCards = computed(() => [
  { label: 'Users', value: stats.value?.userCount ?? stats.value?.totalUsers ?? 0, icon: 'i-heroicons-users', to: '/admin/users' },
  { label: 'Workspaces', value: stats.value?.workspaceCount ?? stats.value?.totalWorkspaces ?? 0, icon: 'i-heroicons-square-3-stack-3d', to: null },
  { label: 'Decks', value: stats.value?.deckCount ?? stats.value?.totalDecks ?? 0, icon: 'i-heroicons-document-text', to: null },
  { label: 'Generation runs', value: stats.value?.generationRunCount ?? stats.value?.totalGenerationRuns ?? 0, icon: 'i-heroicons-sparkles', to: '/admin/jobs' },
  { label: 'Failed runs', value: stats.value?.failedRunCount ?? 0, icon: 'i-heroicons-exclamation-triangle', to: '/admin/jobs', tone: 'danger' },
  { label: 'Active runs', value: stats.value?.activeRunCount ?? 0, icon: 'i-heroicons-play', to: '/admin/jobs', tone: 'success' }
])

const manageItems = [
  { to: '/admin/users', label: 'Users', description: 'Roles, status, password reset', icon: 'i-heroicons-users' },
  { to: '/admin/providers', label: 'Providers', description: 'AI providers and BYOK', icon: 'i-heroicons-cpu-chip' },
  { to: '/admin/jobs', label: 'Jobs', description: 'Generation queue + history', icon: 'i-heroicons-queue-list' },
  { to: '/admin/usage', label: 'Usage & cost', description: 'Tokens, requests, billing', icon: 'i-heroicons-chart-bar' },
  { to: '/admin/audit-logs', label: 'Audit logs', description: 'Auth, generations, admin actions', icon: 'i-heroicons-clipboard-document-list' },
  { to: '/admin/examples', label: 'Examples', description: 'Curated prompts library', icon: 'i-heroicons-light-bulb' },
  { to: '/admin/image-generation', label: 'Image generation', description: 'Image providers and tests', icon: 'i-heroicons-photo' }
]
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Admin overview"
      description="System-wide statistics and quick links."
    >
      <template #actions>
        <PxButton variant="ghost" icon="i-heroicons-arrow-path" @click="() => refresh()">Refresh</PxButton>
      </template>
    </PxPageHeader>

    <div class="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <component
        :is="card.to ? 'NuxtLink' : 'div'"
        v-for="card in statCards"
        :key="card.label"
        :to="card.to ?? undefined"
        :class="card.to ? 'px-focus-ring block rounded-xl' : ''"
      >
        <PxCard :hover="!!card.to" class="h-full">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-xs font-medium text-fg-muted">{{ card.label }}</p>
              <p :class="['mt-1 text-2xl font-black tracking-tight', card.tone === 'danger' ? 'text-danger' : card.tone === 'success' ? 'text-success' : 'text-fg']">{{ card.value }}</p>
            </div>
            <UIcon :name="card.icon" class="h-5 w-5 text-fg-subtle" />
          </div>
        </PxCard>
      </component>
    </div>

    <h2 class="mb-3 text-sm font-semibold text-fg">Manage</h2>
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <NuxtLink
        v-for="item in manageItems"
        :key="item.to"
        :to="item.to"
        class="group cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)] transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_6px_18px_rgba(0,0,0,0.09)]"
      >
        <div class="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-high">
          <UIcon :name="item.icon" class="h-4 w-4 text-fg-muted transition group-hover:text-accent" />
        </div>
        <div class="text-xs font-bold text-fg">{{ item.label }}</div>
        <div class="mt-1 text-[10px] leading-relaxed text-fg-muted">{{ item.description }}</div>
      </NuxtLink>
    </div>
  </div>
</template>
