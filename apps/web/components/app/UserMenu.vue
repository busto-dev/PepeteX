<script setup lang="ts">
const props = defineProps<{ collapsed?: boolean }>()
const { user, logout } = useSession()
const open = ref(false)
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      @click="open = !open"
      :title="collapsed ? (user?.email ?? 'User') : undefined"
    >
      <span class="shrink-0 h-6 w-6 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold text-slate-700 uppercase">
        {{ user?.profile?.name?.[0] ?? user?.email?.[0] ?? 'U' }}
      </span>
      <span v-if="!collapsed" class="flex-1 truncate text-left">
        {{ user?.profile?.name ?? user?.email ?? 'User' }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute bottom-12 left-0 z-50 w-52 rounded-2xl border border-slate-200 bg-white py-1 shadow-xl"
    >
      <div class="border-b border-slate-100 px-3 py-2">
        <p class="text-xs font-semibold text-slate-800 truncate">{{ user?.profile?.name ?? user?.email }}</p>
        <p class="text-xs text-slate-500 truncate">{{ user?.email }}</p>
      </div>
      <NuxtLink
        to="/settings"
        class="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        @click="open = false"
      >⚙ Profile settings</NuxtLink>
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
        @click="logout"
      >↩ Sign out</button>
    </div>
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />
  </div>
</template>
