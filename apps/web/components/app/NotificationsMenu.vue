<script setup lang="ts">
const { notifications, unreadCount, load, markRead, markAllRead } = useNotifications()
const { isAuthenticated } = useSession()
const open = ref(false)

watch(isAuthenticated, async (ok) => { if (ok) await load() }, { immediate: true })

async function onMarkAllRead() {
  await markAllRead()
}

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100"
      @click="open = !open"
    >
      <span class="text-lg">🔔</span>
      <span
        v-if="unreadCount > 0"
        class="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white"
      >{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl"
    >
      <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <span class="text-sm font-semibold text-slate-800">Notifications</span>
        <button
          v-if="unreadCount > 0"
          type="button"
          class="text-xs font-medium text-slate-500 hover:text-slate-800"
          @click="onMarkAllRead"
        >Mark all read</button>
      </div>
      <ul class="max-h-80 divide-y divide-slate-50 overflow-y-auto">
        <li
          v-for="n in notifications"
          :key="n.id"
          class="hover:bg-slate-50 cursor-pointer"
          :class="!n.readAt ? 'bg-indigo-50/50' : ''"
          @click="markRead(n.id)"
        >
          <component
            :is="n.actionUrl ? 'NuxtLink' : 'div'"
            :to="n.actionUrl ?? undefined"
            class="flex items-start gap-2 px-4 py-3"
          >
            <span v-if="!n.readAt" class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
            <span v-else class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-transparent" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-800 truncate">{{ n.title }}</p>
              <p v-if="n.body" class="text-xs text-slate-500 truncate">{{ n.body }}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ formatDate(n.createdAt) }}</p>
            </div>
          </component>
        </li>
        <li v-if="notifications.length === 0" class="px-4 py-6 text-center text-sm text-slate-400">
          No notifications
        </li>
      </ul>
    </div>
    <!-- Backdrop -->
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />
  </div>
</template>
