<script setup lang="ts">
import type { DesignSystemSummary } from '~/types'

type StatusFilter = 'all' | 'enabled' | 'draft'
type CreateScope = 'personal' | 'workspace' | 'global'

const { currentWorkspaceId, currentWorkspace } = useWorkspaces()
const { isGlobalAdmin } = useSession()
const toast = useToast()

const systems = ref<DesignSystemSummary[]>([])
const loading = ref(false)
const creating = ref(false)
const deletingId = ref<string | null>(null)
const showCreateDialog = ref(false)
const query = ref('')
const statusFilter = ref<StatusFilter>('all')
const createForm = reactive({ name: '', description: '', scope: 'workspace' as CreateScope })

const deleteOpen = computed({
  get: () => deletingId.value !== null,
  set: (value: boolean) => { if (!value) deletingId.value = null }
})

const filteredSystems = computed(() => {
  const term = query.value.trim().toLowerCase()
  return systems.value.filter((system) => {
    const matchesQuery = !term || `${system.name} ${system.description ?? ''} ${system.scope}`.toLowerCase().includes(term)
    const matchesStatus = statusFilter.value === 'all' || (statusFilter.value === 'enabled' ? system.isEnabled : !system.isEnabled)
    return matchesQuery && matchesStatus
  })
})

const statusOptions = [
  { value: 'all', label: 'All states' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'draft', label: 'Draft' }
]
const scopeOptions = computed(() => [
  { value: 'workspace', label: currentWorkspace.value ? `Workspace (${currentWorkspace.value.name})` : 'Workspace' },
  { value: 'personal', label: 'Personal' },
  ...(isGlobalAdmin.value ? [{ value: 'global', label: 'Global' }] : [])
])

watch(currentWorkspaceId, load, { immediate: true })
watch(currentWorkspaceId, (workspaceId) => {
  if (!workspaceId && createForm.scope === 'workspace') {
    createForm.scope = 'personal'
  }
})

async function load() {
  if (!currentWorkspaceId.value) {
    systems.value = []
    return
  }
  loading.value = true
  try {
    const data = await $fetch<{ designSystems: DesignSystemSummary[] }>(`/api/design-systems?workspaceId=${currentWorkspaceId.value}`)
    systems.value = data.designSystems
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!createForm.name.trim()) return
  if (createForm.scope === 'workspace' && !currentWorkspaceId.value) return
  creating.value = true
  try {
    const scope = createForm.scope
    const data = await $fetch<{ designSystem: DesignSystemSummary }>('/api/design-systems', {
      method: 'POST',
      body: {
        scope,
        ...(scope === 'workspace' ? { workspaceId: currentWorkspaceId.value } : {}),
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined
      }
    })
    toast.add({ title: 'Design system created', color: 'success' })
    createForm.name = ''
    createForm.description = ''
    createForm.scope = currentWorkspaceId.value ? 'workspace' : 'personal'
    showCreateDialog.value = false
    await navigateTo(`/design-systems/${data.designSystem.id}`)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Could not create design system', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    creating.value = false
  }
}

async function deleteSystem() {
  if (!deletingId.value) return
  try {
    await $fetch(`/api/design-systems/${deletingId.value}`, { method: 'DELETE' })
    toast.add({ title: 'Design system deleted', color: 'success' })
    deletingId.value = null
    await load()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Could not delete', description: err?.data?.statusMessage, color: 'error' })
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Design systems"
      :description="`Brand kits PepeteX uses when generating decks${currentWorkspace ? ` in ${currentWorkspace.name}` : ''}.`"
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="showCreateDialog = true">
          New design system
        </PxButton>
      </template>
    </PxPageHeader>

    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <PxInput
        v-model="query"
        placeholder="Search design systems"
        icon="i-heroicons-magnifying-glass"
        class="sm:w-72"
      />
      <PxSelect v-model="statusFilter" :options="statusOptions" class="sm:w-48" />
    </div>

    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <PxSkeleton v-for="i in 6" :key="i" class="h-40" />
    </div>
    <PxEmptyState
      v-else-if="filteredSystems.length === 0"
      icon="i-heroicons-swatch"
      title="No design systems yet"
      :description="query ? 'No design systems match your search.' : 'Create your first brand kit to teach PepeteX your visual direction.'"
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="showCreateDialog = true">
          Create design system
        </PxButton>
      </template>
    </PxEmptyState>
    <div v-else class="grid gap-2">
      <div
        v-for="system in filteredSystems"
        :key="system.id"
        class="grid gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition hover:border-border-strong md:grid-cols-[auto_minmax(0,1fr)_auto]"
      >
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-accent">
          <UIcon name="i-heroicons-swatch" class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="truncate text-sm font-bold text-fg">{{ system.name }}</h3>
            <PxBadge :tone="system.isEnabled ? 'success' : 'neutral'" variant="soft" size="xs">
              {{ system.isEnabled ? 'Enabled' : 'Draft' }}
            </PxBadge>
          </div>
          <p class="mt-1 truncate text-xs text-fg-muted">
            v{{ system.currentVersionNumber }} · {{ system.scope }} · Updated {{ formatDate(system.updatedAt) }}
          </p>
          <p class="mt-1 line-clamp-1 text-xs text-fg-subtle">{{ system.description || 'No description yet.' }}</p>
        </div>
        <div class="flex items-center gap-2 md:justify-end">
          <PxButton variant="secondary" size="sm" :to="`/design-systems/${system.id}`">Edit</PxButton>
          <PxButton variant="danger" size="sm" @click="deletingId = system.id">Delete</PxButton>
        </div>
      </div>
      <button
        type="button"
        class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-4 text-sm font-medium text-fg-muted transition hover:border-accent hover:text-accent"
        @click="showCreateDialog = true"
      >
        <span class="text-base">+</span>
        Create new design system
      </button>
    </div>

    <PxDialog v-model="showCreateDialog" title="Create design system" size="md">
      <form class="flex flex-col gap-4" @submit.prevent="create">
        <PxInput
          v-model="createForm.name"
          label="Name"
          placeholder="e.g. Indosat Pitch Kit"
          required
          autofocus
        />
        <PxTextarea
          v-model="createForm.description"
          label="Description"
          placeholder="Audience, mood, colors, examples"
          :rows="4"
        />
        <PxSelect
          v-model="createForm.scope"
          :options="scopeOptions"
          label="Scope"
        />
        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <PxButton variant="ghost" type="button" @click="showCreateDialog = false">Cancel</PxButton>
          <PxButton variant="primary" type="submit" :loading="creating" :disabled="!createForm.name.trim() || (createForm.scope === 'workspace' && !currentWorkspaceId)">
            Create
          </PxButton>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="deleteOpen" title="Delete design system?" size="sm">
      <p class="text-sm text-fg-muted">Tokens, components, and saved versions for this system will be removed.</p>
      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <PxButton variant="ghost" @click="deletingId = null">Cancel</PxButton>
        <PxButton variant="danger" @click="deleteSystem">Delete</PxButton>
      </div>
    </PxDialog>
  </div>
</template>
