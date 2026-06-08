import type { GenerationRunKind, GenerationRunSummary } from '~/types'

export interface SubmitGenerationInput {
  deckId: string
  workspaceId: string
  kind: GenerationRunKind
  textProviderId?: string | null
  textModelId?: string | null
  imageEnabled?: boolean
  imageProviderId?: string | null
  imageModelId?: string | null
  customPromptId?: string | null
  designSystemId?: string | null
  languageCode?: string
  manualInstruction?: string
  targetSlideId?: string | null
  targetElementId?: string | null
  slideInstruction?: string
  commandContextJson?: unknown
  attachments?: Array<{ mimeType: string; dataBase64: string }>
}

const POLL_INTERVAL_MS = 1500
const TERMINAL_STATUSES: GenerationRunSummary['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_ASK']

type RunResponse = GenerationRunSummary | { run: GenerationRunSummary }

function unwrapRunResponse(response: RunResponse): GenerationRunSummary {
  return 'run' in response ? response.run : response
}

export const useGeneration = () => {
  const activeRun = useState<GenerationRunSummary | null>('generation:active-run', () => null)
  const runHistory = useState<GenerationRunSummary[]>('generation:history', () => [])
  const activeTimeline = useState<GenerationRunSummary[]>('generation:timeline', () => [])
  const submitting = useState('generation:submitting', () => false)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let streamSource: EventSource | null = null
  let streamedRunId: string | null = null

  function stopPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function stopStream() {
    if (streamSource !== null) {
      streamSource.close()
      streamSource = null
      streamedRunId = null
    }
  }

  function stopPolling() {
    stopPollTimer()
    stopStream()
  }

  async function pollRun(deckId: string, runId: string): Promise<GenerationRunSummary> {
    const data = await $fetch<RunResponse>(
      `/api/decks/${deckId}/generations/${runId}`
    )
    const run = unwrapRunResponse(data)
    activeRun.value = run
    upsertTimelineRun(run)
    return run
  }

  function upsertTimelineRun(run: GenerationRunSummary) {
    const nextTimeline = activeTimeline.value.filter((entry) => entry.id !== run.id)
    nextTimeline.push(run)
    activeTimeline.value = nextTimeline.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    const nextHistory = runHistory.value.filter((entry) => entry.id !== run.id)
    nextHistory.push(run)
    runHistory.value = nextHistory.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  function handleRunUpdate(run: GenerationRunSummary, onComplete?: (run: GenerationRunSummary) => void): boolean {
    activeRun.value = run
    upsertTimelineRun(run)

    if (!TERMINAL_STATUSES.includes(run.status)) return false

    onComplete?.(run)
    return true
  }

  function startPollLoop(deckId: string, runId: string, onComplete?: (run: GenerationRunSummary) => void) {
    stopPollTimer()
    pollTimer = setTimeout(async () => {
      try {
        const run = await pollRun(deckId, runId)
        if (TERMINAL_STATUSES.includes(run.status)) onComplete?.(run)
        else startPollLoop(deckId, runId, onComplete)
      } catch {
        // retry on transient errors
        startPollLoop(deckId, runId, onComplete)
      }
    }, POLL_INTERVAL_MS)
  }

  function schedulePoll(deckId: string, runId: string, onComplete?: (run: GenerationRunSummary) => void) {
    stopStream()
    startPollLoop(deckId, runId, onComplete)
  }

  function streamRun(deckId: string, runId: string, onComplete?: (run: GenerationRunSummary) => void) {
    if (!import.meta.client || typeof EventSource === 'undefined') {
      schedulePoll(deckId, runId, onComplete)
      return
    }

    stopPolling()

    const encodedDeckId = encodeURIComponent(deckId)
    const encodedRunId = encodeURIComponent(runId)
    const source = new EventSource(`/api/decks/${encodedDeckId}/generations/${encodedRunId}/stream`)
    streamSource = source
    streamedRunId = runId

    source.addEventListener('generation-run', (event) => {
      if (streamSource !== source || streamedRunId !== runId) return

      const run = JSON.parse((event as MessageEvent<string>).data) as GenerationRunSummary
      if (handleRunUpdate(run, onComplete)) stopStream()
    })

    source.addEventListener('done', () => {
      if (streamSource !== source || streamedRunId !== runId) return
      stopStream()
    })

    source.onerror = () => {
      if (streamSource !== source || streamedRunId !== runId) return
      stopStream()
      startPollLoop(deckId, runId, onComplete)
    }
  }

  async function submitGeneration(
    input: SubmitGenerationInput,
    onComplete?: (run: GenerationRunSummary) => void
  ): Promise<GenerationRunSummary> {
    submitting.value = true
    try {
      const data = await $fetch<GenerationRunSummary>(`/api/decks/${input.deckId}/generations`, {
        method: 'POST',
        body: input
      })
      handleRunUpdate(data, onComplete)
      if (!TERMINAL_STATUSES.includes(data.status)) streamRun(data.deckId, data.id, onComplete)
      return data
    } finally {
      submitting.value = false
    }
  }

  function trackRun(
    run: GenerationRunSummary,
    onComplete?: (run: GenerationRunSummary) => void
  ) {
    const completed = handleRunUpdate(run, onComplete)
    if (!completed) streamRun(run.deckId, run.id, onComplete)
  }

  async function resumeAskMode(
    deckId: string,
    runId: string,
    answer: string,
    onComplete?: (run: GenerationRunSummary) => void
  ) {
    const data = await $fetch<RunResponse>(
      `/api/decks/${deckId}/generations/${runId}/resume`,
      { method: 'POST', body: { answer } }
    )
    const run = unwrapRunResponse(data)
    handleRunUpdate(run, onComplete)
    if (!TERMINAL_STATUSES.includes(run.status)) streamRun(deckId, runId, onComplete)
    return run
  }

  async function cancelGeneration(
    deckId: string,
    runId: string,
    onComplete?: (run: GenerationRunSummary) => void
  ) {
    const data = await $fetch<RunResponse>(
      `/api/decks/${deckId}/generations/${runId}/cancel`,
      { method: 'POST' }
    )
    const run = unwrapRunResponse(data)
    if (streamedRunId === runId) stopStream()
    handleRunUpdate(run, onComplete)
    return run
  }

  async function loadHistory(deckId: string, limit = 100) {
    try {
      const data = await $fetch<{ runs: GenerationRunSummary[] }>(`/api/decks/${deckId}/generations`, {
        query: { limit },
        headers: ssrCookieHeaders()
      })
      runHistory.value = data.runs
      activeTimeline.value = [...data.runs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    } catch {
      runHistory.value = []
      activeTimeline.value = []
    }
  }

  function clearRun() {
    stopPolling()
    activeRun.value = null
  }

  return {
    activeRun,
    runHistory,
    activeTimeline,
    submitting,
    submitGeneration,
    trackRun,
    resumeAskMode,
    cancelGeneration,
    pollRun,
    loadHistory,
    stopPolling,
    clearRun,
  }
}
