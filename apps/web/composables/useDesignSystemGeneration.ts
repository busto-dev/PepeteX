import type { DesignSystemGenerationRunKind, DesignSystemGenerationRunSummary } from '~/types'

export interface SubmitDesignSystemGenerationInput {
  designSystemId: string
  kind: DesignSystemGenerationRunKind
  textProviderId?: string | null
  textModelId?: string | null
  imageEnabled?: boolean
  imageProviderId?: string | null
  imageModelId?: string | null
  languageCode?: string
  manualInstruction?: string
  feedbackContext?: unknown
  attachments?: Array<{ mimeType: string; dataBase64: string }>
}

const POLL_INTERVAL_MS = 1500
const TERMINAL_STATUSES: DesignSystemGenerationRunSummary['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_ASK']

type RunResponse = DesignSystemGenerationRunSummary | { run: DesignSystemGenerationRunSummary }

function unwrap(response: RunResponse): DesignSystemGenerationRunSummary {
  return 'run' in response ? response.run : response
}

export const useDesignSystemGeneration = () => {
  const activeRun = useState<DesignSystemGenerationRunSummary | null>('ds-generation:active-run', () => null)
  const activeTimeline = useState<DesignSystemGenerationRunSummary[]>('ds-generation:timeline', () => [])
  const submitting = useState('ds-generation:submitting', () => false)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let streamSource: EventSource | null = null
  let streamedRunId: string | null = null

  function stopPollTimer() {
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null }
  }
  function stopStream() {
    if (streamSource !== null) { streamSource.close(); streamSource = null; streamedRunId = null }
  }
  function stopPolling() { stopPollTimer(); stopStream() }

  function upsertTimelineRun(run: DesignSystemGenerationRunSummary) {
    const next = activeTimeline.value.filter((entry) => entry.id !== run.id)
    next.push(run)
    activeTimeline.value = next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  function handleRunUpdate(run: DesignSystemGenerationRunSummary, onComplete?: (run: DesignSystemGenerationRunSummary) => void): boolean {
    activeRun.value = run
    upsertTimelineRun(run)
    if (!TERMINAL_STATUSES.includes(run.status)) return false
    onComplete?.(run)
    return true
  }

  async function pollRun(designSystemId: string, runId: string): Promise<DesignSystemGenerationRunSummary> {
    const data = await $fetch<RunResponse>(`/api/design-systems/${designSystemId}/generations/${runId}`)
    const run = unwrap(data)
    activeRun.value = run
    upsertTimelineRun(run)
    return run
  }

  function startPollLoop(designSystemId: string, runId: string, onComplete?: (run: DesignSystemGenerationRunSummary) => void) {
    stopPollTimer()
    pollTimer = setTimeout(async () => {
      try {
        const run = await pollRun(designSystemId, runId)
        if (TERMINAL_STATUSES.includes(run.status)) onComplete?.(run)
        else startPollLoop(designSystemId, runId, onComplete)
      } catch {
        startPollLoop(designSystemId, runId, onComplete)
      }
    }, POLL_INTERVAL_MS)
  }

  function streamRun(designSystemId: string, runId: string, onComplete?: (run: DesignSystemGenerationRunSummary) => void) {
    if (!import.meta.client || typeof EventSource === 'undefined') {
      stopStream(); startPollLoop(designSystemId, runId, onComplete); return
    }
    stopPolling()
    const source = new EventSource(`/api/design-systems/${encodeURIComponent(designSystemId)}/generations/${encodeURIComponent(runId)}/stream`)
    streamSource = source
    streamedRunId = runId

    source.addEventListener('generation-run', (event) => {
      if (streamSource !== source || streamedRunId !== runId) return
      const run = JSON.parse((event as MessageEvent<string>).data) as DesignSystemGenerationRunSummary
      if (handleRunUpdate(run, onComplete)) stopStream()
    })
    source.addEventListener('done', () => {
      if (streamSource !== source || streamedRunId !== runId) return
      stopStream()
    })
    source.onerror = () => {
      if (streamSource !== source || streamedRunId !== runId) return
      stopStream(); startPollLoop(designSystemId, runId, onComplete)
    }
  }

  async function submitGeneration(
    input: SubmitDesignSystemGenerationInput,
    onComplete?: (run: DesignSystemGenerationRunSummary) => void
  ): Promise<DesignSystemGenerationRunSummary> {
    submitting.value = true
    try {
      const data = await $fetch<DesignSystemGenerationRunSummary>(`/api/design-systems/${input.designSystemId}/generations`, {
        method: 'POST',
        body: input
      })
      handleRunUpdate(data, onComplete)
      if (!TERMINAL_STATUSES.includes(data.status)) streamRun(data.designSystemId, data.id, onComplete)
      return data
    } finally {
      submitting.value = false
    }
  }

  function trackRun(run: DesignSystemGenerationRunSummary, onComplete?: (run: DesignSystemGenerationRunSummary) => void) {
    if (!handleRunUpdate(run, onComplete)) streamRun(run.designSystemId, run.id, onComplete)
  }

  async function resumeAskMode(designSystemId: string, runId: string, answer: string, onComplete?: (run: DesignSystemGenerationRunSummary) => void) {
    const data = await $fetch<RunResponse>(`/api/design-systems/${designSystemId}/generations/${runId}/resume`, { method: 'POST', body: { answer } })
    const run = unwrap(data)
    handleRunUpdate(run, onComplete)
    if (!TERMINAL_STATUSES.includes(run.status)) streamRun(designSystemId, runId, onComplete)
    return run
  }

  async function cancelGeneration(designSystemId: string, runId: string, onComplete?: (run: DesignSystemGenerationRunSummary) => void) {
    const data = await $fetch<RunResponse>(`/api/design-systems/${designSystemId}/generations/${runId}/cancel`, { method: 'POST' })
    const run = unwrap(data)
    if (streamedRunId === runId) stopStream()
    handleRunUpdate(run, onComplete)
    return run
  }

  async function loadHistory(designSystemId: string) {
    try {
      const data = await $fetch<{ runs: DesignSystemGenerationRunSummary[] }>(`/api/design-systems/${designSystemId}/generations`)
      activeTimeline.value = [...data.runs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      const live = data.runs.find((r) => !TERMINAL_STATUSES.includes(r.status) || r.status === 'WAITING_ASK')
      if (live) trackRun(live)
      else activeRun.value = data.runs[0] ?? null
    } catch {
      activeTimeline.value = []
    }
  }

  function clearRun() { stopPolling(); activeRun.value = null }

  return {
    activeRun,
    activeTimeline,
    submitting,
    submitGeneration,
    trackRun,
    resumeAskMode,
    cancelGeneration,
    pollRun,
    loadHistory,
    stopPolling,
    clearRun
  }
}
