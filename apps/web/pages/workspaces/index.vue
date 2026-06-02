<script setup lang="ts">
import type { DeckSummary, DesignSystemSummary, WorkspaceSummary } from '~/types'

interface WorkspaceMetrics {
  deckCount: number
  designSystemCount: number
}

const router = useRouter()
const toast = useToast()
const {
  workspaces,
  currentWorkspaceId,
  loading,
  load,
  setWorkspace,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace
} = useWorkspaces()

const query = ref('')
const createOpen = ref(false)
const createName = ref('')
const creating = ref(false)
const renameTarget = ref<WorkspaceSummary | null>(null)
const renameName = ref('')
const renaming = ref(false)
const deleteTarget = ref<WorkspaceSummary | null>(null)
const deleting = ref(false)
const metrics = ref<Record<string, WorkspaceMetrics>>({})
const loadingMetrics = ref(false)

const filteredWorkspaces = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return workspaces.value
  return workspaces.value.filter((w) =>
    `${w.name} ${w.type} ${w.currentUserRole}`.toLowerCase().includes(term)
  )
})

const totalDecks = computed(() => Object.values(metrics.value).reduce((s, m) => s + m.deckCount, 0))
const totalDesignSystems = computed(() => Object.values(metrics.value).reduce((s, m) => s + m.designSystemCount, 0))

onMounted(async () => {
  await load()
  await loadMetrics()
})

watch(workspaces, () => {
  void loadMetrics()
}, { deep: true })

async function loadMetrics() {
  if (workspaces.value.length === 0) {
    metrics.value = {}
    return
  }
  loadingMetrics.value = true
  try {
    const fetchOne = async (workspaceId: string) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        const [deckData, designSystemData] = await Promise.all([
          $fetch<{ decks: DeckSummary[] }>(`/api/workspaces/${workspaceId}/decks`, { signal: controller.signal }),
          $fetch<{ designSystems: DesignSystemSummary[] }>(`/api/design-systems?workspaceId=${workspaceId}`, { signal: controller.signal })
        ])
        return { deckCount: deckData.decks.length, designSystemCount: designSystemData.designSystems.length }
      } finally {
        clearTimeout(timer)
      }
    }
    const results = await Promise.allSettled(workspaces.value.map((w) => fetchOne(w.id)))
    metrics.value = Object.fromEntries(workspaces.value.map((w, i) => {
      const r = results[i]
      return [w.id, r?.status === 'fulfilled' ? r.value : { deckCount: 0, designSystemCount: 0 }]
    }))
  } finally {
    loadingMetrics.value = false
  }
}

async function submitCreate() {
  const name = createName.value.trim()
  if (!name) return
  creating.value = true
  try {
    const workspace = await createWorkspace(name)
    toast.add({ title: 'Workspace created', color: 'success' })
    createName.value = ''
    createOpen.value = false
    await router.push(`/workspaces/${workspace.id}/dashboard`)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to create workspace', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    creating.value = false
  }
}

function openRename(workspace: WorkspaceSummary) {
  renameTarget.value = workspace
  renameName.value = workspace.name
}

async function submitRename() {
  if (!renameTarget.value) return
  const name = renameName.value.trim()
  if (!name) return
  renaming.value = true
  try {
    await renameWorkspace(renameTarget.value.id, name)
    toast.add({ title: 'Workspace renamed', color: 'success' })
    renameTarget.value = null
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to rename workspace', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    renaming.value = false
  }
}

async function submitDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteWorkspace(deleteTarget.value.id)
    toast.add({ title: 'Workspace deleted', color: 'success' })
    deleteTarget.value = null
    await loadMetrics()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to delete workspace', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    deleting.value = false
  }
}

async function openWorkspace(workspace: WorkspaceSummary) {
  setWorkspace(workspace.id)
  await router.push(`/workspaces/${workspace.id}/dashboard`)
}

function roleTone(role: string): 'success' | 'accent' | 'warning' | 'neutral' {
  if (role === 'OWNER' || role === 'ADMIN') return 'success'
  if (role === 'EDITOR') return 'accent'
  if (role === 'COMMENTER') return 'warning'
  return 'neutral'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader title="Workspaces" description="Create studios, manage members, and switch context across teams.">
      <template #actions>
        <PxButton variant="ghost" size="sm" icon="i-heroicons-arrow-path" :loading="loadingMetrics" @click="loadMetrics">Refresh</PxButton>
        <PxButton variant="primary" size="sm" icon="i-heroicons-plus" @click="createOpen = true">New workspace</PxButton>
      </template>
    </PxPageHeader>

    <div class="mb-5 grid gap-3 md:grid-cols-3">
      <div class="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <div class="text-2xl font-black tracking-tight text-fg">{{ workspaces.length }}</div>
        <div class="mt-1 text-[10px] font-medium text-fg-subtle">Workspaces</div>
      </div>
      <div class="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <div class="text-2xl font-black tracking-tight text-fg">{{ totalDecks }}</div>
        <div class="mt-1 text-[10px] font-medium text-fg-subtle">Total decks</div>
      </div>
      <div class="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <div class="text-2xl font-black tracking-tight text-fg">{{ totalDesignSystems }}</div>
        <div class="mt-1 text-[10px] font-medium text-fg-subtle">Design systems</div>
      </div>
    </div>

    <div class="rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="pepetex-label">Browse</p>
          <h2 class="text-xl font-black text-fg">Your workspace studios</h2>
        </div>
        <PxInput v-model="query" class="sm:w-80" placeholder="Search workspaces…" icon="i-heroicons-magnifying-glass" />
      </div>

      <div v-if="loading" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PxSkeleton v-for="i in 6" :key="i" class="h-44" />
      </div>
      <PxEmptyState v-else-if="filteredWorkspaces.length === 0" icon="i-heroicons-square-3-stack-3d" title="No workspaces found" description="Create a workspace or change your search." />
      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <button v-for="workspace in filteredWorkspaces" :key="workspace.id" type="button" class="px-focus-ring rounded-xl border border-border bg-surface p-5 text-left shadow-[0_1px_6px_rgba(0,0,0,0.06)] transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_6px_20px_rgba(0,0,0,0.10)]" @click="openWorkspace(workspace)">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-black tracking-[-0.3px] text-fg">{{ workspace.name }}</h3>
              <p class="mt-2 text-xs text-fg-subtle">Updated {{ formatDate(workspace.updatedAt) }}</p>
            </div>
            <PxBadge :tone="workspace.type === 'PERSONAL' ? 'neutral' : 'info'" variant="soft" size="xs">{{ workspace.type }}</PxBadge>
          </div>
          <div class="mt-5 grid grid-cols-2 gap-3">
            <div class="rounded-lg border border-border bg-surface-raised p-3"><p class="text-lg font-black text-fg">{{ metrics[workspace.id]?.deckCount ?? 0 }}</p><p class="text-[10px] text-fg-muted">Decks</p></div>
            <div class="rounded-lg border border-border bg-surface-raised p-3"><p class="text-lg font-black text-fg">{{ metrics[workspace.id]?.designSystemCount ?? 0 }}</p><p class="text-[10px] text-fg-muted">Design systems</p></div>
          </div>
          <div class="mt-4 text-[10px] font-bold uppercase tracking-[0.06em] text-fg-subtle">{{ workspace.currentUserRole }}</div>
        </button>
      </div>
    </div>

    <div v-if="createOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <form class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl" @submit.prevent="submitCreate">
        <h3 class="text-lg font-black text-fg">Create workspace</h3>
        <input v-model="createName" type="text" class="pepetex-field mt-4" placeholder="Workspace name" required />
        <div class="mt-5 flex justify-end gap-2"><PxButton variant="secondary" @click="createOpen = false">Cancel</PxButton><PxButton type="submit" variant="primary" :loading="creating">Create</PxButton></div>
      </form>
    </div>

    <div v-if="renameTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <form class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl" @submit.prevent="submitRename">
        <h3 class="text-lg font-black text-fg">Rename workspace</h3>
        <input v-model="renameName" type="text" class="pepetex-field mt-4" required />
        <div class="mt-5 flex justify-end gap-2"><PxButton variant="secondary" @click="renameTarget = null">Cancel</PxButton><PxButton type="submit" variant="primary" :loading="renaming">Save</PxButton></div>
      </form>
    </div>

    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl">
        <h3 class="text-lg font-black text-fg">Delete {{ deleteTarget.name }}?</h3>
        <p class="mt-2 text-sm text-fg-muted">This cannot be undone.</p>
        <div class="mt-5 flex justify-end gap-2"><PxButton variant="secondary" @click="deleteTarget = null">Cancel</PxButton><PxButton variant="danger" :loading="deleting" @click="submitDelete">Delete</PxButton></div>
      </div>
    </div>
  </div>
</template>
