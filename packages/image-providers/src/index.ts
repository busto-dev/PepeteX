export const imageProviderKinds = ['imagen', 'gemini-image', 'gpt-image-2', 'openai-compatible'] as const;

export type ImageProviderKind = (typeof imageProviderKinds)[number];

// ---------------------------------------------------------------------------
// Common interfaces
// ---------------------------------------------------------------------------

export interface ImageGenerationRequest {
  prompt: string;
  model: string;
  /** Number of images to generate (1-4 depending on provider). */
  count: number;
  /** Target MIME type. Defaults to image/png. */
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Optional aspect ratio hint (e.g. "16:9", "1:1"). */
  aspectRatio?: string;
  /** Optional seed for reproducibility where supported. */
  seed?: number;
}

export interface GeneratedImageData {
  /** base64-encoded image bytes */
  base64: string;
  mimeType: string;
  /** Provider-revised prompt when returned. */
  revisedPrompt?: string;
  width?: number;
  height?: number;
}

export interface ImageGenerationResult {
  images: GeneratedImageData[];
  model: string;
  providerKind: ImageProviderKind;
}

export interface ImageProviderCredential {
  apiKey: string;
  projectId?: string;
  organizationId?: string;
  customHeaders?: Record<string, string>;
}

export interface ImageProviderContext {
  credential: ImageProviderCredential;
  baseUrl?: string | null;
}

export interface ImageProviderHealth {
  ok: boolean;
  message: string;
  checkedAt: string;
  diagnostic?: string;
}

export interface ImageModelDescriptor {
  id: string;
  label: string;
  supportsCount?: boolean;
  maxCount?: number;
}

export interface ImageProviderAdapter {
  kind: ImageProviderKind;
  listModels(ctx: ImageProviderContext): Promise<ImageModelDescriptor[]>;
  testConnection(ctx: ImageProviderContext): Promise<ImageProviderHealth>;
  generateImages(
    request: ImageGenerationRequest,
    ctx: ImageProviderContext
  ): Promise<ImageGenerationResult>;
}

// ---------------------------------------------------------------------------
// Friendly error classification
// ---------------------------------------------------------------------------

export type ImageProviderErrorCategory =
  | 'safety_filter'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'invalid_prompt'
  | 'provider_unavailable'
  | 'unknown';

export interface ImageProviderFriendlyError {
  category: ImageProviderErrorCategory;
  userMessage: string;
  retryable: boolean;
}

export function classifyImageProviderError(
  httpStatus: number | undefined,
  errorText: string
): ImageProviderFriendlyError {
  const lower = errorText.toLowerCase();

  // Safety/content policy violations
  if (
    lower.includes('safety') ||
    lower.includes('policy') ||
    lower.includes('content filter') ||
    lower.includes('blocked') ||
    lower.includes('violat') ||
    httpStatus === 400 && (lower.includes('prompt') || lower.includes('content'))
  ) {
    return {
      category: 'safety_filter',
      userMessage: 'The image request was blocked by the provider\'s content policy. Try modifying the prompt.',
      retryable: false
    };
  }

  // Rate limiting
  if (httpStatus === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      category: 'rate_limit',
      userMessage: 'The image provider is rate-limiting requests. Please wait a moment and try again.',
      retryable: true
    };
  }

  // Quota exceeded
  if (lower.includes('quota') || lower.includes('billing') || lower.includes('insufficient')) {
    return {
      category: 'quota_exceeded',
      userMessage: 'The image provider account has reached its quota or billing limit.',
      retryable: false
    };
  }

  // Invalid prompt
  if (httpStatus === 400 || lower.includes('invalid') || lower.includes('bad request')) {
    return {
      category: 'invalid_prompt',
      userMessage: 'The image prompt was rejected by the provider. Try rephrasing the prompt.',
      retryable: false
    };
  }

  // Provider unavailable
  if (!httpStatus || httpStatus >= 500) {
    return {
      category: 'provider_unavailable',
      userMessage: 'The image provider is temporarily unavailable. Please try again later.',
      retryable: true
    };
  }

  return {
    category: 'unknown',
    userMessage: 'Image generation failed. Please try again or contact support.',
    retryable: true
  };
}

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------

async function doFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    ...(init.headers ? { headers: init.headers } : {}),
    body: init.body ?? null
  });

  return {
    status: res.status,
    json: () => res.json() as Promise<unknown>,
    text: () => res.text()
  };
}

// ---------------------------------------------------------------------------
// Imagen adapter (Google Cloud Vertex AI)
// ---------------------------------------------------------------------------

const IMAGEN_DEFAULT_BASE_URL = 'https://us-central1-aiplatform.googleapis.com';

const IMAGEN_MODELS: ImageModelDescriptor[] = [
  { id: 'imagegeneration@006', label: 'Imagen 3 (imagegeneration@006)', supportsCount: true, maxCount: 4 },
  { id: 'imagen-3.0-generate-001', label: 'Imagen 3.0 Generate 001', supportsCount: true, maxCount: 4 },
  { id: 'imagen-3.0-fast-generate-001', label: 'Imagen 3.0 Fast Generate 001', supportsCount: true, maxCount: 4 }
];

export class ImagenAdapter implements ImageProviderAdapter {
  readonly kind: ImageProviderKind = 'imagen';

  async listModels(_ctx: ImageProviderContext): Promise<ImageModelDescriptor[]> {
    return IMAGEN_MODELS;
  }

  async testConnection(ctx: ImageProviderContext): Promise<ImageProviderHealth> {
    try {
      const baseUrl = ctx.baseUrl ?? IMAGEN_DEFAULT_BASE_URL;
      const projectId = ctx.credential.projectId;
      if (!projectId) {
        return { ok: false, message: 'Project ID is required for Imagen.', checkedAt: new Date().toISOString() };
      }
      const url = `${baseUrl}/v1/projects/${projectId}/locations/us-central1/publishers/google/models`;
      const res = await doFetch(url, {
        headers: {
          Authorization: `Bearer ${ctx.credential.apiKey}`,
          'Content-Type': 'application/json',
          ...(ctx.credential.customHeaders ?? {})
        }
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: 'Imagen connection successful.', checkedAt: new Date().toISOString() };
      }
      const text = await res.text();
      return {
        ok: false,
        message: `Imagen connection failed (HTTP ${res.status}).`,
        checkedAt: new Date().toISOString(),
        diagnostic: text.slice(0, 500)
      };
    } catch (err) {
      return {
        ok: false,
        message: 'Imagen connection check threw an error.',
        checkedAt: new Date().toISOString(),
        diagnostic: String(err)
      };
    }
  }

  async generateImages(
    request: ImageGenerationRequest,
    ctx: ImageProviderContext
  ): Promise<ImageGenerationResult> {
    const baseUrl = ctx.baseUrl ?? IMAGEN_DEFAULT_BASE_URL;
    const projectId = ctx.credential.projectId;
    if (!projectId) throw new Error('Project ID is required for Imagen image generation.');

    const url = `${baseUrl}/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${request.model}:predict`;

    const body = JSON.stringify({
      instances: [{ prompt: request.prompt }],
      parameters: {
        sampleCount: Math.min(request.count, 4),
        ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {})
      }
    });

    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.credential.apiKey}`,
        'Content-Type': 'application/json',
        ...(ctx.credential.customHeaders ?? {})
      },
      body
    });

    if (res.status < 200 || res.status >= 300) {
      const text = await res.text();
      throw new Error(`Imagen generation failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };

    const predictions = data.predictions ?? [];
    const images: GeneratedImageData[] = predictions.map((p) => ({
      base64: p.bytesBase64Encoded ?? '',
      mimeType: p.mimeType ?? 'image/png'
    }));

    return { images, model: request.model, providerKind: this.kind };
  }
}

// ---------------------------------------------------------------------------
// Gemini Image adapter (gemini-2.0-flash-preview-image-generation)
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

const GEMINI_IMAGE_MODELS: ImageModelDescriptor[] = [
  {
    id: 'gemini-2.0-flash-preview-image-generation',
    label: 'Gemini 2.0 Flash Image Generation (preview)',
    supportsCount: false,
    maxCount: 1
  }
];

export class GeminiImageAdapter implements ImageProviderAdapter {
  readonly kind: ImageProviderKind = 'gemini-image';

  async listModels(_ctx: ImageProviderContext): Promise<ImageModelDescriptor[]> {
    return GEMINI_IMAGE_MODELS;
  }

  async testConnection(ctx: ImageProviderContext): Promise<ImageProviderHealth> {
    try {
      const baseUrl = ctx.baseUrl ?? GEMINI_IMAGE_DEFAULT_BASE_URL;
      const res = await doFetch(
        `${baseUrl}/v1beta/models?key=${ctx.credential.apiKey}`,
        { headers: ctx.credential.customHeaders ?? {} }
      );
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: 'Gemini Image connection successful.', checkedAt: new Date().toISOString() };
      }
      const text = await res.text();
      return {
        ok: false,
        message: `Gemini Image connection failed (HTTP ${res.status}).`,
        checkedAt: new Date().toISOString(),
        diagnostic: text.slice(0, 500)
      };
    } catch (err) {
      return {
        ok: false,
        message: 'Gemini Image connection check threw an error.',
        checkedAt: new Date().toISOString(),
        diagnostic: String(err)
      };
    }
  }

  async generateImages(
    request: ImageGenerationRequest,
    ctx: ImageProviderContext
  ): Promise<ImageGenerationResult> {
    const baseUrl = ctx.baseUrl ?? GEMINI_IMAGE_DEFAULT_BASE_URL;
    const model = request.model;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        ...(request.aspectRatio ? { imageGenerationConfig: { aspectRatio: request.aspectRatio } } : {})
      }
    });

    const res = await doFetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${ctx.credential.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ctx.credential.customHeaders ?? {})
        },
        body
      }
    );

    if (res.status < 200 || res.status >= 300) {
      const text = await res.text();
      throw new Error(`Gemini Image generation failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }>;
        };
      }>;
    };

    const images: GeneratedImageData[] = [];
    for (const candidate of data.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data) {
          images.push({
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType ?? 'image/png'
          });
        }
      }
    }

    return { images, model, providerKind: this.kind };
  }
}

// ---------------------------------------------------------------------------
// GPT-image-2 adapter (OpenAI gpt-image-2 / dall-e-3)
// ---------------------------------------------------------------------------

const GPT_IMAGE_DEFAULT_BASE_URL = 'https://api.openai.com';

const GPT_IMAGE_MODELS: ImageModelDescriptor[] = [
  { id: 'gpt-image-2', label: 'GPT-image-2', supportsCount: true, maxCount: 10 },
  { id: 'dall-e-3', label: 'DALL-E 3', supportsCount: false, maxCount: 1 },
  { id: 'dall-e-2', label: 'DALL-E 2', supportsCount: true, maxCount: 10 }
];

export class GptImage2Adapter implements ImageProviderAdapter {
  readonly kind: ImageProviderKind = 'gpt-image-2';

  async listModels(_ctx: ImageProviderContext): Promise<ImageModelDescriptor[]> {
    return GPT_IMAGE_MODELS;
  }

  async testConnection(ctx: ImageProviderContext): Promise<ImageProviderHealth> {
    try {
      const baseUrl = ctx.baseUrl ?? GPT_IMAGE_DEFAULT_BASE_URL;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${ctx.credential.apiKey}`,
        ...(ctx.credential.organizationId ? { 'OpenAI-Organization': ctx.credential.organizationId } : {}),
        ...(ctx.credential.projectId ? { 'OpenAI-Project': ctx.credential.projectId } : {}),
        ...(ctx.credential.customHeaders ?? {})
      };
      const res = await doFetch(`${baseUrl}/v1/models`, { headers });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: 'GPT-image-2 connection successful.', checkedAt: new Date().toISOString() };
      }
      const text = await res.text();
      return {
        ok: false,
        message: `GPT-image-2 connection failed (HTTP ${res.status}).`,
        checkedAt: new Date().toISOString(),
        diagnostic: text.slice(0, 500)
      };
    } catch (err) {
      return {
        ok: false,
        message: 'GPT-image-2 connection check threw an error.',
        checkedAt: new Date().toISOString(),
        diagnostic: String(err)
      };
    }
  }

  async generateImages(
    request: ImageGenerationRequest,
    ctx: ImageProviderContext
  ): Promise<ImageGenerationResult> {
    const baseUrl = ctx.baseUrl ?? GPT_IMAGE_DEFAULT_BASE_URL;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${ctx.credential.apiKey}`,
      'Content-Type': 'application/json',
      ...(ctx.credential.organizationId ? { 'OpenAI-Organization': ctx.credential.organizationId } : {}),
      ...(ctx.credential.projectId ? { 'OpenAI-Project': ctx.credential.projectId } : {}),
      ...(ctx.credential.customHeaders ?? {})
    };

    const isDallE = request.model.startsWith('dall-e');
    const body = JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      n: Math.min(request.count, isDallE ? 1 : 10),
      size: '1792x1024',
      ...(isDallE ? { response_format: 'b64_json' } : { output_format: 'png' })
    });

    const res = await doFetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers,
      body
    });

    if (res.status < 200 || res.status >= 300) {
      const text = await res.text();
      throw new Error(`GPT-image-2 generation failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json() as {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    };

    const images: GeneratedImageData[] = (data.data ?? []).map((item) => ({
      base64: item.b64_json ?? '',
      mimeType: request.mimeType ?? 'image/png',
      ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {})
    }));

    return { images, model: request.model, providerKind: this.kind };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible image adapter (generic /v1/images/generations)
// ---------------------------------------------------------------------------

export class OpenAICompatibleImageAdapter implements ImageProviderAdapter {
  readonly kind: ImageProviderKind = 'openai-compatible';

  async listModels(ctx: ImageProviderContext): Promise<ImageModelDescriptor[]> {
    try {
      if (!ctx.baseUrl) return [];
      const res = await doFetch(`${ctx.baseUrl}/v1/models`, {
        headers: {
          Authorization: `Bearer ${ctx.credential.apiKey}`,
          ...(ctx.credential.customHeaders ?? {})
        }
      });
      if (res.status !== 200) return [];
      const data = await res.json() as { data?: Array<{ id?: string }> };
      return (data.data ?? [])
        .filter((m) => typeof m.id === 'string')
        .map((m) => ({ id: m.id as string, label: m.id as string, supportsCount: true, maxCount: 4 }));
    } catch {
      return [];
    }
  }

  async testConnection(ctx: ImageProviderContext): Promise<ImageProviderHealth> {
    try {
      if (!ctx.baseUrl) {
        return { ok: false, message: 'Base URL is required for OpenAI-compatible image provider.', checkedAt: new Date().toISOString() };
      }
      const res = await doFetch(`${ctx.baseUrl}/v1/models`, {
        headers: {
          Authorization: `Bearer ${ctx.credential.apiKey}`,
          ...(ctx.credential.customHeaders ?? {})
        }
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: 'OpenAI-compatible image connection successful.', checkedAt: new Date().toISOString() };
      }
      const text = await res.text();
      return {
        ok: false,
        message: `OpenAI-compatible image connection failed (HTTP ${res.status}).`,
        checkedAt: new Date().toISOString(),
        diagnostic: text.slice(0, 500)
      };
    } catch (err) {
      return {
        ok: false,
        message: 'OpenAI-compatible image connection check threw an error.',
        checkedAt: new Date().toISOString(),
        diagnostic: String(err)
      };
    }
  }

  async generateImages(
    request: ImageGenerationRequest,
    ctx: ImageProviderContext
  ): Promise<ImageGenerationResult> {
    if (!ctx.baseUrl) throw new Error('Base URL is required for OpenAI-compatible image generation.');

    const body = JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      n: Math.min(request.count, 4),
      response_format: 'b64_json',
      size: '1792x1024'
    });

    const res = await doFetch(`${ctx.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.credential.apiKey}`,
        'Content-Type': 'application/json',
        ...(ctx.credential.customHeaders ?? {})
      },
      body
    });

    if (res.status < 200 || res.status >= 300) {
      const text = await res.text();
      throw new Error(`OpenAI-compatible image generation failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json() as {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    };

    const images: GeneratedImageData[] = (data.data ?? []).map((item) => ({
      base64: item.b64_json ?? '',
      mimeType: request.mimeType ?? 'image/png',
      ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {})
    }));

    return { images, model: request.model, providerKind: this.kind };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createImageProviderAdapter(kind: ImageProviderKind): ImageProviderAdapter {
  switch (kind) {
    case 'imagen':
      return new ImagenAdapter();
    case 'gemini-image':
      return new GeminiImageAdapter();
    case 'gpt-image-2':
      return new GptImage2Adapter();
    case 'openai-compatible':
      return new OpenAICompatibleImageAdapter();
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown image provider kind: ${String(exhaustive)}`);
    }
  }
}

