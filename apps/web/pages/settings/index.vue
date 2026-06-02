<script setup lang="ts">
import type { ProviderSummary } from '~/types'

type SettingsTab = 'profile' | 'security' | 'byok' | 'preferences'

interface ByokCredential {
  id: string
  providerDefinitionId: string
  providerName: string
  providerKind: string
  label: string
  apiKeyPreview: string
  createdAt: string
}

const { user, refresh } = useSession()
const { workspaces, load: loadWorkspaces } = useWorkspaces()
const colorMode = useColorMode()
const toast = useToast()

const form = reactive({
  name: '',
  avatarUrl: '',
  uiLanguage: 'en',
  themePreference: 'system',
  defaultWorkspaceId: ''
})

watch(user, (u) => {
  if (!u) return
  Object.assign(form, {
    name: u.profile?.name ?? '',
    avatarUrl: u.profile?.avatarUrl ?? '',
    uiLanguage: u.profile?.uiLanguage ?? 'en',
    themePreference: u.profile?.themePreference ?? 'system',
    defaultWorkspaceId: u.profile?.defaultWorkspaceId ?? ''
  })
  colorMode.preference = u.profile?.themePreference ?? 'system'
}, { immediate: true })

watch(() => form.themePreference, (value) => {
  colorMode.preference = value
})

const saving = ref(false)
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const savingPassword = ref(false)

async function saveProfile() {
  saving.value = true
  try {
    await $fetch('/api/me/profile', {
      method: 'PATCH',
      body: {
        name: form.name,
        avatarUrl: form.avatarUrl || undefined,
        uiLanguage: form.uiLanguage,
        themePreference: form.themePreference,
        defaultWorkspaceId: form.defaultWorkspaceId || undefined
      }
    })
    await refresh()
    toast.add({ title: 'Profile updated', color: 'success' })
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to update profile', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function changePassword() {
  if (!passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()) return
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    toast.add({ title: 'Passwords do not match', color: 'error' })
    return
  }
  savingPassword.value = true
  try {
    await $fetch('/api/me/password', {
      method: 'POST',
      body: {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      }
    })
    Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirmPassword: '' })
    toast.add({ title: 'Password updated', color: 'success' })
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to update password', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    savingPassword.value = false
  }
}

const byokProviders = ref<ProviderSummary[]>([])
const byokCredentials = ref<ByokCredential[]>([])
const loadingByok = ref(false)
const byokForm = reactive({ providerDefinitionId: '', label: '', apiKey: '' })
const savingByok = ref(false)
const deletingCredentialId = ref<string | null>(null)

async function loadByok() {
  loadingByok.value = true
  try {
    const [providerData, credentialData] = await Promise.all([
      $fetch<{ providers: ProviderSummary[] }>('/api/providers'),
      $fetch<{ credentials: ByokCredential[] } | ByokCredential[]>('/api/me/credentials')
    ])
    byokProviders.value = (providerData.providers ?? []).filter((provider) => provider.enabled && provider.allowUserCredentials)
    byokCredentials.value = Array.isArray(credentialData) ? credentialData : credentialData.credentials ?? []
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Could not load credentials', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    loadingByok.value = false
  }
}

async function saveByok() {
  if (!byokForm.providerDefinitionId || !byokForm.apiKey.trim()) return
  const provider = byokProviders.value.find((item) => item.id === byokForm.providerDefinitionId)
  savingByok.value = true
  try {
    await $fetch('/api/me/credentials', {
      method: 'POST',
      body: {
        providerDefinitionId: byokForm.providerDefinitionId,
        label: byokForm.label.trim() || `${provider?.name ?? 'Provider'} personal key`,
        apiKey: byokForm.apiKey
      }
    })
    Object.assign(byokForm, { providerDefinitionId: '', label: '', apiKey: '' })
    toast.add({ title: 'Credential saved', color: 'success' })
    await loadByok()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to save credential', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    savingByok.value = false
  }
}

async function deleteByok(id: string) {
  deletingCredentialId.value = id
  try {
    await $fetch(`/api/me/credentials/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Credential removed', color: 'success' })
    await loadByok()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to remove credential', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    deletingCredentialId.value = null
  }
}

onMounted(async () => {
  await Promise.all([loadWorkspaces(), loadByok()])
})

const activeTab = ref<SettingsTab>('profile')

const tabs: Array<{ value: SettingsTab; label: string }> = [
  { value: 'profile', label: 'Profile' },
  { value: 'security', label: 'Security' },
  { value: 'byok', label: 'Credentials (BYOK)' },
  { value: 'preferences', label: 'Preferences' }
]

const themeOptions = [
  { value: 'light', label: 'Light', icon: 'i-heroicons-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-heroicons-moon' },
  { value: 'system', label: 'System', icon: 'i-heroicons-computer-desktop' }
]

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Bahasa Indonesia' }
]

const workspaceOptions = computed(() => [
  { value: '', label: 'No default (use last opened)' },
  ...workspaces.value.map((workspace) => ({ value: workspace.id, label: workspace.name }))
])

const byokDefinitionOptions = computed(() => [
  { value: '', label: loadingByok.value ? 'Loading providers...' : 'Select a provider' },
  ...byokProviders.value.map((provider) => ({ value: provider.id, label: `${provider.name} (${provider.kind})` }))
])
</script>

<template>
  <div class="mx-auto w-full max-w-5xl pb-12">
    <PxPageHeader
      title="Settings"
      description="Manage your profile, security, API credentials, and preferences."
    />

    <div class="mt-5 flex w-full flex-wrap gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-sm sm:w-fit">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        class="px-focus-ring rounded-[7px] px-3 py-1.5 text-xs font-medium transition-all"
        :class="activeTab === tab.value ? 'bg-surface text-fg font-semibold shadow-sm' : 'text-fg-muted hover:text-fg'"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="mt-6 max-w-3xl">
      <PxCard v-if="activeTab === 'profile'" padding="md" class="space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-fg">Profile information</h3>
          <p class="mt-1 text-xs text-fg-muted">Information shown across PepeteX.</p>
        </div>
        <form class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]" @submit.prevent="saveProfile">
          <div class="flex items-center gap-4">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white shadow-[0_4px_14px_var(--px-accent-glow)]" style="background: var(--px-accent-grad)">
              {{ (form.name || user?.email || 'U').slice(0, 1).toUpperCase() }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-bold text-fg">{{ form.name || user?.email }}</div>
              <div class="truncate text-xs text-fg-subtle">{{ user?.email }}</div>
            </div>
          </div>

          <div class="md:col-start-2">
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Display name</label>
            <PxInput v-model="form.name" placeholder="Your name" />
          </div>
          <div class="md:col-start-2">
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Email address</label>
            <PxInput :model-value="user?.email ?? ''" disabled />
            <p class="mt-1 text-[11px] text-fg-subtle">Contact an admin to change your email.</p>
          </div>
          <div class="md:col-start-2">
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Avatar URL</label>
            <PxInput v-model="form.avatarUrl" placeholder="https://..." />
          </div>
          <div class="flex justify-end pt-2 md:col-start-2">
            <PxButton type="submit" variant="primary" size="sm" :loading="saving">Save changes</PxButton>
          </div>
        </form>
      </PxCard>

      <PxCard v-else-if="activeTab === 'security'" padding="lg" class="space-y-5">
        <div>
          <h3 class="text-sm font-semibold text-fg">Change password</h3>
          <p class="mt-1 text-xs text-fg-muted">Use a strong, unique password for your PepeteX account.</p>
        </div>
        <form class="space-y-4" @submit.prevent="changePassword">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Current password</label>
            <PxInput v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" required />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">New password</label>
            <PxInput v-model="passwordForm.newPassword" type="password" autocomplete="new-password" required />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Confirm new password</label>
            <PxInput v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" required />
          </div>
          <div class="flex justify-end pt-2">
            <PxButton type="submit" variant="primary" size="sm" :loading="savingPassword">Change password</PxButton>
          </div>
        </form>
      </PxCard>

      <PxCard v-else-if="activeTab === 'byok'" padding="lg" class="space-y-6">
        <div>
          <h3 class="text-sm font-semibold text-fg">Bring your own keys</h3>
          <p class="mt-1 text-xs text-fg-muted">Personal AI provider keys are encrypted at rest and only available to your account.</p>
        </div>

        <form class="space-y-3 rounded-xl border border-border bg-surface-raised p-4" @submit.prevent="saveByok">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Provider</label>
            <PxSelect v-model="byokForm.providerDefinitionId" :options="byokDefinitionOptions" :disabled="loadingByok" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Credential name</label>
            <PxInput v-model="byokForm.label" placeholder="Personal OpenAI key" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">API key</label>
            <PxInput v-model="byokForm.apiKey" type="password" autocomplete="new-password" placeholder="sk-..." />
          </div>
          <div class="flex justify-end pt-1">
            <PxButton type="submit" variant="primary" size="sm" :loading="savingByok" :disabled="!byokForm.providerDefinitionId || !byokForm.apiKey">
              Add credential
            </PxButton>
          </div>
        </form>

        <div>
          <h4 class="mb-2 text-xs font-semibold text-fg-muted">Existing credentials</h4>
          <div v-if="byokCredentials.length === 0" class="rounded-xl border-2 border-dashed border-border px-4 py-6 text-center text-xs text-fg-muted">
            No personal credentials yet.
          </div>
          <div v-else class="divide-y divide-border rounded-xl border border-border bg-surface">
            <div v-for="credential in byokCredentials" :key="credential.id" class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-fg">{{ credential.label }}</p>
                <p class="text-[11px] text-fg-subtle">{{ credential.providerName }} · {{ credential.apiKeyPreview }}</p>
              </div>
              <PxButton
                variant="danger"
                size="sm"
                icon="i-heroicons-trash"
                :loading="deletingCredentialId === credential.id"
                @click="deleteByok(credential.id)"
              >
                Delete
              </PxButton>
            </div>
          </div>
        </div>
      </PxCard>

      <PxCard v-else padding="lg" class="space-y-5">
        <div>
          <h3 class="text-sm font-semibold text-fg">Preferences</h3>
          <p class="mt-1 text-xs text-fg-muted">Choose how PepeteX should feel when you work.</p>
        </div>
        <div class="space-y-5">
          <div>
            <label class="mb-2 block text-xs font-medium text-fg-muted">Theme</label>
            <PxSegmented v-model="form.themePreference" :options="themeOptions" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Language</label>
            <PxSelect v-model="form.uiLanguage" :options="languageOptions" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-fg-muted">Default workspace</label>
            <PxSelect v-model="form.defaultWorkspaceId" :options="workspaceOptions" />
          </div>
          <div class="flex justify-end pt-2">
            <PxButton variant="primary" size="sm" :loading="saving" @click="saveProfile">Save preferences</PxButton>
          </div>
        </div>
      </PxCard>
    </div>
  </div>
</template>

