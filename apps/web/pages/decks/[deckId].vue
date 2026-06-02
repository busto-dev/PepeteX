<script setup lang="ts">
import type { GeneratePayload } from '~/components/deck/DeckGenerationComposer.vue'
import type { DeckSlideDetail, GenerationRunSummary } from '~/types'
import type { InitialGenerationSettings } from '~/lib/initial-generation-settings'
import {
  clearStoredInitialGenerationSettings,
  parseInitialGenerationQuery,
  readStoredInitialGenerationSettings
} from '~/lib/initial-generation-settings'
import { TWEAK_CATEGORY_DEFINITIONS } from '~/lib/tweak-definitions'

definePageMeta({ fullBleed: true, hideHeader: true, hideSidebar: true })

type InspectorPanel = 'edit' | 'tweaks' | 'history' | 'export'

type PendingInitialGeneration = InitialGenerationSettings

type GenerationMessageItem = GenerationRunSummary['messages'][number]
type GenerationToolCallItem = GenerationRunSummary['toolCalls'][number]
type GenerationTimelineEntry =
  | { kind: 'message'; id: string; createdAt: string; message: GenerationMessageItem }
  | { kind: 'tool'; id: string; createdAt: string; toolCall: GenerationToolCallItem }

type DraftDeckPreview = {
  title: string | null
  slides: DeckSlideDetail[]
  fonts?: Array<{ id?: string; fontFamily: string; fontAliases?: string[]; mimeType: string; dataUrl: string; fontWeight?: number | string | null; fontStyle?: string | null }>
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const routeDeckId = computed(() => route.params.deckId as string)
const { currentWorkspaceId, workspaces, setWorkspace } = useWorkspaces()
const {
  decks, selectedDeckId, deckDetail, selectedSlideId, selectedFieldId,
  loadingDecks, loadingDetail, canManage,
  selectedDeck, selectedSlide, selectedSlideIndex,
  loadDecks, loadDetail, createDeck, renameDeck, deleteDeck,
  duplicateSlide, moveSlide, deleteSlide, saveText, restoreRevision,
  forkDeck, moveDeckToWorkspace, copyDeck
} = useDeck()
const { activeRun, runHistory, activeTimeline, submitting, submitGeneration, resumeAskMode, cancelGeneration, loadHistory } = useGeneration()

const leftMode = ref<'chat' | 'comments' | 'files'>('chat')
const activeInspector = ref<InspectorPanel | null>(null)
const commentMode = ref(false)
const savingText = ref(false)
const leftPanelOpen = ref(true)
const deckListOpen = ref(false)
const chatTranscriptRef = ref<HTMLElement | null>(null)
const chatAutoScroll = ref(true)
const zoom = ref(100)
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const selectedCustomPromptId = ref<string | null>(null)
const selectedCommentElementId = ref<string | null>(null)
const syncingWorkspace = ref(false)
const initialGenerationAppliedDeckId = ref<string | null>(null)
const pendingInitialGeneration = ref<PendingInitialGeneration | null>(null)
const initialGenerationByDeck = useState<Record<string, InitialGenerationSettings>>(
  'deck:initial-generation-settings',
  () => ({})
)
const submittedInitialGenerationByDeck = useState<Record<string, string>>(
  'deck:submitted-initial-generation',
  () => ({})
)
const startingInitialGeneration = ref(false)
const initialGenerationHistoryLoadedDeckId = ref<string | null>(null)
const cancellingRunId = ref<string | null>(null)
const renamingDeck = ref<{ id: string; title: string } | null>(null)
const renameTitle = ref('')
const savingRename = ref(false)
const deletingDeckId = ref<string | null>(null)
const tweakCategories = TWEAK_CATEGORY_DEFINITIONS.slice(0, 6)
let selectedDeckLoadToken = 0

const currentWorkspace = computed(() => workspaces.value.find((workspace) => workspace.id === currentWorkspaceId.value))
const selectedSlidePosition = computed(() => {
  const total = previewSlides.value.length
  const index = previewSlideIndex.value
  return index >= 0 && total > 0 ? `${index + 1} / ${total}` : 'No slide selected'
})
const previewFrameStyle = computed(() => ({ width: `${Math.round(1120 * zoom.value / 100)}px`, maxWidth: zoom.value <= 100 ? '100%' : 'none' }))
const selectedSlideNote = computed(() => {
  const slide = previewSlide.value
  if (!slide) return 'Select a slide to see presenter notes and slide context.'
  const body = slide.editableFields.find((field) => field.elementType === 'body') ?? slide.editableFields[0]
  return body?.text ?? 'No speaker notes are generated for this slide yet. Use chat to ask PepeteX for a talk track.'
})
const visibleRuns = computed<GenerationRunSummary[]>(() => {
  const runs = new Map<string, GenerationRunSummary>()
  for (const run of activeTimeline.value) {
    if (run.deckId === selectedDeckId.value) runs.set(run.id, run)
  }
  for (const run of runHistory.value) {
    if (run.deckId === selectedDeckId.value) runs.set(run.id, run)
  }
  if (activeRun.value?.deckId === selectedDeckId.value) runs.set(activeRun.value.id, activeRun.value)
  return [...runs.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
})
const visibleRunTimelineKey = computed(() =>
  visibleRuns.value
    .map((run) => [
      run.id,
      run.status,
      run.updatedAt,
      run.messages.length,
      run.toolCalls.length,
      run.latestCheckpoint?.id ?? ''
    ].join(':'))
    .join('|')
)
const previewInteractionMode = computed<'none' | 'comment' | 'edit'>(() => {
  if (commentMode.value) return 'comment'
  if (activeInspector.value === 'edit') return 'edit'
  return 'none'
})
const previewSelectedElementId = computed(() => {
  if (previewInteractionMode.value === 'comment') return selectedCommentElementId.value
  if (previewInteractionMode.value === 'edit') return selectedFieldId.value
  return null
})
const activeDraftRun = computed(() => {
  const run = [...visibleRuns.value]
    .reverse()
    .find((entry) => ['PENDING', 'RUNNING', 'WAITING_ASK', 'FAILED', 'CANCELLED'].includes(entry.status) && isPreviewableCheckpoint(entry.latestCheckpoint))
  return run ?? null
})
const activeDraftPreview = computed(() => {
  const checkpoint = activeDraftRun.value?.latestCheckpoint
  return checkpoint ? parseDraftDeckPreview(checkpoint.deckJson) : null
})
const previewSlides = computed(() => activeDraftPreview.value?.slides ?? deckDetail.value?.slides ?? [])
const previewFontFaces = computed(() => activeDraftPreview.value?.fonts ?? deckDetail.value?.fonts ?? [])
const showingDraftPreview = computed(() => (activeDraftPreview.value?.slides.length ?? 0) > 0)
const activeDraftLatestSlideId = computed(() => activeDraftPreview.value?.slides.at(-1)?.id ?? null)
const shouldFollowDraftLatestSlide = computed(() => {
  const kind = activeDraftRun.value?.kind
  return kind === 'AGENT_COMMAND' || kind === 'FULL_DECK' || kind === 'SINGLE_SLIDE'
})
const previewSlideIndex = computed(() => {
  const slides = previewSlides.value
  if (slides.length === 0) return -1
  const selectedIndex = slides.findIndex((slide) => slide.id === selectedSlideId.value)
  if (selectedIndex >= 0) return selectedIndex
  if (showingDraftPreview.value) return slides.length - 1
  return selectedIndex >= 0 ? selectedIndex : 0
})
const previewSlide = computed(() => {
  const slides = previewSlides.value
  return previewSlideIndex.value >= 0 ? slides[previewSlideIndex.value] ?? null : null
})
const previewDeckTitle = computed(() => activeDraftPreview.value?.title ?? deckDetail.value?.title ?? '')

watch(routeDeckId, (id) => {
  if (id && selectedDeckId.value !== id) selectedDeckId.value = id
}, { immediate: true })

watch(activeDraftLatestSlideId, (id) => {
  if (id && shouldFollowDraftLatestSlide.value) selectedSlideId.value = id
}, { flush: 'post' })

watch(currentWorkspaceId, async (workspaceId) => {
  if (!workspaceId || syncingWorkspace.value) return
  await loadDecks(workspaceId)
}, { immediate: true })

watch(selectedDeckId, async (id) => {
  const loadToken = ++selectedDeckLoadToken
  initialGenerationHistoryLoadedDeckId.value = null
  if (!id) return
  applyInitialGenerationForDeck(id)
  await loadDetail(id)
  if (loadToken !== selectedDeckLoadToken || selectedDeckId.value !== id) return
  await loadHistory(id)
  if (loadToken !== selectedDeckLoadToken || selectedDeckId.value !== id) return
  const workspaceId = deckDetail.value?.workspaceId
  if (workspaceId && workspaceId !== currentWorkspaceId.value) {
    syncingWorkspace.value = true
    setWorkspace(workspaceId)
    await loadDecks(workspaceId)
    syncingWorkspace.value = false
  }
  if (loadToken !== selectedDeckLoadToken || selectedDeckId.value !== id) return
  initialGenerationHistoryLoadedDeckId.value = id
  await maybeRunPendingInitialGeneration()
}, { immediate: true })

watch(() => route.query, () => {
  const id = selectedDeckId.value
  if (!id) return
  applyInitialGenerationForDeck(id)
  void maybeRunPendingInitialGeneration()
})

watch([pendingInitialGeneration, selectedProviderId, selectedModelId, currentWorkspaceId, deckDetail], () => {
  void maybeRunPendingInitialGeneration()
})

watch(selectedSlideId, () => {
  selectedCommentElementId.value = null
})

watch(visibleRunTimelineKey, () => {
  if (leftMode.value !== 'chat' || !chatAutoScroll.value) return
  void nextTick(scrollChatTranscriptToBottom)
}, { flush: 'post' })

async function maybeRunPendingInitialGeneration() {
  if (!import.meta.client) return

  const pending = pendingInitialGeneration.value
  const deckId = selectedDeckId.value
  const detail = deckDetail.value
  const textProviderId = pending?.textProviderId ?? selectedProviderId.value
  const textModelId = pending?.textModelId ?? selectedModelId.value
  if (
    startingInitialGeneration.value ||
    !pending ||
    pending.prefillOnly ||
    !deckId ||
    !currentWorkspaceId.value ||
    !textProviderId ||
    !textModelId ||
    !detail ||
    detail.id !== deckId ||
    initialGenerationHistoryLoadedDeckId.value !== deckId
  ) {
    return
  }

  if (detail.workspaceId !== currentWorkspaceId.value) return

  if ((detail.slides.length ?? 0) > 0) {
    pendingInitialGeneration.value = null
    return
  }

  const initialGenerationKey = buildInitialGenerationKey(deckId, pending, textProviderId, textModelId)
  if (
    submittedInitialGenerationByDeck.value[deckId] === initialGenerationKey ||
    hasExistingInitialGenerationRun(deckId, initialGenerationKey)
  ) {
    pendingInitialGeneration.value = null
    return
  }

  submittedInitialGenerationByDeck.value = {
    ...submittedInitialGenerationByDeck.value,
    [deckId]: initialGenerationKey
  }

  startingInitialGeneration.value = true
  pendingInitialGeneration.value = null
  try {
    await onGenerate({
      kind: 'AGENT_COMMAND',
      manualInstruction: pending.manualInstruction,
      languageCode: pending.languageCode,
      textProviderId,
      textModelId,
      customPromptId: pending.customPromptId ?? selectedCustomPromptId.value,
      designSystemId: pending.designSystemId,
      enableImageGeneration: pending.enableImageGeneration,
      imageProviderId: pending.enableImageGeneration ? pending.imageProviderId : null,
      imageModelId: pending.enableImageGeneration ? pending.imageModelId : null,
      commandContextJson: {
        source: 'homepage_initial_generation',
        initialGenerationKey
      }
    })
  } finally {
    startingInitialGeneration.value = false
  }
}

function buildInitialGenerationKey(
  deckId: string,
  pending: PendingInitialGeneration,
  textProviderId: string,
  textModelId: string
) {
  return [
    deckId,
    pending.manualInstruction.trim(),
    textProviderId,
    textModelId,
    pending.customPromptId ?? '',
    pending.designSystemId ?? '',
    pending.languageCode || 'en',
    pending.enableImageGeneration ? 'image:1' : 'image:0',
    pending.enableImageGeneration ? pending.imageProviderId ?? '' : '',
    pending.enableImageGeneration ? pending.imageModelId ?? '' : ''
  ].map((part) => encodeURIComponent(part)).join('|')
}

function hasExistingInitialGenerationRun(deckId: string, initialGenerationKey: string) {
  const runs = [
    ...activeTimeline.value,
    ...runHistory.value,
    ...(activeRun.value ? [activeRun.value] : [])
  ]

  return runs.some((run) =>
    run.deckId === deckId &&
    run.status !== 'FAILED' &&
    run.status !== 'CANCELLED' &&
    getInitialGenerationKey(run.commandContextJson) === initialGenerationKey
  )
}

function getInitialGenerationKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  return record.source === 'homepage_initial_generation' && typeof record.initialGenerationKey === 'string'
    ? record.initialGenerationKey
    : null
}

function applyInitialGenerationForDeck(deckId: string) {
  const initialGeneration = readInitialGenerationForDeck(deckId)
  if (!initialGeneration || initialGenerationAppliedDeckId.value === deckId) return

  initialGenerationAppliedDeckId.value = deckId
  clearInitialGenerationState(deckId)
  clearStoredInitialGenerationSettings(deckId)
  pendingInitialGeneration.value = initialGeneration
  selectedProviderId.value = initialGeneration.textProviderId ?? selectedProviderId.value
  selectedModelId.value = initialGeneration.textModelId ?? selectedModelId.value
  selectedCustomPromptId.value = initialGeneration.customPromptId ?? selectedCustomPromptId.value

  if (import.meta.client && Object.keys(route.query).length > 0) {
    void router.replace({ path: route.path, query: {} })
  }
}

function readInitialGenerationForDeck(deckId: string): PendingInitialGeneration | null {
  const stateSettings = initialGenerationByDeck.value[deckId] ?? null
  const stored = readStoredInitialGenerationSettings(deckId)
  const querySettings = parseInitialGenerationQuery(route.query)
  return mergeInitialGenerationSettings(
    mergeInitialGenerationSettings(stateSettings, stored),
    querySettings
  )
}

function mergeInitialGenerationSettings(
  base: PendingInitialGeneration | null,
  override: PendingInitialGeneration | null
): PendingInitialGeneration | null {
  if (!base) return override
  if (!override) return base

  return {
    manualInstruction: override.manualInstruction || base.manualInstruction,
    textProviderId: override.textProviderId ?? base.textProviderId,
    textModelId: override.textModelId ?? base.textModelId,
    customPromptId: override.customPromptId ?? base.customPromptId,
    designSystemId: override.designSystemId ?? base.designSystemId,
    languageCode: override.languageCode || base.languageCode,
    enableImageGeneration: override.enableImageGeneration || base.enableImageGeneration,
    imageProviderId: override.imageProviderId ?? base.imageProviderId,
    imageModelId: override.imageModelId ?? base.imageModelId,
    prefillOnly: override.prefillOnly || base.prefillOnly
  }
}

function clearInitialGenerationState(deckId: string) {
  if (!(deckId in initialGenerationByDeck.value)) return
  const next = { ...initialGenerationByDeck.value }
  delete next[deckId]
  initialGenerationByDeck.value = next
}

async function handleGenerationSettled(run: GenerationRunSummary) {
  if (selectedDeckId.value) await loadHistory(selectedDeckId.value)

  if (run.status === 'FAILED') {
    toast.add({
      title: 'Generation failed',
      description: run.errorMessage ?? 'PepeteX could not complete this generation run.',
      color: 'error'
    })
    return
  }

  if (run.status === 'CANCELLED') {
    toast.add({
      title: 'Generation stopped',
      description: 'PepeteX stopped the run and kept the current deck revision unchanged.'
    })
    return
  }

  if (run.status === 'COMPLETED' && selectedDeckId.value) {
    await refreshDeckDetailPreservingSelection()
    if (currentWorkspaceId.value) await loadDecks(currentWorkspaceId.value)
  }
}

async function refreshDeckDetailPreservingSelection() {
  if (!selectedDeckId.value) return

  await loadDetail(selectedDeckId.value, {
    preferredSlideId: selectedSlideId.value,
    preferredFieldId: selectedFieldId.value
  })
}

function getErrorMessage(error: unknown, fallback: string) {
  return (error as { data?: { statusMessage?: string }; statusMessage?: string; message?: string })?.data?.statusMessage ??
    (error as { statusMessage?: string })?.statusMessage ??
    (error as { message?: string })?.message ??
    fallback
}

async function selectDeck(id: string) {
  selectedDeckId.value = id
  deckListOpen.value = false
  if (id !== routeDeckId.value) await router.push(`/decks/${id}`)
}

async function onGenerate(payload: GeneratePayload) {
  if (!currentWorkspaceId.value) return
  try {
    if (!selectedDeckId.value) {
      const deck = await createDeck(currentWorkspaceId.value, 'Untitled deck')
      await router.push(`/decks/${deck.id}`)
    }
    if (!selectedDeckId.value) return
    const selectedElementId = previewSelectedElementId.value
    const commandContextJson = payload.commandContextJson ?? {
      source: 'deck_studio_chat',
      selectedSlideId: selectedSlideId.value ?? null,
      selectedElementId: selectedElementId ?? null,
      selectedFieldId: selectedFieldId.value ?? null,
      selectedCommentElementId: selectedCommentElementId.value ?? null,
      previewInteractionMode: previewInteractionMode.value,
      slideCount: deckDetail.value?.slides.length ?? 0
    }
    await submitGeneration({
      deckId: selectedDeckId.value,
      workspaceId: currentWorkspaceId.value,
      kind: payload.kind,
      textProviderId: payload.textProviderId,
      textModelId: payload.textModelId,
      imageEnabled: payload.enableImageGeneration,
      imageProviderId: payload.imageProviderId,
      imageModelId: payload.imageModelId,
      customPromptId: payload.customPromptId,
      designSystemId: payload.designSystemId,
      languageCode: payload.languageCode,
      manualInstruction: payload.manualInstruction,
      targetSlideId: selectedSlideId.value ?? undefined,
      targetElementId: selectedElementId ?? undefined,
      commandContextJson,
      slideInstruction: payload.manualInstruction,
      ...(payload.attachments && payload.attachments.length > 0 ? { attachments: payload.attachments } : {})
    }, handleGenerationSettled)
    leftMode.value = 'chat'
  } catch (error) {
    toast.add({
      title: 'Generation could not start',
      description: getErrorMessage(error, 'Please check the selected provider and model, then try again.'),
      color: 'error'
    })
  }
}

async function onResumeAsk(runId: string, answer: string) {
  if (!selectedDeckId.value) return
  try {
    await resumeAskMode(selectedDeckId.value, runId, answer, handleGenerationSettled)
  } catch (error) {
    toast.add({
      title: 'Could not resume generation',
      description: getErrorMessage(error, 'PepeteX could not submit your answer.'),
      color: 'error'
    })
  }
}

async function onCancelGeneration(runId: string) {
  if (!selectedDeckId.value || cancellingRunId.value) return
  cancellingRunId.value = runId
  try {
    await cancelGeneration(selectedDeckId.value, runId, handleGenerationSettled)
  } catch (error) {
    toast.add({
      title: 'Could not stop generation',
      description: getErrorMessage(error, 'PepeteX could not cancel this generation run.'),
      color: 'error'
    })
  } finally {
    cancellingRunId.value = null
  }
}

async function onSaveText(elementId: string, text: string) {
  if (!selectedDeckId.value || !selectedSlideId.value) return
  savingText.value = true
  try {
    await saveText(selectedDeckId.value, selectedSlideId.value, elementId, text)
    toast.add({ title: 'Text saved', color: 'success' })
  } catch (error) {
    toast.add({
      title: 'Text could not be saved',
      description: getErrorMessage(error, 'PepeteX could not update this text element.'),
      color: 'error'
    })
  } finally {
    savingText.value = false
  }
}

async function onCreateDeck() {
  if (!currentWorkspaceId.value) return
  const deck = await createDeck(currentWorkspaceId.value, 'Untitled Deck')
  await router.push(`/decks/${deck.id}`)
}

async function onMoveUp() {
  if (!selectedDeckId.value || !selectedSlideId.value || selectedSlideIndex.value <= 0) return
  await moveSlide(selectedDeckId.value, selectedSlideId.value, selectedSlideIndex.value - 1)
}

async function onMoveDown() {
  const total = deckDetail.value?.slides.length ?? 0
  if (!selectedDeckId.value || !selectedSlideId.value || selectedSlideIndex.value >= total - 1) return
  await moveSlide(selectedDeckId.value, selectedSlideId.value, selectedSlideIndex.value + 1)
}

async function onDuplicate() {
  if (!selectedDeckId.value || !selectedSlideId.value) return
  await duplicateSlide(selectedDeckId.value, selectedSlideId.value)
}

async function onDeleteSlide() {
  if (!selectedDeckId.value || !selectedSlideId.value) return
  await deleteSlide(selectedDeckId.value, selectedSlideId.value)
}

async function onRestoreRevision(revisionId: string) {
  if (!selectedDeckId.value) return
  await restoreRevision(selectedDeckId.value, revisionId)
  toast.add({ title: 'Revision restored', color: 'success' })
}

async function onForkDeck(deckId: string, targetWorkspaceId: string) {
  const deck = await forkDeck(deckId, targetWorkspaceId)
  toast.add({ title: 'Deck forked', color: 'success' })
  await router.push(`/decks/${deck.id}`)
}

async function onMoveDeck(deckId: string, targetWorkspaceId: string) {
  const deck = await moveDeckToWorkspace(deckId, targetWorkspaceId)
  toast.add({ title: 'Deck moved', color: 'success' })
  await router.push(`/decks/${deck.id}`)
}

async function onCopyDeck(deckId: string, targetWorkspaceId: string) {
  const deck = await copyDeck(deckId, targetWorkspaceId)
  toast.add({ title: 'Deck copied', color: 'success' })
  await router.push(`/decks/${deck.id}`)
}

function openRename(deckId: string, title: string) {
  renamingDeck.value = { id: deckId, title }
  renameTitle.value = title
}

async function confirmRename() {
  if (!renamingDeck.value) return
  const title = renameTitle.value.trim()
  if (!title) {
    toast.add({ title: 'Deck name is required', color: 'warning' })
    return
  }

  savingRename.value = true
  try {
    await renameDeck(renamingDeck.value.id, title)
    toast.add({ title: 'Deck renamed', color: 'success' })
    renamingDeck.value = null
  } catch (error) {
    toast.add({
      title: 'Could not rename deck',
      description: getErrorMessage(error, 'PepeteX could not update this deck name.'),
      color: 'error'
    })
  } finally {
    savingRename.value = false
  }
}

async function confirmDelete() {
  if (!deletingDeckId.value || !currentWorkspaceId.value) return
  await deleteDeck(deletingDeckId.value, currentWorkspaceId.value)
  deletingDeckId.value = null
  await router.push('/')
}

function toggleInspector(panel: InspectorPanel) {
  const nextPanel = activeInspector.value === panel ? null : panel
  activeInspector.value = nextPanel
  if (nextPanel === 'edit') {
    commentMode.value = false
    selectedCommentElementId.value = null
  }
}

function setZoom(next: number) {
  zoom.value = Math.min(140, Math.max(60, next))
}

function toggleCommentMode() {
  setCommentMode(!commentMode.value)
}

function setCommentMode(enabled: boolean) {
  commentMode.value = enabled
  if (enabled) {
    leftMode.value = 'comments'
    leftPanelOpen.value = true
    activeInspector.value = activeInspector.value === 'edit' ? null : activeInspector.value
    selectedFieldId.value = null
  } else {
    selectedCommentElementId.value = null
  }
}

function onPreviewElementClick(payload: { elementId: string; elementType: string | undefined }) {
  if (commentMode.value) {
    selectedCommentElementId.value = payload.elementId
    leftMode.value = 'comments'
    leftPanelOpen.value = true
    activeInspector.value = activeInspector.value === 'edit' ? null : activeInspector.value
    return
  }

  if (activeInspector.value === 'edit') {
    const field = selectedSlide.value?.editableFields.find((entry) => entry.elementId === payload.elementId)
    if (field) {
      selectedFieldId.value = field.elementId
      activeInspector.value = 'edit'
      return
    }

    toast.add({
      title: 'Element is not text-editable',
      description: 'Choose a headline, body, or CTA text element to edit its copy.',
      color: 'warning'
    })
  }
}

function runKindLabel(kind: GenerationRunSummary['kind']) {
  if (kind === 'AGENT_COMMAND') return 'Studio command'
  return kind.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase())
}

function runStatusClass(status: GenerationRunSummary['status']) {
  switch (status) {
    case 'COMPLETED': return 'bg-emerald-50 text-emerald-700 ring-emerald-100'
    case 'FAILED': return 'bg-rose-50 text-rose-700 ring-rose-100'
    case 'WAITING_ASK': return 'bg-amber-50 text-amber-700 ring-amber-100'
    case 'RUNNING': return 'bg-indigo-50 text-indigo-700 ring-indigo-100'
    case 'CANCELLED': return 'bg-slate-100 text-slate-500 ring-slate-200'
    default: return 'bg-slate-50 text-slate-600 ring-slate-200'
  }
}

function runProgressSteps(run: GenerationRunSummary) {
  if (run.status === 'COMPLETED') {
    return [{ label: 'Saved deck revision', state: 'done' as const }]
  }
  if (run.status === 'FAILED') {
    return [{ label: 'Worker reported a failure', state: 'blocked' as const }]
  }
  if (run.status === 'CANCELLED') {
    return [{ label: 'Stopped by user request', state: 'blocked' as const }]
  }
  if (run.status === 'WAITING_ASK') {
    return [
      { label: 'Read deck context', state: 'done' as const },
      { label: 'Waiting for your answer', state: 'active' as const }
    ]
  }
  if (run.status === 'RUNNING') {
    return [
      { label: 'Read deck context', state: 'done' as const },
      { label: currentRunActionLabel(run), state: 'active' as const },
      { label: 'Validate and save revision', state: 'idle' as const }
    ]
  }
  if (run.status === 'PENDING') {
    return [
      { label: 'Request submitted', state: 'done' as const },
      { label: 'Waiting for worker', state: 'active' as const }
    ]
  }
  return []
}

function runTimelineEntries(run: GenerationRunSummary): GenerationTimelineEntry[] {
  return [
    ...run.messages.filter(isVisibleChatMessage).map((message) => ({
      kind: 'message' as const,
      id: `message-${message.id}`,
      createdAt: message.createdAt,
      message
    })),
    ...run.toolCalls.map((toolCall) => ({
      kind: 'tool' as const,
      id: `tool-${toolCall.id}`,
      createdAt: toolCall.createdAt,
      toolCall
    }))
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function isVisibleChatMessage(message: GenerationMessageItem) {
  if (message.role === 'SYSTEM') return false

  const metadata = message.metadata && typeof message.metadata === 'object'
    ? message.metadata as Record<string, unknown>
    : null

  if (message.role === 'ASSISTANT' && metadata?.phase === 'prepare') return false

  return true
}

function showRunStatusBanner(run: GenerationRunSummary) {
  return ['PENDING', 'RUNNING', 'WAITING_ASK', 'FAILED', 'CANCELLED'].includes(run.status)
}

function isRunCancellable(run: GenerationRunSummary) {
  return ['PENDING', 'RUNNING', 'WAITING_ASK'].includes(run.status)
}

function runStatusBannerClass(run: GenerationRunSummary) {
  if (run.status === 'FAILED') return 'border-rose-100 bg-rose-50 text-rose-800'
  if (run.status === 'CANCELLED') return 'border-slate-200 bg-slate-50 text-slate-700'
  if (run.status === 'WAITING_ASK') return 'border-amber-100 bg-amber-50 text-amber-800'
  if (run.status === 'RUNNING') return 'border-indigo-100 bg-indigo-50 text-indigo-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function runStatusBannerIcon(run: GenerationRunSummary) {
  if (run.status === 'FAILED') return 'i-heroicons-exclamation-triangle'
  if (run.status === 'CANCELLED') return 'i-heroicons-stop-circle'
  if (run.status === 'WAITING_ASK') return 'i-heroicons-question-mark-circle'
  if (run.status === 'RUNNING') return 'i-heroicons-arrow-path'
  return 'i-heroicons-clock'
}

function runLiveStatusLabel(run: GenerationRunSummary) {
  if (run.status === 'FAILED') return run.errorMessage ?? 'The worker reported a failure before it could finish.'
  if (run.status === 'CANCELLED') return 'Generation stopped. The committed deck revision was not changed.'
  if (run.status === 'WAITING_ASK') return run.askQuestion ?? 'Waiting for one detail from you.'
  if (run.status === 'PENDING') return 'Queued for the worker'
  if (run.status !== 'RUNNING') return run.status.toLowerCase().replaceAll('_', ' ')

  const activeToolCall = [...run.toolCalls].reverse().find((toolCall) => toolCall.status === 'RUNNING')
  return activeToolCall ? toolDisplayLabel(activeToolCall) : 'Waiting for the next model or tool event'
}

function isPreviewableCheckpoint(checkpoint: GenerationRunSummary['latestCheckpoint']) {
  return !!checkpoint && checkpoint.status !== 'VALIDATION_FAILED'
}

const AGENT_TOOL_LABELS: Record<string, string> = {
  request_clarification: 'Asking a follow-up question',
  request_approval: 'Requesting approval',
  read_deck_state: 'Reading deck state',
  plan_deck: 'Planning the deck',
  read_design_system: 'Reading design system',
  list_reference_files: 'Listing reference files',
  read_reference_file: 'Reading reference file',
  write_slide: 'Writing a slide draft',
  patch_slide: 'Patching a slide draft',
  validate_slide: 'Validating slide draft',
  validate_deck: 'Validating deck draft',
  finish_generation: 'Committing validated deck'
}

function toolDisplayLabel(toolCall: GenerationToolCallItem) {
  return AGENT_TOOL_LABELS[toolCall.name] ?? toolCall.label
}

function onChatTranscriptScroll() {
  const element = chatTranscriptRef.value
  if (!element || leftMode.value !== 'chat') return
  chatAutoScroll.value = element.scrollHeight - element.scrollTop - element.clientHeight < 96
}

function scrollChatTranscriptToBottom() {
  const element = chatTranscriptRef.value
  if (!element) return
  element.scrollTop = element.scrollHeight
}

function messageAuthorLabel(message: GenerationMessageItem) {
  if (message.role === 'USER') return 'You'
  if (message.role === 'VERIFIER') return 'Verifier agent'
  return 'PepeteX'
}

function messageAvatarIcon(message: GenerationMessageItem) {
  if (message.role === 'VERIFIER') return 'i-heroicons-shield-check'
  return 'i-heroicons-bolt'
}

function messageBubbleClass(message: GenerationMessageItem) {
  if (message.role === 'USER') return 'bg-fg text-bg shadow-sm'
  if (message.role === 'VERIFIER') return 'border border-amber-200 bg-amber-50 text-amber-900'
  return 'border border-border bg-surface text-fg-muted'
}

function toolCallStatusClass(status: GenerationToolCallItem['status']) {
  if (status === 'COMPLETED') return 'border-emerald-100 bg-emerald-50 text-emerald-800'
  if (status === 'FAILED') return 'border-rose-100 bg-rose-50 text-rose-800'
  return 'border-indigo-100 bg-indigo-50 text-indigo-800'
}

function toolCallStatusIcon(status: GenerationToolCallItem['status']) {
  if (status === 'COMPLETED') return 'i-heroicons-check-circle'
  if (status === 'FAILED') return 'i-heroicons-exclamation-triangle'
  return 'i-heroicons-arrow-path'
}

function toolPayload(toolCall: GenerationToolCallItem) {
  const payload = toolCall.resultJson ?? toolCall.inputJson
  if (payload == null) return ''
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function parseDraftDeckPreview(value: unknown): DraftDeckPreview | null {
  if (!value || typeof value !== 'object') return null

  const record = value as { title?: unknown; slides?: unknown; fonts?: unknown }
  if (!Array.isArray(record.slides)) return null

  const slides = record.slides
    .map((slide): DeckSlideDetail | null => {
      if (!slide || typeof slide !== 'object') return null
      const slideRecord = slide as { id?: unknown; title?: unknown; html?: unknown; css?: unknown }
      if (typeof slideRecord.id !== 'string' || typeof slideRecord.html !== 'string' || typeof slideRecord.css !== 'string') {
        return null
      }

      return {
        id: slideRecord.id,
        title: typeof slideRecord.title === 'string' ? slideRecord.title : 'Draft slide',
        html: slideRecord.html,
        css: slideRecord.css,
        editableFields: []
      }
    })
    .filter((slide): slide is DeckSlideDetail => slide !== null)

  if (slides.length === 0) return null

  return {
    title: typeof record.title === 'string' ? record.title : null,
    slides,
    fonts: parseDraftFontFaces(record.fonts)
  }
}

function parseDraftFontFaces(value: unknown): DraftDeckPreview['fonts'] {
  if (!Array.isArray(value)) return []
  return value
    .map((font) => {
      if (!font || typeof font !== 'object') return null
      const record = font as Record<string, unknown>
      if (
        typeof record.fontFamily !== 'string' ||
        typeof record.mimeType !== 'string' ||
        typeof record.dataUrl !== 'string'
      ) {
        return null
      }
      return {
        ...(typeof record.id === 'string' ? { id: record.id } : {}),
        fontFamily: record.fontFamily,
        ...(Array.isArray(record.fontAliases)
          ? { fontAliases: record.fontAliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0) }
          : {}),
        mimeType: record.mimeType,
        dataUrl: record.dataUrl,
        ...(typeof record.fontWeight === 'number' || typeof record.fontWeight === 'string' || record.fontWeight === null
          ? { fontWeight: record.fontWeight }
          : {}),
        ...(typeof record.fontStyle === 'string' || record.fontStyle === null ? { fontStyle: record.fontStyle } : {})
      }
    })
    .filter((font): font is NonNullable<DraftDeckPreview['fonts']>[number] => font !== null)
}

function currentRunActionLabel(run: GenerationRunSummary) {
  switch (run.kind) {
    case 'AGENT_COMMAND': return 'Working on your request'
    case 'APPLY_COMMENTS': return 'Applying submitted comments'
    case 'APPLY_TWEAKS': return 'Applying selected tweaks'
    case 'SINGLE_SLIDE': return 'Composing one slide'
    case 'REGENERATE_SLIDE': return 'Rebuilding selected slide'
    default: return 'Composing slide HTML'
  }
}

function progressStepIcon(state: 'done' | 'active' | 'blocked' | 'idle') {
  if (state === 'done') return 'i-heroicons-check-circle'
  if (state === 'active') return 'i-heroicons-arrow-path'
  if (state === 'blocked') return 'i-heroicons-exclamation-triangle'
  return 'i-heroicons-minus-circle'
}

function progressStepClass(state: 'done' | 'active' | 'blocked' | 'idle') {
  if (state === 'done') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (state === 'active') return 'border-indigo-100 bg-indigo-50 text-indigo-700'
  if (state === 'blocked') return 'border-rose-100 bg-rose-50 text-rose-700'
  return 'border-border bg-surface text-fg-muted'
}

function formatRunDate(v: string) {
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(v))
}
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] overflow-hidden bg-bg text-fg">
    <aside v-show="leftPanelOpen" class="absolute inset-y-0 left-0 z-30 flex h-full min-h-0 w-[min(88vw,320px)] shrink-0 flex-col overflow-hidden border-r border-border bg-surface shadow-lg lg:relative lg:z-auto lg:w-[300px] lg:shadow-sm xl:w-[320px]">
      <div class="shrink-0 border-b border-border p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <NuxtLink to="/" class="text-xs font-bold uppercase tracking-[0.16em] text-fg-subtle transition hover:text-fg">{{ currentWorkspace?.name ?? 'Studio' }}</NuxtLink>
            <button type="button" class="mt-1 flex max-w-full items-center gap-2 text-left" @click="deckListOpen = !deckListOpen">
              <span class="truncate text-lg font-black text-fg">{{ deckDetail?.title ?? selectedDeck?.title ?? 'Untitled deck' }}</span>
              <UIcon :name="deckListOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="h-4 w-4 shrink-0 text-fg-subtle" />
            </button>
          </div>
          <div class="flex items-center gap-1">
            <PxButton variant="ghost" size="sm" icon="i-heroicons-plus" square title="New deck" @click="onCreateDeck" />
            <PxButton variant="ghost" size="sm" icon="i-heroicons-x-mark" square title="Hide panel" @click="leftPanelOpen = false" />
          </div>
        </div>

        <div v-if="deckListOpen" class="mt-4 max-h-72 overflow-y-auto rounded-3xl border border-border bg-bg-subtle p-2 scrollbar-soft">
          <DeckList :decks="decks" :workspaces="workspaces" :selectedDeckId="selectedDeckId" :loading="loadingDecks" @select="selectDeck" @create="onCreateDeck" @rename="openRename" @delete="(id) => { deletingDeckId = id }" @fork="onForkDeck" @move="onMoveDeck" />
          <PxButton v-if="selectedDeckId && currentWorkspaceId" class="mt-2" variant="secondary" size="sm" block @click="onCopyDeck(selectedDeckId, currentWorkspaceId)">Copy in workspace</PxButton>
        </div>

        <div class="mt-4 grid grid-cols-3 rounded-2xl bg-bg-subtle p-1 text-xs font-black text-fg-muted">
          <button type="button" class="rounded-xl px-3 py-2 transition" :class="leftMode === 'chat' ? 'bg-surface text-fg shadow-sm' : 'hover:text-fg'" @click="leftMode = 'chat'">Chat</button>
          <button type="button" class="rounded-xl px-3 py-2 transition" :class="leftMode === 'comments' ? 'bg-surface text-fg shadow-sm' : 'hover:text-fg'" @click="setCommentMode(true)">Comments</button>
          <button type="button" class="rounded-xl px-3 py-2 transition" :class="leftMode === 'files' ? 'bg-surface text-fg shadow-sm' : 'hover:text-fg'" @click="leftMode = 'files'">Files</button>
        </div>
      </div>

      <div ref="chatTranscriptRef" class="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-soft" @scroll="onChatTranscriptScroll">
        <div v-if="leftMode === 'chat'" class="space-y-5">
          <div v-if="deckDetail" class="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span class="font-bold text-fg">{{ deckDetail.title }}</span>
            <span class="h-1 w-1 rounded-full bg-fg-subtle" />
            <span>Slide {{ selectedSlidePosition }}</span>
            <span class="h-1 w-1 rounded-full bg-fg-subtle" />
            <span>Revision {{ deckDetail.currentRevisionNumber }}</span>
          </div>

          <div v-if="visibleRuns.length === 0" class="flex gap-3 text-sm leading-6 text-fg-muted">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-subtle">
              <UIcon name="i-heroicons-sparkles" class="h-4 w-4" />
            </div>
            <p>Tell me what you want to create. I’ll narrate generation progress here like a working assistant, not a job monitor.</p>
          </div>

          <div v-for="run in visibleRuns" :key="run.id" class="space-y-3">
            <template v-if="runTimelineEntries(run).length > 0">
              <div v-for="entry in runTimelineEntries(run)" :key="entry.id">
                <div v-if="entry.kind === 'message'" class="flex" :class="entry.message.role === 'USER' ? 'justify-end' : 'gap-3'">
                  <div v-if="entry.message.role !== 'USER'" class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-subtle ring-1 ring-border">
                    <UIcon :name="messageAvatarIcon(entry.message)" class="h-4 w-4" />
                  </div>
                  <div class="max-w-[88%] rounded-[22px] px-4 py-3 text-sm leading-6" :class="messageBubbleClass(entry.message)">
                    <div class="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] opacity-60">
                      <span>{{ messageAuthorLabel(entry.message) }}</span>
                      <span class="h-1 w-1 rounded-full bg-current" />
                      <span>{{ formatRunDate(entry.message.createdAt) }}</span>
                    </div>
                    <p class="whitespace-pre-wrap">{{ entry.message.content }}</p>
                  </div>
                </div>

                <div v-else class="flex gap-3">
                  <div class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-subtle ring-1 ring-border">
                    <UIcon name="i-heroicons-wrench-screwdriver" class="h-4 w-4" />
                  </div>
                  <details class="min-w-0 flex-1 rounded-2xl border px-3 py-2 text-xs shadow-xs" :class="toolCallStatusClass(entry.toolCall.status)" :open="entry.toolCall.status === 'FAILED'">
                    <summary class="flex cursor-pointer list-none items-center justify-between gap-3 font-bold">
                      <span class="flex min-w-0 items-center gap-2">
                        <UIcon :name="toolCallStatusIcon(entry.toolCall.status)" class="h-4 w-4 shrink-0" :class="entry.toolCall.status === 'RUNNING' ? 'animate-spin' : ''" />
                        <span class="truncate">{{ toolDisplayLabel(entry.toolCall) }}</span>
                      </span>
                      <span class="shrink-0 text-[10px] uppercase tracking-[0.14em] opacity-70">{{ entry.toolCall.status.toLowerCase() }}</span>
                    </summary>
                    <p v-if="entry.toolCall.errorMessage" class="mt-2 text-xs leading-5">{{ entry.toolCall.errorMessage }}</p>
                    <pre v-if="toolPayload(entry.toolCall)" class="mt-2 max-h-44 overflow-auto rounded-xl bg-white/70 p-3 text-[11px] leading-5 text-slate-800 scrollbar-soft">{{ toolPayload(entry.toolCall) }}</pre>
                  </details>
                </div>
              </div>

              <div v-if="run.latestCheckpoint" class="ml-11 rounded-2xl border border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
                <span class="font-black text-fg">Latest checkpoint:</span>
                {{ run.latestCheckpoint.summary ?? run.latestCheckpoint.status.toLowerCase().replaceAll('_', ' ') }}
              </div>

              <div v-if="showRunStatusBanner(run)" class="ml-11 flex gap-2 rounded-2xl border px-3 py-2 text-xs leading-5 shadow-xs" :class="runStatusBannerClass(run)">
                <UIcon :name="runStatusBannerIcon(run)" class="mt-0.5 h-4 w-4 shrink-0" :class="run.status === 'RUNNING' ? 'animate-spin' : ''" />
                <div class="min-w-0 flex-1">
                  <p class="font-bold">{{ runLiveStatusLabel(run) }}</p>
                  <p v-if="run.status === 'FAILED' && run.errorMessage" class="mt-1 opacity-80">{{ run.errorMessage }}</p>
                </div>
                <button
                  v-if="isRunCancellable(run)"
                  type="button"
                  class="shrink-0 rounded-full border border-current/20 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="cancellingRunId === run.id"
                  @click="onCancelGeneration(run.id)"
                >
                  {{ cancellingRunId === run.id ? 'Stopping' : 'Stop' }}
                </button>
              </div>

              <DeckAskModeCard v-if="run.status === 'WAITING_ASK' && run.askQuestion" :run="run" @submit="(answer) => onResumeAsk(run.id, answer)" />
            </template>

            <template v-else>
              <div v-if="run.manualInstruction" class="flex justify-end">
                <div class="max-w-[88%] rounded-[22px] bg-fg px-4 py-3 text-sm leading-6 text-bg shadow-sm">
                  <div class="mb-1 text-[10px] font-black uppercase tracking-[0.16em] opacity-50">You</div>
                  {{ run.manualInstruction }}
                </div>
              </div>

              <div class="flex gap-3">
                <div class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-subtle ring-1 ring-border">
                  <UIcon name="i-heroicons-bolt" class="h-4 w-4" />
                </div>
                <div class="min-w-0 flex-1 space-y-3">
                  <div class="flex items-center gap-2 text-[11px] font-bold text-fg-subtle">
                    <span>PepeteX</span>
                    <span class="h-1 w-1 rounded-full bg-fg-subtle" />
                    <span>{{ formatRunDate(run.createdAt) }}</span>
                  </div>

                  <div v-if="runProgressSteps(run).length > 0" class="space-y-2">
                    <div
                      v-for="step in runProgressSteps(run)"
                      :key="step.label"
                      class="flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold"
                      :class="progressStepClass(step.state)"
                    >
                      <UIcon :name="progressStepIcon(step.state)" class="h-4 w-4" :class="step.state === 'active' ? 'animate-spin' : ''" />
                      <span>{{ step.label }}</span>
                    </div>
                  </div>

                  <DeckAskModeCard v-if="run.status === 'WAITING_ASK' && run.askQuestion" :run="run" @submit="(answer) => onResumeAsk(run.id, answer)" />

                  <button
                    v-if="isRunCancellable(run)"
                    type="button"
                    class="pepetex-btn-ghost px-3 py-1.5 text-xs text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="cancellingRunId === run.id"
                    @click="onCancelGeneration(run.id)"
                  >
                    {{ cancellingRunId === run.id ? 'Stopping generation...' : 'Stop generation' }}
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
        <DeckCommentPanel v-else-if="leftMode === 'comments'" :deckId="selectedDeckId" :slideId="selectedSlideId" :selectedElementId="selectedCommentElementId" :commentMode="commentMode" :canManage="canManage" @update:commentMode="setCommentMode" @applied="refreshDeckDetailPreservingSelection" />
        <DeckReferenceFileManager v-else :deckId="selectedDeckId" :canManage="canManage" @change="refreshDeckDetailPreservingSelection" />
      </div>

      <div v-if="leftMode === 'chat'" class="shrink-0 border-t border-border bg-surface p-4">
        <DeckGenerationComposer :workspaceId="currentWorkspaceId" :deckId="selectedDeckId" :selectedProviderId="selectedProviderId" :selectedModelId="selectedModelId" :selectedCustomPromptId="selectedCustomPromptId" :submitting="submitting" variant="chat" :initialBrief="pendingInitialGeneration?.manualInstruction ?? null" :initialDesignSystemId="pendingInitialGeneration?.designSystemId ?? null" :initialLanguage="(pendingInitialGeneration?.languageCode as 'en' | 'id' | null | undefined) ?? null" :initialEnableImageGeneration="pendingInitialGeneration?.enableImageGeneration ?? false" :initialImageProviderId="pendingInitialGeneration?.imageProviderId ?? null" :initialImageModelId="pendingInitialGeneration?.imageModelId ?? null" @update:selectedProviderId="(v) => selectedProviderId = v" @update:selectedModelId="(v) => selectedModelId = v" @update:selectedCustomPromptId="(v) => selectedCustomPromptId = v" @generate="onGenerate" />
      </div>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 shadow-sm">
        <div class="flex min-w-0 items-center gap-2">
          <PxButton v-if="!leftPanelOpen" variant="ghost" size="sm" icon="i-heroicons-chat-bubble-left-right" square aria-label="Show chat" title="Show chat" @click="leftPanelOpen = true" />
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-[0_3px_10px_var(--px-accent-glow)]" style="background: var(--px-accent-grad)">
            <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="11" height="8" rx="2" stroke="white" stroke-width="2" />
            </svg>
          </span>
          <div class="min-w-0">
            <p class="truncate text-[11px] font-medium text-fg-subtle">{{ currentWorkspace?.name ?? 'Workspace' }} /</p>
            <div class="flex min-w-0 items-center gap-2">
              <h1 class="truncate text-sm font-black text-fg">{{ deckDetail?.title ?? selectedDeck?.title ?? 'Untitled presentation' }}</h1>
              <PxButton
                v-if="selectedDeckId && canManage"
                variant="ghost"
                size="sm"
                icon="i-heroicons-pencil-square"
                square
                aria-label="Rename deck"
                title="Rename deck"
                @click="openRename(selectedDeckId, deckDetail?.title ?? selectedDeck?.title ?? 'Untitled presentation')"
              />
              <PxBadge tone="success" variant="soft" size="xs">Saved</PxBadge>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <PxButton variant="secondary" size="sm" icon="i-heroicons-arrow-path" :disabled="!selectedDeckId" @click="refreshDeckDetailPreservingSelection">Refresh</PxButton>
          <PxButton variant="secondary" size="sm" icon="i-heroicons-share" @click="toast.add({ title: 'Share link copied', color: 'success' })">Share</PxButton>
          <PxButton variant="primary" size="sm" icon="i-heroicons-arrow-down-tray" @click="activeInspector = 'export'">Export PPTX</PxButton>
        </div>
      </header>

      <div class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3">
        <div class="flex items-center gap-1">
          <PxButton v-if="selectedSlideId" variant="ghost" size="sm" icon="i-heroicons-arrow-up" square aria-label="Move slide up" :disabled="selectedSlideIndex <= 0" title="Move slide up" @click="onMoveUp" />
          <PxButton v-if="selectedSlideId" variant="ghost" size="sm" icon="i-heroicons-arrow-down" square aria-label="Move slide down" :disabled="selectedSlideIndex >= (deckDetail?.slides.length ?? 0) - 1" title="Move slide down" @click="onMoveDown" />
          <PxButton v-if="selectedSlideId" variant="ghost" size="sm" icon="i-heroicons-document-duplicate" square aria-label="Duplicate slide" title="Duplicate slide" @click="onDuplicate" />
          <PxButton v-if="selectedSlideId" variant="ghost" size="sm" icon="i-heroicons-trash" square aria-label="Delete slide" title="Delete slide" @click="onDeleteSlide" />
        </div>
        <div class="flex items-center gap-1 overflow-x-auto scrollbar-soft">
          <PxButton variant="ghost" size="sm" icon="i-heroicons-adjustments-horizontal" @click="toggleInspector('tweaks')">Tweaks</PxButton>
          <PxButton :variant="commentMode ? 'primary' : 'ghost'" size="sm" icon="i-heroicons-chat-bubble-left-right" @click="toggleCommentMode">Comment</PxButton>
          <PxButton :variant="activeInspector === 'edit' ? 'primary' : 'ghost'" size="sm" icon="i-heroicons-pencil-square" @click="toggleInspector('edit')">Edit</PxButton>
          <PxButton :variant="activeInspector === 'history' ? 'primary' : 'ghost'" size="sm" icon="i-heroicons-clock" @click="toggleInspector('history')">History</PxButton>
          <div class="ml-2 flex items-center rounded-2xl border border-border bg-bg-subtle p-1 text-xs font-black text-fg-muted">
            <button type="button" class="px-focus-ring rounded-xl px-2 py-1 hover:bg-surface" @click="setZoom(zoom - 10)">−</button>
            <span class="min-w-12 text-center text-fg">{{ zoom }}%</span>
            <button type="button" class="px-focus-ring rounded-xl px-2 py-1 hover:bg-surface" @click="setZoom(zoom + 10)">+</button>
          </div>
        </div>
      </div>

      <div v-if="activeInspector === 'tweaks'" class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-bg-subtle px-4 py-2 scrollbar-soft">
        <span class="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-fg-subtle">Quick tweaks</span>
        <button v-for="cat in tweakCategories" :key="cat.key" type="button" class="px-focus-ring shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold text-fg-muted shadow-xs transition hover:border-accent hover:text-fg">{{ cat.label }}</button>
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden bg-[#111113]">
        <div class="absolute inset-0 opacity-20 px-grid-bg" />
        <div v-if="loadingDetail" class="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/55">Loading deck…</div>
        <div v-else-if="!deckDetail" class="absolute inset-0 flex items-center justify-center p-6">
          <div class="max-w-md rounded-[32px] bg-surface p-8 text-center shadow-xl">
            <div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[24px] bg-fg text-bg"><UIcon name="i-heroicons-sparkles" class="h-8 w-8" /></div>
            <p class="pepetex-label">Loading project</p>
            <h2 class="mt-2 text-3xl font-black tracking-tight text-fg">Opening this deck</h2>
            <p class="mt-3 text-sm leading-6 text-fg-muted">If this keeps spinning, check your workspace permission or return to Studio.</p>
            <NuxtLink to="/" class="pepetex-btn-primary mt-6 px-5 py-3 text-sm">Back to Studio</NuxtLink>
          </div>
        </div>
        <div v-else class="absolute inset-0 flex items-center justify-center p-4 md:p-6">
          <div class="transition-all" :style="previewFrameStyle">
            <DeckSlidePreview :slide="previewSlide" :deckTitle="previewDeckTitle" :fontFaces="previewFontFaces" :commentMode="commentMode" :interactionMode="previewInteractionMode" :selectedElementId="previewSelectedElementId" class="w-full shadow-2xl shadow-black/40" @element-click="onPreviewElementClick" />
          </div>
          <div v-if="showingDraftPreview" class="pointer-events-none absolute top-5 left-1/2 z-10 -translate-x-1/2 rounded-full border border-cyan-300/30 bg-cyan-950/80 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-100 shadow-xl shadow-black/20 backdrop-blur">
            Previewing latest checkpoint
          </div>
          <div class="pointer-events-none absolute bottom-5 left-0 right-0 z-10 flex justify-center">
            <div class="pointer-events-auto flex items-center gap-3 rounded-full bg-black/85 px-4 py-2 text-xs font-black text-white shadow-xl shadow-black/30 backdrop-blur">
              <button type="button" class="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30" :disabled="previewSlideIndex <= 0" @click="selectedSlideId = previewSlides[previewSlideIndex - 1]?.id ?? selectedSlideId"><UIcon name="i-heroicons-chevron-left" class="h-4 w-4" /></button>
              <span class="min-w-12 text-center">{{ selectedSlidePosition }}</span>
              <button type="button" class="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30" :disabled="previewSlideIndex >= previewSlides.length - 1" @click="selectedSlideId = previewSlides[previewSlideIndex + 1]?.id ?? selectedSlideId"><UIcon name="i-heroicons-chevron-right" class="h-4 w-4" /></button>
              <span class="h-4 w-px bg-white/20" />
              <button type="button" class="rounded-full px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white" @click="setZoom(100)">Reset</button>
            </div>
          </div>
        </div>
      </div>

      <div class="shrink-0 border-t border-border bg-surface"><DeckSlideStrip :slides="previewSlides" :selectedSlideId="previewSlide?.id ?? selectedSlideId" :deckTitle="previewDeckTitle" :fontFaces="previewFontFaces" @select="(id) => { selectedSlideId = id }" /></div>
      <section class="h-24 shrink-0 border-t border-border bg-surface px-4 py-2.5">
        <div class="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-fg-subtle"><span>Speaker notes</span><span>{{ selectedSlidePosition }}</span></div>
        <p class="line-clamp-2 text-sm leading-6 text-fg-muted">{{ selectedSlideNote }}</p>
      </section>
    </section>

    <PxInspectorPanel v-if="activeInspector" :title="activeInspector" eyebrow="Inspector" @close="activeInspector = null">
        <DeckTextEditor v-if="activeInspector === 'edit'" :fields="selectedSlide?.editableFields ?? []" :selectedFieldId="selectedFieldId" :canManage="canManage" :saving="savingText" @update:selectedFieldId="(v) => { selectedFieldId = v }" @save="onSaveText" />
        <DeckTweakPanel v-else-if="activeInspector === 'tweaks'" :deckId="selectedDeckId" :canManage="canManage" @applied="refreshDeckDetailPreservingSelection" />
        <div v-else-if="activeInspector === 'history'" class="space-y-4">
          <DeckGenerationPanel :activeRun="activeRun" :runHistory="runHistory" :deckId="selectedDeckId" @resumeAsk="onResumeAsk" @cancelRun="onCancelGeneration" @refresh="refreshDeckDetailPreservingSelection" />
          <DeckRevisionPanel :revisions="deckDetail?.revisions ?? []" :currentRevisionNumber="deckDetail?.currentRevisionNumber ?? 0" :canManage="canManage" @restore="onRestoreRevision" />
        </div>
        <DeckExportPanel v-else :deckId="selectedDeckId" />
    </PxInspectorPanel>
  </div>

  <div v-if="renamingDeck" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
    <div class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl">
      <h3 class="text-lg font-black text-fg">Rename deck</h3>
      <input v-model="renameTitle" type="text" class="pepetex-field mt-4" :disabled="savingRename" @keyup.enter="confirmRename" />
      <div class="mt-4 flex justify-end gap-2">
        <PxButton variant="secondary" :disabled="savingRename" @click="renamingDeck = null">Cancel</PxButton>
        <PxButton variant="primary" :loading="savingRename" :disabled="savingRename || !renameTitle.trim()" @click="confirmRename">Rename</PxButton>
      </div>
    </div>
  </div>
  <div v-if="deletingDeckId" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
    <div class="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl">
      <h3 class="text-lg font-black text-fg">Delete deck?</h3>
      <p class="mt-2 text-sm leading-6 text-fg-muted">This cannot be undone. All slides and revisions will be deleted.</p>
      <div class="mt-5 flex justify-end gap-2">
        <PxButton variant="secondary" @click="deletingDeckId = null">Cancel</PxButton>
        <PxButton variant="danger" @click="confirmDelete">Delete</PxButton>
      </div>
    </div>
  </div>
</template>
