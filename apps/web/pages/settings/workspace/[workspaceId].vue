<script setup lang="ts">
import WorkspaceMemberAddDialog from '~/components/workspace/WorkspaceMemberAddDialog.vue'
import type { WorkspaceSummary, WorkspaceMemberSummary } from '~/types'

const route = useRoute()
const workspaceId = computed(() => route.params.workspaceId as string)
const toast = useToast()

const activeTab = ref<'general' | 'members' | 'providers'>('general')
const loading = ref(false)
const workspace = ref<WorkspaceSummary | null>(null)
const members = ref<WorkspaceMemberSummary[]>([])
const savingSettings = ref(false)
const canManageMembers = computed(() => ['OWNER', 'ADMIN'].includes(workspace.value?.currentUserRole ?? 'VIEWER'))

const form = reactive({ name: '' })

async function load() {
  loading.value = true
  try {
    const [wsData, membersData] = await Promise.all([
      $fetch<{ workspace: WorkspaceSummary }>(`/api/workspaces/${workspaceId.value}`),
      $fetch<{ members: WorkspaceMemberSummary[] }>(`/api/workspaces/${workspaceId.value}/members`)
    ])
    workspace.value = wsData.workspace
    members.value = membersData.members
    form.name = wsData.workspace.name
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(workspaceId, load)

async function saveGeneral() {
  savingSettings.value = true
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}`, { method: 'PATCH', body: { name: form.name } })
    toast.add({ title: 'Workspace updated', color: 'success' })
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    savingSettings.value = false
  }
}

const addMemberOpen = ref(false)

async function removeMember(memberId: string) {
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/members/${memberId}`, { method: 'DELETE' })
    toast.add({ title: 'Member removed', color: 'success' })
    await load()
  } catch {
    toast.add({ title: 'Failed', color: 'error' })
  }
}

const roleColor: Record<string, string> = {
  OWNER: 'bg-amber-100 text-amber-700',
  ADMIN: 'bg-indigo-100 text-indigo-700',
  EDITOR: 'bg-green-100 text-green-700',
  COMMENTER: 'bg-slate-100 text-slate-600',
  VIEWER: 'bg-slate-100 text-slate-500'
}

// Provider policies
const allProviders = ref<Array<{ id: string; name: string; kind: string; enabled: boolean }>>([])
const providerPolicies = ref<Array<{ providerDefinitionId: string; allowedModelIds: string[] }>>([])
const loadingProviders = ref(false)
const savingPolicies = ref(false)
const blockedProviderSentinel = '__pepetex_blocked__'

async function loadProviderPolicies() {
  loadingProviders.value = true
  try {
    const [pd, polData] = await Promise.all([
      $fetch<{ providers: Array<{ id: string; name: string; kind: string; enabled: boolean }> }>('/api/providers'),
      $fetch<{ policies: Array<{ providerDefinitionId: string; allowedModelIds: string[] }> }>(`/api/workspaces/${workspaceId.value}/provider-policies`).catch(() => ({ policies: [] }))
    ])
    allProviders.value = pd.providers
    providerPolicies.value = polData.policies
  } finally {
    loadingProviders.value = false
  }
}

function isPolicyAllowed(providerId: string) {
  const policy = providerPolicies.value.find((entry) => entry.providerDefinitionId === providerId)
  return !policy?.allowedModelIds.includes(blockedProviderSentinel)
}

async function togglePolicy(providerId: string) {
  const current = isPolicyAllowed(providerId)
  savingPolicies.value = true
  try {
    const policies = providerPolicies.value
      .filter((policy) => policy.providerDefinitionId !== providerId)
      .map((policy) => ({
        providerDefinitionId: policy.providerDefinitionId,
        allowedModelIds: policy.allowedModelIds
      }))

    if (current) {
      policies.push({ providerDefinitionId: providerId, allowedModelIds: [blockedProviderSentinel] })
    }

    await $fetch(`/api/workspaces/${workspaceId.value}/provider-policies`, {
      method: 'PUT',
      body: { policies }
    })
    await loadProviderPolicies()
    toast.add({ title: 'Policy updated', color: 'success' })
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    savingPolicies.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'providers') loadProviderPolicies()
})

const tabs = [
  { key: 'general', label: 'General' },
  { key: 'members', label: 'Members' },
  { key: 'providers', label: 'Provider Policies' },
] as const
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div class="flex items-center gap-3">
      <NuxtLink to="/settings" class="text-sm text-slate-500 hover:text-slate-800">← Settings</NuxtLink>
      <span class="text-slate-300">/</span>
      <h1 class="text-xl font-bold text-slate-900">{{ workspace?.name ?? 'Workspace Settings' }}</h1>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 w-fit">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="rounded-xl px-4 py-1.5 text-sm font-medium transition-colors"
        :class="activeTab === tab.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <div v-if="loading" class="text-sm text-slate-400">Loading…</div>

    <!-- General -->
    <div v-else-if="activeTab === 'general'" class="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <label class="mb-1 block text-sm font-medium text-slate-700">Workspace name</label>
        <input v-model="form.name" type="text" class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-slate-700">Type</label>
        <p class="text-sm text-slate-500">{{ workspace?.type ?? '—' }}</p>
      </div>
      <button
        type="button"
        class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
        :disabled="savingSettings"
        @click="saveGeneral"
      >{{ savingSettings ? 'Saving…' : 'Save changes' }}</button>
    </div>

    <!-- Members -->
    <div v-else-if="activeTab === 'members'" class="space-y-4">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-slate-700">{{ members.length }} member{{ members.length !== 1 ? 's' : '' }}</p>
        <button v-if="canManageMembers" type="button" class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white" @click="addMemberOpen = true">
          + Add member
        </button>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table class="w-full text-sm">
          <tbody class="divide-y divide-slate-50">
            <tr v-for="m in members" :key="m.id" class="hover:bg-slate-50">
              <td class="px-4 py-3">
                <p class="font-medium text-slate-800">{{ m.name ?? '—' }}</p>
                <p class="text-xs text-slate-400">{{ m.email }}</p>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="roleColor[m.role] ?? 'bg-slate-100'">{{ m.role }}</span>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  v-if="canManageMembers && m.role !== 'OWNER'"
                  type="button"
                  class="rounded-lg border border-rose-200 px-3 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  @click="removeMember(m.id)"
                >Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Provider Policies -->
    <div v-else-if="activeTab === 'providers'" class="space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 class="text-base font-semibold text-slate-800 mb-1">Provider Access Policies</h2>
        <p class="text-sm text-slate-500 mb-4">Control which AI providers members of this workspace can use. By default, all global providers are available.</p>
        <div v-if="loadingProviders" class="text-sm text-slate-400">Loading providers…</div>
        <div v-else class="space-y-2">
          <div
            v-for="p in allProviders"
            :key="p.id"
            class="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"
          >
            <div>
              <p class="text-sm font-medium text-slate-800">{{ p.name }}</p>
              <p class="text-xs text-slate-400">{{ p.kind }} · {{ p.enabled ? 'Enabled' : 'Disabled' }}</p>
            </div>
            <button
              type="button"
              class="rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
              :class="isPolicyAllowed(p.id)
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
              :disabled="savingPolicies"
              @click="togglePolicy(p.id)"
            >{{ isPolicyAllowed(p.id) ? '✓ Allowed' : '✗ Blocked' }}</button>
          </div>
          <p v-if="allProviders.length === 0" class="text-sm text-slate-400">No providers configured. Ask your global admin to add providers.</p>
        </div>
      </div>
    </div>
  </div>

  <WorkspaceMemberAddDialog v-if="addMemberOpen" :workspace-id="workspaceId" @close="addMemberOpen = false" @added="load" />
</template>
