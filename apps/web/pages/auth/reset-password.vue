<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: [] })

const email = ref('')
const loading = ref(false)
const sent = ref(false)

async function submit() {
  if (!email.value.trim()) return
  loading.value = true
  try {
    await $fetch('/api/auth/password-reset/request', {
      method: 'POST',
      body: { email: email.value.trim().toLowerCase() }
    })
    sent.value = true
  } catch {
    sent.value = true
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold tracking-tight text-fg">Reset your password</h2>
    <p class="mt-1 text-sm text-fg-muted">Enter your email and we'll send a reset link.</p>

    <div v-if="sent" class="mt-6 rounded-lg border border-border bg-surface px-4 py-4 text-sm text-fg">
      If an account with that email exists, a reset link has been sent. Check your inbox.
    </div>

    <form v-else class="mt-6 flex flex-col gap-4" @submit.prevent="submit">
      <PxInput
        v-model="email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        autocomplete="email"
        required
        icon="i-heroicons-envelope"
      />
      <PxButton variant="primary" size="lg" block type="submit" :loading="loading">
        Send reset link
      </PxButton>
    </form>

    <p class="mt-6 text-center text-sm text-fg-muted">
      <NuxtLink to="/login" class="font-medium text-fg hover:underline">Back to sign in</NuxtLink>
    </p>
  </div>
</template>