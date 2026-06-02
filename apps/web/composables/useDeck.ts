import type { DeckDetail, DeckSummary } from '~/types'

type ApplyDetailOptions = {
  preferredSlideId?: string | null
  preferredFieldId?: string | null
}

export const useDeck = () => {
  const decks = useState<DeckSummary[]>('deck:list', () => [])
  const selectedDeckId = useState<string | null>('deck:selected-id', () => null)
  const deckDetail = useState<DeckDetail | null>('deck:detail', () => null)
  const selectedSlideId = useState<string | null>('deck:selected-slide-id', () => null)
  const selectedFieldId = useState<string | null>('deck:selected-field-id', () => null)
  const loadingDecks = useState('deck:loading-list', () => false)
  const loadingDetail = useState('deck:loading-detail', () => false)

  const selectedDeck = computed(() => decks.value.find((d) => d.id === selectedDeckId.value) ?? null)
  const selectedSlide = computed(
    () => deckDetail.value?.slides.find((s) => s.id === selectedSlideId.value) ?? null
  )
  const selectedSlideIndex = computed(
    () => deckDetail.value?.slides.findIndex((s) => s.id === selectedSlideId.value) ?? -1
  )
  const selectedField = computed(
    () =>
      selectedSlide.value?.editableFields.find((f) => f.elementId === selectedFieldId.value) ??
      selectedSlide.value?.editableFields[0] ??
      null
  )
  const canManage = computed(() => {
    const role = deckDetail.value?.currentUserRole ?? selectedDeck.value?.currentUserRole
    return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR'
  })

  async function loadDecks(workspaceId: string) {
    loadingDecks.value = true
    try {
      const data = await $fetch<{ decks: DeckSummary[] }>(`/api/workspaces/${workspaceId}/decks`)
      decks.value = data.decks
      if (!data.decks.find((d) => d.id === selectedDeckId.value)) {
        selectedDeckId.value = data.decks[0]?.id ?? null
      }
    } finally {
      loadingDecks.value = false
    }
  }

  function applyDetail(detail: DeckDetail, options: ApplyDetailOptions = {}) {
    deckDetail.value = detail
    const nextSlideId = options.preferredSlideId ?? selectedSlideId.value
    selectedSlideId.value = detail.slides.find((s) => s.id === nextSlideId)?.id ?? detail.slides[0]?.id ?? null

    const fields = detail.slides.find((s) => s.id === selectedSlideId.value)?.editableFields ?? []
    const nextFieldId = options.preferredFieldId ?? selectedFieldId.value
    selectedFieldId.value = fields.find((f) => f.elementId === nextFieldId)?.elementId ?? fields[0]?.elementId ?? null
  }

  async function loadDetail(deckId: string, options: ApplyDetailOptions = {}) {
    loadingDetail.value = true
    try {
      const data = await $fetch<{ deck: DeckDetail }>(`/api/decks/${deckId}`)
      applyDetail(data.deck, options)
    } finally {
      loadingDetail.value = false
    }
  }

  async function refreshDetail(options: ApplyDetailOptions = {}) {
    if (selectedDeckId.value) await loadDetail(selectedDeckId.value, options)
  }

  async function createDeck(workspaceId: string, title: string): Promise<DeckSummary> {
    const data = await $fetch<{ deck: DeckSummary }>(`/api/workspaces/${workspaceId}/decks`, {
      method: 'POST',
      body: { title }
    })
    await loadDecks(workspaceId)
    selectedDeckId.value = data.deck.id
    return data.deck
  }

  async function renameDeck(deckId: string, title: string) {
    const data = await $fetch<{ deck: DeckSummary }>(`/api/decks/${deckId}`, {
      method: 'PATCH',
      body: { title }
    })
    await loadDecks(data.deck.workspaceId)
    await loadDetail(deckId)
  }

  async function deleteDeck(deckId: string, workspaceId: string) {
    await $fetch(`/api/decks/${deckId}`, { method: 'DELETE' })
    deckDetail.value = null
    selectedDeckId.value = null
    await loadDecks(workspaceId)
  }

  async function forkDeck(deckId: string, targetWorkspaceId: string): Promise<DeckSummary> {
    const data = await $fetch<{ deck: DeckSummary }>(`/api/decks/${deckId}/fork`, {
      method: 'POST',
      body: { targetWorkspaceId }
    })
    await loadDecks(data.deck.workspaceId)
    selectedDeckId.value = data.deck.id
    return data.deck
  }

  async function copyDeck(deckId: string, targetWorkspaceId: string): Promise<DeckSummary> {
    const data = await $fetch<{ deck: DeckSummary }>(`/api/decks/${deckId}/copy`, {
      method: 'POST',
      body: { targetWorkspaceId }
    })
    await loadDecks(data.deck.workspaceId)
    selectedDeckId.value = data.deck.id
    return data.deck
  }

  async function moveDeckToWorkspace(deckId: string, targetWorkspaceId: string): Promise<DeckSummary> {
    const data = await $fetch<{ deck: DeckSummary }>(`/api/decks/${deckId}/move`, {
      method: 'POST',
      body: { targetWorkspaceId }
    })
    await loadDecks(data.deck.workspaceId)
    selectedDeckId.value = data.deck.id
    return data.deck
  }

  async function duplicateSlide(deckId: string, slideId: string) {
    const data = await $fetch<{ deck: DeckDetail }>(`/api/decks/${deckId}/slides/${slideId}/duplicate`, {
      method: 'POST'
    })
    applyDetail(data.deck)
  }

  async function moveSlide(deckId: string, slideId: string, toIndex: number) {
    const data = await $fetch<{ deck: DeckDetail }>(`/api/decks/${deckId}/slides/reorder`, {
      method: 'PATCH',
      body: { slideId, toIndex }
    })
    applyDetail(data.deck)
    selectedSlideId.value = slideId
  }

  async function deleteSlide(deckId: string, slideId: string) {
    const data = await $fetch<{ deck: DeckDetail }>(`/api/decks/${deckId}/slides/${slideId}`, {
      method: 'DELETE'
    })
    applyDetail(data.deck)
  }

  async function saveText(deckId: string, slideId: string, elementId: string, text: string) {
    const data = await $fetch<{ deck: DeckDetail }>(`/api/decks/${deckId}/slides/${slideId}/text`, {
      method: 'PATCH',
      body: { elementId, text }
    })
    applyDetail(data.deck, { preferredSlideId: slideId, preferredFieldId: elementId })
  }

  async function restoreRevision(deckId: string, revisionId: string) {
    const data = await $fetch<{ deck: DeckDetail }>(`/api/decks/${deckId}/revisions/${revisionId}/restore`, {
      method: 'POST'
    })
    applyDetail(data.deck)
  }

  function clearDeck() {
    deckDetail.value = null
    selectedDeckId.value = null
    selectedSlideId.value = null
    selectedFieldId.value = null
  }

  return {
    decks,
    selectedDeckId,
    deckDetail,
    selectedSlideId,
    selectedFieldId,
    loadingDecks,
    loadingDetail,
    selectedDeck,
    selectedSlide,
    selectedSlideIndex,
    selectedField,
    canManage,
    loadDecks,
    loadDetail,
    refreshDetail,
    createDeck,
    renameDeck,
    deleteDeck,
    forkDeck,
    copyDeck,
    moveDeckToWorkspace,
    duplicateSlide,
    moveSlide,
    deleteSlide,
    saveText,
    restoreRevision,
    clearDeck,
  }
}
