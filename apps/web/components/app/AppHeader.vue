<script setup lang="ts">
const emit = defineEmits<{ (e: 'toggle-sidebar'): void }>()
const route = useRoute()

const pageTitle = computed(() => {
  const path = route.path
  if (path === '/') return 'Decks'
  if (path.startsWith('/design-systems')) return 'Design Systems'
  if (path === '/prompts') return 'Custom Prompts'
  if (path === '/examples') return 'Examples'
  if (path === '/settings') return 'Settings'
  if (path.startsWith('/settings/workspace')) return 'Workspace Settings'
  if (path === '/admin') return 'Admin Dashboard'
  if (path === '/admin/users') return 'Users'
  if (path === '/admin/providers') return 'AI Providers'
  if (path === '/admin/jobs') return 'Job Monitor'
  if (path === '/admin/audit-logs') return 'Audit Logs'
  if (path === '/admin/usage') return 'Usage & Costs'
  if (path === '/admin/examples') return 'Prompt Examples'
  if (path === '/admin/image-generation') return 'Image Generation'
  if (path === '/search') return 'Search'
  return 'PepeteX'
})

const pageSubtitle = computed(() => {
  const path = route.path
  if (path === '/') return 'Create, refine, and export presentation decks.'
  if (path.startsWith('/design-systems')) return 'Build brand kits for consistent slide generation.'
  if (path === '/prompts') return 'Manage reusable generation instructions.'
  if (path === '/settings') return 'Profile, workspace, and provider preferences.'
  if (path.startsWith('/admin')) return 'Operational controls and observability.'
  return 'AI-powered PPTX generation.'
})
</script>

<template>
  <header class="flex h-16 shrink-0 items-center gap-4 border-b border-white/70 bg-white/80 px-4 shadow-sm shadow-slate-200/40 backdrop-blur-xl lg:px-6">
    <!-- Mobile sidebar toggle -->
    <button
      type="button"
      class="rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
      @click="emit('toggle-sidebar')"
    >
      <UIcon name="i-heroicons-bars-3" class="h-5 w-5" />
    </button>
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-base font-black tracking-tight text-slate-950">{{ pageTitle }}</h2>
      <p class="hidden truncate text-xs font-medium text-slate-500 sm:block">{{ pageSubtitle }}</p>
    </div>
    <NuxtLink
      to="/search"
      class="hidden min-w-64 items-center gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-sm text-slate-500 transition hover:border-indigo-200 hover:bg-white hover:text-slate-700 md:flex"
    >
      <UIcon name="i-heroicons-magnifying-glass" class="h-4 w-4" />
      <span class="flex-1">Search decks, prompts, design systems</span>
      <span class="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">/</span>
    </NuxtLink>
    <AppNotificationsMenu />
    <AppUserMenu :collapsed="false" />
  </header>
</template>
