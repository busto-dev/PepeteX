<script setup lang="ts">
const props = defineProps<{ deckId: string | null }>()
const toast = useToast()

type ExportFormat = 'pptx' | 'pdf'

// `exportingFormat` is the format whose POST request is currently in flight.
// It is used ONLY to disable that one button briefly while the enqueue request
// is pending — it is intentionally NOT tied to the background job status, so a
// queued/processing/stuck job never locks the export buttons.
const exportingFormat = ref<ExportFormat | null>(null)
const exportingHtml = ref(false)
const activeJobId = ref<string | null>(null)
const activeFormat = ref<ExportFormat | null>(null)
const jobStatus = ref<'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null>(null)
const jobError = ref<string | null>(null)
const exportHistory = ref<Array<{
  id: string
  createdAt: string
  exportedAt?: string
  status: string
  format?: 'PPTX' | 'PDF'
  fileName?: string
  fileSize?: number
  sizeBytes?: number
  fallbackReason?: string | null
}>>([])
const loadingHistory = ref(false)
let pollInterval: ReturnType<typeof setInterval> | null = null

watch(() => props.deckId, async (id) => {
  if (id) await loadHistory()
  else exportHistory.value = []
}, { immediate: true })

async function loadHistory() {
  if (!props.deckId) return
  loadingHistory.value = true
  try {
    const data = await $fetch<{ exports: typeof exportHistory.value }>(`/api/decks/${props.deckId}/exports`)
    exportHistory.value = data.exports ?? []
  } catch {
    /* export history endpoint may not exist yet */
  } finally {
    loadingHistory.value = false
  }
}

async function exportAs(format: ExportFormat) {
  if (!props.deckId) return
  // Guard against a double-fire of the same format's in-flight request only.
  if (exportingFormat.value === format) return
  exportingFormat.value = format
  try {
    const data = await $fetch<{ jobId: string; exportedFileId: string }>(
      `/api/decks/${props.deckId}/export/${format}`,
      { method: 'POST' }
    )
    activeJobId.value = data.jobId
    activeFormat.value = format
    jobStatus.value = 'PENDING'
    jobError.value = null
    const label = format === 'pdf' ? 'PDF' : 'PPTX'
    toast.add({
      title: `${label} export started`,
      description: 'Processing your deck…',
      color: 'success'
    })
    startPolling(data.jobId, format)
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Export failed',
      description: err?.data?.statusMessage ?? 'Unknown error',
      color: 'error'
    })
  } finally {
    exportingFormat.value = null
  }
}

function startPolling(jobId: string, format: ExportFormat) {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(async () => {
    try {
      const data = await $fetch<{ status: string; downloadUrl?: string | null; errorMessage?: string | null }>(`/api/jobs/${jobId}/status`)
      jobStatus.value = data.status as typeof jobStatus.value
      jobError.value = data.errorMessage ?? null
      if (data.status === 'COMPLETED') {
        clearInterval(pollInterval!)
        pollInterval = null
        const label = format === 'pdf' ? 'PDF' : 'PPTX'
        toast.add({ title: `${label} ready!`, description: 'Your export is ready to download.', color: 'success' })
        await loadHistory()
      } else if (data.status === 'FAILED') {
        clearInterval(pollInterval!)
        pollInterval = null
        toast.add({ title: 'Export failed', description: data.errorMessage ?? 'Check the job monitor for details.', color: 'error' })
        await loadHistory()
      }
    } catch (e: unknown) {
      clearInterval(pollInterval!)
      pollInterval = null
      jobStatus.value = 'FAILED'
      const err = e as { data?: { statusMessage?: string } }
      jobError.value = err?.data?.statusMessage ?? 'Could not refresh export status.'
      toast.add({ title: 'Export status unavailable', description: jobError.value, color: 'error' })
    }
  }, 3000)
}

async function retryExport() {
  const format = activeFormat.value ?? 'pptx'
  activeJobId.value = null
  activeFormat.value = null
  jobStatus.value = null
  jobError.value = null
  await exportAs(format)
}

function historyStatus(status: string) {
  if (status === 'QUEUED') return 'PENDING'
  if (status === 'RUNNING') return 'PROCESSING'
  if (status === 'COMPLETED') return 'COMPLETED'
  return 'FAILED'
}

async function downloadHtml() {
  if (!props.deckId) return
  exportingHtml.value = true
  try {
    const blob = await $fetch<Blob>(`/api/decks/${props.deckId}/export/html`, {
      responseType: 'blob'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deck-${props.deckId}.html`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: 'Download failed', description: err?.data?.statusMessage ?? 'Unknown error', color: 'error' })
  } finally {
    exportingHtml.value = false
  }
}

function formatBytes(b?: number) {
  if (!b) return ''
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`
  return `${(b / 1024 / 1024).toFixed(1)}MB`
}

function formatDate(v?: string) {
  if (!v) return ''
  return new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))
}

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Export</p>

    <!-- Active job status -->
    <div v-if="activeJobId && jobStatus" class="rounded-xl border p-3 text-sm" :class="{
      'border-blue-200 bg-blue-50 text-blue-700': ['PENDING', 'PROCESSING'].includes(jobStatus),
      'border-green-200 bg-green-50 text-green-700': jobStatus === 'COMPLETED',
      'border-rose-200 bg-rose-50 text-rose-700': jobStatus === 'FAILED',
    }">
      <div class="flex items-center justify-between">
        <span>
          {{
            jobStatus === 'PENDING' ? `⏳ ${activeFormat?.toUpperCase() ?? ''} queued…`
            : jobStatus === 'PROCESSING' ? `⚙ Generating ${activeFormat?.toUpperCase() ?? ''}…`
            : jobStatus === 'COMPLETED' ? `✓ ${activeFormat?.toUpperCase() ?? ''} ready`
            : '✗ Failed'
          }}
        </span>
        <button v-if="jobStatus === 'FAILED'" type="button" class="text-xs underline" @click="retryExport">Retry</button>
      </div>
      <p v-if="jobError" class="mt-2 text-xs opacity-80">{{ jobError }}</p>
    </div>

    <div class="space-y-2">
      <!-- Independent export buttons. Each is disabled only while its own
           enqueue request is in flight — never gated on background job status,
           so an in-progress or stuck job can't block starting another export. -->
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        :disabled="exportingFormat === 'pdf' || !deckId"
        @click="exportAs('pdf')"
      >
        <span class="flex flex-col items-start">
          <span>📄 Export as PDF</span>
          <span class="text-xs font-normal text-slate-400">1:1 fidelity, matches preview</span>
        </span>
        <span v-if="exportingFormat === 'pdf'" class="text-xs text-slate-400">Queuing…</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        :disabled="exportingFormat === 'pptx' || !deckId"
        @click="exportAs('pptx')"
      >
        <span class="flex flex-col items-start">
          <span>📊 Export as PPTX</span>
          <span class="text-xs font-normal text-slate-400">Editable in PowerPoint</span>
        </span>
        <span v-if="exportingFormat === 'pptx'" class="text-xs text-slate-400">Queuing…</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        :disabled="exportingHtml || !deckId"
        @click="downloadHtml"
      >
        <span>🌐 Download HTML</span>
        <span v-if="exportingHtml" class="text-xs text-slate-400">Downloading…</span>
      </button>
    </div>

    <p class="text-xs text-slate-400">Export runs as a background job. You'll receive a notification when it's ready.</p>

    <!-- Export history -->
    <div v-if="exportHistory.length > 0">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Export History</p>
      <div class="space-y-1.5">
        <div
          v-for="e in exportHistory"
          :key="e.id"
          class="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-xs"
        >
          <div>
            <p class="text-slate-700">{{ formatDate(e.createdAt ?? e.exportedAt ?? '') }}</p>
            <p class="text-slate-400">{{ e.fallbackReason ?? formatBytes(e.fileSize ?? e.sizeBytes) }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span
              v-if="e.format"
              class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
            >{{ e.format }}</span>
            <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="{
              'bg-green-100 text-green-700': historyStatus(e.status) === 'COMPLETED',
              'bg-rose-100 text-rose-600': historyStatus(e.status) === 'FAILED',
              'bg-blue-100 text-blue-700': ['PENDING', 'PROCESSING'].includes(historyStatus(e.status))
            }">{{ historyStatus(e.status) }}</span>
            <a
              v-if="historyStatus(e.status) === 'COMPLETED'"
              :href="`/api/exports/${e.id}/download`"
              target="_blank"
              class="text-indigo-600 hover:text-indigo-800 font-medium"
            >↓ Download</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
