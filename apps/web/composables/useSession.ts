import type { User } from '~/types'

type SessionPayload = { authenticated: boolean; user: User | null }

export const useSession = () => {
  const user = useState<User | null>('session:user', () => null)
  const pending = useState('session:pending', () => true)
  const ready = useState('session:ready', () => false)

  const isAuthenticated = computed(() => user.value !== null)
  const isGlobalAdmin = computed(() => user.value?.globalRole === 'GLOBAL_ADMIN')

  async function refresh() {
    pending.value = true
    try {
      // Forward incoming request cookies during SSR so the session lookup sees them.
      const headers = import.meta.server
        ? useRequestHeaders(['cookie'])
        : undefined
      const data = await $fetch<SessionPayload>('/api/me', { headers })
      user.value = data.authenticated ? (data.user as User) : null
      return data
    } catch {
      user.value = null
      return { authenticated: false, user: null } satisfies SessionPayload
    } finally {
      pending.value = false
      ready.value = true
    }
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // best-effort
    }
    user.value = null
    await navigateTo('/login')
  }

  return { user, pending, ready, isAuthenticated, isGlobalAdmin, refresh, logout }
}
