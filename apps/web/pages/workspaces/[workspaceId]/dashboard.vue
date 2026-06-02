<script setup lang="ts">
import WorkspaceMemberAddDialog from '~/components/workspace/WorkspaceMemberAddDialog.vue'
import type { DeckSummary, DesignSystemSummary, WorkspaceMemberSummary, WorkspaceRole, WorkspaceSummary } from '~/types'

type UsageByKind = { kind: string; count: number }

interface UsageSummary {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  pendingRuns: number
  byKind: UsageByKind[]
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const workspaceId = computed(() => route.params.workspaceId as string)
const { setWorkspace, renameWorkspace, deleteWorkspace } = useWorkspaces()
const { createDeck } = useDeck()

const workspace = ref<WorkspaceSummary | null>(null)
const decks = ref<DeckSummary[]>([])
const designSystems = ref<DesignSystemSummary[]>([])
const members = ref<WorkspaceMemberSummary[]>([])
const usage = ref<UsageSummary | null>(null)
const loading = ref(false)
const creatingDeck = ref(false)
const addMemberOpen = ref(false)
const memberActionId = ref<string | null>(null)
const renameOpen = ref(false)
const renameName = ref('')
const renaming = ref(false)
const deleting = ref(false)
const deleteOpen = ref(false)
const activeTab = ref<'overview' | 'decks' | 'design-systems' | 'members' | 'usage'>('overview')

const roleOptions: Array<Exclude<WorkspaceRole, 'OWNER'>> = ['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']
const memberRoleOptions = roleOptions.map((r) => ({ value: r, label: r }))
const canManageMembers = computed(() => ['OWNER', 'ADMIN'].includes(workspace.value?.currentUserRole ?? 'VIEWER'))
const canEditWorkspace = computed(() => ['OWNER', 'ADMIN', 'EDITOR'].includes(workspace.value?.currentUserRole ?? 'VIEWER'))
const recentDecks = computed(() => decks.value.slice(0, 6))

watch(workspaceId, async (id) => {
  if (!id) return
  setWorkspace(id)
  await loadAll()
}, { immediate: true })

async function loadAll() {
  loading.value = true
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const [workspaceRes, deckRes, designSystemRes, memberRes, usageRes] = await Promise.allSettled([
        $fetch<{ workspace: WorkspaceSummary }>(`/api/workspaces/${workspaceId.value}`, { signal: controller.signal }),
        $fetch<{ decks: DeckSummary[] }>(`/api/workspaces/${workspaceId.value}/decks`, { signal: controller.signal }),
        $fetch<{ designSystems: DesignSystemSummary[] }>(`/api/design-systems?workspaceId=${workspaceId.value}`, { signal: controller.signal }),
        $fetch<{ members: WorkspaceMemberSummary[] }>(`/api/workspaces/${workspaceId.value}/members`, { signal: controller.signal }),
        $fetch<UsageSummary>(`/api/workspaces/${workspaceId.value}/usage`, { signal: controller.signal })
      ])

      if (workspaceRes.status === 'fulfilled') {
        workspace.value = workspaceRes.value.workspace
        renameName.value = workspaceRes.value.workspace.name
      } else {
        const err = workspaceRes.reason as { data?: { statusMessage?: string } }
        toast.add({ title: 'Failed to load workspace', description: err?.data?.statusMessage, color: 'error' })
      }
      decks.value = deckRes.status === 'fulfilled' ? deckRes.value.decks : []
      designSystems.value = designSystemRes.status === 'fulfilled' ? designSystemRes.value.designSystems : []
      members.value = memberRes.status === 'fulfilled' ? memberRes.value.members : []
      usage.value = usageRes.status === 'fulfilled' ? usageRes.value : null
    } finally {
      clearTimeout(timer)
    }
  } finally {
    loading.value = false
  }
}

async function startDeck() {
  if (!workspace.value) return
  creatingDeck.value = true
  try {
    const deck = await createDeck(workspace.value.id, 'Untitled deck')
    await router.push(`/decks/${deck.id}`)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to create deck', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    creatingDeck.value = false
  }
}

async function updateMemberRole(member: WorkspaceMemberSummary, role: Exclude<WorkspaceRole, 'OWNER'>) {
  memberActionId.value = member.id
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/members/${member.id}`, {
      method: 'PATCH',
      body: { role }
    })
    toast.add({ title: 'Member role updated', color: 'success' })
    await loadAll()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to update member', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    memberActionId.value = null
  }
}

async function removeMember(member: WorkspaceMemberSummary) {
  memberActionId.value = member.id
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/members/${member.id}`, { method: 'DELETE' })
    toast.add({ title: 'Member removed', color: 'success' })
    await loadAll()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to remove member', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    memberActionId.value = null
  }
}

async function submitRename() {
  if (!workspace.value || !renameName.value.trim()) return
  renaming.value = true
  try {
    const updated = await renameWorkspace(workspace.value.id, renameName.value.trim())
    workspace.value = updated
    toast.add({ title: 'Workspace renamed', color: 'success' })
    renameOpen.value = false
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to rename workspace', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    renaming.value = false
  }
}

async function submitDelete() {
  if (!workspace.value) return
  deleting.value = true
  try {
    await deleteWorkspace(workspace.value.id)
    toast.add({ title: 'Workspace deleted', color: 'success' })
    await router.push('/workspaces')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to delete workspace', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    deleting.value = false
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
}

function roleTone(role: WorkspaceRole): 'success' | 'accent' | 'warning' | 'neutral' {
  if (role === 'OWNER' || role === 'ADMIN') return 'success'
  if (role === 'EDITOR') return 'accent'
  if (role === 'COMMENTER') return 'warning'
  return 'neutral'
}

const tabs = computed(() => [
  { value: 'overview', label: 'Overview' },
  { value: 'decks', label: 'Decks', count: decks.value.length },
  { value: 'design-systems', label: 'Design systems', count: designSystems.value.length },
  { value: 'members', label: 'Members', count: members.value.length },
  { value: 'usage', label: 'Usage' }
])
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader :title="workspace?.name ?? 'Loading workspace…'" :back="{ to: '/workspaces', label: 'All workspaces' }">
      <template #meta>
        <div v-if="workspace" class="flex flex-wrap items-center gap-1.5">
          <PxBadge :tone="workspace.type === 'PERSONAL' ? 'neutral' : 'info'" variant="soft" size="xs">{{ workspace.type === 'PERSONAL' ? 'Personal' : 'Shared' }}</PxBadge>
          <PxBadge :tone="roleTone(workspace.currentUserRole)" variant="soft" size="xs">{{ workspace.currentUserRole }}</PxBadge>
          <span class="text-xs text-fg-subtle">Updated {{ formatDate(workspace.updatedAt) }}</span>
        </div>
      </template>
      <template #actions>
        <PxButton v-if="canEditWorkspace" variant="secondary" size="sm" icon="i-heroicons-pencil-square" @click="renameOpen = true">Rename</PxButton>
        <PxButton variant="primary" size="sm" icon="i-heroicons-plus" :loading="creatingDeck" @click="startDeck">New deck</PxButton>
      </template>
    </PxPageHeader>

    <div v-if="loading" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <PxSkeleton v-for="i in 4" :key="i" class="h-36" />
    </div>

    <div v-else class="space-y-6">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ decks.length }}</p><p class="mt-1 text-sm text-fg-muted">Decks</p></PxCard>
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ designSystems.length }}</p><p class="mt-1 text-sm text-fg-muted">Design systems</p></PxCard>
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ members.length }}</p><p class="mt-1 text-sm text-fg-muted">Members</p></PxCard>
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ usage?.totalRuns ?? 0 }}</p><p class="mt-1 text-sm text-fg-muted">Generation runs</p></PxCard>
      </div>

      <div class="flex w-fit flex-wrap gap-0.5 rounded-[10px] border border-border bg-surface-raised p-1 shadow-sm">
        <button v-for="tab in tabs" :key="tab.value" type="button" class="px-focus-ring rounded-[7px] px-3 py-1.5 text-xs font-medium transition-all" :class="activeTab === tab.value ? 'bg-surface text-fg font-semibold shadow-sm' : 'text-fg-muted hover:text-fg'" @click="activeTab = tab.value as typeof activeTab">
          {{ tab.label }}<span v-if="'count' in tab" class="ml-1 opacity-60">{{ tab.count }}</span>
        </button>
      </div>

      <section v-if="activeTab === 'overview'" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <PxCard padding="lg">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div><p class="pepetex-label">Recent decks</p><h2 class="text-xl font-black text-fg">Keep working</h2></div>
            <PxButton variant="secondary" size="sm" @click="activeTab = 'decks'">View all</PxButton>
          </div>
          <div v-if="recentDecks.length" class="grid gap-3 sm:grid-cols-2">
            <NuxtLink v-for="deck in recentDecks" :key="deck.id" :to="`/decks/${deck.id}`" class="rounded-3xl border border-border bg-bg-subtle p-4 transition hover:border-border-strong hover:bg-surface">
              <h3 class="truncate text-sm font-black text-fg">{{ deck.title }}</h3>
              <p class="mt-1 text-xs text-fg-subtle">{{ deck.slideCount ?? 0 }} slides · {{ formatDate(deck.updatedAt) }}</p>
            </NuxtLink>
          </div>
          <PxEmptyState v-else icon="i-heroicons-presentation-chart-bar" title="No decks yet" description="Create a new deck in this workspace." />
        </PxCard>
        <div class="rounded-xl border border-border bg-surface p-3 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
          <div class="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-[0.07em] text-fg-subtle">Controls</div>
          <button class="px-focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-fg-muted transition hover:bg-bg-subtle hover:text-fg" :disabled="creatingDeck" @click="startDeck">
            <UIcon name="i-heroicons-plus-circle" class="h-3.5 w-3.5 shrink-0" />
            Create deck
          </button>
          <button v-if="canManageMembers" class="px-focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-fg-muted transition hover:bg-bg-subtle hover:text-fg" @click="addMemberOpen = true">
            <UIcon name="i-heroicons-user-plus" class="h-3.5 w-3.5 shrink-0" />
            Add member
          </button>
          <button v-if="canEditWorkspace" class="px-focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-fg-muted transition hover:bg-bg-subtle hover:text-fg" @click="renameOpen = true">
            <UIcon name="i-heroicons-pencil" class="h-3.5 w-3.5 shrink-0" />
            Rename workspace
          </button>
          <template v-if="workspace?.currentUserRole === 'OWNER'">
            <div class="my-2 h-px bg-border" />
            <button class="px-focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-danger transition hover:bg-[color:var(--px-danger-soft)]" @click="deleteOpen = true">
              <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5 shrink-0" />
              Delete workspace
            </button>
          </template>
        </div>
      </section>

      <section v-else-if="activeTab === 'decks'" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NuxtLink v-for="deck in decks" :key="deck.id" :to="`/decks/${deck.id}`" class="rounded-3xl border border-border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <h3 class="truncate text-base font-black text-fg">{{ deck.title }}</h3>
          <p class="mt-2 text-sm text-fg-muted">{{ deck.slideCount ?? 0 }} slides · updated {{ formatDate(deck.updatedAt) }}</p>
        </NuxtLink>
        <PxEmptyState v-if="decks.length === 0" icon="i-heroicons-document-plus" title="No decks" description="Create your first deck in this workspace." />
      </section>

      <section v-else-if="activeTab === 'design-systems'" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NuxtLink v-for="ds in designSystems" :key="ds.id" :to="`/design-systems/${ds.id}`" class="rounded-3xl border border-border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <h3 class="truncate text-base font-black text-fg">{{ ds.name }}</h3>
          <p class="mt-2 line-clamp-2 text-sm text-fg-muted">{{ ds.description ?? 'Brand kit and component language for generated decks.' }}</p>
        </NuxtLink>
        <PxEmptyState v-if="designSystems.length === 0" icon="i-heroicons-swatch" title="No design systems" description="Create or import a design system for this workspace." />
      </section>

      <section v-else-if="activeTab === 'members'" class="rounded-3xl border border-border bg-surface shadow-sm">
        <div class="flex items-center justify-between border-b border-border p-4">
          <div><p class="pepetex-label">People</p><h2 class="text-xl font-black text-fg">Workspace members</h2></div>
          <PxButton v-if="canManageMembers" variant="primary" size="sm" icon="i-heroicons-user-plus" @click="addMemberOpen = true">Add member</PxButton>
        </div>
        <div class="divide-y divide-border">
          <div v-for="member in members" :key="member.id" class="flex flex-wrap items-center gap-3 p-4">
            <PxAvatar :name="member.name ?? member.email" :src="member.avatarUrl" />
            <div class="min-w-0 flex-1"><p class="truncate text-sm font-black text-fg">{{ member.name ?? member.email }}</p><p class="truncate text-xs text-fg-subtle">{{ member.email }}</p></div>
            <select v-if="canManageMembers && member.role !== 'OWNER'" class="pepetex-field w-auto" :value="member.role" :disabled="memberActionId === member.id" @change="updateMemberRole(member, ($event.target as HTMLSelectElement).value as Exclude<WorkspaceRole, 'OWNER'>)">
              <option v-for="role in memberRoleOptions" :key="role.value" :value="role.value">{{ role.label }}</option>
            </select>
            <PxBadge v-else :tone="roleTone(member.role)" variant="soft">{{ member.role }}</PxBadge>
            <PxButton v-if="canManageMembers && member.role !== 'OWNER'" variant="ghost" size="sm" icon="i-heroicons-trash" square :loading="memberActionId === member.id" @click="removeMember(member)" />
          </div>
        </div>
      </section>

      <section v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ usage?.completedRuns ?? 0 }}</p><p class="mt-1 text-sm text-fg-muted">Completed</p></PxCard>
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ usage?.failedRuns ?? 0 }}</p><p class="mt-1 text-sm text-fg-muted">Failed</p></PxCard>
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ usage?.pendingRuns ?? 0 }}</p><p class="mt-1 text-sm text-fg-muted">Pending</p></PxCard>
        <PxCard padding="lg"><p class="text-3xl font-black text-fg">{{ usage?.byKind?.length ?? 0 }}</p><p class="mt-1 text-sm text-fg-muted">Run types</p></PxCard>
      </section>
    </div>

    <WorkspaceMemberAddDialog v-if="addMemberOpen" :workspace-id="workspaceId" @close="addMemberOpen = false" @added="loadAll" />

    <div v-if="renameOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <form class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl" @submit.prevent="submitRename">
        <h3 class="text-lg font-black text-fg">Rename workspace</h3>
        <input v-model="renameName" type="text" class="pepetex-field mt-4" required />
        <div class="mt-5 flex justify-end gap-2"><PxButton variant="secondary" @click="renameOpen = false">Cancel</PxButton><PxButton type="submit" variant="primary" :loading="renaming">Save</PxButton></div>
      </form>
    </div>

    <div v-if="deleteOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl">
        <h3 class="text-lg font-black text-fg">Delete workspace?</h3>
        <p class="mt-2 text-sm text-fg-muted">This removes the workspace and cannot be undone.</p>
        <div class="mt-5 flex justify-end gap-2"><PxButton variant="secondary" @click="deleteOpen = false">Cancel</PxButton><PxButton variant="danger" :loading="deleting" @click="submitDelete">Delete</PxButton></div>
      </div>
    </div>
  </div>
</template>
