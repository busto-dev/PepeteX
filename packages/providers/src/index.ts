import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const textProviderKinds = ['gemini', 'openai-compatible', 'cliproxyapi'] as const;
export const providerCredentialScopes = ['user', 'system'] as const;
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_FILE_PROCESSING_TIMEOUT_MS = 60_000;
const GEMINI_FILE_PROCESSING_POLL_INTERVAL_MS = 1_000;
const DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS = 65_536;
const DEFAULT_TEXT_INPUT_TOKEN_LIMIT = 128_000;
const GEMINI_LONG_CONTEXT_INPUT_TOKEN_LIMIT = 1_048_576;

export type TextProviderKind = (typeof textProviderKinds)[number];
export type ProviderCredentialScope = (typeof providerCredentialScopes)[number];

export interface ModelDescriptor {
  id: string;
  label: string;
  supportsFileUpload?: boolean;
}

export type ManualModelDescriptor = Pick<ModelDescriptor, 'id' | 'label'>;

export interface ProviderCredentialPayload {
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  customHeaders?: Record<string, string>;
  manualModels?: ManualModelDescriptor[];
}

export interface ProviderFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type ProviderFetcher = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  }
) => Promise<ProviderFetchResponse>;

export interface ProviderContext {
  baseUrl?: string | null;
  credential: ProviderCredentialPayload;
  manualModelIds?: string[];
  manualModels?: ManualModelDescriptor[];
  fetcher?: ProviderFetcher;
}

export interface ProviderHealth {
  ok: boolean;
  message: string;
  checkedAt: string;
  modelCount?: number;
  diagnostic?: string;
}

export interface StructuredGenerationInput<T> {
  model: string;
  prompt: string;
  systemInstruction?: string;
  schema?: T;
  maxOutputTokens?: number;
  attachments?: StructuredGenerationAttachment[];
}

export interface StructuredGenerationAttachment {
  filename: string;
  mimeType: string;
  contentBase64?: string;
  providerFileId?: string;
  providerFileUri?: string;
  sizeBytes?: number;
}

export interface TokenCountInput {
  model: string;
  contents?: string;
  prompt?: string;
  systemInstruction?: string;
  attachments?: StructuredGenerationAttachment[];
}

export interface TokenCountResult {
  supported: boolean;
  totalTokens: number | null;
  estimated?: boolean;
}

export interface CostEstimateInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimateResult {
  supported: boolean;
  estimatedCostUsd: number | null;
  currency: 'USD';
  basis?: string;
}

export interface StructuredGenerationResult<T> {
  model: string;
  output: T;
}

export interface ProviderFileRef {
  providerFileId: string;
  providerFileUri?: string;
}

export interface ProviderFileUploadInput {
  filename: string;
  mimeType: string;
  content: Uint8Array | ArrayBuffer;
}

export interface ProviderFileDeleteInput {
  providerFileId: string;
}

export interface TextProviderAdapter {
  kind: TextProviderKind;
  listModels(ctx: ProviderContext): Promise<ModelDescriptor[]>;
  testConnection(ctx: ProviderContext): Promise<ProviderHealth>;
  generateStructured<T>(
    input: StructuredGenerationInput<T>,
    ctx: ProviderContext
  ): Promise<StructuredGenerationResult<T>>;
  uploadReferenceFile?(input: ProviderFileUploadInput, ctx: ProviderContext): Promise<ProviderFileRef>;
  deleteReferenceFile?(input: ProviderFileDeleteInput, ctx: ProviderContext): Promise<void>;
  countTokens?(input: TokenCountInput, ctx: ProviderContext): Promise<TokenCountResult>;
  estimateCost(input: CostEstimateInput, ctx: ProviderContext): Promise<CostEstimateResult>;
}

export type CLIProxyRouteKind =
  | 'openai-compatible'
  | 'gemini-compatible'
  | 'claude-compatible'
  | 'unknown';

const PROVIDER_CREDENTIAL_CIPHER_VERSION = 'v1';
const PROVIDER_CREDENTIAL_ALGORITHM = 'aes-256-gcm';

export function encryptProviderCredentialPayload(
  payload: ProviderCredentialPayload,
  encryptionKey: string
): string {
  const key = decodeEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(PROVIDER_CREDENTIAL_ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PROVIDER_CREDENTIAL_CIPHER_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64')
  ].join('.');
}

export function decryptProviderCredentialPayload(
  encryptedPayload: string,
  encryptionKey: string
): ProviderCredentialPayload {
  const [version, ivBase64, authTagBase64, ciphertextBase64] = encryptedPayload.split('.');

  if (
    version !== PROVIDER_CREDENTIAL_CIPHER_VERSION ||
    !ivBase64 ||
    !authTagBase64 ||
    !ciphertextBase64
  ) {
    throw new Error('Provider credential payload format is invalid.');
  }

  const key = decodeEncryptionKey(encryptionKey);
  const decipher = createDecipheriv(
    PROVIDER_CREDENTIAL_ALGORITHM,
    key,
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const payload = JSON.parse(plaintext) as Partial<ProviderCredentialPayload>;

  if (!payload.apiKey || typeof payload.apiKey !== 'string') {
    throw new Error('Provider credential payload is missing the API key.');
  }

  return {
    apiKey: payload.apiKey,
    ...(typeof payload.organizationId === 'string'
      ? { organizationId: payload.organizationId }
      : {}),
    ...(typeof payload.projectId === 'string' ? { projectId: payload.projectId } : {}),
    ...(isStringRecord(payload.customHeaders) ? { customHeaders: payload.customHeaders } : {}),
    ...(Array.isArray(payload.manualModels)
      ? { manualModels: normalizeManualModels(payload.manualModels) }
      : {})
  };
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return '*'.repeat(secret.length);
  }

  const prefix = secret.slice(0, Math.min(4, Math.ceil(secret.length / 4)));
  const suffix = secret.slice(-4);
  const maskedLength = Math.max(secret.length - prefix.length - suffix.length, 0);

  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

export function getProviderCredentialEncryptionKey(env: NodeJS.ProcessEnv): string {
  const raw = env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error(
      'Provider credential encryption key is not configured. Set PROVIDER_CREDENTIAL_ENCRYPTION_KEY.'
    );
  }

  decodeEncryptionKey(raw);
  return raw;
}

export function stableProviderHeaderHash(headers: Record<string, string> | undefined): string | null {
  if (!headers || Object.keys(headers).length === 0) {
    return null;
  }

  const normalizedEntries = Object.entries(headers)
    .map(([key, value]) => [key.trim().toLowerCase(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const digest = createHash('sha256')
    .update(JSON.stringify(normalizedEntries))
    .digest('hex');

  return digest;
}

export function createTextProviderAdapter(kind: TextProviderKind): TextProviderAdapter {
  switch (kind) {
    case 'gemini':
      return createGeminiAdapter();
    case 'openai-compatible':
      return createOpenAICompatibleAdapter();
    case 'cliproxyapi':
      return createCLIProxyAPIAdapter();
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported text provider kind: ${exhaustive as string}`);
    }
  }
}

export function textProviderKindFromPrisma(
  kind: 'GEMINI' | 'OPENAI_COMPATIBLE' | 'CLIPROXYAPI'
): TextProviderKind {
  switch (kind) {
    case 'GEMINI':
      return 'gemini';
    case 'OPENAI_COMPATIBLE':
      return 'openai-compatible';
    case 'CLIPROXYAPI':
      return 'cliproxyapi';
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported Prisma provider kind: ${exhaustive as string}`);
    }
  }
}

export function getModelInputTokenLimit(kind: TextProviderKind, model: string): number {
  const normalizedModelId = normalizeModelId(model);

  if (kind === 'gemini' || (kind === 'cliproxyapi' && normalizedModelId.includes('gemini'))) {
    if (isNonTextTokenModel(normalizedModelId)) {
      return 8_192;
    }

    return GEMINI_LONG_CONTEXT_INPUT_TOKEN_LIMIT;
  }

  return DEFAULT_TEXT_INPUT_TOKEN_LIMIT;
}

function createMultipartBody(
  parts: Array<{
    headers: Record<string, string>;
    body: string | Uint8Array;
  }>
): {
  body: Uint8Array;
  contentType: string;
} {
  const boundary = `pepetex_provider_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const contentType = `multipart/form-data; boundary=${boundary}`;
  const encoder = new TextEncoder();
  const chunks = parts.flatMap((part) => {
    const headerLines = [
      `--${boundary}`,
      ...Object.entries(part.headers).map(([key, value]) => `${key}: ${value}`),
      '',
      ''
    ];
    const headerBytes = encoder.encode(headerLines.join('\r\n'));
    const bodyBytes = typeof part.body === 'string' ? encoder.encode(part.body) : part.body;
    const terminator = encoder.encode('\r\n');

    return [headerBytes, bodyBytes, terminator];
  });

  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body: result,
    contentType
  };
}

function buildGeminiFileUploadUrl(baseUrl: string | null | undefined): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl ?? DEFAULT_GEMINI_BASE_URL);
  const lowerCasedBaseUrl = normalizedBaseUrl.toLowerCase();

  if (lowerCasedBaseUrl.endsWith('/upload/v1beta/files') || lowerCasedBaseUrl.endsWith('/upload/v1/files')) {
    return normalizedBaseUrl;
  }

  if (lowerCasedBaseUrl.endsWith('/upload/v1beta') || lowerCasedBaseUrl.endsWith('/upload/v1')) {
    return `${normalizedBaseUrl}/files`;
  }

  if (lowerCasedBaseUrl.endsWith('/files')) {
    return `${insertGeminiUploadSegment(normalizedBaseUrl.slice(0, -'/files'.length))}/files`;
  }

  if (lowerCasedBaseUrl.endsWith('/v1beta') || lowerCasedBaseUrl.endsWith('/v1')) {
    return `${insertGeminiUploadSegment(normalizedBaseUrl)}/files`;
  }

  return `${normalizedBaseUrl}/upload/v1beta/files`;
}

function buildGeminiFileMetadataBaseUrl(baseUrl: string | null | undefined): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace('/upload/v1beta', '/v1beta').replace('/upload/v1', '/v1');
  const lowerCasedBaseUrl = normalizedBaseUrl.toLowerCase();

  if (lowerCasedBaseUrl.endsWith('/files')) {
    return normalizedBaseUrl;
  }

  if (lowerCasedBaseUrl.endsWith('/v1beta') || lowerCasedBaseUrl.endsWith('/v1')) {
    return `${normalizedBaseUrl}/files`;
  }

  return `${normalizedBaseUrl}/v1beta/files`;
}

function insertGeminiUploadSegment(baseUrl: string): string {
  const lowerCasedBaseUrl = baseUrl.toLowerCase();

  if (lowerCasedBaseUrl.endsWith('/upload/v1beta') || lowerCasedBaseUrl.endsWith('/upload/v1')) {
    return baseUrl;
  }

  if (lowerCasedBaseUrl.endsWith('/v1beta')) {
    return `${baseUrl.slice(0, -'/v1beta'.length)}/upload/v1beta`;
  }

  if (lowerCasedBaseUrl.endsWith('/v1')) {
    return `${baseUrl.slice(0, -'/v1'.length)}/upload/v1`;
  }

  return `${baseUrl}/upload/v1beta`;
}

function buildGeminiFileDeleteUrl(
  baseUrl: string | null | undefined,
  providerFileId: string
): string {
  const filesBaseUrl = buildGeminiFileMetadataBaseUrl(baseUrl);

  if (filesBaseUrl.endsWith('/files')) {
    const normalizedFileId = providerFileId.replace(/^files\//, '');
    return `${filesBaseUrl}/${encodeURIComponent(normalizedFileId)}`;
  }

  return `${filesBaseUrl}/${encodeURIComponent(providerFileId)}`;
}

function buildGeminiFileMetadataUrl(
  baseUrl: string | null | undefined,
  providerFileId: string
): string {
  return buildGeminiFileDeleteUrl(baseUrl, providerFileId);
}

function buildOpenAIFilesUrl(baseUrl: string | null | undefined): string {
  const normalizedBaseUrl = normalizeRequiredBaseUrl(baseUrl, 'OpenAI-compatible');

  if (normalizedBaseUrl.toLowerCase().endsWith('/files')) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/files`;
}

async function uploadGeminiReferenceFile(
  input: ProviderFileUploadInput,
  ctx: ProviderContext
): Promise<ProviderFileRef> {
  const metadataJson = JSON.stringify({
    file: {
      display_name: input.filename
    }
  });
  const fileContent = input.content instanceof ArrayBuffer ? new Uint8Array(input.content) : input.content;
  const { body, contentType } = createMultipartBody([
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: metadataJson
    },
    {
      headers: {
        'Content-Type': input.mimeType
      },
      body: fileContent
    }
  ]);
  const response = await getProviderFetcher(ctx.fetcher)(
    `${buildGeminiFileUploadUrl(ctx.baseUrl)}?uploadType=multipart`,
    {
      method: 'POST',
      headers: {
        ...createGeminiHeaders(ctx.credential),
        'content-type': contentType
      },
      body
    }
  );
  const payload = await readJsonResponse<{
    file?: {
      name?: string;
      uri?: string;
      state?: string;
      error?: { message?: string };
    };
    name?: string;
    uri?: string;
    state?: string;
    error?: { message?: string };
  }>(response, 'Gemini file upload');
  const uploadedFile = payload.file ?? payload;
  let rawProviderFileId = normalizeOptionalString(uploadedFile.name);
  let rawProviderFileUri = normalizeOptionalString(uploadedFile.uri);
  const uploadedState = normalizeOptionalString(uploadedFile.state);

  if (!rawProviderFileId) {
    throw new Error('Gemini file upload returned an empty file name.');
  }

  if (uploadedState === 'FAILED') {
    throw new Error(`Gemini file upload processing failed${uploadedFile.error?.message ? `: ${uploadedFile.error.message}` : '.'}`);
  }

  if (uploadedState === 'PROCESSING') {
    const activeFile = await waitForGeminiFileActive(rawProviderFileId, ctx);
    rawProviderFileId = normalizeOptionalString(activeFile.name) || rawProviderFileId;
    rawProviderFileUri = normalizeOptionalString(activeFile.uri) || rawProviderFileUri;
  }

  return {
    providerFileId: rawProviderFileId,
    ...(rawProviderFileUri ? { providerFileUri: rawProviderFileUri } : {})
  };
}

async function waitForGeminiFileActive(
  providerFileId: string,
  ctx: ProviderContext
): Promise<{ name?: string; uri?: string; state?: string; error?: { message?: string } }> {
  const fetcher = getProviderFetcher(ctx.fetcher);
  const deadline = Date.now() + GEMINI_FILE_PROCESSING_TIMEOUT_MS;
  let lastState = 'PROCESSING';

  while (Date.now() < deadline) {
    await delay(GEMINI_FILE_PROCESSING_POLL_INTERVAL_MS);

    const response = await fetcher(
      buildGeminiFileMetadataUrl(ctx.baseUrl, providerFileId),
      {
        method: 'GET',
        headers: createGeminiHeaders(ctx.credential)
      }
    );
    const file = await readJsonResponse<{ name?: string; uri?: string; state?: string; error?: { message?: string } }>(response, 'Gemini file metadata');
    lastState = normalizeOptionalString(file.state) || lastState;

    if (lastState === 'ACTIVE') return file;

    if (lastState === 'FAILED') {
      throw new Error(`Gemini file processing failed${file.error?.message ? `: ${file.error.message}` : '.'}`);
    }
  }

  throw new Error(`Gemini file ${providerFileId} did not become ACTIVE before timeout; last state was ${lastState}.`);
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deleteGeminiReferenceFile(
  input: ProviderFileDeleteInput,
  ctx: ProviderContext
): Promise<void> {
  const response = await getProviderFetcher(ctx.fetcher)(
    buildGeminiFileDeleteUrl(ctx.baseUrl, input.providerFileId),
    {
      method: 'DELETE',
      headers: createGeminiHeaders(ctx.credential)
    }
  );

  if (!response.ok && response.status !== 404) {
    const diagnostic = await safeReadResponseText(response);

    throw new Error(
      `Gemini file deletion failed with ${response.status} ${response.statusText}${diagnostic ? `: ${diagnostic}` : '.'}`
    );
  }
}

async function uploadOpenAIReferenceFile(
  input: ProviderFileUploadInput,
  ctx: ProviderContext
): Promise<ProviderFileRef> {
  const fileContent = input.content instanceof ArrayBuffer ? new Uint8Array(input.content) : input.content;
  const { body, contentType } = createMultipartBody([
    {
      headers: {
        'Content-Disposition': 'form-data; name="purpose"'
      },
      body: 'references'
    },
    {
      headers: {
        'Content-Disposition': `form-data; name="file"; filename="${input.filename}"`,
        'Content-Type': input.mimeType
      },
      body: fileContent
    }
  ]);
  const response = await getProviderFetcher(ctx.fetcher)(buildOpenAIFilesUrl(ctx.baseUrl), {
    method: 'POST',
    headers: {
      ...createOpenAICompatibleHeaders(ctx.credential),
      'content-type': contentType
    },
    body
  });
  const payload = await readJsonResponse<{
    id?: string;
  }>(response, 'OpenAI-compatible file upload');
  const rawProviderFileId = typeof payload.id === 'string' ? payload.id.trim() : '';

  if (!rawProviderFileId) {
    throw new Error('OpenAI-compatible file upload returned an empty file id.');
  }

  return {
    providerFileId: rawProviderFileId
  };
}

async function deleteOpenAIReferenceFile(
  input: ProviderFileDeleteInput,
  ctx: ProviderContext
): Promise<void> {
  const response = await getProviderFetcher(ctx.fetcher)(
    `${buildOpenAIFilesUrl(ctx.baseUrl)}/${encodeURIComponent(input.providerFileId)}`,
    {
      method: 'DELETE',
      headers: createOpenAICompatibleHeaders(ctx.credential)
    }
  );

  if (!response.ok && response.status !== 404) {
    const diagnostic = await safeReadResponseText(response);

    throw new Error(
      `OpenAI-compatible file deletion failed with ${response.status} ${response.statusText}${diagnostic ? `: ${diagnostic}` : '.'}`
    );
  }
}

async function uploadCLIProxyReferenceFile(
  input: ProviderFileUploadInput,
  ctx: ProviderContext
): Promise<ProviderFileRef> {
  const routeKind = inferCLIProxyRouteKind(normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI'));

  if (routeKind === 'gemini-compatible') {
    return uploadGeminiReferenceFile(input, ctx);
  }

  if (routeKind === 'openai-compatible') {
    return uploadOpenAIReferenceFile(input, ctx);
  }

  throw new Error(
    'CLIProxyAPI reference file upload is supported only for Gemini-compatible and OpenAI-compatible routes.'
  );
}

async function deleteCLIProxyReferenceFile(
  input: ProviderFileDeleteInput,
  ctx: ProviderContext
): Promise<void> {
  const routeKind = inferCLIProxyRouteKind(normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI'));

  if (routeKind === 'gemini-compatible') {
    return deleteGeminiReferenceFile(input, ctx);
  }

  if (routeKind === 'openai-compatible') {
    return deleteOpenAIReferenceFile(input, ctx);
  }

  throw new Error(
    'CLIProxyAPI reference file deletion is supported only for Gemini-compatible and OpenAI-compatible routes.'
  );
}

export function createGeminiAdapter(): TextProviderAdapter {
  return {
    kind: 'gemini',
    listModels: (ctx) => listGeminiModels(ctx),
    testConnection: (ctx) =>
      testProviderConnectionWithModelDiscovery(
        'Gemini',
        () => listGeminiModels(ctx)
      ),
    generateStructured: (input, ctx) => generateGeminiStructured(input, ctx),
    uploadReferenceFile: (input, ctx) => uploadGeminiReferenceFile(input, ctx),
    deleteReferenceFile: (input, ctx) => deleteGeminiReferenceFile(input, ctx),
    countTokens: (input, ctx) => countGeminiTokens(input, ctx),
    estimateCost: async (input) => estimateGeminiCost(input)
  };
}

export function createOpenAICompatibleAdapter(): TextProviderAdapter {
  return {
    kind: 'openai-compatible',
    listModels: (ctx) => listOpenAICompatibleModels(ctx),
    testConnection: (ctx) =>
      testProviderConnectionWithModelDiscovery(
        'OpenAI-compatible',
        () => listOpenAICompatibleModels(ctx)
      ),
    generateStructured: (input, ctx) => generateOpenAICompatibleStructured(input, ctx),
    uploadReferenceFile: (input, ctx) => uploadOpenAIReferenceFile(input, ctx),
    deleteReferenceFile: (input, ctx) => deleteOpenAIReferenceFile(input, ctx),
    countTokens: async (input) => ({
      supported: true,
      totalTokens: estimateTokenCountHeuristic(input),
      estimated: true
    }),
    estimateCost: async (input) => estimateOpenAICompatibleCost(input)
  };
}

export function createCLIProxyAPIAdapter(): TextProviderAdapter {
  return {
    kind: 'cliproxyapi',
    listModels: (ctx) => listCLIProxyModels(ctx),
    testConnection: (ctx) =>
      testProviderConnectionWithModelDiscovery(
        'CLIProxyAPI',
        () => listCLIProxyModels(ctx)
      ),
    generateStructured: (input, ctx) => generateCLIProxyStructured(input, ctx),
    uploadReferenceFile: (input, ctx) => uploadCLIProxyReferenceFile(input, ctx),
    deleteReferenceFile: (input, ctx) => deleteCLIProxyReferenceFile(input, ctx),
    countTokens: (input, ctx) => countCLIProxyTokens(input, ctx),
    estimateCost: async (input, ctx) => estimateCLIProxyCost(input, ctx)
  };
}

export function inferCLIProxyRouteKind(baseUrl: string): CLIProxyRouteKind {
  const normalized = baseUrl.trim().toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  if (normalized.includes('gemini')) {
    return 'gemini-compatible';
  }

  if (normalized.includes('claude') || normalized.includes('anthropic')) {
    return 'claude-compatible';
  }

  if (normalized.includes('openai') || normalized.includes('/v1')) {
    return 'openai-compatible';
  }

  return 'unknown';
}

async function listGeminiModels(ctx: ProviderContext): Promise<ModelDescriptor[]> {
  const manualModels = createManualModelDescriptors(ctx.manualModelIds, ctx.manualModels);
  if (manualModels.length > 0) {
    return dedupeModels(manualModels);
  }

  const response = await getProviderFetcher(ctx.fetcher)(
    buildGeminiModelsUrl(ctx.baseUrl),
    {
      method: 'GET',
      headers: createGeminiHeaders(ctx.credential)
    }
  );
  const payload = await readJsonResponse<GeminiModelsResponse>(
    response,
    'Gemini model discovery'
  );
  const models = (payload.models ?? [])
    .map(normalizeGeminiModelDescriptor)
    .filter((model): model is ModelDescriptor => model !== null);

  return dedupeModels(models);
}

async function listOpenAICompatibleModels(ctx: ProviderContext): Promise<ModelDescriptor[]> {
  const manualModels = createManualModelDescriptors(ctx.manualModelIds, ctx.manualModels);
  if (manualModels.length > 0) {
    return dedupeModels(manualModels);
  }

  const response = await getProviderFetcher(ctx.fetcher)(
    buildOpenAIModelsUrl(ctx.baseUrl),
    {
      method: 'GET',
      headers: createOpenAICompatibleHeaders(ctx.credential)
    }
  );
  const payload = await readJsonResponse<OpenAIModelsResponse>(
    response,
    'OpenAI-compatible model discovery'
  );
  const models = dedupeModels([
    ...(payload.data ?? [])
      .map(normalizeOpenAIModelDescriptor)
      .filter((model): model is ModelDescriptor => model !== null)
  ]);

  return models;
}

async function listCLIProxyModels(ctx: ProviderContext): Promise<ModelDescriptor[]> {
  const baseUrl = normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI');
  const routeKind = inferCLIProxyRouteKind(baseUrl);

  if (routeKind === 'gemini-compatible') {
    return listGeminiModels({
      ...ctx,
      baseUrl
    });
  }

  return listOpenAICompatibleModels({
    ...ctx,
    baseUrl
  });
}

async function testProviderConnectionWithModelDiscovery(
  providerLabel: string,
  discovery: () => Promise<ModelDescriptor[]>
): Promise<ProviderHealth> {
  try {
    const models = await discovery();

    return {
      ok: true,
      message: `${providerLabel} connection is healthy.`,
      checkedAt: new Date().toISOString(),
      modelCount: models.length
    };
  } catch (error) {
    const diagnostic =
      error instanceof Error ? error.message : `${providerLabel} connection test failed.`;

    return {
      ok: false,
      message: `Unable to connect to the ${providerLabel} provider.`,
      checkedAt: new Date().toISOString(),
      diagnostic
    };
  }
}

async function generateGeminiStructured<T>(
  input: StructuredGenerationInput<T>,
  ctx: ProviderContext
): Promise<StructuredGenerationResult<T>> {
  const apiKey = ctx.credential.apiKey;
  if (!apiKey) throw new Error('Gemini generateStructured requires an API key.');

  const baseUrl = (ctx.baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    maxOutputTokens: input.maxOutputTokens ?? DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS
  };

  if (input.schema !== undefined) {
    generationConfig.responseJsonSchema = input.schema;
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: buildGeminiPromptParts(input) }],
    generationConfig
  };

  if (input.systemInstruction) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  const fetcher = ctx.fetcher ?? defaultFetch;
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const candidate = (data.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : null;
  const text = ((candidate?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined)?.[0]?.text as string | undefined;

  if (!text) {
    throw new Error(`Gemini response missing content text. Raw response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  if (finishReason && finishReason !== 'STOP' && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
    throw new Error(`Gemini response stopped with finishReason=${finishReason} before a complete structured result could be parsed. Preview: ${text.slice(0, 500)}`);
  }

  let output: T;
  try {
    output = JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini response content is not valid JSON${finishReason ? ` (finishReason=${finishReason})` : ''}: ${text.slice(0, 500)}`);
  }

  return { model: input.model, output };
}

async function countGeminiTokens(
  input: TokenCountInput,
  ctx: ProviderContext
): Promise<TokenCountResult> {
  const apiKey = ctx.credential.apiKey;
  if (!apiKey) throw new Error('Gemini countTokens requires an API key.');

  const prompt = input.prompt ?? input.contents ?? '';
  const response = await getProviderFetcher(ctx.fetcher)(
    buildGeminiModelActionUrl(ctx.baseUrl, input.model, 'countTokens', apiKey),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ctx.credential.customHeaders ?? {})
      },
      body: JSON.stringify({
        generateContentRequest: {
          model: toGeminiModelResourceName(input.model),
          contents: [
            {
              role: 'user',
              parts: buildGeminiPromptParts({
                model: input.model,
                prompt,
                ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
                ...(input.attachments ? { attachments: input.attachments } : {})
              })
            }
          ],
          ...(input.systemInstruction
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {})
        }
      })
    }
  );
  const payload = await readJsonResponse<{ totalTokens?: unknown }>(response, 'Gemini token counting');
  const totalTokens = Number(payload.totalTokens);

  if (!Number.isFinite(totalTokens)) {
    throw new Error('Gemini token counting returned no totalTokens value.');
  }

  return {
    supported: true,
    totalTokens
  };
}

async function generateOpenAICompatibleStructured<T>(
  input: StructuredGenerationInput<T>,
  ctx: ProviderContext
): Promise<StructuredGenerationResult<T>> {
  const baseUrl = normalizeRequiredBaseUrl(ctx.baseUrl, 'OpenAI-compatible').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (ctx.credential.apiKey) {
    headers['Authorization'] = `Bearer ${ctx.credential.apiKey}`;
  }
  if (ctx.credential.organizationId) {
    headers['OpenAI-Organization'] = ctx.credential.organizationId;
  }
  if (ctx.credential.projectId) {
    headers['OpenAI-Project'] = ctx.credential.projectId;
  }
  if (ctx.credential.customHeaders) {
    Object.assign(headers, ctx.credential.customHeaders);
  }

  const messages: Array<{ role: string; content: string | OpenAIMessageContentPart[] }> = [];
  if (input.systemInstruction) {
    messages.push({ role: 'system', content: input.systemInstruction });
  }
  messages.push({ role: 'user', content: buildOpenAIUserContent(input) });

  const body = { model: input.model, messages, response_format: { type: 'json_object' } };

  const fetcher = ctx.fetcher ?? defaultFetch;
  const response = await fetcher(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const content = ((data.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)?.content as string | undefined;

  if (!content) {
    throw new Error(`OpenAI-compatible response missing message content. Raw: ${JSON.stringify(data).slice(0, 500)}`);
  }

  let output: T;
  try {
    output = JSON.parse(content) as T;
  } catch {
    throw new Error(`OpenAI-compatible response content is not valid JSON: ${content.slice(0, 300)}`);
  }

  return { model: input.model, output };
}

async function generateCLIProxyStructured<T>(
  input: StructuredGenerationInput<T>,
  ctx: ProviderContext
): Promise<StructuredGenerationResult<T>> {
  const routeKind = inferCLIProxyRouteKind(normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI'));

  if (routeKind === 'gemini-compatible') {
    return generateGeminiStructured(input, ctx);
  }

  return generateOpenAICompatibleStructured(input, ctx);
}

async function countCLIProxyTokens(
  input: TokenCountInput,
  ctx: ProviderContext
): Promise<TokenCountResult> {
  const routeKind = inferCLIProxyRouteKind(normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI'));

  if (routeKind === 'gemini-compatible') {
    return countGeminiTokens(input, ctx);
  }

  return {
    supported: true,
    totalTokens: estimateTokenCountHeuristic(input),
    estimated: true
  };
}

function estimateTokenCountHeuristic(input: TokenCountInput): number {
  const textChars = (input.prompt ?? input.contents ?? '').length + (input.systemInstruction?.length ?? 0);
  const attachmentTokens = (input.attachments ?? []).reduce((sum, attachment) => {
    if (attachment.contentBase64) {
      return sum + Math.ceil((attachment.contentBase64.length * 0.75) / 4);
    }

    if (typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)) {
      return sum + Math.ceil(attachment.sizeBytes / 4);
    }

    return sum + Math.ceil(
      [
        attachment.filename,
        attachment.mimeType,
        attachment.providerFileId ?? '',
        attachment.providerFileUri ?? ''
      ].join('\n').length / 4
    );
  }, 0);

  return Math.ceil(textChars / 4) + attachmentTokens;
}

type GeminiPromptPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

function buildGeminiPromptParts(input: StructuredGenerationInput<unknown>): GeminiPromptPart[] {
  return [
    { text: input.prompt },
    ...(input.attachments ?? []).flatMap((attachment): GeminiPromptPart[] => {
      const fileUri = attachment.providerFileUri ?? attachment.providerFileId;
      if (fileUri) {
        return [{
          fileData: {
            mimeType: attachment.mimeType,
            fileUri
          }
        }];
      }

      if (attachment.contentBase64) {
        return [{
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.contentBase64
          }
        }];
      }

      return [];
    })
  ];
}

type OpenAIMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function buildOpenAIUserContent(input: StructuredGenerationInput<unknown>): string | OpenAIMessageContentPart[] {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return input.prompt;

  const parts: OpenAIMessageContentPart[] = [{ type: 'text', text: input.prompt }];

  for (const attachment of attachments) {
    if (attachment.mimeType.startsWith('image/') && attachment.contentBase64) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mimeType};base64,${attachment.contentBase64}`
        }
      });
      continue;
    }

    if (isTextLikeAttachment(attachment.mimeType) && attachment.contentBase64) {
      const text = decodeBase64Text(attachment.contentBase64).slice(0, 24_000);
      if (text.trim()) {
        parts.push({
          type: 'text',
          text: `Attached reference file "${attachment.filename}" (${attachment.mimeType}):\n${text}`
        });
      }
    }
  }

  return parts;
}

function isTextLikeAttachment(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/csv'
    || mimeType === 'text/csv'
    || mimeType === 'application/xml';
}

function decodeBase64Text(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

async function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }
): Promise<ProviderFetchResponse> {
  let response: Response;
  try {
    response = await fetch(url, init as RequestInit);
  } catch (error) {
    throw new Error(
      `Provider network request failed: ${formatProviderFetchError(error)} (${summarizeProviderRequest(url, init)})`
    );
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<unknown>,
    text: () => response.text()
  };
}

function formatProviderFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return `${error.message}; cause=${cause.name}: ${cause.message}`;
  }

  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : null;
    const message = typeof record.message === 'string' ? record.message : null;
    if (code || message) return `${error.message}; cause=${[code, message].filter(Boolean).join(' ')}`;
  }

  return error.message;
}

function summarizeProviderRequest(
  url: string,
  init?: { method?: string; body?: string | Uint8Array }
): string {
  const parsed = new URL(url);
  const bodyBytes = typeof init?.body === 'string'
    ? Buffer.byteLength(init.body, 'utf8')
    : init?.body?.byteLength ?? 0;

  return `method=${init?.method ?? 'GET'}, host=${parsed.host}, path=${parsed.pathname}, bodyBytes=${bodyBytes}`;
}

async function estimateGeminiCost(input: CostEstimateInput): Promise<CostEstimateResult> {
  return estimateTextModelCost(input, GEMINI_TEXT_MODEL_PRICING_RULES);
}

async function estimateOpenAICompatibleCost(input: CostEstimateInput): Promise<CostEstimateResult> {
  return estimateTextModelCost(input, OPENAI_TEXT_MODEL_PRICING_RULES);
}

async function estimateCLIProxyCost(
  input: CostEstimateInput,
  ctx: ProviderContext
): Promise<CostEstimateResult> {
  const routeKind = inferCLIProxyRouteKind(ctx.baseUrl ?? '');

  if (routeKind === 'gemini-compatible') {
    return estimateGeminiCost(input);
  }

  if (routeKind === 'openai-compatible') {
    return estimateOpenAICompatibleCost(input);
  }

  if (routeKind === 'claude-compatible') {
    return {
      supported: false,
      estimatedCostUsd: null,
      currency: 'USD',
      basis:
        'Cost estimation is unavailable for CLIProxyAPI Claude-compatible routes in the current Phase 2 implementation.'
    };
  }

  return {
    supported: false,
    estimatedCostUsd: null,
    currency: 'USD',
    basis:
      'Cost estimation is unavailable because the CLIProxyAPI route kind could not be inferred from the configured base URL.'
  };
}

function estimateTextModelCost(
  input: CostEstimateInput,
  rules: readonly TextModelPricingRule[]
): CostEstimateResult {
  const normalizedModelId = normalizeModelId(input.model);

  if (!normalizedModelId) {
    return {
      supported: false,
      estimatedCostUsd: null,
      currency: 'USD',
      basis: 'A model id is required to estimate cost.'
    };
  }

  if (isNonTextTokenModel(normalizedModelId)) {
    return {
      supported: false,
      estimatedCostUsd: null,
      currency: 'USD',
      basis: `Cost estimation currently supports text-token pricing only; "${input.model}" uses a different billing model.`
    };
  }

  const rule = rules.find((candidate) => candidate.matches(normalizedModelId));

  if (!rule) {
    return {
      supported: false,
      estimatedCostUsd: null,
      currency: 'USD',
      basis: `No built-in pricing rule is available for model "${input.model}".`
    };
  }

  const pricing = rule.resolve(input);
  const estimatedCostUsd =
    (input.inputTokens * pricing.inputCostPerMillionUsd) / 1_000_000 +
    (input.outputTokens * pricing.outputCostPerMillionUsd) / 1_000_000;

  return {
    supported: true,
    estimatedCostUsd: roundUsdEstimate(estimatedCostUsd),
    currency: 'USD',
    basis: pricing.basis
  };
}

function createGeminiHeaders(credential: ProviderCredentialPayload): Record<string, string> {
  return {
    ...(credential.customHeaders ?? {}),
    'x-goog-api-key': credential.apiKey
  };
}

function createOpenAICompatibleHeaders(
  credential: ProviderCredentialPayload
): Record<string, string> {
  return {
    ...(credential.customHeaders ?? {}),
    Authorization: `Bearer ${credential.apiKey}`,
    ...(credential.organizationId ? { 'OpenAI-Organization': credential.organizationId } : {}),
    ...(credential.projectId ? { 'OpenAI-Project': credential.projectId } : {})
  };
}

function buildGeminiModelsUrl(baseUrl: string | null | undefined): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl ?? DEFAULT_GEMINI_BASE_URL);
  const lowerCasedBaseUrl = normalizedBaseUrl.toLowerCase();

  if (lowerCasedBaseUrl.endsWith('/models')) {
    return normalizedBaseUrl;
  }

  if (lowerCasedBaseUrl.endsWith('/v1beta') || lowerCasedBaseUrl.endsWith('/v1')) {
    return `${normalizedBaseUrl}/models`;
  }

  return `${normalizedBaseUrl}/v1beta/models`;
}

function buildGeminiModelActionUrl(
  baseUrl: string | null | undefined,
  model: string,
  action: 'generateContent' | 'countTokens',
  apiKey: string
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl ?? DEFAULT_GEMINI_BASE_URL);
  const apiBase =
    /\/v\d+(beta|alpha)?$/i.test(normalizedBaseUrl)
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1beta`;
  const normalizedModel = normalizeGeminiModelId(model);

  return `${apiBase}/models/${encodeURIComponent(normalizedModel)}:${action}?key=${encodeURIComponent(apiKey)}`;
}

function buildOpenAIModelsUrl(baseUrl: string | null | undefined): string {
  const normalizedBaseUrl = normalizeRequiredBaseUrl(baseUrl, 'OpenAI-compatible');

  if (normalizedBaseUrl.toLowerCase().endsWith('/models')) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/models`;
}

function normalizeGeminiModelDescriptor(model: unknown): ModelDescriptor | null {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return null;
  }

  const candidate = model as {
    name?: unknown;
    displayName?: unknown;
    supportedGenerationMethods?: unknown;
  };
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const supportedGenerationMethods = Array.isArray(candidate.supportedGenerationMethods)
    ? candidate.supportedGenerationMethods.filter((method): method is string => typeof method === 'string')
    : [];

  if (!name || !supportedGenerationMethods.includes('generateContent')) {
    return null;
  }

  const id = normalizeGeminiModelId(name);
  const label =
    typeof candidate.displayName === 'string' && candidate.displayName.trim()
      ? candidate.displayName.trim()
      : id;

  return {
    id,
    label,
    supportsFileUpload: true
  };
}

function normalizeOpenAIModelDescriptor(model: unknown): ModelDescriptor | null {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return null;
  }

  const candidate = model as {
    id?: unknown;
  };
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';

  if (!id) {
    return null;
  }

  return {
    id,
    label: id
  };
}

function createManualModelDescriptors(
  manualModelIds: string[] | undefined,
  manualModels: ManualModelDescriptor[] | undefined
): ModelDescriptor[] {
  const normalizedManualModels = normalizeManualModels(manualModels);
  const normalizedModelIds = (manualModelIds ?? [])
    .map((manualModelId) => manualModelId.trim())
    .filter(Boolean)
    .filter((modelId) => !normalizedManualModels.some((model) => model.id === modelId));

  return [
    ...normalizedManualModels,
    ...normalizedModelIds.map((modelId) => ({
      id: modelId,
      label: modelId
    }))
  ];
}

function normalizeManualModels(value: unknown): ManualModelDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const models: ManualModelDescriptor[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const candidate = entry as { id?: unknown; label?: unknown };
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';

    if (!id) {
      continue;
    }

    models.push({
      id,
      label: label || id
    });
  }

  return models;
}

function dedupeModels(models: ModelDescriptor[]): ModelDescriptor[] {
  const seen = new Set<string>();
  const deduped: ModelDescriptor[] = [];

  for (const model of models) {
    if (seen.has(model.id)) {
      continue;
    }

    seen.add(model.id);
    deduped.push(model);
  }

  return deduped;
}

function normalizeGeminiModelId(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

function toGeminiModelResourceName(name: string): string {
  return `models/${normalizeGeminiModelId(name)}`;
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function isNonTextTokenModel(model: string): boolean {
  return [
    'audio',
    'image',
    'realtime',
    'live',
    'tts',
    'transcribe',
    'transcription',
    'embedding'
  ].some((marker) => model.includes(marker));
}

function roundUsdEstimate(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeRequiredBaseUrl(
  baseUrl: string | null | undefined,
  providerLabel: string
): string {
  const normalizedBaseUrl = baseUrl?.trim();

  if (!normalizedBaseUrl) {
    throw new Error(`${providerLabel} provider base URL is not configured.`);
  }

  return normalizeBaseUrl(normalizedBaseUrl);
}

function getProviderFetcher(fetcher: ProviderFetcher | undefined): ProviderFetcher {
  return (
    fetcher ??
    (async (input, init) =>
      (await fetch(input, init as RequestInit)) as unknown as ProviderFetchResponse)
  );
}

async function readJsonResponse<T>(
  response: ProviderFetchResponse,
  operationLabel: string
): Promise<T> {
  if (!response.ok) {
    const diagnostic = await safeReadResponseText(response);

    throw new Error(
      `${operationLabel} failed with ${response.status} ${response.statusText}${diagnostic ? `: ${diagnostic}` : '.'}`
    );
  }

  return (await response.json()) as T;
}

async function safeReadResponseText(response: ProviderFetchResponse): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 300);
  } catch {
    return '';
  }
}

function decodeEncryptionKey(encryptionKey: string): Buffer {
  const decoded = Buffer.from(encryptionKey, 'base64');

  if (decoded.length !== 32) {
    throw new Error('Provider credential encryption key must decode to exactly 32 bytes.');
  }

  return decoded;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

interface GeminiModelsResponse {
  models?: unknown[];
}

interface OpenAIModelsResponse {
  data?: unknown[];
}

interface TextModelPricing {
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  basis: string;
}

interface TextModelPricingRule {
  matches(model: string): boolean;
  resolve(input: CostEstimateInput): TextModelPricing;
}

function createPrefixPricingRule(
  prefixes: readonly string[],
  pricing: TextModelPricing
): TextModelPricingRule {
  return {
    matches: (model) => prefixes.some((prefix) => model.startsWith(prefix)),
    resolve: () => pricing
  };
}

function createTieredGeminiPricingRule(
  prefixes: readonly string[],
  tiers: {
    thresholdInputTokens: number;
    lower: Omit<TextModelPricing, 'basis'>;
    higher: Omit<TextModelPricing, 'basis'>;
    lowerBasis: string;
    higherBasis: string;
  }
): TextModelPricingRule {
  return {
    matches: (model) => prefixes.some((prefix) => model.startsWith(prefix)),
    resolve: (input) =>
      input.inputTokens > tiers.thresholdInputTokens
        ? {
            ...tiers.higher,
            basis: tiers.higherBasis
          }
        : {
            ...tiers.lower,
            basis: tiers.lowerBasis
          }
  };
}

const GEMINI_TEXT_MODEL_PRICING_RULES: readonly TextModelPricingRule[] = [
  createTieredGeminiPricingRule(['gemini-3.1-pro-preview'], {
    thresholdInputTokens: 200_000,
    lower: {
      inputCostPerMillionUsd: 2,
      outputCostPerMillionUsd: 12
    },
    higher: {
      inputCostPerMillionUsd: 4,
      outputCostPerMillionUsd: 18
    },
    lowerBasis: 'Gemini 3.1 Pro Preview standard pricing for prompts up to 200k input tokens.',
    higherBasis: 'Gemini 3.1 Pro Preview standard pricing for prompts above 200k input tokens.'
  }),
  createPrefixPricingRule(['gemini-3.1-flash-lite-preview'], {
    inputCostPerMillionUsd: 0.25,
    outputCostPerMillionUsd: 1.5,
    basis: 'Gemini 3.1 Flash-Lite Preview standard pricing.'
  }),
  createPrefixPricingRule(['gemini-3-flash-preview'], {
    inputCostPerMillionUsd: 0.5,
    outputCostPerMillionUsd: 3,
    basis: 'Gemini 3 Flash Preview standard pricing.'
  }),
  createTieredGeminiPricingRule(['gemini-2.5-pro'], {
    thresholdInputTokens: 200_000,
    lower: {
      inputCostPerMillionUsd: 1.25,
      outputCostPerMillionUsd: 10
    },
    higher: {
      inputCostPerMillionUsd: 2.5,
      outputCostPerMillionUsd: 15
    },
    lowerBasis: 'Gemini 2.5 Pro standard pricing for prompts up to 200k input tokens.',
    higherBasis: 'Gemini 2.5 Pro standard pricing for prompts above 200k input tokens.'
  }),
  createPrefixPricingRule(['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash-lite'], {
    inputCostPerMillionUsd: 0.1,
    outputCostPerMillionUsd: 0.4,
    basis: 'Gemini 2.5 Flash-Lite standard pricing.'
  }),
  createPrefixPricingRule(['gemini-2.5-flash-preview', 'gemini-2.5-flash'], {
    inputCostPerMillionUsd: 0.3,
    outputCostPerMillionUsd: 2.5,
    basis: 'Gemini 2.5 Flash standard pricing.'
  }),
  createPrefixPricingRule(['gemini-2.0-flash-lite'], {
    inputCostPerMillionUsd: 0.075,
    outputCostPerMillionUsd: 0.3,
    basis: 'Gemini 2.0 Flash-Lite standard pricing.'
  }),
  createPrefixPricingRule(['gemini-2.0-flash'], {
    inputCostPerMillionUsd: 0.1,
    outputCostPerMillionUsd: 0.4,
    basis: 'Gemini 2.0 Flash standard pricing.'
  })
];

const OPENAI_TEXT_MODEL_PRICING_RULES: readonly TextModelPricingRule[] = [
  createPrefixPricingRule(['gpt-5.5-pro'], {
    inputCostPerMillionUsd: 30,
    outputCostPerMillionUsd: 180,
    basis: 'OpenAI GPT-5.5 pro text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5.5'], {
    inputCostPerMillionUsd: 5,
    outputCostPerMillionUsd: 30,
    basis: 'OpenAI GPT-5.5 text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5.4-mini'], {
    inputCostPerMillionUsd: 0.75,
    outputCostPerMillionUsd: 4.5,
    basis: 'OpenAI GPT-5.4 mini text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5.4-nano'], {
    inputCostPerMillionUsd: 0.2,
    outputCostPerMillionUsd: 1.25,
    basis: 'OpenAI GPT-5.4 nano text-token pricing.'
  }),
  createTieredGeminiPricingRule(['gpt-5.4'], {
    thresholdInputTokens: 272_000,
    lower: {
      inputCostPerMillionUsd: 2.5,
      outputCostPerMillionUsd: 15
    },
    higher: {
      inputCostPerMillionUsd: 5,
      outputCostPerMillionUsd: 22.5
    },
    lowerBasis: 'OpenAI GPT-5.4 text-token pricing for prompts up to 272k input tokens.',
    higherBasis: 'OpenAI GPT-5.4 text-token pricing for prompts above 272k input tokens.'
  }),
  createPrefixPricingRule(['gpt-5-mini'], {
    inputCostPerMillionUsd: 0.25,
    outputCostPerMillionUsd: 2,
    basis: 'OpenAI GPT-5 mini text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5-nano'], {
    inputCostPerMillionUsd: 0.05,
    outputCostPerMillionUsd: 0.4,
    basis: 'OpenAI GPT-5 nano text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5-codex'], {
    inputCostPerMillionUsd: 1.25,
    outputCostPerMillionUsd: 10,
    basis: 'OpenAI GPT-5-Codex text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5.1'], {
    inputCostPerMillionUsd: 1.25,
    outputCostPerMillionUsd: 10,
    basis: 'OpenAI GPT-5.1 text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5-pro'], {
    inputCostPerMillionUsd: 15,
    outputCostPerMillionUsd: 120,
    basis: 'OpenAI GPT-5 pro text-token pricing.'
  }),
  createPrefixPricingRule(['gpt-5'], {
    inputCostPerMillionUsd: 1.25,
    outputCostPerMillionUsd: 10,
    basis: 'OpenAI GPT-5 text-token pricing.'
  }),
  createPrefixPricingRule(['o4-mini'], {
    inputCostPerMillionUsd: 1.1,
    outputCostPerMillionUsd: 4.4,
    basis: 'OpenAI o4-mini text-token pricing.'
  })
];

export * from './aiSdk.js';
