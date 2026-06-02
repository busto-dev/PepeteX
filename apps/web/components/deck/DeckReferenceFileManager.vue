<script setup lang="ts">
import type { ReferenceFileSummary } from '~/types'

const props = defineProps<{ deckId: string | null; canManage: boolean }>()
const emit = defineEmits<{ (e: 'change'): void }>()

const toast = useToast()
const referenceFiles = ref<ReferenceFileSummary[]>([])
const assets = ref<ReferenceFileSummary[]>([])
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

watch(() => props.deckId, async (id) => {
  if (!id) { referenceFiles.value = []; assets.value = []; return }
  await loadReferences(id)
  await loadAssets(id)
}, { immediate: true })

async function loadReferences(deckId: string) {
  loadingReferences.value = true
  try {
    const data = await $fetch<{ referenceFiles: ReferenceFileSummary[] }>(`/api/decks/${deckId}/reference-files`)
    referenceFiles.value = data.referenceFiles
  } finally {
    loadingReferences.value = false
  }
}

async function loadAssets(deckId: string) {
  loadingAssets.value = true
  try {
    const data = await $fetch<{ assets: ReferenceFileSummary[] }>(`/api/decks/${deckId}/assets`)
    assets.value = data.assets
  } finally {
    loadingAssets.value = false
  }
}

async function uploadReference() {
  if (!props.deckId || !pendingReferenceFile.value) return
  uploadingReference.value = true
  try {
    const form = new FormData()
    form.set('file', pendingReferenceFile.value)
    await $fetch(`/api/decks/${props.deckId}/reference-files`, { method: 'POST', body: form })
    pendingReferenceFile.value = null
    referenceInputKey.value++
    await loadReferences(props.deckId)
    emit('change')
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Upload failed', description: err?.data?.statusMessage ?? 'Unknown error', color: 'error' })
  } finally {
    uploadingReference.value = false
  }
}

async function uploadAsset() {
  if (!props.deckId || !pendingAssetFile.value) return
  uploadingAsset.value = true
  try {
    const form = new FormData()
    form.set('file', pendingAssetFile.value)
    await $fetch(`/api/decks/${props.deckId}/assets`, { method: 'POST', body: form })
    pendingAssetFile.value = null
    assetInputKey.value++
    await loadAssets(props.deckId)
    emit('change')
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Upload failed', description: err?.data?.statusMessage ?? 'Unknown error', color: 'error' })
  } finally {
    uploadingAsset.value = false
  }
}

async function removeReference(fileId: string) {
  if (!props.deckId) return
  deletingReferenceId.value = fileId
  try {
    await $fetch(`/api/decks/${props.deckId}/reference-files/${fileId}`, { method: 'DELETE' })
    await loadReferences(props.deckId)
    emit('change')
  } finally {
    deletingReferenceId.value = null
  }
}

async function removeAsset(fileId: string) {
  if (!props.deckId) return
  deletingAssetId.value = fileId
  try {
    await $fetch(`/api/decks/${props.deckId}/assets/${fileId}`, { method: 'DELETE' })
    await loadAssets(props.deckId)
    emit('change')
  } finally {
    deletingAssetId.value = null
  }
}

function onSelectReference(e: Event) {
  pendingReferenceFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

function onSelectAsset(e: Event) {
  pendingAssetFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-6">
    <!-- Reference Files -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Reference Files</p>
      <p class="text-xs text-slate-400">Upload documents and images to use as LLM context for generation.</p>

      <div v-if="canManage && deckId" class="space-y-2">
        <input
          :key="referenceInputKey"
          type="file"
          accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
          class="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          @change="onSelectReference"
        />
        <button
          type="button"
          class="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
          :disabled="uploadingReference || !pendingReferenceFile"
          @click="uploadReference"
        >{{ uploadingReference ? 'Uploading…' : 'Upload reference file' }}</button>
      </div>

      <div v-if="loadingReferences" class="text-sm text-slate-400">Loading…</div>
      <div v-else-if="referenceFiles.length === 0" class="text-sm text-slate-400">No reference files yet.</div>
      <ul v-else class="space-y-2">
        <li
          v-for="f in referenceFiles"
          :key="f.id"
          class="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
        >
          <div class="min-w-0">
            <p class="truncate font-medium text-slate-800">{{ f.originalFilename }}</p>
            <p class="text-xs text-slate-400">
              {{ formatSize(f.sizeBytes) }}
              <span v-if="f.pageCount"> · {{ f.pageCount }} pages</span>
              <span v-if="f.imageWidth"> · {{ f.imageWidth }}×{{ f.imageHeight }}</span>
            </p>
          </div>
          <button
            v-if="canManage"
            type="button"
            class="shrink-0 text-xs font-medium text-rose-600 hover:text-rose-800 disabled:text-slate-400"
            :disabled="deletingReferenceId === f.id"
            @click="removeReference(f.id)"
          >{{ deletingReferenceId === f.id ? '…' : 'Delete' }}</button>
        </li>
      </ul>
    </div>

    <!-- Assets -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Assets</p>
      <p class="text-xs text-slate-400">Upload reusable images and SVGs that can be placed in slides.</p>

      <div v-if="canManage && deckId" class="space-y-2">
        <input
          :key="assetInputKey"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg"
          class="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          @change="onSelectAsset"
        />
        <button
          type="button"
          class="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
          :disabled="uploadingAsset || !pendingAssetFile"
          @click="uploadAsset"
        >{{ uploadingAsset ? 'Uploading…' : 'Upload asset' }}</button>
      </div>

      <div v-if="loadingAssets" class="text-sm text-slate-400">Loading…</div>
      <div v-else-if="assets.length === 0" class="text-sm text-slate-400">No assets yet.</div>
      <ul v-else class="space-y-2">
        <li
          v-for="f in assets"
          :key="f.id"
          class="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
        >
          <div class="min-w-0">
            <p class="truncate font-medium text-slate-800">{{ f.originalFilename }}</p>
            <p class="text-xs text-slate-400">
              {{ f.assetRole ?? 'asset' }}
              <span v-if="f.imageWidth"> · {{ f.imageWidth }}×{{ f.imageHeight }}</span>
            </p>
          </div>
          <button
            v-if="canManage"
            type="button"
            class="shrink-0 text-xs font-medium text-rose-600 hover:text-rose-800 disabled:text-slate-400"
            :disabled="deletingAssetId === f.id"
            @click="removeAsset(f.id)"
          >{{ deletingAssetId === f.id ? '…' : 'Delete' }}</button>
        </li>
      </ul>
    </div>
  </div>
</template>
