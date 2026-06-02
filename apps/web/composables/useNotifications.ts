import type { NotificationSummary } from '~/types'

export const useNotifications = () => {
  const notifications = useState<NotificationSummary[]>('notifications:list', () => [])
  const loading = useState('notifications:loading', () => false)

  const unreadCount = computed(() => notifications.value.filter((n) => !n.readAt).length)

  async function load(opts?: { unreadOnly?: boolean }) {
    loading.value = true
    try {
      const query = opts?.unreadOnly ? '?unreadOnly=true' : ''
      const data = await $fetch<{ notifications: NotificationSummary[] }>(`/api/notifications${query}`)
      notifications.value = data.notifications
    } catch {
      notifications.value = []
    } finally {
      loading.value = false
    }
  }

  async function markRead(id: string) {
    await $fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    const n = notifications.value.find((x) => x.id === id)
    if (n) n.readAt = new Date().toISOString()
  }

  async function markAllRead() {
    await $fetch('/api/notifications/read-all', { method: 'POST' })
    notifications.value = notifications.value.map((n) => ({
      ...n,
      readAt: n.readAt ?? new Date().toISOString()
    }))
  }

  return { notifications, unreadCount, loading, load, markRead, markAllRead }
}
