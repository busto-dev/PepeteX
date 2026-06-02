<script setup lang="ts">
import type { WorkspaceMemberCandidateSummary, WorkspaceRole } from '~/types'

const props = defineProps<{
  workspaceId: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'added'): void
}>()

const toast = useToast()

const roleOptions: Array<Exclude<WorkspaceRole, 'OWNER'>> = ['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']

const query = ref('')
const candidates = ref<WorkspaceMemberCandidateSummary[]>([])
const selectedUser = ref<WorkspaceMemberCandidateSummary | null>(null)
const memberRole = ref<Exclude<WorkspaceRole, 'OWNER'>>('EDITOR')
const searching = ref(false)
const adding = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchController: AbortController | null = null

const trimmedQuery = computed(() => query.value.trim())
const canSubmit = computed(() => selectedUser.value !== null && !adding.value)

watch(query, (value) => {
  if (selectedUser.value && value !== formatCandidate(selectedUser.value)) {
    selectedUser.value = null
  }

  if (selectedUser.value) {
    candidates.value = []
    return
  }

  queueSearch(value)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  searchController?.abort()
})

function queueSearch(value: string) {
  if (searchTimer) clearTimeout(searchTimer)

  const search = value.trim()

  if (search.length < 2) {
    searchController?.abort()
    searching.value = false
    candidates.value = []
    return
  }

  searchTimer = setTimeout(() => {
    void searchCandidates(search)
  }, 250)
}

async function searchCandidates(search: string) {
  searchController?.abort()

  const controller = new AbortController()
  searchController = controller
  searching.value = true

  try {
    const data = await $fetch<{ users: WorkspaceMemberCandidateSummary[] }>(
      `/api/workspaces/${props.workspaceId}/members/candidates`,
      {
        query: { q: search },
        signal: controller.signal
      }
    )

    if (trimmedQuery.value === search) {
      candidates.value = data.users
    }
  } catch (error: unknown) {
    if (!isAbortError(error)) {
      const err = error as { data?: { statusMessage?: string } }
      toast.add({ title: 'Failed to search users', description: err?.data?.statusMessage, color: 'error' })
    }
  } finally {
    if (searchController === controller) {
      searching.value = false
      searchController = null
    }
  }
}

function selectCandidate(candidate: WorkspaceMemberCandidateSummary) {
  selectedUser.value = candidate
  query.value = formatCandidate(candidate)
  candidates.value = []
}

function clearSelection() {
  selectedUser.value = null
  query.value = ''
  candidates.value = []
}

function formatCandidate(candidate: WorkspaceMemberCandidateSummary) {
  return candidate.name ? `${candidate.name} (${candidate.email})` : candidate.email
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

async function addMember() {
  if (!selectedUser.value) {
    toast.add({ title: 'Select an existing user first', color: 'warning' })
    return
  }

  adding.value = true

  try {
    await $fetch(`/api/workspaces/${props.workspaceId}/members`, {
      method: 'POST',
      body: { email: selectedUser.value.email, role: memberRole.value }
    })
    toast.add({ title: 'Member added', color: 'success' })
    emit('added')
    emit('close')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to add member', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" @click.self="emit('close')">
    <form class="w-full max-w-md rounded-3xl bg-surface p-6 shadow-xl" @submit.prevent="addMember">
      <h3 class="text-lg font-black text-fg">Add member</h3>
      <p class="mt-1 text-sm text-fg-muted">Search existing users by name or email, then choose their workspace role.</p>

      <label class="pepetex-label mt-5">User</label>
      <input
        v-model="query"
        type="search"
        class="pepetex-field"
        placeholder="Type at least 2 characters"
        autocomplete="off"
      />

      <div v-if="selectedUser" class="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-bg-subtle p-3">
        <PxAvatar :name="selectedUser.name ?? selectedUser.email" :src="selectedUser.avatarUrl" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-black text-fg">{{ selectedUser.name ?? selectedUser.email }}</p>
          <p class="truncate text-xs text-fg-subtle">{{ selectedUser.email }}</p>
        </div>
        <PxButton variant="ghost" size="sm" type="button" @click="clearSelection">Change</PxButton>
      </div>

      <div v-else-if="trimmedQuery.length > 0 && trimmedQuery.length < 2" class="mt-2 rounded-2xl border border-border bg-bg-subtle p-3 text-sm text-fg-muted">
        Type at least 2 characters to search users.
      </div>

      <div v-else-if="trimmedQuery.length >= 2" class="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
        <p v-if="searching" class="p-3 text-sm text-fg-muted">Searching...</p>
        <template v-else>
          <button
            v-for="candidate in candidates"
            :key="candidate.userId"
            type="button"
            class="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-bg-subtle"
            @click="selectCandidate(candidate)"
          >
            <PxAvatar :name="candidate.name ?? candidate.email" :src="candidate.avatarUrl" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-black text-fg">{{ candidate.name ?? candidate.email }}</span>
              <span class="block truncate text-xs text-fg-subtle">{{ candidate.email }}</span>
            </span>
          </button>
          <p v-if="candidates.length === 0" class="p-3 text-sm text-fg-muted">No matching users found.</p>
        </template>
      </div>

      <label class="pepetex-label mt-5">Role</label>
      <select v-model="memberRole" class="pepetex-field">
        <option v-for="role in roleOptions" :key="role" :value="role">{{ role }}</option>
      </select>

      <div class="mt-5 flex justify-end gap-2">
        <PxButton variant="secondary" type="button" @click="emit('close')">Cancel</PxButton>
        <PxButton type="submit" variant="primary" :disabled="!canSubmit" :loading="adding">Add member</PxButton>
      </div>
    </form>
  </div>
</template>
