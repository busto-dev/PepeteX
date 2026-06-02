export interface InitialGenerationSettings {
  manualInstruction: string
  textProviderId: string | null
  textModelId: string | null
  customPromptId: string | null
  designSystemId: string | null
  languageCode: string
  enableImageGeneration: boolean
  imageProviderId: string | null
  imageModelId: string | null
  /** When true the deck page prefills fields but does not auto-fire generation. */
  prefillOnly?: boolean
}

const STORAGE_KEY_PREFIX = 'pepetex:initial-generation:'

export function serializeInitialGenerationQuery(
  settings: InitialGenerationSettings
): Record<string, string> {
  const query: Record<string, string> = {}

  addOptionalQueryParam(query, 'prompt', settings.manualInstruction)

  addOptionalQueryParam(query, 'textProviderId', settings.textProviderId)
  addOptionalQueryParam(query, 'textModelId', settings.textModelId)
  addOptionalQueryParam(query, 'customPromptId', settings.customPromptId)
  addOptionalQueryParam(query, 'designSystemId', settings.designSystemId)
  addOptionalQueryParam(query, 'languageCode', settings.languageCode || 'en')

  if (settings.enableImageGeneration) query.enableImageGeneration = '1'
  if (settings.enableImageGeneration) {
    addOptionalQueryParam(query, 'imageProviderId', settings.imageProviderId)
    addOptionalQueryParam(query, 'imageModelId', settings.imageModelId)
  }
  if (settings.prefillOnly) query.prefillOnly = '1'

  return query
}

export function storeInitialGenerationSettings(deckId: string, settings: InitialGenerationSettings) {
  if (!import.meta.client) return
  window.sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${deckId}`, JSON.stringify(settings))
}

export function readStoredInitialGenerationSettings(deckId: string): InitialGenerationSettings | null {
  if (!import.meta.client) return null
  const raw = window.sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${deckId}`)
  if (!raw) return null
  try {
    return parseStoredInitialGenerationSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearStoredInitialGenerationSettings(deckId: string) {
  if (!import.meta.client) return
  window.sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${deckId}`)
}

export function parseInitialGenerationQuery(
  query: Record<string, unknown>
): InitialGenerationSettings | null {
  if (!hasInitialGenerationQuery(query)) return null
  const manualInstruction = readQueryString(query.prompt)?.trim() ?? ''

  return {
    manualInstruction,
    textProviderId: readQueryString(query.textProviderId),
    textModelId: readQueryString(query.textModelId),
    customPromptId: readQueryString(query.customPromptId),
    designSystemId: readQueryString(query.designSystemId),
    languageCode: readQueryString(query.languageCode) || 'en',
    enableImageGeneration: readQueryBoolean(query.enableImageGeneration),
    imageProviderId: readQueryString(query.imageProviderId),
    imageModelId: readQueryString(query.imageModelId),
    prefillOnly: readQueryBoolean(query.prefillOnly)
  }
}

function addOptionalQueryParam(query: Record<string, string>, key: string, value: string | null) {
  const normalized = value?.trim()
  if (normalized) query[key] = normalized
}

function readQueryString(value: unknown): string | null {
  const entry = Array.isArray(value) ? value[0] : value
  return typeof entry === 'string' && entry.trim() ? entry.trim() : null
}

function readQueryBoolean(value: unknown): boolean {
  const entry = readQueryString(value)
  return entry === '1' || entry === 'true'
}

function parseStoredInitialGenerationSettings(value: unknown): InitialGenerationSettings | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!hasStoredInitialGenerationSettings(record)) return null
  const manualInstruction = readQueryString(record.manualInstruction)?.trim() ?? ''

  return {
    manualInstruction,
    textProviderId: readQueryString(record.textProviderId),
    textModelId: readQueryString(record.textModelId),
    customPromptId: readQueryString(record.customPromptId),
    designSystemId: readQueryString(record.designSystemId),
    languageCode: readQueryString(record.languageCode) || 'en',
    enableImageGeneration: readStoredBoolean(record.enableImageGeneration),
    imageProviderId: readQueryString(record.imageProviderId),
    imageModelId: readQueryString(record.imageModelId),
    prefillOnly: readStoredBoolean(record.prefillOnly)
  }
}

function readStoredBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return readQueryBoolean(value)
}

function hasInitialGenerationQuery(query: Record<string, unknown>): boolean {
  return [
    'prompt',
    'textProviderId',
    'textModelId',
    'customPromptId',
    'designSystemId',
    'languageCode',
    'enableImageGeneration',
    'imageProviderId',
    'imageModelId',
    'prefillOnly'
  ].some((key) => {
    if (!(key in query)) return false
    if (key === 'enableImageGeneration' || key === 'prefillOnly') return readQueryBoolean(query[key])
    return readQueryString(query[key]) !== null
  })
}

function hasStoredInitialGenerationSettings(record: Record<string, unknown>): boolean {
  return [
    'manualInstruction',
    'textProviderId',
    'textModelId',
    'customPromptId',
    'designSystemId',
    'languageCode',
    'enableImageGeneration',
    'imageProviderId',
    'imageModelId',
    'prefillOnly'
  ].some((key) => key in record)
}
