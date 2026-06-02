export default defineNuxtRouteMiddleware(() => {
  const { isGlobalAdmin, isAuthenticated } = useSession()

  if (import.meta.server) return

  if (!isAuthenticated.value || !isGlobalAdmin.value) {
    return navigateTo('/')
  }
})
