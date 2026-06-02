<script setup lang="ts">
import type { ProviderSummary } from '~/types'

definePageMeta({ middleware: 'admin' })

const toast = useToast()
const providers = ref<ProviderSummary[]>([])
const loading = ref(false)
const query = ref('')

const editing = ref<ProviderSummary | null>(null)
const creating = ref(false)
const form = reactive({
  name: '',
  kind: 'gemini' as string,
  geminiApiKey: '',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiCustomHeaders: '',
  openaiOrgId: '',
  openaiProjectId: '',
  openaiManualModelNames: '',
  cliproxyBaseUrl: '',
  cliproxyRouteKind: 'openai-compatible' as string,
  cliproxyApiKey: '',
  geminiManualModelNames: '',
  cliproxyManualModelNames: ''
})
const submitting = ref(false)
const testingId = ref<string | null>(null)
const testingModal = ref(false)
const testResultModal = ref<{ ok: boolean; message: string } | null>(null)
const revealingId = ref<string | null>(null)
const revealedCredentials = ref<Record<string, Record<string, unknown>>>({})
const deletingProvider = ref<{ id: string; name: string } | null>(null)
const deletingId = ref<string | null>(null)
const initialManualModelText = ref('')

const PROVIDER_KINDS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'cliproxyapi', label: 'CLIProxyAPI' }
]
const CLIPROXY_ROUTE_KINDS = [
  { value: 'openai-compatible', label: 'OpenAI compatible' },
  { value: 'gemini-compatible', label: 'Gemini compatible' },
  { value: 'claude-compatible', label: 'Claude compatible' }
]

const filteredProviders = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return providers.value
  return providers.value.filter((provider) =>
    `${provider.name} ${provider.kind}`.toLowerCase().includes(term)
  )
})

const deleteOpen = computed({
  get: () => deletingProvider.value !== null,
  set: (v: boolean) => { if (!v) deletingProvider.value = null }
})

function formatKindLabel(kind: string) {
  const k = kind.toLowerCase().replace('_', '-')
  if (k === 'gemini') return 'Gemini'
  if (k === 'openai-compatible' || k === 'openai_compatible') return 'OpenAI Compatible'
  if (k === 'cliproxyapi') return 'CLIProxyAPI'
  return kind
}

function kindTone(kind: string): 'info' | 'success' | 'accent' | 'neutral' {
  const k = kind.toLowerCase().replace('_', '-')
  if (k === 'gemini') return 'info'
  if (k === 'openai-compatible' || k === 'openai_compatible') return 'success'
  if (k === 'cliproxyapi') return 'accent'
  return 'neutral'
}

function buildSaveBody() {
  const base = { name: form.name, kind: form.kind }
  if (form.kind === 'gemini') {
    const manualModels = parseManualModels(form.geminiManualModelNames)
    const manualModelsChanged = hasManualModelsChanged()
    return {
      ...base,
      credentialPayload: shouldSendCredentialPayload(form.geminiApiKey, manualModelsChanged)
        ? {
            apiKey: form.geminiApiKey || undefined,
            ...(shouldSendManualModels(manualModelsChanged) ? { manualModels } : {})
          }
        : undefined
    }
  }
  if (form.kind === 'openai-compatible') {
    const customHeaders = form.openaiCustomHeaders.trim()
      ? Object.fromEntries(
          form.openaiCustomHeaders.trim().split('\n').filter(Boolean).map((line) => {
            const separatorIndex = line.indexOf(':')
            if (separatorIndex < 0) return [line.trim(), '']
            return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()]
          })
        )
      : undefined
    const manualModels = parseManualModels(form.openaiManualModelNames)
    const manualModelsChanged = hasManualModelsChanged()
    return {
      ...base,
      baseUrl: form.openaiBaseUrl || undefined,
      credentialPayload: shouldSendCredentialPayload(form.openaiApiKey, manualModelsChanged)
        ? {
            baseUrl: form.openaiBaseUrl || undefined,
            apiKey: form.openaiApiKey || undefined,
            customHeaders,
            orgId: form.openaiOrgId || undefined,
            projectId: form.openaiProjectId || undefined,
            ...(shouldSendManualModels(manualModelsChanged) ? { manualModels } : {})
          }
        : undefined
    }
  }
  if (form.kind === 'cliproxyapi') {
    const manualModels = parseManualModels(form.cliproxyManualModelNames)
    const manualModelsChanged = hasManualModelsChanged()
    return {
      ...base,
      baseUrl: form.cliproxyBaseUrl || undefined,
      credentialPayload: shouldSendCredentialPayload(form.cliproxyApiKey, manualModelsChanged)
        ? {
            baseUrl: form.cliproxyBaseUrl || undefined,
            routeKind: form.cliproxyRouteKind,
            apiKey: form.cliproxyApiKey || undefined,
            ...(shouldSendManualModels(manualModelsChanged) ? { manualModels } : {})
          }
        : undefined
    }
  }
  return base
}

function shouldSendCredentialPayload(apiKey: string, manualModelsChanged: boolean) {
  return editing.value ? !!apiKey || manualModelsChanged : !!apiKey || currentManualModelText().length > 0
}

function shouldSendManualModels(manualModelsChanged: boolean) {
  return !editing.value || manualModelsChanged
}

function parseManualModels(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes('|') ? '|' : line.includes('=') ? '=' : ''
      if (!separator) return { id: line, label: line }
      const [idPart, ...labelParts] = line.split(separator)
      const id = idPart?.trim() ?? ''
      const label = labelParts.join(separator).trim()
      return { id, label: label || id }
    })
    .filter((model) => model.id)
}

function formatManualModels(models: Array<{ id: string; label: string }> | undefined) {
  return (models ?? [])
    .map((model) => {
      const id = model.id.trim()
      const label = model.label.trim()
      return label && label !== id ? `${id} | ${label}` : id
    })
    .filter(Boolean)
    .join('\n')
}

function currentManualModelText() {
  if (form.kind === 'gemini') return form.geminiManualModelNames.trim()
  if (form.kind === 'openai-compatible') return form.openaiManualModelNames.trim()
  if (form.kind === 'cliproxyapi') return form.cliproxyManualModelNames.trim()
  return ''
}

function hasManualModelsChanged() {
  return currentManualModelText() !== initialManualModelText.value
}

async function load() {
  loading.value = true
  try {
    const data = await $fetch<{ providers: ProviderSummary[] }>('/api/providers')
    providers.value = data.providers
  } finally {
    loading.value = false
  }
}

onMounted(load)

function resetForm() {
  Object.assign(form, {
    name: '', kind: 'gemini',
    geminiApiKey: '',
    geminiManualModelNames: '',
    openaiBaseUrl: '', openaiApiKey: '', openaiCustomHeaders: '', openaiOrgId: '', openaiProjectId: '', openaiManualModelNames: '',
    cliproxyBaseUrl: '', cliproxyRouteKind: 'openai-compatible', cliproxyApiKey: '', cliproxyManualModelNames: ''
  })
  initialManualModelText.value = ''
}

function openCreate() {
  resetForm()
  editing.value = null
  creating.value = true
  testResultModal.value = null
}

function openEdit(p: ProviderSummary) {
  resetForm()
  form.name = p.name
  form.kind = p.kind.toLowerCase().replace('_', '-')
  const manualModelText = formatManualModels(p.systemCredentials?.[0]?.manualModels)
  if (form.kind === 'gemini') {
    form.geminiManualModelNames = manualModelText
  } else if (form.kind === 'openai-compatible') {
    form.openaiBaseUrl = p.baseUrl ?? ''
    form.openaiManualModelNames = manualModelText
  } else if (form.kind === 'cliproxyapi') {
    form.cliproxyBaseUrl = p.baseUrl ?? ''
    form.cliproxyManualModelNames = manualModelText
  }
  initialManualModelText.value = currentManualModelText()
  editing.value = p
  creating.value = true
  testResultModal.value = null
}

function closeModal() {
  creating.value = false
  editing.value = null
}

async function saveProvider() {
  submitting.value = true
  try {
    const body = buildSaveBody()
    if (editing.value) {
      await $fetch(`/api/admin/providers/${editing.value.id}`, { method: 'PATCH', body })
      toast.add({ title: 'Provider updated', color: 'success' })
      initialManualModelText.value = currentManualModelText()
      creating.value = false
      editing.value = null
    } else {
      const data = await $fetch<{ provider: ProviderSummary }>('/api/admin/providers', { method: 'POST', body })
      toast.add({ title: 'Provider created', description: 'You can now test the connection.', color: 'success' })
      editing.value = data.provider
      initialManualModelText.value = currentManualModelText()
    }
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function testConnectionRow(id: string) {
  testingId.value = id
  try {
    const data = await $fetch<{ ok: boolean; message: string }>(`/api/admin/providers/${id}/test`)
    toast.add({ title: data.ok ? 'Connection OK' : 'Connection failed', description: data.message, color: data.ok ? 'success' : 'error' })
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Test failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    testingId.value = null
  }
}

async function testConnectionInModal() {
  if (!editing.value) return
  testingModal.value = true
  testResultModal.value = null
  try {
    const data = await $fetch<{ ok: boolean; message: string }>(`/api/admin/providers/${editing.value.id}/test`)
    testResultModal.value = data
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    testResultModal.value = { ok: false, message: err?.data?.statusMessage ?? 'Test failed' }
  } finally {
    testingModal.value = false
  }
}

async function confirmDelete() {
  if (!deletingProvider.value) return
  deletingId.value = deletingProvider.value.id
  try {
    await $fetch(`/api/admin/providers/${deletingProvider.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Provider deleted', color: 'success' })
    deletingProvider.value = null
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Delete failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    deletingId.value = null
  }
}

async function revealCredential(id: string) {
  if (revealedCredentials.value[id]) {
    const updated = { ...revealedCredentials.value }
    delete updated[id]
    revealedCredentials.value = updated
    return
  }
  revealingId.value = id
  try {
    const data = await $fetch<{ credential: Record<string, unknown> }>(`/api/admin/providers/${id}/credential`)
    revealedCredentials.value = { ...revealedCredentials.value, [id]: data.credential }
  } catch {
    toast.add({ title: 'Failed to reveal credential', color: 'error' })
  } finally {
    revealingId.value = null
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="AI providers"
      description="Configure global and workspace AI provider credentials."
      :back="{ to: '/admin' }"
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="openCreate">Add provider</PxButton>
      </template>
    </PxPageHeader>

    <div class="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-sm">
      <PxInput v-model="query" icon="i-heroicons-magnifying-glass" placeholder="Search providers..." size="sm" class="min-w-0 flex-1" />
      <PxButton variant="secondary" size="sm" icon="i-heroicons-funnel">Filters</PxButton>
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2">
      <PxSkeleton v-for="i in 4" :key="i" class="h-16" />
    </div>
    <PxEmptyState
      v-else-if="filteredProviders.length === 0"
      icon="i-heroicons-cpu-chip"
      title="No providers configured"
      description="Add a provider to enable text and image generation."
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="openCreate">Add provider</PxButton>
      </template>
    </PxEmptyState>
    <div v-else class="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
      <table class="min-w-[720px] w-full text-sm">
        <thead class="border-b border-border bg-bg-subtle/50 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            <th class="px-4 py-3 text-left">Name</th>
            <th class="px-4 py-3 text-left">Kind</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <template v-for="p in filteredProviders" :key="p.id">
            <tr class="hover:bg-bg-subtle/60">
              <td class="px-4 py-3 font-medium text-fg">{{ p.name }}</td>
              <td class="px-4 py-3">
                <PxBadge :tone="kindTone(p.kind)" variant="soft" size="xs">{{ formatKindLabel(p.kind) }}</PxBadge>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex flex-nowrap justify-end gap-1.5">
                  <PxButton variant="ghost" size="xs" :loading="testingId === p.id" @click="testConnectionRow(p.id)">Test</PxButton>
                  <PxButton variant="ghost" size="xs" :loading="revealingId === p.id" @click="revealCredential(p.id)">
                    {{ revealedCredentials[p.id] ? 'Hide' : 'Reveal' }}
                  </PxButton>
                  <PxButton variant="ghost" size="xs" @click="openEdit(p)">Edit</PxButton>
                  <PxButton variant="ghost" size="xs" :loading="deletingId === p.id" @click="deletingProvider = { id: p.id, name: p.name }">Delete</PxButton>
                </div>
              </td>
            </tr>
            <tr v-if="revealedCredentials[p.id]">
              <td colspan="3" class="px-4 pb-3">
                <pre class="overflow-x-auto rounded-lg border border-border bg-bg-subtle p-3 font-mono text-[11px] text-fg">{{ JSON.stringify(revealedCredentials[p.id], null, 2) }}</pre>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <PxDialog v-model="creating" :title="editing ? 'Edit provider' : 'Add provider'" size="lg">
      <form class="flex flex-col gap-4" @submit.prevent="saveProvider">
        <PxInput v-model="form.name" label="Display name" placeholder="e.g. Gemini Pro (Production)" required />
        <PxSelect v-model="form.kind" :options="PROVIDER_KINDS" label="Provider type" />

        <template v-if="form.kind === 'gemini'">
          <PxInput
            v-model="form.geminiApiKey"
            type="password"
            label="API key"
            placeholder="AIza…"
            autocomplete="new-password"
            :hint="editing ? 'Leave blank to keep existing key.' : undefined"
          />
          <PxTextarea
            v-model="form.geminiManualModelNames"
            label="Manual models"
            placeholder="gemini-3.1-pro | Advanced Model"
            hint="Optional. One per line as model-id | Alias. When set, only these models are shown instead of /models."
            :rows="3"
          />
        </template>

        <template v-if="form.kind === 'openai-compatible'">
          <PxInput v-model="form.openaiBaseUrl" type="url" label="Base URL" placeholder="https://api.openai.com/v1" />
          <PxInput
            v-model="form.openaiApiKey"
            type="password"
            label="API key"
            placeholder="sk-…"
            autocomplete="new-password"
            :hint="editing ? 'Leave blank to keep existing key.' : undefined"
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <PxInput v-model="form.openaiOrgId" label="Organization ID" placeholder="org-…" hint="Optional" />
            <PxInput v-model="form.openaiProjectId" label="Project ID" placeholder="proj-…" hint="Optional" />
          </div>
          <PxTextarea
            v-model="form.openaiCustomHeaders"
            label="Custom headers"
            placeholder="X-Custom-Header: value"
            hint="One per line: Key: Value"
            :rows="2"
          />
          <PxTextarea
            v-model="form.openaiManualModelNames"
            label="Manual models"
            placeholder="gpt-5.4 | Advanced Model&#10;gpt-5.4-mini"
            hint="Optional. One per line as model-id | Alias. When set, only these models are shown instead of /models."
            :rows="3"
          />
        </template>

        <template v-if="form.kind === 'cliproxyapi'">
          <PxInput v-model="form.cliproxyBaseUrl" type="url" label="Base URL" placeholder="http://localhost:3001" />
          <PxSelect v-model="form.cliproxyRouteKind" :options="CLIPROXY_ROUTE_KINDS" label="Route kind" />
          <PxInput
            v-model="form.cliproxyApiKey"
            type="password"
            label="API key"
            placeholder="optional key"
            autocomplete="new-password"
            hint="Optional"
          />
          <PxTextarea
            v-model="form.cliproxyManualModelNames"
            label="Manual models"
            placeholder="gemini-3.1-pro | Advanced Model"
            hint="Optional. One per line as model-id | Alias. When set, only these models are shown instead of /models."
            :rows="3"
          />
        </template>

        <div
          v-if="testResultModal"
          class="rounded-lg border px-3 py-2 text-sm"
          :class="testResultModal.ok ? 'border-[color:var(--px-success-500)] bg-[color:color-mix(in_oklab,var(--px-success-500)_10%,transparent)] text-fg' : 'border-[color:var(--px-danger-500)] bg-[color:color-mix(in_oklab,var(--px-danger-500)_10%,transparent)] text-[color:var(--px-danger-600)]'"
        >
          {{ testResultModal.ok ? '✓' : '✗' }} {{ testResultModal.message }}
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <PxButton
            v-if="editing"
            type="button"
            variant="outline"
            :loading="testingModal"
            @click="testConnectionInModal"
          >
            Test connection
          </PxButton>
          <span v-else />
          <div class="flex gap-2">
            <PxButton variant="ghost" type="button" @click="closeModal">{{ editing ? 'Close' : 'Cancel' }}</PxButton>
            <PxButton variant="primary" type="submit" :loading="submitting">
              {{ editing ? 'Save' : 'Save & enable test' }}
            </PxButton>
          </div>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="deleteOpen" title="Delete provider?" size="sm">
      <p class="text-sm text-fg-muted">
        Delete provider <span class="font-medium text-fg">{{ deletingProvider?.name }}</span>? This cannot be undone.
      </p>
      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <PxButton variant="ghost" @click="deletingProvider = null">Cancel</PxButton>
        <PxButton variant="danger" :loading="!!deletingId" @click="confirmDelete">Delete</PxButton>
      </div>
    </PxDialog>
  </div>
</template>
