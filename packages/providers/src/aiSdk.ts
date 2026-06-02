import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderContext, ProviderFetcher, TextProviderKind } from './index.js';

export type AgentLanguageModel = ReturnType<ReturnType<typeof createGoogleGenerativeAI>['languageModel']>;

export interface CreateAgentLanguageModelInput {
  kind: TextProviderKind;
  model: string;
  ctx: ProviderContext;
  providerName?: string;
}

export function createAgentLanguageModel({
  kind,
  model,
  ctx,
  providerName
}: CreateAgentLanguageModelInput): AgentLanguageModel {
  switch (kind) {
    case 'gemini': {
      const provider = createGoogleGenerativeAI({
        ...(ctx.baseUrl ? { baseURL: withGoogleApiVersion(ctx.baseUrl) } : {}),
        apiKey: ctx.credential.apiKey,
        ...(ctx.credential.customHeaders ? { headers: ctx.credential.customHeaders } : {}),
        ...(ctx.fetcher ? { fetch: createFetchAdapter(ctx.fetcher) } : {})
      });

      return provider.languageModel(model);
    }

    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: providerName?.trim() || 'pepetex-compat',
        baseURL: normalizeRequiredBaseUrl(ctx.baseUrl, 'OpenAI-compatible'),
        apiKey: ctx.credential.apiKey,
        headers: {
          ...(ctx.credential.customHeaders ?? {}),
          ...(ctx.credential.organizationId
            ? { 'OpenAI-Organization': ctx.credential.organizationId }
            : {}),
          ...(ctx.credential.projectId ? { 'OpenAI-Project': ctx.credential.projectId } : {})
        },
        includeUsage: true,
        ...(ctx.fetcher ? { fetch: createFetchAdapter(ctx.fetcher) } : {})
      });

      return provider.languageModel(model);
    }

    case 'cliproxyapi': {
      const routeKind = inferCLIProxyAgentRouteKind(ctx.baseUrl ?? '');
      if (routeKind === 'gemini-compatible') {
        const provider = createGoogleGenerativeAI({
          baseURL: withGoogleApiVersion(normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI Gemini route')),
          apiKey: ctx.credential.apiKey,
          ...(ctx.credential.customHeaders ? { headers: ctx.credential.customHeaders } : {}),
          ...(ctx.fetcher ? { fetch: createFetchAdapter(ctx.fetcher) } : {})
        });

        return provider.languageModel(model);
      }

      if (routeKind === 'openai-compatible' || routeKind === 'unknown') {
        const provider = createOpenAICompatible({
          name: providerName?.trim() || 'pepetex-cliproxy',
          baseURL: normalizeRequiredBaseUrl(ctx.baseUrl, 'CLIProxyAPI OpenAI-compatible route'),
          apiKey: ctx.credential.apiKey,
          headers: {
            ...(ctx.credential.customHeaders ?? {}),
            ...(ctx.credential.organizationId
              ? { 'OpenAI-Organization': ctx.credential.organizationId }
              : {}),
            ...(ctx.credential.projectId ? { 'OpenAI-Project': ctx.credential.projectId } : {})
          },
          includeUsage: true,
          ...(ctx.fetcher ? { fetch: createFetchAdapter(ctx.fetcher) } : {})
        });

        return provider.languageModel(model);
      }

      throw new Error(
        'CLIProxyAPI Claude-compatible routes are not enabled for Mastra agentic generation because PepeteX has no Anthropic AI SDK adapter configured.'
      );
    }

    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported text provider kind: ${exhaustive as string}`);
    }
  }
}

function inferCLIProxyAgentRouteKind(baseUrl: string): 'openai-compatible' | 'gemini-compatible' | 'claude-compatible' | 'unknown' {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized.includes('/gemini') || normalized.includes('generativelanguage')) return 'gemini-compatible';
  if (normalized.includes('/openai') || normalized.endsWith('/v1')) return 'openai-compatible';
  if (normalized.includes('/anthropic') || normalized.includes('/claude')) return 'claude-compatible';
  return 'unknown';
}

function normalizeRequiredBaseUrl(baseUrl: string | null | undefined, providerLabel: string): string {
  const normalized = baseUrl?.trim().replace(/\/+$/, '');

  if (!normalized) {
    throw new Error(`${providerLabel} agentic generation requires a base URL.`);
  }

  return normalized;
}

function withGoogleApiVersion(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (/\/v\d+(beta|alpha)?$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/v1beta`;
}

function createFetchAdapter(fetcher: ProviderFetcher): typeof globalThis.fetch {
  return async (input, init) => {
    const providerInit: Parameters<ProviderFetcher>[1] = {};
    const headers = toHeaderRecord(init?.headers);
    const requestBody = toFetcherBody(init?.body);

    if (init?.method) {
      providerInit.method = init.method;
    }
    if (headers) {
      providerInit.headers = headers;
    }
    if (requestBody) {
      providerInit.body = requestBody;
    }

    const response = await fetcher(toFetchUrl(input), providerInit);
    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText
    });
  };
}

function toFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const normalized = new Headers(headers);
  const record: Record<string, string> = {};
  normalized.forEach((value, key) => {
    record[key] = value;
  });

  return record;
}

function toFetcherBody(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body === null || body === undefined) {
    return undefined;
  }

  if (typeof body === 'string' || body instanceof Uint8Array) {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }

  throw new Error('Custom provider fetchers only support string, Uint8Array, or ArrayBuffer request bodies.');
}
