<script setup lang="ts">
import { useColorMode } from '#imports'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()

const { isGlobalAdmin, user, logout } = useSession()
const { workspaces, currentWorkspaceId, setWorkspace } = useWorkspaces()
const colorMode = useColorMode()
const route = useRoute()
const { decks } = useDeck()

const currentWorkspace = computed(() => workspaces.value.find((w) => w.id === currentWorkspaceId.value) ?? workspaces.value[0] ?? null)

const navSections = [
  {
    label: '',
    items: [
      { label: 'Studio', icon: 'i-heroicons-home', to: '/' },
      { label: 'Decks', icon: 'i-heroicons-document', to: '/workspaces' },
      { label: 'Templates', icon: 'i-heroicons-table-cells', to: '/examples' },
      { label: 'Design Systems', icon: 'i-heroicons-swatch', to: '/design-systems' },
      { label: 'Prompts', icon: 'i-heroicons-command-line', to: '/prompts' },
      { label: 'Knowledge', icon: 'i-heroicons-cloud', to: '/search' }
    ]
  }
]

const adminNav = [
  { label: 'Providers', icon: 'i-heroicons-cpu-chip', to: '/admin/providers' },
  { label: 'Users', icon: 'i-heroicons-users', to: '/admin/users' },
  { label: 'Templates', icon: 'i-heroicons-academic-cap', to: '/admin/examples' },
  { label: 'Jobs', icon: 'i-heroicons-queue-list', to: '/admin/jobs' },
  { label: 'Usage', icon: 'i-heroicons-chart-bar', to: '/admin/usage' },
  { label: 'Audit', icon: 'i-heroicons-clipboard-document-list', to: '/admin/audit-logs' },
  { label: 'Image gen', icon: 'i-heroicons-photo', to: '/admin/image-generation' },
  { label: 'Settings', icon: 'i-heroicons-cog-6-tooth', to: '/settings' }
]

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  if (to === '/admin') return route.path === '/admin'
  return route.path.startsWith(to)
}

function navCount(to: string) {
  if (to === '/workspaces') return workspaces.value.length || undefined
  if (to === '/') return decks.value.length || undefined
  return undefined
}

const userMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)

function onClickOutside(e: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) userMenuOpen.value = false
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))

function cycleTheme() {
  const next = colorMode.preference === 'light' ? 'dark' : colorMode.preference === 'dark' ? 'system' : 'light'
  colorMode.preference = next
}

const themeIcon = computed(() => colorMode.preference === 'dark' ? 'i-heroicons-moon' : colorMode.preference === 'light' ? 'i-heroicons-sun' : 'i-heroicons-computer-desktop')
</script>

<template>
  <aside
    :class="[
      'relative hidden shrink-0 flex-col overflow-hidden border-r border-border bg-surface shadow-sm backdrop-blur-xl transition-[width] duration-200 md:flex',
      collapsed ? 'w-[60px]' : 'w-[232px]'
    ]"
  >
    <div class="relative flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
      <NuxtLink to="/" class="flex min-w-0 items-center gap-3 rounded-xl px-1 py-1">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center text-accent">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 5.5c2.8 1.3 4.6 3.2 5.8 5.8C8.2 10.1 6.3 8.3 5 5.5Z" fill="currentColor" />
            <path d="M19 5.5c-1.3 2.8-3.2 4.6-5.8 5.8 1.2-2.6 3-4.5 5.8-5.8Z" fill="currentColor" />
            <path d="M5 18.5c1.3-2.8 3.2-4.6 5.8-5.8-1.2 2.6-3 4.5-5.8 5.8Z" fill="currentColor" />
            <path d="M19 18.5c-2.8-1.3-4.6-3.2-5.8-5.8 2.6 1.2 4.5 3 5.8 5.8Z" fill="currentColor" />
          </svg>
        </span>
        <span v-if="!collapsed" class="min-w-0">
          <span class="block truncate text-sm font-semibold tracking-tight text-fg">PepeteX</span>
        </span>
      </NuxtLink>
      <button
        type="button"
        class="px-focus-ring rounded-xl p-2 text-fg-subtle transition hover:bg-bg-subtle hover:text-fg"
        :title="collapsed ? 'Expand' : 'Collapse'"
        @click="emit('toggle')"
      >
        <UIcon :name="collapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-left'" class="h-4 w-4" />
      </button>
    </div>

    <div v-if="!collapsed" class="relative border-b border-border px-2.5 py-3">
      <label class="pepetex-label">Workspace</label>
      <div class="relative">
        <select
          v-if="currentWorkspace"
          class="px-focus-ring w-full appearance-none truncate rounded-md border border-border bg-surface-raised px-2.5 py-2 pr-8 text-xs font-medium text-fg shadow-xs transition hover:border-border-strong"
          :value="currentWorkspaceId ?? ''"
          @change="setWorkspace(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
        </select>
        <UIcon name="i-heroicons-chevron-up-down" class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
      </div>
    </div>
    <div v-else-if="currentWorkspace" class="relative flex justify-center border-b border-border py-2.5">
      <div class="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-xs font-bold text-accent-soft-fg" :title="currentWorkspace.name">
        {{ currentWorkspace.name[0]?.toUpperCase() }}
      </div>
    </div>

    <nav class="relative flex-1 space-y-0.5 overflow-y-auto px-2 py-2 scrollbar-soft">
      <template v-for="section in navSections" :key="section.label">
        <div v-if="!collapsed && section.label" class="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
          {{ section.label }}
        </div>
        <div v-else class="mx-2 my-2 h-px bg-border" />
        <NuxtLink
          v-for="item in section.items"
          :key="item.to"
          :to="item.to"
          :class="[
            'group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-all',
            isActive(item.to)
              ? 'bg-accent-soft text-accent'
              : 'text-fg-muted hover:bg-surface-high hover:text-fg',
            collapsed && 'justify-center px-2'
          ]"
          :title="collapsed ? item.label : undefined"
        >
          <span
            :class="[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all',
              isActive(item.to)
                ? 'border-transparent bg-accent text-white shadow-[0_2px_8px_var(--px-accent-glow)]'
                : 'border-border bg-surface-high text-fg-subtle group-hover:text-fg'
            ]"
          >
            <UIcon :name="item.icon" class="h-3.5 w-3.5" />
          </span>
          <span v-if="!collapsed" class="min-w-0 flex-1">
            <span class="block truncate">{{ item.label }}</span>
          </span>
          <span v-if="!collapsed && navCount(item.to)" class="rounded-full bg-surface-high px-1.5 py-0.5 text-[10px] font-bold text-fg-subtle">
            {{ navCount(item.to) }}
          </span>
        </NuxtLink>
      </template>

      <template v-if="isGlobalAdmin">
        <div :class="['pb-1 pt-4', collapsed ? 'px-2' : 'px-2']">
          <div v-if="!collapsed" class="text-[10px] font-medium text-fg-subtle">Admin</div>
          <div v-else class="h-px bg-border" />
        </div>
        <NuxtLink
          v-for="item in adminNav"
          :key="item.to"
          :to="item.to"
          :class="[
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
            isActive(item.to) ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface-high hover:text-fg',
            collapsed && 'justify-center px-2'
          ]"
          :title="collapsed ? item.label : undefined"
        >
          <span
            :class="[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all',
              isActive(item.to)
                ? 'border-transparent bg-accent text-white shadow-[0_2px_8px_var(--px-accent-glow)]'
                : 'border-border bg-surface-high text-fg-subtle'
            ]"
          >
            <UIcon :name="item.icon" class="h-3.5 w-3.5" />
          </span>
          <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </template>
    </nav>

    <div class="relative border-t border-border p-2">
      <button
        type="button"
        :class="['px-focus-ring mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-fg-muted transition hover:bg-bg-subtle hover:text-fg', collapsed && 'justify-center']"
        :title="collapsed ? 'Theme' : undefined"
        @click="cycleTheme"
      >
        <UIcon :name="themeIcon" class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed" class="capitalize">{{ colorMode.preference }}</span>
      </button>
      <div ref="userMenuRef" class="relative">
        <button
          type="button"
          :class="['px-focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-bg-subtle', collapsed && 'justify-center']"
          @click="userMenuOpen = !userMenuOpen"
        >
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
            {{ (user?.profile?.name ?? user?.email ?? 'U').slice(0, 1).toUpperCase() }}
          </span>
          <div v-if="!collapsed" class="min-w-0 flex-1">
            <p class="truncate text-xs font-bold text-fg">{{ user?.profile?.name ?? user?.email }}</p>
            <p class="truncate text-[11px] text-fg-subtle">{{ user?.email }}</p>
          </div>
          <UIcon v-if="!collapsed" name="i-heroicons-chevron-down" class="h-4 w-4 shrink-0 text-fg-subtle" />
        </button>
        <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0 translate-y-1" leave-active-class="transition duration-100 ease-in" leave-to-class="opacity-0 translate-y-1">
          <div v-if="userMenuOpen" class="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg" role="menu">
            <NuxtLink to="/settings" class="flex items-center gap-2 px-3 py-2.5 text-sm text-fg hover:bg-bg-subtle" @click="userMenuOpen = false">
              <UIcon name="i-heroicons-user-circle" class="h-4 w-4" /> Profile & settings
            </NuxtLink>
            <button type="button" class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-fg hover:bg-bg-subtle" @click="logout">
              <UIcon name="i-heroicons-arrow-right-on-rectangle" class="h-4 w-4" /> Sign out
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </aside>
</template>
