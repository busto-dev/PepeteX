<script setup lang="ts">
const { isGlobalAdmin } = useSession()
const { workspaces, currentWorkspaceId, setWorkspace } = useWorkspaces()
const route = useRoute()

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()

const currentWorkspace = computed(() => workspaces.value.find(w => w.id === currentWorkspaceId.value))

const navItems = [
  { label: 'Studio', hint: 'Generate decks', icon: 'i-heroicons-squares-2x2', to: '/' },
  { label: 'Design Systems', hint: 'Brand kits', icon: 'i-heroicons-swatch', to: '/design-systems' },
  { label: 'Custom Prompts', hint: 'Reusable briefs', icon: 'i-heroicons-chat-bubble-left-ellipsis', to: '/prompts' },
  { label: 'Examples', hint: 'Starting points', icon: 'i-heroicons-star', to: '/examples' },
]

const adminItems = [
  { label: 'Dashboard', icon: 'i-heroicons-chart-bar', to: '/admin' },
  { label: 'Users', icon: 'i-heroicons-users', to: '/admin/users' },
  { label: 'Providers', icon: 'i-heroicons-cpu-chip', to: '/admin/providers' },
  { label: 'Jobs', icon: 'i-heroicons-queue-list', to: '/admin/jobs' },
  { label: 'Usage', icon: 'i-heroicons-arrow-trending-up', to: '/admin/usage' },
  { label: 'Audit Logs', icon: 'i-heroicons-clipboard-document-list', to: '/admin/audit-logs' },
  { label: 'Examples', icon: 'i-heroicons-academic-cap', to: '/admin/examples' },
  { label: 'Image Gen', icon: 'i-heroicons-photo', to: '/admin/image-generation' },
]

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

<template>
  <aside
    class="relative flex shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#07111f] text-white shadow-2xl transition-all duration-200"
    :class="collapsed ? 'w-16' : 'w-72'"
  >
    <div class="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_30%_0%,rgba(79,70,229,.42),transparent_28rem)]" />
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(circle_at_60%_100%,rgba(6,182,212,.18),transparent_24rem)]" />

    <!-- Logo + toggle -->
    <div class="relative flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-3">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950 shadow-lg shadow-indigo-950/20">
          PX
        </div>
        <div v-if="!collapsed" class="min-w-0">
          <p class="text-base font-black tracking-tight text-white">PepeteX</p>
          <p class="truncate text-[11px] font-medium text-slate-400">AI presentation studio</p>
        </div>
      </div>
      <button
        type="button"
        class="rounded-xl p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="emit('toggle')"
      >
        <UIcon :name="collapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-left'" class="h-4 w-4" />
      </button>
    </div>

    <!-- Workspace indicator -->
    <div v-if="!collapsed && currentWorkspace" class="relative border-b border-white/10 px-3 py-4">
      <p class="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
      <select
        class="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm font-semibold text-slate-100 outline-none transition focus:border-indigo-400"
        :value="currentWorkspaceId ?? ''"
        @change="setWorkspace(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="ws in workspaces" :key="ws.id" :value="ws.id" class="bg-slate-900">{{ ws.name }}</option>
      </select>
    </div>
    <div v-else-if="collapsed && currentWorkspace" class="relative flex justify-center border-b border-white/10 py-3">
      <div
        class="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-500 text-xs font-black text-white shadow-lg shadow-indigo-950/30"
        :title="currentWorkspace.name"
      >{{ currentWorkspace.name[0]?.toUpperCase() }}</div>
    </div>

    <!-- Primary nav -->
    <nav class="scrollbar-dark relative flex-1 space-y-1 overflow-y-auto px-2 py-4">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all"
        :class="isActive(item.to)
          ? 'bg-white text-slate-950 shadow-xl shadow-indigo-950/20'
          : 'text-slate-400 hover:bg-white/10 hover:text-white'"
        :title="collapsed ? item.label : undefined"
      >
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors" :class="isActive(item.to) ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-slate-400 group-hover:bg-white/10 group-hover:text-white'">
          <UIcon :name="item.icon" class="h-4 w-4" />
        </span>
        <span v-if="!collapsed" class="min-w-0">
          <span class="block truncate">{{ item.label }}</span>
          <span class="block truncate text-[11px] font-medium" :class="isActive(item.to) ? 'text-slate-500' : 'text-slate-500'">{{ item.hint }}</span>
        </span>
      </NuxtLink>

      <!-- Admin section -->
      <template v-if="isGlobalAdmin">
        <div v-if="!collapsed" class="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Admin
        </div>
        <div v-else class="mt-4 mb-1 px-2.5">
          <div class="border-t border-slate-700/50" />
        </div>
        <NuxtLink
          v-for="item in adminItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold transition-colors"
          :class="isActive(item.to)
            ? 'bg-amber-400/15 text-amber-200'
            : 'text-slate-500 hover:bg-white/10 hover:text-slate-200'"
          :title="collapsed ? item.label : undefined"
        >
          <UIcon :name="item.icon" class="h-4 w-4 shrink-0" />
          <span v-if="!collapsed">{{ item.label }}</span>
        </NuxtLink>
      </template>
    </nav>

    <!-- Bottom: settings + user -->
    <div class="relative space-y-1 border-t border-white/10 p-2">
      <NuxtLink
        to="/settings"
        class="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        :title="collapsed ? 'Settings' : undefined"
      >
        <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">Settings</span>
      </NuxtLink>
      <AppUserMenu :collapsed="collapsed" />
    </div>
  </aside>
</template>
