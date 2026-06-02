export default defineNuxtRouteMiddleware((to) => {
  // Skip auth check for auth pages themselves
  if (to.path.startsWith('/login') || to.path.startsWith('/auth/')) return

  const { isAuthenticated, ready } = useSession()

  // Server-rendered first paint: useAsyncData('session') in app.vue resolved before
  // middleware runs, so we can trust ready/isAuthenticated on both server and client.
  if (!ready.value) return

  if (!isAuthenticated.value) {
    return navigateTo('/login')
  }
})
