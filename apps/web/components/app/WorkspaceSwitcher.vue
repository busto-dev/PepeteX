<script setup lang="ts">
import type { WorkspaceSummary } from '~/types'

const { workspaces, currentWorkspaceId, load, setWorkspace } = useWorkspaces()
const { isAuthenticated } = useSession()

watch(isAuthenticated, async (ok) => { if (ok) await load() }, { immediate: true })

function onChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  if (val) setWorkspace(val)
}
</script>

<template>
  <select
    class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800"
    :value="currentWorkspaceId ?? ''"
    @change="onChange"
  >
    <option value="" disabled>Select workspace</option>
    <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
      {{ ws.name }} {{ ws.type === 'PERSONAL' ? '(Personal)' : '' }}
    </option>
  </select>
</template>
