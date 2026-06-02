<script setup lang="ts">
import type { DesignSystemReferenceFileSummary } from '~/types'

const props = defineProps<{
  designSystemId: string | null
  canManage: boolean
}>()

const emit = defineEmits<{
  (e: 'change', files: DesignSystemReferenceFileSummary[]): void
}>()

const toast = useToast()
const referenceFiles = ref<DesignSystemReferenceFileSummary[]>([])
const assets = ref<DesignSystemReferenceFileSummary[]>([])
const loadingReferences = ref(false)
const loadingAssets = ref(false)
const uploadingReference = ref(false)
const uploadingAsset = ref(false)
const deletingReferenceId = ref<string | null>(null)
const deletingAssetId = ref<string | null>(null)
const referenceInputKey = ref(0)
const assetInputKey = ref(0)
const pendingReferenceFile = ref<File | null>(null)
const pendingAssetFile = ref<File | null>(null)
const pendingAssetRole = ref<'logo' | 'image' | 'font' | 'other'>('other')

const assetRoleOptions: Array<{ value: 'logo' | 'image' | 'font' | 'other'; label: string }> = [
  { value: 'logo', label: 'Logo' },
  { value: 'image', label: 'Image' },
  { value: 'font', label: 'Font' },
  { value: 'other', label: 'Other' }
]

const assetAccept = computed(() =>
  pendingAssetRole.value === 'font'
    ? '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'
    : '.png,.jpg,.jpeg,.webp,.svg'
)

watch(() => props.designSystemId, async (designSystemId) => {
  if (!designSystemId) {
    referenceFiles.value = []
    assets.value = []
    return
  }

  await loadReferences(designSystemId)
  await loadAssets(designSystemId)
}, { immediate: true })

async function loadReferences(designSystemId: string) {
  loadingReferences.value = true
  try {
    const data = await $fetch<{ referenceFiles: DesignSystemReferenceFileSummary[] }>(`/api/design-systems/${designSystemId}/reference-files`)
    referenceFiles.value = data.referenceFiles
    emit('change', [...referenceFiles.value, ...assets.value])
  } finally {
    loadingReferences.value = false
  }
}

async function loadAssets(designSystemId: string) {
  loadingAssets.value = true
  try {
    const data = await $fetch<{ assets: DesignSystemReferenceFileSummary[] }>(`/api/design-systems/${designSystemId}/assets`)
    assets.value = data.assets
    emit('change', [...referenceFiles.value, ...assets.value])
  } finally {
    loadingAssets.value = false
  }
}

async function uploadReference() {
  if (!props.designSystemId || !pendingReferenceFile.value) return

  uploadingReference.value = true
  try {
    const form = new FormData()
    form.set('file', pendingReferenceFile.value)
    form.set('role', 'other')
    await $fetch(`/api/design-systems/${props.designSystemId}/reference-files`, {
      method: 'POST',
      body: form
    })
    pendingReferenceFile.value = null
    referenceInputKey.value += 1
    await loadReferences(props.designSystemId)
  } catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Upload failed',
      description: err?.data?.statusMessage ?? 'Unknown error',
      color: 'error'
    })
  } finally {
    uploadingReference.value = false
  }
}

async function uploadAsset() {
  if (!props.designSystemId || !pendingAssetFile.value) return

  uploadingAsset.value = true
  try {
    const form = new FormData()
    form.set('file', pendingAssetFile.value)
    form.set('assetRole', pendingAssetRole.value)
    await $fetch(`/api/design-systems/${props.designSystemId}/assets`, {
      method: 'POST',
      body: form
    })
    pendingAssetFile.value = null
    pendingAssetRole.value = 'other'
    assetInputKey.value += 1
    await loadAssets(props.designSystemId)
  } catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Upload failed',
      description: err?.data?.statusMessage ?? 'Unknown error',
      color: 'error'
    })
  } finally {
    uploadingAsset.value = false
  }
}

async function removeReference(fileId: string) {
  if (!props.designSystemId) return

  deletingReferenceId.value = fileId
  try {
    await $fetch(`/api/design-systems/${props.designSystemId}/reference-files/${fileId}`, {
      method: 'DELETE'
    })
    await loadReferences(props.designSystemId)
  } catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Delete failed',
      description: err?.data?.statusMessage ?? 'Unknown error',
      color: 'error'
    })
  } finally {
    deletingReferenceId.value = null
  }
}

async function removeAsset(fileId: string) {
  if (!props.designSystemId) return

  deletingAssetId.value = fileId
  try {
    await $fetch(`/api/design-systems/${props.designSystemId}/assets/${fileId}`, {
      method: 'DELETE'
    })
    await loadAssets(props.designSystemId)
  } catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Delete failed',
      description: err?.data?.statusMessage ?? 'Unknown error',
      color: 'error'
    })
  } finally {
    deletingAssetId.value = null
  }
}

function onSelectReference(event: Event) {
  pendingReferenceFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function onSelectAsset(event: Event) {
  pendingAssetFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-6 rounded-[28px] border border-stone-200 bg-white p-4 shadow-sm">
    <!-- Header -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">References & assets</p>
        <p class="mt-1 text-sm font-bold text-stone-600">Upload brand guides plus reusable logo/image assets for deck generation.</p>
      </div>
      <span class="rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-black text-stone-500">{{ referenceFiles.length + assets.length }}</span>
    </div>

    <!-- Reference Files -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wider text-stone-500">Reference Files</p>
      <p class="text-xs text-stone-400">PDFs, text guides, and images used as LLM context.</p>

      <div v-if="canManage && designSystemId" class="space-y-2">
        <input
          :key="referenceInputKey"
          type="file"
          accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
          class="block w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-slate-950 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
          @change="onSelectReference"
        >
        <button
          type="button"
          class="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
          :disabled="uploadingReference || !pendingReferenceFile"
          @click="uploadReference"
        >{{ uploadingReference ? 'Uploading...' : 'Upload reference' }}</button>
      </div>

      <div v-if="loadingReferences" class="text-sm text-stone-400">Loading references...</div>
      <div v-else-if="referenceFiles.length === 0" class="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm text-stone-500">
        No references yet.
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="file in referenceFiles"
          :key="file.id"
          class="flex items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm"
        >
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-white">
              <img
                v-if="file.previewUrl"
                :src="file.previewUrl"
                :alt="file.originalFilename"
                class="h-full w-full object-cover"
                loading="lazy"
              >
              <span v-else class="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">{{ file.extension || file.role }}</span>
            </div>
            <div class="min-w-0">
              <p class="truncate font-black text-slate-900">{{ file.originalFilename }}</p>
              <p class="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{{ file.role }}</p>
              <p class="mt-1 text-xs text-stone-500">
                {{ formatSize(file.sizeBytes) }}
                <span v-if="file.pageCount"> - {{ file.pageCount }} pages</span>
                <span v-if="file.imageWidth"> - {{ file.imageWidth }}x{{ file.imageHeight }}</span>
              </p>
            </div>
          </div>
          <button
            v-if="canManage"
            type="button"
            class="shrink-0 rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-black text-rose-600 disabled:opacity-50"
            :disabled="deletingReferenceId === file.id"
            @click="removeReference(file.id)"
          >{{ deletingReferenceId === file.id ? 'Deleting...' : 'Delete' }}</button>
        </li>
      </ul>
    </div>

    <!-- Assets -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wider text-stone-500">Assets</p>
      <p class="text-xs text-stone-400">Reusable images plus fonts for typography tokens.</p>

      <div v-if="canManage && designSystemId" class="space-y-2">
        <select v-model="pendingAssetRole" class="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700 outline-none focus:border-[#d97855]">
          <option v-for="option in assetRoleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <input
          :key="assetInputKey"
          type="file"
          :accept="assetAccept"
          class="block w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-slate-950 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
          @change="onSelectAsset"
        >
        <button
          type="button"
          class="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
          :disabled="uploadingAsset || !pendingAssetFile"
          @click="uploadAsset"
        >{{ uploadingAsset ? 'Uploading...' : 'Upload asset' }}</button>
      </div>

      <div v-if="loadingAssets" class="text-sm text-stone-400">Loading assets...</div>
      <div v-else-if="assets.length === 0" class="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm text-stone-500">
        No assets yet.
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="file in assets"
          :key="file.id"
          class="flex items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm"
        >
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-white">
              <img
                v-if="file.previewUrl"
                :src="file.previewUrl"
                :alt="file.originalFilename"
                class="h-full w-full object-cover"
                loading="lazy"
              >
              <span v-else class="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">{{ file.extension || file.assetRole || file.role }}</span>
            </div>
            <div class="min-w-0">
              <p class="truncate font-black text-slate-900">{{ file.originalFilename }}</p>
              <p class="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{{ file.assetRole ?? file.role }}</p>
              <p class="mt-1 text-xs text-stone-500">
                {{ formatSize(file.sizeBytes) }}
                <span v-if="file.imageWidth"> - {{ file.imageWidth }}x{{ file.imageHeight }}</span>
              </p>
            </div>
          </div>
          <button
            v-if="canManage"
            type="button"
            class="shrink-0 rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-black text-rose-600 disabled:opacity-50"
            :disabled="deletingAssetId === file.id"
            @click="removeAsset(file.id)"
          >{{ deletingAssetId === file.id ? 'Deleting...' : 'Delete' }}</button>
        </li>
      </ul>
    </div>
  </div>
</template>
