<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: [] })

const route = useRoute()
const token = computed(() => (Array.isArray(route.query.token) ? route.query.token[0] : route.query.token) ?? '')

const password = ref('')
const confirm = ref('')
const loading = ref(false)
const done = ref(false)
const error = ref<string | null>(null)

async function submit() {
  if (!token.value) {
    error.value = 'Missing reset token. Please use the link from your email.'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match.'
    return
  }
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }

  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: token.value, password: password.value }
    })
    done.value = true
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    error.value = err?.data?.statusMessage ?? 'Reset failed. The link may have expired.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold tracking-tight text-fg">Set a new password</h2>

    <div v-if="done" class="mt-6 flex flex-col gap-4">
      <div class="rounded-lg border border-border bg-surface px-4 py-4 text-sm text-fg">
        Password updated successfully. You can now sign in.
      </div>
      <PxButton variant="primary" size="lg" block to="/login">Go to sign in</PxButton>
    </div>

    <form v-else class="mt-6 flex flex-col gap-4" @submit.prevent="submit">
      <div v-if="!token" class="rounded-lg border border-[color:var(--px-warning-300)] bg-[color:color-mix(in_oklab,var(--px-warning-500)_12%,transparent)] px-4 py-3 text-sm text-fg">
        No reset token found. Please use the link from your password reset email.
      </div>

      <PxInput
        v-model="password"
        type="password"
        label="New password"
        placeholder="At least 8 characters"
        autocomplete="new-password"
        required
        icon="i-heroicons-lock-closed"
      />
      <PxInput
        v-model="confirm"
        type="password"
        label="Confirm password"
        placeholder="Repeat your password"
        autocomplete="new-password"
        required
        icon="i-heroicons-lock-closed"
      />

      <div v-if="error" class="rounded-lg border border-[color:var(--px-danger-500)] bg-[color:color-mix(in_oklab,var(--px-danger-500)_10%,transparent)] px-4 py-3 text-sm text-[color:var(--px-danger-600)]">
        {{ error }}
      </div>

      <PxButton variant="primary" size="lg" block type="submit" :loading="loading" :disabled="!token">
        Update password
      </PxButton>
    </form>

    <p class="mt-6 text-center text-sm text-fg-muted">
      <NuxtLink to="/login" class="font-medium text-fg hover:underline">Back to sign in</NuxtLink>
    </p>
  </div>
</template>