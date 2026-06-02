// ---------------------------------------------------------------------------
// Shared client-side TypeScript types mirroring server-side API response shapes.
// Do NOT import from server packages here — these are plain TS interfaces only.
// ---------------------------------------------------------------------------

// ─── Auth / User ────────────────────────────────────────────────────────────

export interface UserProfile {
  name: string | null
  avatarUrl: string | null
  uiLanguage: string
  themePreference: string
  defaultWorkspaceId: string | null
}

export interface User {
  id: string
  email: string
  globalRole: 'GLOBAL_ADMIN' | 'USER'
  profile: UserProfile | null
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER'
export type WorkspaceType = 'PERSONAL' | 'SHARED'

export interface WorkspaceSummary {
  id: string
  name: string
  type: WorkspaceType
  currentUserRole: WorkspaceRole
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMemberSummary {
  id: string
  userId: string
  email: string
  name: string | null
  avatarUrl: string | null
  role: WorkspaceRole
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMemberCandidateSummary {
  userId: string
  email: string
  name: string | null
  avatarUrl: string | null
}

export interface WorkspaceProviderPolicy {
  id: string
  workspaceId: string
  providerDefinitionId: string
  providerName: string
  providerKind: string
  providerEnabled: boolean
  allowedModelIds: string[]
  createdAt: string
  updatedAt: string
}

// ─── Deck ────────────────────────────────────────────────────────────────────

export interface DeckEditableField {
  elementId: string
  elementType: 'headline' | 'body' | 'cta'
  label: string
  text: string
}

export interface DeckSlideDetail {
  id: string
  title: string
  html: string
  css: string
  editableFields: DeckEditableField[]
}

export interface DeckRevisionSummary {
  id: string
  revisionNumber: number
  label: string
  source: string
  summary: string | null
  slideCount: number
  createdAt: string
  createdBy: { id: string; email: string; name: string | null }
  restoredFromRevisionNumber: number | null
}

export interface DeckSummary {
  id: string
  workspaceId: string
  workspaceName: string
  workspaceType: WorkspaceType
  title: string
  slideCount?: number
  referenceFileCount: number
  currentUserRole: WorkspaceRole
  createdAt: string
  updatedAt: string
}

export interface DeckDetail extends DeckSummary {
  language: string
  aspectRatio: '16:9'
  canvas: { width: 1920; height: 1080 }
  fonts?: Array<{
    id?: string
    fontFamily: string
    fontAliases?: string[]
    mimeType: string
    dataUrl: string
    fontWeight?: number | string | null
    fontStyle?: string | null
  }>
  currentRevisionNumber: number
  slides: DeckSlideDetail[]
  revisions: DeckRevisionSummary[]
}

// ─── Reference Files ─────────────────────────────────────────────────────────

export interface ReferenceFileSummary {
  id: string
  purpose: string
  assetRole: string | null
  originalFilename: string
  mimeType: string
  sizeBytes: number
  pageCount: number | null
  imageWidth: number | null
  imageHeight: number | null
  expiresAt: string | null
  createdAt: string
}

// ─── Providers ───────────────────────────────────────────────────────────────

export type ProviderKind = 'gemini' | 'openai-compatible' | 'cliproxyapi'

export interface ProviderCredentialSummary {
  id: string
  scope: 'user' | 'system'
  label: string
  apiKeyPreview: string
  manualModels?: ModelDescriptor[]
  createdAt: string
  updatedAt: string
}

export interface ProviderSummary {
  id: string
  name: string
  kind: string
  enabled: boolean
  allowUserCredentials: boolean
  baseUrl: string | null
  hasSystemCredential: boolean
  userCredentials: ProviderCredentialSummary[]
  systemCredentials?: ProviderCredentialSummary[]
}

export interface ModelDescriptor {
  id: string
  label: string
  supportsFileUpload?: boolean | null
  maxOutputTokens?: number | null
}

export interface ProviderModelsResult {
  providerId: string
  kind: string
  credentialScope: 'user' | 'system'
  models: ModelDescriptor[]
  defaultModelId: string | null
  configurationError?: string
}

// ─── Generation Runs ─────────────────────────────────────────────────────────

export type GenerationRunKind =
  | 'AGENT_COMMAND'
  | 'FULL_DECK'
  | 'SINGLE_SLIDE'
  | 'REGENERATE_SLIDE'
  | 'APPLY_COMMENTS'
  | 'APPLY_TWEAKS'
  | 'GENERATE_IMAGE'
  | 'REGENERATE_IMAGE'

export type GenerationRunStatus = 'PENDING' | 'RUNNING' | 'WAITING_ASK' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type GenerationMessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER'
export type GenerationToolCallStatus = 'RUNNING' | 'COMPLETED' | 'FAILED'
export type GenerationCheckpointStatus = 'DRAFT' | 'VALIDATED' | 'VALIDATION_FAILED' | 'COMMITTED'

export interface AskOption {
  id: string
  label: string
  description?: string
  value: unknown
}

export interface GenerationMessageSummary {
  id: string
  role: GenerationMessageRole
  content: string
  metadata: unknown
  createdAt: string
}

export interface GenerationToolCallSummary {
  id: string
  mastraToolCallId: string | null
  name: string
  label: string
  status: GenerationToolCallStatus
  inputJson: unknown
  resultJson: unknown
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GenerationCheckpointSummary {
  id: string
  status: GenerationCheckpointStatus
  summary: string | null
  deckJson: unknown
  validationJson: unknown
  revisionId: string | null
  createdAt: string
}

export interface GenerationRunSummary {
  id: string
  deckId: string
  kind: GenerationRunKind
  status: GenerationRunStatus
  statusMessage?: string | null
  textProviderId: string | null
  textModelId: string | null
  imageEnabled: boolean
  imageProviderId: string | null
  imageModelId: string | null
  customPromptId: string | null
  designSystemId: string | null
  languageCode: string
  manualInstruction: string | null
  targetSlideId: string | null
  targetElementId: string | null
  commandContextJson: unknown
  resultRevisionId: string | null
  aiSummary: string | null
  errorMessage: string | null
  mastraResourceId: string | null
  mastraThreadId: string | null
  mastraRunId: string | null
  agentTraceId: string | null
  agentMode: string | null
  agentStepCount: number
  inputTokensUsed: number
  outputTokensUsed: number
  askQuestion: string | null
  askOptionsJson: AskOption[] | null
  askAllowManualAnswer: boolean
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  messages: GenerationMessageSummary[]
  toolCalls: GenerationToolCallSummary[]
  latestCheckpoint: GenerationCheckpointSummary | null
}

// ─── Comments ────────────────────────────────────────────────────────────────

export type CommentStatus = 'OPEN' | 'SUBMITTED' | 'APPLIED' | 'RESOLVED' | 'REJECTED'

export interface CommentSummary {
  id: string
  deckId: string
  slideId: string | null
  elementIds: string[]
  text: string
  status: CommentStatus
  isOwn: boolean
  author: { id: string; email: string; name: string | null }
  createdAt: string
  updatedAt: string
}

// ─── Tweaks ──────────────────────────────────────────────────────────────────

export type TweakBatchStatus = 'PENDING' | 'SUBMITTED' | 'APPLIED'

export interface TweakItem {
  id: string
  scope: string
  slideId: string | null
  elementId: string | null
  category: string
  value: unknown
  createdAt: string
  updatedAt: string
}

export interface TweakBatch {
  id: string
  deckId: string
  status: TweakBatchStatus
  submittedAt: string | null
  appliedAt: string | null
  createdAt: string
  items: TweakItem[]
}

// ─── Custom Prompts ──────────────────────────────────────────────────────────

export type CustomPromptScope = 'personal' | 'workspace' | 'global'

export interface CustomPromptVariant {
  languageCode: string
  instruction: string
}

export interface CustomPromptSummary {
  id: string
  title: string
  description?: string | null
  scope: CustomPromptScope
  workspaceId: string | null
  workspaceName?: string | null
  category: string | null
  tags: string[]
  variants: CustomPromptVariant[]
  createdAt: string
  updatedAt: string
}

// ─── Design Systems ──────────────────────────────────────────────────────────

export type DesignSystemScope = 'personal' | 'workspace' | 'global'

export interface DesignSystemColorToken {
  id: string
  label: string
  value: string
  usage: string | null
}

export interface DesignSystemTypographyToken {
  id: string
  label: string
  fontFamily: string
  fontSizePx: number
  fontWeight: number
  lineHeight: number
  fontAssetId?: string | null
}

export interface DesignSystemSpacingToken {
  id: string
  label: string
  valuePx: number
}

export interface DesignSystemTokenSet {
  colors: DesignSystemColorToken[]
  typography: DesignSystemTypographyToken[]
  spacing: DesignSystemSpacingToken[]
}

export interface DesignSystemComponent {
  id: string
  name: string
  kind: string
  description: string | null
  html: string
  css: string
}

export interface DesignSystemExampleSlide {
  id: string
  name: string
  purpose: string
  html: string
  css: string
}

export interface DesignSystemDocument {
  tokens: DesignSystemTokenSet
  components: DesignSystemComponent[]
  exampleSlides: DesignSystemExampleSlide[]
}

export interface DesignSystemSummary {
  id: string
  name: string
  description?: string | null
  scope: DesignSystemScope
  workspaceId: string | null
  workspaceName?: string | null
  isEnabled: boolean
  currentVersionNumber: number
  versionCount?: number
  createdAt: string
  updatedAt: string
  currentVersion?: DesignSystemVersionSummary
}

export interface DesignSystemVersionSummary {
  id: string
  versionNumber: number
  label: string | null
  summary: string | null
  createdAt: string
  createdByUser?: { id: string; email: string; name: string | null }
  createdBy?: { id: string; email: string; name: string | null } | null
  counts?: Record<string, number>
}

export interface DesignSystemVersionDetail extends DesignSystemVersionSummary {
  document: DesignSystemDocument
}

export interface DesignSystemDetail extends DesignSystemSummary {
  currentVersion: DesignSystemVersionDetail
  versions: DesignSystemVersionSummary[]
  /** V2 bucketed document (canonical). Present when the version has documentJson. */
  documentV2?: DesignSystemDocumentV2 | null
}

// ─── Design System V2 (flexible bucketed document) ────────────────────────────

export type DesignSystemBucketKind = 'color' | 'typography' | 'spacing' | 'component' | 'example' | 'asset' | 'custom'

export interface DesignSystemV2BaseItem {
  id: string
  label: string
}

export interface DesignSystemV2ColorItem extends DesignSystemV2BaseItem { value: string; usage: string | null }
export interface DesignSystemV2TypographyItem extends DesignSystemV2BaseItem { fontFamily: string; fontSizePx: number; fontWeight: number; lineHeight: number; fontAssetId: string | null }
export interface DesignSystemV2SpacingItem extends DesignSystemV2BaseItem { valuePx: number }
export interface DesignSystemV2ComponentItem extends DesignSystemV2BaseItem { kind: string; description: string | null; html: string; css: string }
export interface DesignSystemV2ExampleItem extends DesignSystemV2BaseItem { purpose: string; html: string; css: string }
export interface DesignSystemV2AssetItem extends DesignSystemV2BaseItem {
  assetKind: string
  source: 'reference' | 'generated'
  referenceFileId: string | null
  generatedImageId: string | null
  prompt: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  description: string | null
}
export interface DesignSystemV2CustomItem extends DesignSystemV2BaseItem { description: string | null; value: string | null }

export type DesignSystemV2Item =
  | DesignSystemV2ColorItem
  | DesignSystemV2TypographyItem
  | DesignSystemV2SpacingItem
  | DesignSystemV2ComponentItem
  | DesignSystemV2ExampleItem
  | DesignSystemV2AssetItem
  | DesignSystemV2CustomItem

export interface DesignSystemV2SubCategory {
  id: string
  label: string
  description: string | null
  items: DesignSystemV2Item[]
}

export interface DesignSystemV2Bucket {
  id: string
  kind: DesignSystemBucketKind
  label: string
  description: string | null
  subCategories: DesignSystemV2SubCategory[]
}

export interface DesignSystemDocumentV2 {
  version: 2
  buckets: DesignSystemV2Bucket[]
}

// ─── Design System agentic generation run ─────────────────────────────────────

export type DesignSystemGenerationRunKind = 'DS_AGENT_COMMAND' | 'DS_FULL_GENERATE'

export interface DesignSystemGenerationRunCheckpoint {
  id: string
  status: GenerationCheckpointStatus
  summary: string | null
  documentJson: DesignSystemDocumentV2 | null
  validationJson: unknown
  versionId: string | null
  createdAt: string
}

export interface DesignSystemGenerationRunSummary {
  id: string
  designSystemId: string
  kind: DesignSystemGenerationRunKind
  status: GenerationRunStatus
  textProviderId: string | null
  textModelId: string | null
  imageEnabled: boolean
  imageProviderId: string | null
  imageModelId: string | null
  languageCode: string
  manualInstruction: string | null
  feedbackContextJson: unknown
  resultVersionId: string | null
  aiSummary: string | null
  errorMessage: string | null
  mastraResourceId: string | null
  mastraThreadId: string | null
  mastraRunId: string | null
  agentStepCount: number
  inputTokensUsed: number
  outputTokensUsed: number
  askQuestion: string | null
  askOptionsJson: AskOption[] | null
  askAllowManualAnswer: boolean
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  messages: GenerationMessageSummary[]
  toolCalls: GenerationToolCallSummary[]
  latestCheckpoint: DesignSystemGenerationRunCheckpoint | null
}

export type DesignSystemReferenceFileRole = 'logo' | 'brand-image' | 'font' | 'pdf' | 'other'

export interface DesignSystemReferenceFileSummary {
  id: string
  designSystemId: string
  purpose: string
  assetRole: string | null
  role: DesignSystemReferenceFileRole
  originalFilename: string
  mimeType: string
  extension: string
  sizeBytes: number
  pageCount: string | number | null
  imageWidth: string | number | null
  imageHeight: string | number | null
  storageBucket: string
  storageObjectPath: string
  /** Short-lived signed read URL for image MIME types; null for non-images. */
  previewUrl: string | null
  createdAt: string
  updatedAt: string
}

export type DesignSystemGenerationJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'paused'
  | 'unknown'

export type DesignSystemGenerationProgressStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export interface DesignSystemGenerationMessage {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER'
  content: string
  createdAt: string
}

export interface DesignSystemGenerationToolCall {
  id: string
  name: string
  label: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  createdAt: string
  completedAt: string | null
  errorMessage?: string | null
  inputJson?: unknown
  resultJson?: unknown
}

export interface DesignSystemGenerationProgress {
  status: DesignSystemGenerationProgressStatus
  updatedAt: string
  messages: DesignSystemGenerationMessage[]
  toolCalls: DesignSystemGenerationToolCall[]
  warnings: string[]
  resultVersionNumber?: number
  resultVersionId?: string
  errorMessage?: string
}

export interface DesignSystemGenerationJobStatus {
  jobId: string
  state: DesignSystemGenerationJobState
  attemptsMade: number
  failedReason: string | null
  processedAt: string | null
  finishedAt: string | null
  payload: {
    designSystemId: string
    prompt: string
    description: string | null
    brandColors: string[]
    textProviderId: string
    textModelId: string
    enableImageGeneration: boolean
  }
  progress: DesignSystemGenerationProgress
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface NotificationSummary {
  id: string
  userId: string
  kind: string
  title: string
  body: string | null
  actionUrl: string | null
  metadata: unknown
  readAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Examples ────────────────────────────────────────────────────────────────

export interface ExampleReferenceFileSummary {
  id: string
  promptExampleId: string
  purpose: 'REFERENCE' | 'ASSET'
  assetRole: 'LOGO' | 'IMAGE' | 'FONT' | 'OTHER' | null
  originalFilename: string
  mimeType: string
  extension: string
  sizeBytes: number
  pageCount: number | null
  imageWidth: number | null
  imageHeight: number | null
  storageBucket: string
  storageObjectPath: string
  createdAt: string
  updatedAt: string
}

export interface ExampleSummary {
  id: string
  title: string
  category?: string | null
  promptEn?: string | null
  promptId?: string | null
  promptText?: string | null
  languageCode?: string
  thumbnailUrl: string | null
  isEnabled: boolean
  isPublished?: boolean
  sortOrder: number
  designSystemId?: string | null
  customPromptId?: string | null
  textProviderKind?: string | null
  textModelId?: string | null
  imageEnabled?: boolean
  imageProviderKind?: string | null
  imageModelId?: string | null
  referenceFiles?: ExampleReferenceFileSummary[]
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminUserSummary {
  id: string
  email: string
  name?: string | null
  globalRole: string
  isGlobalAdmin?: boolean
  createdAt: string
  updatedAt: string
  profile: { name: string | null; avatarUrl: string | null } | null
}

export interface DashboardStats {
  userCount: number
  totalUsers?: number
  workspaceCount: number
  totalWorkspaces?: number
  deckCount: number
  totalDecks?: number
  slideCount?: number
  totalSlides?: number
  generationRunCount: number
  totalGenerationRuns?: number
  totalPptxExports?: number
  failedRunCount: number
  pendingRunCount: number
  activeRunCount: number
}

export interface AdminJobSummary {
  id: string
  deckId?: string
  kind?: GenerationRunKind
  status: string
  queue?: string
  name?: string
  attemptsMade?: number
  maxAttempts?: number
  textProviderId?: string | null
  textModelId?: string | null
  errorMessage?: string | null
  createdAt: string
  completedAt?: string | null
  createdByUser?: { id: string; email: string }
}

export interface AuditLogEntry {
  id: string
  action: string
  actorUserId: string | null
  actorEmail: string | null
  targetUserId: string | null
  resourceType?: string | null
  resourceId?: string | null
  metadata: unknown
  details?: unknown
  createdAt: string
}

export interface UsageStats {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  pendingRuns: number
  activeRuns: number
  generationRuns?: number
  pptxExports?: number
  activeUsers?: number
  tokensUsed?: number
  totalCostUsd?: number | null
  byKind: Record<string, number>
  byProvider?: Array<{ providerId: string; providerName: string; runs: number; tokens: number; costUsd?: number | null }>
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export interface ExportedFileSummary {
  id: string
  deckId: string
  revisionId: string
  fileName: string
  sizeBytes: number
  status: 'COMPLETED' | 'FAILED'
  isFallback: boolean
  fallbackReason: string | null
  exportedAt: string
}

// ─── Image Generation ────────────────────────────────────────────────────────

export interface GeneratedImageSummary {
  id: string
  deckId: string
  prompt: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  friendlyError: string | null
  gcsPath: string | null
  createdAt: string
}
