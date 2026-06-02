<script setup lang="ts">
import type { CustomPromptSummary, DesignSystemSummary, ExampleSummary, ModelDescriptor, ProviderSummary } from '~/types'

definePageMeta({ middleware: 'admin' })

const toast = useToast()
const examples = ref<ExampleSummary[]>([])
const designSystems = ref<DesignSystemSummary[]>([])
const customPrompts = ref<CustomPromptSummary[]>([])
const providers = ref<ProviderSummary[]>([])
const textModelOptions = ref<Array<{ value: string; label: string }>>([])
const loadingTextModels = ref(false)
const textModelError = ref<string | null>(null)
const loading = ref(false)
const creating = ref(false)
const submitting = ref(false)
const deletingId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const referenceUploadId = ref<string | null>(null)
const assetUploadId = ref<string | null>(null)

interface ExampleFormState {
  title: string
  category: string
  promptEn: string
  promptId: string
  isEnabled: boolean
  sortOrder: number
  designSystemId: string
  customPromptId: string
  textProviderKind: string
  textModelId: string
  imageEnabled: boolean
  imageProviderKind: string
  imageModelId: string
}

function blankForm(): ExampleFormState {
  return {
    title: '',
    category: '',
    promptEn: '',
    promptId: '',
    isEnabled: true,
    sortOrder: 0,
    designSystemId: '',
    customPromptId: '',
    textProviderKind: '',
    textModelId: '',
    imageEnabled: false,
    imageProviderKind: '',
    imageModelId: ''
  }
}

const form = reactive<ExampleFormState>(blankForm())

const textProviderKindOptions = [
  { value: '', label: 'No preference' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'cliproxyapi', label: 'CLIProxyAPI' }
]

const imageProviderKindOptions = [
  { value: '', label: 'No preference' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'cliproxyapi', label: 'CLIProxyAPI' },
  { value: 'imagen', label: 'Imagen' },
  { value: 'gemini-image', label: 'Gemini Image' },
  { value: 'gpt-image-2', label: 'GPT Image 2' }
]

const globalDesignSystems = computed(() => designSystems.value.filter((ds) => ds.scope === 'global'))
const globalCustomPrompts = computed(() => customPrompts.value.filter((cp) => cp.scope === 'global'))

const designSystemOptions = computed(() => [
  { value: '', label: 'No design system' },
  ...globalDesignSystems.value.map((ds) => ({ value: ds.id, label: ds.name }))
])
const customPromptOptions = computed(() => [
  { value: '', label: 'No prompt preset' },
  ...globalCustomPrompts.value.map((cp) => ({ value: cp.id, label: cp.title }))
])
const providerOptionsForTextKind = computed(() =>
  providers.value.filter((provider) => normalizeProviderKindForUi(provider.kind) === normalizeProviderKindForUi(form.textProviderKind))
)
const textModelSelectOptions = computed(() => [
  { value: '', label: loadingTextModels.value ? 'Loading models...' : 'No model preference' },
  ...ensureCurrentTextModelOption(textModelOptions.value)
])

const deleteOpen = computed({
  get: () => deletingId.value !== null,
  set: (v: boolean) => { if (!v) deletingId.value = null }
})
const editOpen = computed({
  get: () => editingId.value !== null,
  set: (v: boolean) => { if (!v) editingId.value = null }
})
const editingExample = computed(() => examples.value.find((e) => e.id === editingId.value) ?? null)

async function load() {
  loading.value = true
  try {
    const [exData, dsData, cpData, providerData] = await Promise.all([
      $fetch<{ examples: ExampleSummary[] }>('/api/admin/examples'),
      $fetch<{ designSystems: DesignSystemSummary[] }>('/api/design-systems').catch(() => ({ designSystems: [] })),
      $fetch<{ customPrompts: CustomPromptSummary[] }>('/api/custom-prompts').catch(() => ({ customPrompts: [] })),
      $fetch<{ providers: ProviderSummary[] }>('/api/providers').catch(() => ({ providers: [] }))
    ])
    examples.value = exData.examples
    designSystems.value = dsData.designSystems
    customPrompts.value = cpData.customPrompts
    providers.value = providerData.providers
  } finally {
    loading.value = false
  }
}

watch(providers, () => {
  void loadTextModelOptions()
})

function onTextProviderKindChange(value: string) {
  const nextKind = value ? normalizeProviderKindForUi(value) : ''
  if (nextKind === form.textProviderKind) return
  form.textProviderKind = nextKind
  form.textModelId = ''
  void loadTextModelOptions()
}

async function loadTextModelOptions() {
  textModelOptions.value = []
  textModelError.value = null
  if (!form.textProviderKind) return

  const candidates = providerOptionsForTextKind.value
  if (candidates.length === 0) {
    textModelError.value = 'No provider is configured for this kind.'
    return
  }

  loadingTextModels.value = true
  try {
    const modelMap = new Map<string, string>()
    for (const provider of candidates) {
      try {
        const data = await $fetch<{ result: { models: ModelDescriptor[] } }>(`/api/providers/${provider.id}/models`)
        for (const model of data.result.models) {
          if (!modelMap.has(model.id)) {
            modelMap.set(model.id, model.label)
          }
        }
      } catch {
        // Keep loading other providers; one broken credential should not block all template editing.
      }
    }

    textModelOptions.value = [...modelMap.entries()].map(([value, label]) => ({ value, label }))
    if (textModelOptions.value.length === 0) {
      textModelError.value = 'No models are available for this provider kind.'
    }
  } finally {
    loadingTextModels.value = false
  }
}

function normalizeProviderKindForUi(kind: string): string {
  return kind.trim().toLowerCase().replaceAll('_', '-')
}

function ensureCurrentTextModelOption(options: Array<{ value: string; label: string }>) {
  if (!form.textModelId || options.some((option) => option.value === form.textModelId)) {
    return options
  }
  return [{ value: form.textModelId, label: `${form.textModelId} (saved)` }, ...options]
}

onMounted(load)

function loadFormFromExample(e: ExampleSummary) {
  form.title = e.title
  form.category = e.category ?? ''
  form.promptEn = e.promptEn ?? ''
  form.promptId = e.promptId ?? ''
  form.isEnabled = e.isEnabled
  form.sortOrder = e.sortOrder
  form.designSystemId = e.designSystemId ?? ''
  form.customPromptId = e.customPromptId ?? ''
  form.textProviderKind = e.textProviderKind ? normalizeProviderKindForUi(e.textProviderKind) : ''
  form.textModelId = e.textModelId ?? ''
  form.imageEnabled = !!e.imageEnabled
  form.imageProviderKind = e.imageProviderKind ? normalizeProviderKindForUi(e.imageProviderKind) : ''
  form.imageModelId = e.imageModelId ?? ''
  void loadTextModelOptions()
}

function startCreate() {
  Object.assign(form, blankForm())
  textModelOptions.value = []
  textModelError.value = null
  creating.value = true
}

function startEdit(e: ExampleSummary) {
  loadFormFromExample(e)
  editingId.value = e.id
}

function buildPayload(): Record<string, unknown> {
  return {
    title: form.title.trim(),
    category: form.category.trim(),
    promptEn: form.promptEn.trim(),
    promptId: form.promptId.trim() || form.promptEn.trim(),
    isEnabled: form.isEnabled,
    sortOrder: form.sortOrder,
    designSystemId: form.designSystemId || null,
    customPromptId: form.customPromptId || null,
    textProviderKind: form.textProviderKind || null,
    textModelId: form.textModelId.trim() || null,
    imageEnabled: form.imageEnabled,
    imageProviderKind: form.imageProviderKind || null,
    imageModelId: form.imageModelId.trim() || null
  }
}

async function create() {
  if (!form.title.trim() || !form.category.trim() || !form.promptEn.trim()) {
    toast.add({ title: 'Title, category, and prompt are required', color: 'warning' })
    return
  }
  submitting.value = true
  try {
    const created = await $fetch<ExampleSummary>('/api/admin/examples', { method: 'POST', body: buildPayload() })
    creating.value = false
    toast.add({ title: 'Example created', color: 'success' })
    await load()
    // Open editor so admin can attach files immediately.
    editingId.value = created.id
    loadFormFromExample(created)
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to create', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function saveEdit() {
  if (!editingId.value) return
  submitting.value = true
  try {
    await $fetch(`/api/admin/examples/${editingId.value}`, { method: 'PATCH', body: buildPayload() })
    toast.add({ title: 'Example saved', color: 'success' })
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to save', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function togglePublish(e: ExampleSummary) {
  try {
    await $fetch(`/api/admin/examples/${e.id}`, { method: 'PATCH', body: { isEnabled: !e.isEnabled } })
    await load()
  } catch {
    toast.add({ title: 'Failed to update', color: 'error' })
  }
}

async function deleteExample() {
  if (!deletingId.value) return
  try {
    await $fetch(`/api/admin/examples/${deletingId.value}`, { method: 'DELETE' })
    deletingId.value = null
    toast.add({ title: 'Deleted', color: 'success' })
    await load()
  } catch {
    toast.add({ title: 'Failed to delete', color: 'error' })
  }
}

async function uploadFiles(exampleId: string, purpose: 'REFERENCE' | 'ASSET', fileList: FileList | null) {
  if (!fileList || fileList.length === 0) return
  if (purpose === 'REFERENCE') referenceUploadId.value = exampleId
  else assetUploadId.value = exampleId
  try {
    for (const file of Array.from(fileList)) {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('purpose', purpose)
      try {
        await $fetch(`/api/admin/examples/${exampleId}/reference-files`, {
          method: 'POST',
          body: formData
        })
      } catch (error: unknown) {
        const err = error as { data?: { statusMessage?: string } }
        toast.add({
          title: `Could not upload ${file.name}`,
          description: err?.data?.statusMessage ?? 'Upload failed.',
          color: 'error'
        })
      }
    }
    await load()
  } finally {
    referenceUploadId.value = null
    assetUploadId.value = null
  }
}

function onReferenceUpload(event: Event, exampleId: string) {
  const input = event.target as HTMLInputElement
  void uploadFiles(exampleId, 'REFERENCE', input.files).then(() => {
    input.value = ''
  })
}

function onAssetUpload(event: Event, exampleId: string) {
  const input = event.target as HTMLInputElement
  void uploadFiles(exampleId, 'ASSET', input.files).then(() => {
    input.value = ''
  })
}

async function deleteFile(exampleId: string, fileId: string) {
  try {
    await $fetch(`/api/admin/examples/${exampleId}/reference-files/${fileId}`, { method: 'DELETE' })
    await load()
  } catch {
    toast.add({ title: 'Could not delete file', color: 'error' })
  }
}

const editingReferenceFiles = computed(() =>
  (editingExample.value?.referenceFiles ?? []).filter((f) => f.purpose === 'REFERENCE')
)
const editingAssetFiles = computed(() =>
  (editingExample.value?.referenceFiles ?? []).filter((f) => f.purpose === 'ASSET')
)
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Example prompts"
      description="Manage the gallery examples shown to all users. Templates can pre-select a design system, prompt preset, provider, model, and reference / asset files."
      :back="{ to: '/admin' }"
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="startCreate">Add example</PxButton>
      </template>
    </PxPageHeader>

    <div class="overflow-hidden rounded-xl border border-border bg-surface">
      <table class="w-full text-sm">
        <thead class="border-b border-border bg-bg-subtle/50 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            <th class="px-4 py-3 text-left">Title</th>
            <th class="px-4 py-3 text-left">Category</th>
            <th class="px-4 py-3 text-left">Bundle</th>
            <th class="px-4 py-3 text-left">Published</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="e in examples" :key="e.id" class="hover:bg-bg-subtle/50">
            <td class="px-4 py-3 font-medium text-fg">{{ e.title }}</td>
            <td class="px-4 py-3 text-fg-muted">{{ e.category ?? '—' }}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-1">
                <PxBadge v-if="e.designSystemId" tone="neutral" variant="soft" size="xs">DS</PxBadge>
                <PxBadge v-if="e.customPromptId" tone="neutral" variant="soft" size="xs">Prompt</PxBadge>
                <PxBadge v-if="e.textProviderKind" tone="neutral" variant="soft" size="xs">{{ e.textProviderKind }}</PxBadge>
                <PxBadge v-if="e.imageEnabled" tone="neutral" variant="soft" size="xs">images</PxBadge>
                <PxBadge
                  v-if="(e.referenceFiles?.length ?? 0) > 0"
                  tone="neutral"
                  variant="soft"
                  size="xs"
                >
                  {{ e.referenceFiles?.length }} file{{ (e.referenceFiles?.length ?? 0) === 1 ? '' : 's' }}
                </PxBadge>
              </div>
            </td>
            <td class="px-4 py-3">
              <button
                type="button"
                class="text-xs font-medium"
                :class="e.isEnabled ? 'text-[color:var(--px-success-600)]' : 'text-fg-muted'"
                @click="togglePublish(e)"
              >
                {{ e.isEnabled ? '● Published' : '○ Draft' }}
              </button>
            </td>
            <td class="px-4 py-3 text-right">
              <PxButton variant="ghost" size="xs" @click="startEdit(e)">Edit</PxButton>
              <PxButton variant="ghost" size="xs" @click="deletingId = e.id">Delete</PxButton>
            </td>
          </tr>
          <tr v-if="loading">
            <td colspan="5" class="px-4 py-6 text-center text-fg-muted">Loading…</td>
          </tr>
          <tr v-else-if="examples.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-fg-muted">No examples yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <PxDialog v-model="creating" title="Add example" size="lg">
      <form class="flex flex-col gap-3" @submit.prevent="create">
        <div class="grid gap-3 md:grid-cols-2">
          <PxInput v-model="form.title" label="Title" placeholder="Title" required />
          <PxInput v-model="form.category" label="Category" placeholder="e.g. Business" required />
        </div>
        <PxTextarea v-model="form.promptEn" label="Prompt (English)" :rows="4" required />
        <PxTextarea v-model="form.promptId" label="Prompt (Indonesian) — falls back to English if blank" :rows="3" />
        <div class="grid gap-3 md:grid-cols-2">
          <PxSelect v-model="form.designSystemId" :options="designSystemOptions" label="Design system (global only)" />
          <PxSelect v-model="form.customPromptId" :options="customPromptOptions" label="Prompt preset (global only)" />
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <PxSelect
            :model-value="form.textProviderKind"
            :options="textProviderKindOptions"
            label="Text provider kind"
            @update:model-value="onTextProviderKindChange"
          />
          <PxSelect
            v-model="form.textModelId"
            :options="textModelSelectOptions"
            label="Text model"
            :disabled="!form.textProviderKind || loadingTextModels || textModelSelectOptions.length <= 1"
          />
        </div>
        <p v-if="textModelError" class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">{{ textModelError }}</p>
        <label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm">
          <span class="font-medium text-fg">Generate images during run</span>
          <PxSwitch v-model="form.imageEnabled" />
        </label>
        <div v-if="form.imageEnabled" class="grid gap-3 md:grid-cols-2">
          <PxSelect v-model="form.imageProviderKind" :options="imageProviderKindOptions" label="Image provider kind" />
          <PxInput v-model="form.imageModelId" label="Image model id" placeholder="e.g. imagen-3.0-generate" />
        </div>
        <label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm">
          <span class="font-medium text-fg">Publish immediately</span>
          <PxSwitch v-model="form.isEnabled" />
        </label>
        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <PxButton variant="ghost" type="button" @click="creating = false">Cancel</PxButton>
          <PxButton variant="primary" type="submit" :loading="submitting">Create</PxButton>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="editOpen" title="Edit example" size="lg">
      <form class="flex flex-col gap-3" @submit.prevent="saveEdit">
        <div class="grid gap-3 md:grid-cols-2">
          <PxInput v-model="form.title" label="Title" required />
          <PxInput v-model="form.category" label="Category" required />
        </div>
        <PxTextarea v-model="form.promptEn" label="Prompt (English)" :rows="4" required />
        <PxTextarea v-model="form.promptId" label="Prompt (Indonesian)" :rows="3" />
        <div class="grid gap-3 md:grid-cols-2">
          <PxSelect v-model="form.designSystemId" :options="designSystemOptions" label="Design system (global only)" />
          <PxSelect v-model="form.customPromptId" :options="customPromptOptions" label="Prompt preset (global only)" />
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <PxSelect
            :model-value="form.textProviderKind"
            :options="textProviderKindOptions"
            label="Text provider kind"
            @update:model-value="onTextProviderKindChange"
          />
          <PxSelect
            v-model="form.textModelId"
            :options="textModelSelectOptions"
            label="Text model"
            :disabled="!form.textProviderKind || loadingTextModels || textModelSelectOptions.length <= 1"
          />
        </div>
        <p v-if="textModelError" class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">{{ textModelError }}</p>
        <label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm">
          <span class="font-medium text-fg">Generate images during run</span>
          <PxSwitch v-model="form.imageEnabled" />
        </label>
        <div v-if="form.imageEnabled" class="grid gap-3 md:grid-cols-2">
          <PxSelect v-model="form.imageProviderKind" :options="imageProviderKindOptions" label="Image provider kind" />
          <PxInput v-model="form.imageModelId" label="Image model id" />
        </div>
        <label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm">
          <span class="font-medium text-fg">Published</span>
          <PxSwitch v-model="form.isEnabled" />
        </label>

        <div v-if="editingExample" class="space-y-4 border-t border-border pt-4">
          <div>
            <div class="mb-2 flex items-center justify-between">
              <p class="text-sm font-semibold text-fg">Reference files</p>
              <label class="cursor-pointer text-xs font-semibold text-accent hover:underline">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
                  class="sr-only"
                  :disabled="referenceUploadId === editingExample.id"
                  @change="(ev) => editingExample && onReferenceUpload(ev, editingExample.id)"
                />
                {{ referenceUploadId === editingExample.id ? 'Uploading…' : 'Upload files' }}
              </label>
            </div>
            <div v-if="editingReferenceFiles.length === 0" class="text-xs text-fg-muted">No reference files yet.</div>
            <ul v-else class="space-y-1 text-xs">
              <li
                v-for="f in editingReferenceFiles"
                :key="f.id"
                class="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle/30 px-3 py-2"
              >
                <span class="truncate text-fg">{{ f.originalFilename }}</span>
                <button
                  type="button"
                  class="shrink-0 text-fg-muted hover:text-rose-600"
                  @click="editingExample && deleteFile(editingExample.id, f.id)"
                >
                  Remove
                </button>
              </li>
            </ul>
          </div>
          <div>
            <div class="mb-2 flex items-center justify-between">
              <p class="text-sm font-semibold text-fg">Assets / pre-baked images</p>
              <label class="cursor-pointer text-xs font-semibold text-accent hover:underline">
                <input
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.svg"
                  class="sr-only"
                  :disabled="assetUploadId === editingExample.id"
                  @change="(ev) => editingExample && onAssetUpload(ev, editingExample.id)"
                />
                {{ assetUploadId === editingExample.id ? 'Uploading…' : 'Upload files' }}
              </label>
            </div>
            <div v-if="editingAssetFiles.length === 0" class="text-xs text-fg-muted">No asset files yet.</div>
            <ul v-else class="space-y-1 text-xs">
              <li
                v-for="f in editingAssetFiles"
                :key="f.id"
                class="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle/30 px-3 py-2"
              >
                <span class="truncate text-fg">{{ f.originalFilename }}</span>
                <button
                  type="button"
                  class="shrink-0 text-fg-muted hover:text-rose-600"
                  @click="editingExample && deleteFile(editingExample.id, f.id)"
                >
                  Remove
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <PxButton variant="ghost" type="button" @click="editingId = null">Close</PxButton>
          <PxButton variant="primary" type="submit" :loading="submitting">Save</PxButton>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="deleteOpen" title="Delete example?" size="sm">
      <p class="text-sm text-fg-muted">This action cannot be undone. Attached files will be removed too.</p>
      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <PxButton variant="ghost" @click="deletingId = null">Cancel</PxButton>
        <PxButton variant="danger" @click="deleteExample">Delete</PxButton>
      </div>
    </PxDialog>
  </div>
</template>
