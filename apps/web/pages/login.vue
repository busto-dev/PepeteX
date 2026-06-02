<script setup lang="ts">
definePageMeta({ layout: false, middleware: [] })

const { refresh, isAuthenticated } = useSession()
const toast = useToast()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  if (isAuthenticated.value) await navigateTo('/')
})

async function submit() {
  if (!email.value.trim() || !password.value) return
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value.trim().toLowerCase(), password: password.value }
    })
    await refresh()
    await navigateTo('/')
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    error.value = err?.data?.statusMessage ?? err?.message ?? 'Login failed.'
    toast.add({ title: 'Login failed', description: error.value ?? undefined, color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-bg px-6 py-12 text-fg">
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <div class="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[13px] shadow-[0_6px_20px_var(--px-accent-glow)]" style="background: var(--px-accent-grad)">
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="15" height="11" rx="3" stroke="white" stroke-width="2.5" />
          </svg>
        </div>
        <h1 class="text-[22px] font-black tracking-[-0.6px] text-fg">Welcome back</h1>
        <p class="mt-1 text-xs text-fg-muted">Sign in to your PepeteX account</p>
      </div>

      <form class="rounded-[18px] border border-border bg-surface p-6 shadow-[0_4px_20px_rgba(0,0,0,0.08)]" @submit.prevent="submit">
        <div class="space-y-4">
          <div>
            <label for="email" class="mb-1.5 block text-xs font-medium text-fg-muted">Email address</label>
            <PxInput
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              autofocus
              size="lg"
              placeholder="you@company.com"
              icon="i-heroicons-envelope"
            />
          </div>

          <div>
            <label for="password" class="mb-1.5 block text-xs font-medium text-fg-muted">Password</label>
            <PxInput
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              size="lg"
              placeholder="Password"
              icon="i-heroicons-lock-closed"
            />
          </div>

          <div v-if="error" class="rounded-md border border-[color:var(--px-danger-border)] bg-[color:var(--px-danger-soft)] px-3 py-2.5 text-sm text-danger">
            {{ error }}
          </div>

          <PxButton type="submit" variant="primary" size="lg" :loading="loading" :disabled="loading" block>
            {{ loading ? 'Signing in...' : 'Sign in' }}
          </PxButton>
        </div>

        <p class="mt-4 text-center text-xs text-fg-subtle">
          Forgot your password?
          <NuxtLink to="/auth/reset-password" class="font-semibold text-accent hover:underline">Reset it</NuxtLink>
        </p>
      </form>
    </div>
  </div>
</template>

