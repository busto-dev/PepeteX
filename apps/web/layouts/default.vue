<script setup lang="ts">
const sidebarOpen = ref(true)
const mobileNavOpen = ref(false)
const route = useRoute()

const { load: loadWorkspaces } = useWorkspaces()
const { isAuthenticated, user } = useSession()

watchEffect(() => {
  if (isAuthenticated.value) void loadWorkspaces()
})

const isFullBleed = computed(() => !!route.meta.fullBleed)
const showSidebar = computed(() => !route.meta.hideSidebar)
const initials = computed(() => (user.value?.profile?.name ?? user.value?.email ?? 'U').slice(0, 2).toUpperCase())
</script>

<template>
  <div class="relative flex h-screen overflow-hidden bg-bg text-fg">
    <PxAppSidebar v-if="showSidebar" :collapsed="!sidebarOpen" class="relative z-10" @toggle="sidebarOpen = !sidebarOpen" />
    <div v-if="mobileNavOpen" class="fixed inset-0 z-50 md:hidden">
      <button type="button" class="absolute inset-0 bg-black/30" aria-label="Close navigation" @click="mobileNavOpen = false" />
      <PxAppSidebar :collapsed="false" class="absolute inset-y-0 left-0 !flex" @toggle="mobileNavOpen = false" />
    </div>
    <main
      :class="[
        'relative z-0 min-w-0 flex-1',
        isFullBleed
          ? 'flex flex-col overflow-hidden'
          : 'overflow-y-auto'
      ]"
    >
      <header v-if="!isFullBleed" class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur sm:px-6 lg:px-8">
        <button
          v-if="showSidebar"
          type="button"
          class="px-focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg shadow-sm md:hidden"
          aria-label="Open navigation"
          @click="mobileNavOpen = true"
        >
          <UIcon name="i-heroicons-bars-3" class="h-5 w-5" />
        </button>
        <div class="relative min-w-0 flex-1">
          <UIcon name="i-heroicons-magnifying-glass" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <NuxtLink to="/search" class="flex h-9 max-w-xl items-center rounded-md border border-border bg-surface px-9 text-sm text-fg-subtle shadow-sm transition hover:border-border-strong hover:text-fg">
            Search decks, templates, providers...
            <span class="ml-auto hidden rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-fg-subtle sm:inline">Ctrl K</span>
          </NuxtLink>
        </div>
        <PxButton variant="ghost" size="sm" icon="i-heroicons-bell" square aria-label="Notifications" />
        <NuxtLink to="/settings" class="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium text-fg hover:bg-surface-high">
          <span class="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent-soft-fg">{{ initials }}</span>
          <span class="hidden sm:inline">{{ user?.profile?.name ?? user?.email ?? 'Account' }}</span>
          <UIcon name="i-heroicons-chevron-down" class="hidden h-4 w-4 text-fg-subtle sm:block" />
        </NuxtLink>
      </header>
      <div v-if="!isFullBleed" class="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <slot />
      </div>
      <slot v-else />
    </main>
  </div>
</template>
