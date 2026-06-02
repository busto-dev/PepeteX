<script setup lang="ts">
import type { AdminUserSummary } from '~/types'

definePageMeta({ middleware: 'admin' })

const toast = useToast()
const users = ref<AdminUserSummary[]>([])
const loading = ref(false)
const search = ref('')

const createOpen = ref(false)
const createForm = reactive({ email: '', password: '', name: '', isGlobalAdmin: false })
const submittingCreate = ref(false)

const deletingId = ref<string | null>(null)
const submittingDelete = ref(false)

const resettingId = ref<string | null>(null)
const newPassword = ref('')
const submittingReset = ref(false)

const deleteOpen = computed({
  get: () => deletingId.value !== null,
  set: (v: boolean) => { if (!v) deletingId.value = null }
})
const resetOpen = computed({
  get: () => resettingId.value !== null,
  set: (v: boolean) => { if (!v) { resettingId.value = null; newPassword.value = '' } }
})

async function load() {
  loading.value = true
  try {
    const data = await $fetch<{ users: AdminUserSummary[] }>('/api/admin/users', {
      query: search.value ? { q: search.value } : undefined
    })
    users.value = data.users
  } finally {
    loading.value = false
  }
}

onMounted(load)

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 400)
})

async function createUser() {
  submittingCreate.value = true
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: createForm })
    Object.assign(createForm, { email: '', password: '', name: '', isGlobalAdmin: false })
    createOpen.value = false
    toast.add({ title: 'User created', color: 'success' })
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Could not create user', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submittingCreate.value = false
  }
}

async function resetPassword() {
  if (!resettingId.value) return
  submittingReset.value = true
  try {
    await $fetch(`/api/admin/users/${resettingId.value}/reset-password`, {
      method: 'POST',
      body: { password: newPassword.value }
    })
    resettingId.value = null
    newPassword.value = ''
    toast.add({ title: 'Password reset', color: 'success' })
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submittingReset.value = false
  }
}

async function deleteUser() {
  if (!deletingId.value) return
  submittingDelete.value = true
  try {
    await $fetch(`/api/admin/users/${deletingId.value}`, { method: 'DELETE' })
    deletingId.value = null
    toast.add({ title: 'User deleted', color: 'success' })
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submittingDelete.value = false
  }
}

function formatDate(v: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(v))
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Users"
      description="Manage all user accounts."
      :back="{ to: '/admin' }"
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="createOpen = true">New user</PxButton>
      </template>
    </PxPageHeader>

    <PxInput
      v-model="search"
      type="search"
      placeholder="Search by name or email..."
      icon="i-heroicons-magnifying-glass"
      class="mb-4 sm:max-w-sm"
    />

    <div class="overflow-hidden rounded-xl border border-border bg-surface">
      <table class="w-full text-sm">
        <thead class="border-b border-border bg-bg-subtle/50 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            <th class="px-4 py-3 text-left">Name / Email</th>
            <th class="px-4 py-3 text-left">Role</th>
            <th class="px-4 py-3 text-left">Created</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="u in users" :key="u.id" class="hover:bg-bg-subtle/50">
            <td class="px-4 py-3">
              <p class="font-medium text-fg">{{ u.profile?.name ?? u.name ?? '—' }}</p>
              <p class="text-xs text-fg-subtle">{{ u.email }}</p>
            </td>
            <td class="px-4 py-3">
              <PxBadge
                :tone="u.globalRole === 'GLOBAL_ADMIN' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
              >
                {{ u.globalRole === 'GLOBAL_ADMIN' ? 'Admin' : 'User' }}
              </PxBadge>
            </td>
            <td class="px-4 py-3 text-fg-muted">{{ formatDate(u.createdAt) }}</td>
            <td class="px-4 py-3 text-right">
              <div class="flex justify-end gap-2">
                <PxButton variant="ghost" size="xs" @click="resettingId = u.id; newPassword = ''">Reset PW</PxButton>
                <PxButton variant="ghost" size="xs" @click="deletingId = u.id">Delete</PxButton>
              </div>
            </td>
          </tr>
          <tr v-if="loading">
            <td colspan="4" class="px-4 py-8 text-center text-fg-subtle">Loading…</td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="4" class="px-4 py-8 text-center text-fg-subtle">No users found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <PxDialog v-model="createOpen" title="Create user" size="md">
      <form class="flex flex-col gap-4" @submit.prevent="createUser">
        <PxInput v-model="createForm.name" label="Name" placeholder="Optional" />
        <PxInput v-model="createForm.email" type="email" label="Email" required autocomplete="email" />
        <PxInput v-model="createForm.password" type="password" label="Password" required autocomplete="new-password" />
        <label class="flex items-center justify-between gap-3 text-sm">
          <span class="text-fg">Global admin</span>
          <PxSwitch v-model="createForm.isGlobalAdmin" />
        </label>
        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <PxButton variant="ghost" type="button" @click="createOpen = false">Cancel</PxButton>
          <PxButton variant="primary" type="submit" :loading="submittingCreate">Create</PxButton>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="resetOpen" title="Reset password" size="sm">
      <form class="flex flex-col gap-4" @submit.prevent="resetPassword">
        <PxInput v-model="newPassword" type="password" label="New password" required autocomplete="new-password" />
        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <PxButton variant="ghost" type="button" @click="resettingId = null">Cancel</PxButton>
          <PxButton variant="primary" type="submit" :loading="submittingReset" :disabled="!newPassword">Reset</PxButton>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="deleteOpen" title="Delete user?" size="sm">
      <p class="text-sm text-fg-muted">This will permanently delete the account and all associated data.</p>
      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <PxButton variant="ghost" @click="deletingId = null">Cancel</PxButton>
        <PxButton variant="danger" :loading="submittingDelete" @click="deleteUser">Delete</PxButton>
      </div>
    </PxDialog>
  </div>
</template>
