<script setup lang="ts">
import type { CustomPromptSummary } from '~/types'

const { currentWorkspaceId } = useWorkspaces()
const toast = useToast()

type Scope = 'personal' | 'workspace' | 'global'
const activeScope = ref<Scope>('personal')
const prompts = ref<CustomPromptSummary[]>([])
const loading = ref(false)

const editing = ref<CustomPromptSummary | null>(null)
const creating = ref(false)
const form = reactive({
  title: '',
  description: '',
  promptTextEn: '',
  promptTextId: '',
  scope: 'personal' as Scope,
  workspaceId: null as string | null
})
const submitting = ref(false)
const deletingId = ref<string | null>(null)

const scopeOptions = [
  { value: 'personal', label: 'Personal' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'global', label: 'Global' }
]

const deleteOpen = computed({
  get: () => deletingId.value !== null,
  set: (v: boolean) => { if (!v) deletingId.value = null }
})

async function load() {
  loading.value = true
  try {
    const query: Record<string, string> = { scope: activeScope.value }
    if (activeScope.value === 'workspace' && currentWorkspaceId.value) {
      query.workspaceId = currentWorkspaceId.value
    }
    const data = await $fetch<{ customPrompts: CustomPromptSummary[] }>('/api/custom-prompts', { query })
    prompts.value = data.customPrompts
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([activeScope, currentWorkspaceId], load)

function openCreate() {
  Object.assign(form, {
    title: '',
    description: '',
    promptTextEn: '',
    promptTextId: '',
    scope: activeScope.value,
    workspaceId: activeScope.value === 'workspace' ? currentWorkspaceId.value : null
  })
  editing.value = null
  creating.value = true
}

function openEdit(p: CustomPromptSummary) {
  Object.assign(form, {
    title: p.title,
    description: p.description ?? '',
    promptTextEn: p.variants?.find((v) => v.languageCode === 'en')?.instruction ?? '',
    promptTextId: p.variants?.find((v) => v.languageCode === 'id')?.instruction ?? '',
    scope: p.scope,
    workspaceId: p.workspaceId ?? null
  })
  editing.value = p
  creating.value = true
}

function buildVariants() {
  const variants: { languageCode: string; instruction: string }[] = []
  if (form.promptTextEn.trim()) variants.push({ languageCode: 'en', instruction: form.promptTextEn.trim() })
  if (form.promptTextId.trim()) variants.push({ languageCode: 'id', instruction: form.promptTextId.trim() })
  return variants
}

async function save() {
  submitting.value = true
  try {
    if (editing.value) {
      const body = {
        title: form.title,
        description: form.description || null,
        variants: buildVariants()
      }
      await $fetch(`/api/custom-prompts/${editing.value.id}`, { method: 'PATCH', body })
      toast.add({ title: 'Prompt updated', color: 'success' })
    } else {
      const body = {
        scope: form.scope,
        ...(form.scope === 'workspace' && form.workspaceId ? { workspaceId: form.workspaceId } : {}),
        title: form.title,
        ...(form.description ? { description: form.description } : {}),
        variants: buildVariants()
      }
      await $fetch('/api/custom-prompts', { method: 'POST', body })
      toast.add({ title: 'Prompt created', color: 'success' })
    }
    creating.value = false
    editing.value = null
    await load()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function deletePrompt() {
  if (!deletingId.value) return
  try {
    await $fetch(`/api/custom-prompts/${deletingId.value}`, { method: 'DELETE' })
    deletingId.value = null
    toast.add({ title: 'Deleted', color: 'success' })
    await load()
  } catch {
    toast.add({ title: 'Failed to delete', color: 'error' })
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl pb-12">
    <PxPageHeader
      title="Custom prompts"
      description="Create and manage custom AI prompts for generation."
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="openCreate">New prompt</PxButton>
      </template>
    </PxPageHeader>

    <div class="mb-6">
      <PxSegmented v-model="activeScope" :options="scopeOptions" />
    </div>

    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <PxSkeleton v-for="i in 6" :key="i" class="h-32" />
    </div>
    <PxEmptyState
      v-else-if="prompts.length === 0"
      icon="i-heroicons-sparkles"
      :title="`No ${activeScope} prompts yet`"
      description="Create reusable prompt templates for your team."
    >
      <template #actions>
        <PxButton variant="primary" icon="i-heroicons-plus" @click="openCreate">New prompt</PxButton>
      </template>
    </PxEmptyState>
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <PxCard v-for="p in prompts" :key="p.id" padding="md">
        <div class="flex h-full flex-col gap-2">
          <div class="flex items-start justify-between gap-2">
            <p class="font-semibold text-fg">{{ p.title }}</p>
            <div class="flex shrink-0 gap-1">
              <PxButton variant="ghost" size="xs" @click="openEdit(p)">Edit</PxButton>
              <PxButton variant="ghost" size="xs" @click="deletingId = p.id">Delete</PxButton>
            </div>
          </div>
          <p v-if="p.description" class="line-clamp-2 text-xs text-fg-muted">{{ p.description }}</p>
          <div class="mt-auto flex flex-wrap gap-1 pt-2">
            <PxBadge v-if="p.variants?.find(v => v.languageCode === 'en')" tone="neutral" variant="soft" size="xs">EN</PxBadge>
            <PxBadge v-if="p.variants?.find(v => v.languageCode === 'id')" tone="neutral" variant="soft" size="xs">ID</PxBadge>
          </div>
        </div>
      </PxCard>
    </div>

    <PxDialog v-model="creating" :title="editing ? 'Edit prompt' : 'New prompt'" size="lg">
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <PxInput v-model="form.title" label="Name" placeholder="Prompt name" required />
        <PxInput v-model="form.description" label="Description" placeholder="Optional" />
        <PxTextarea
          v-model="form.promptTextEn"
          label="English variant"
          placeholder="English prompt text…"
          :rows="4"
        />
        <PxTextarea
          v-model="form.promptTextId"
          label="Indonesian variant"
          placeholder="Indonesian prompt text (optional)…"
          :rows="4"
        />
        <PxSelect v-model="form.scope" :options="scopeOptions" label="Scope" />
        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <PxButton variant="ghost" type="button" @click="creating = false; editing = null">Cancel</PxButton>
          <PxButton variant="primary" type="submit" :loading="submitting">Save</PxButton>
        </div>
      </form>
    </PxDialog>

    <PxDialog v-model="deleteOpen" title="Delete prompt?" size="sm">
      <p class="text-sm text-fg-muted">This action cannot be undone.</p>
      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <PxButton variant="ghost" @click="deletingId = null">Cancel</PxButton>
        <PxButton variant="danger" @click="deletePrompt">Delete</PxButton>
      </div>
    </PxDialog>
  </div>
</template>
