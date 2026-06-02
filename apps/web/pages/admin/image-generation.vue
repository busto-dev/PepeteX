<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

const toast = useToast()
const loading = ref(false)
const saving = ref(false)

const settings = ref<{
  enabled: boolean
  defaultProviderId: string | null
  defaultModelId: string | null
  maxImagesPerRun: number
  allowWorkspaceOverride: boolean
} | null>(null)

async function load() {
  loading.value = true
  try {
    const data = await $fetch<{ settings: typeof settings.value }>('/api/admin/image-generation-settings')
    settings.value = data.settings
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!settings.value) return
  saving.value = true
  try {
    await $fetch('/api/admin/image-generation-settings', { method: 'PATCH', body: settings.value })
    toast.add({ title: 'Settings saved', color: 'success' })
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Failed to save', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto w-full max-w-3xl pb-12">
    <PxPageHeader
      title="Image generation"
      description="Configure global image generation settings."
      :back="{ to: '/admin' }"
    />

    <div v-if="loading" class="space-y-3">
      <PxSkeleton class="h-12" />
      <PxSkeleton class="h-12" />
      <PxSkeleton class="h-12" />
    </div>
    <PxCard v-else-if="settings" padding="lg">
      <form class="flex flex-col gap-5" @submit.prevent="save">
        <label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm">
          <span>
            <span class="block font-medium text-fg">Enable image generation</span>
            <span class="block text-xs text-fg-muted">Allow users to generate images during deck creation.</span>
          </span>
          <PxSwitch v-model="settings.enabled" />
        </label>

        <label class="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm">
          <span>
            <span class="block font-medium text-fg">Allow workspace override</span>
            <span class="block text-xs text-fg-muted">Workspace admins can override these defaults.</span>
          </span>
          <PxSwitch v-model="settings.allowWorkspaceOverride" />
        </label>

        <PxInput
          v-model.number="settings.maxImagesPerRun"
          type="number"
          label="Max images per generation run"
          hint="Hard limit on the number of images created per run."
        />

        <div class="flex justify-end border-t border-border pt-4">
          <PxButton type="submit" variant="primary" :loading="saving">Save settings</PxButton>
        </div>
      </form>
    </PxCard>
  </div>
</template>
