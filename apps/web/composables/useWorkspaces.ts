import type { WorkspaceSummary } from '~/types'

export const useWorkspaces = () => {
  const workspaces = useState<WorkspaceSummary[]>('workspaces:list', () => [])
  const currentWorkspaceId = useState<string | null>('workspaces:current', () => null)
  const loading = useState('workspaces:loading', () => false)

  const currentWorkspace = computed(
    () => workspaces.value.find((w) => w.id === currentWorkspaceId.value) ?? workspaces.value[0] ?? null
  )

  async function load() {
    loading.value = true
    try {
      const data = await $fetch<{ workspaces: WorkspaceSummary[] }>('/api/workspaces')
      workspaces.value = data.workspaces
      // Preserve current selection if still valid, otherwise pick default
      const ids = data.workspaces.map((w) => w.id)
      if (!currentWorkspaceId.value || !ids.includes(currentWorkspaceId.value)) {
        currentWorkspaceId.value = data.workspaces[0]?.id ?? null
      }
    } finally {
      loading.value = false
    }
  }

  function setWorkspace(id: string) {
    currentWorkspaceId.value = id
  }

  async function createWorkspace(name: string) {
    const data = await $fetch<{ workspace: WorkspaceSummary }>('/api/workspaces', {
      method: 'POST',
      body: { name }
    })
    await load()
    currentWorkspaceId.value = data.workspace.id
    return data.workspace
  }

  async function renameWorkspace(id: string, name: string) {
    const data = await $fetch<{ workspace: WorkspaceSummary }>(`/api/workspaces/${id}`, {
      method: 'PATCH',
      body: { name }
    })
    await load()
    currentWorkspaceId.value = data.workspace.id
    return data.workspace
  }

  async function deleteWorkspace(id: string) {
    await $fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (currentWorkspaceId.value === id) currentWorkspaceId.value = null
    await load()
  }

  return {
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    loading,
    load,
    setWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  }
}
