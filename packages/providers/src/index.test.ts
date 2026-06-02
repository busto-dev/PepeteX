import { describe, expect, it } from 'vitest';

import {
  createCLIProxyAPIAdapter,
  createAgentLanguageModel,
  createGeminiAdapter,
  createOpenAICompatibleAdapter,
  decryptProviderCredentialPayload,
  encryptProviderCredentialPayload,
  getModelInputTokenLimit,
  getProviderCredentialEncryptionKey,
  inferCLIProxyRouteKind,
  maskSecret
} from './index';

describe('@pepetex/providers', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');

  it('encrypts and decrypts credential payloads', () => {
    const payload = {
      apiKey: 'sk-test-secret-1234',
      organizationId: 'org_123',
      projectId: 'proj_123',
      customHeaders: {
        'x-api-version': '2026-04-25'
      },
      manualModels: [{ id: 'gemini-3.1-pro', label: 'Advanced Model' }]
    };

    const ciphertext = encryptProviderCredentialPayload(payload, encryptionKey);

    expect(ciphertext).not.toContain(payload.apiKey);
    expect(decryptProviderCredentialPayload(ciphertext, encryptionKey)).toEqual(payload);
  });

  it('masks secrets for display', () => {
    expect(maskSecret('sk-test-secret-1234')).toBe('sk-t***********1234');
    expect(maskSecret('abcd')).toBe('****');
    expect(maskSecret('ab')).toBe('**');
  });

  it('parses a configured 32-byte encryption key', () => {
    expect(getProviderCredentialEncryptionKey({ PROVIDER_CREDENTIAL_ENCRYPTION_KEY: encryptionKey }))
      .toBe(encryptionKey);
  });

  it('rejects malformed encryption keys', () => {
    expect(() =>
      getProviderCredentialEncryptionKey({
        PROVIDER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64')
      })
    ).toThrow('Provider credential encryption key must decode to exactly 32 bytes.');
  });

  it('discovers Gemini models without hard-coding a preferred default', async () => {
    const adapter = createGeminiAdapter();

    const models = await adapter.listModels({
      credential: {
        apiKey: 'gemini-secret'
      },
      fetcher: createJsonFetcher({
        models: [
          {
            name: 'models/gemini-3.1-flash-lite-preview',
            displayName: 'Gemini 3.1 Flash Lite',
            supportedGenerationMethods: ['generateContent']
          },
          {
            name: 'models/gemini-2.0-pro',
            displayName: 'Gemini 2.0 Pro',
            supportedGenerationMethods: ['generateContent']
          },
          {
            name: 'models/embedding-001',
            displayName: 'Embedding 001',
            supportedGenerationMethods: ['embedContent']
          }
        ]
      })
    });

    expect(models).toEqual([
      {
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash Lite',
        supportsFileUpload: true
      },
      {
        id: 'gemini-2.0-pro',
        label: 'Gemini 2.0 Pro',
        supportsFileUpload: true
      }
    ]);
  });

  it('uses manual models instead of discovery for OpenAI-compatible providers', async () => {
    const adapter = createOpenAICompatibleAdapter();

    const models = await adapter.listModels({
      baseUrl: 'https://example.com/v1',
      credential: {
        apiKey: 'openai-secret',
        organizationId: 'org_123',
        projectId: 'proj_123'
      },
      manualModelIds: ['custom-model-alpha', 'gpt-4.1-mini'],
      manualModels: [{ id: 'custom-model-beta', label: 'Advanced Model' }],
      fetcher: async () => {
        throw new Error('Manual models should bypass /models discovery.');
      }
    });

    expect(models).toEqual([
      {
        id: 'custom-model-beta',
        label: 'Advanced Model'
      },
      {
        id: 'custom-model-alpha',
        label: 'custom-model-alpha'
      },
      {
        id: 'gpt-4.1-mini',
        label: 'gpt-4.1-mini'
      }
    ]);
  });

  it('uses manual models instead of discovery for Gemini providers', async () => {
    const adapter = createGeminiAdapter();

    const models = await adapter.listModels({
      credential: {
        apiKey: 'gemini-secret'
      },
      manualModels: [{ id: 'gemini-3.1-pro', label: 'Advanced Model' }],
      fetcher: async () => {
        throw new Error('Manual models should bypass /models discovery.');
      }
    });

    expect(models).toEqual([
      {
        id: 'gemini-3.1-pro',
        label: 'Advanced Model'
      }
    ]);
  });

  it('infers CLIProxy route kinds and uses Gemini-compatible discovery when needed', async () => {
    expect(inferCLIProxyRouteKind('https://proxy.example.com/openai/v1')).toBe(
      'openai-compatible'
    );
    expect(inferCLIProxyRouteKind('https://proxy.example.com/gemini/v1beta')).toBe(
      'gemini-compatible'
    );
    expect(inferCLIProxyRouteKind('https://proxy.example.com/anthropic')).toBe(
      'claude-compatible'
    );

    const adapter = createCLIProxyAPIAdapter();
    const models = await adapter.listModels({
      baseUrl: 'https://proxy.example.com/gemini/v1beta',
      credential: {
        apiKey: 'cliproxy-secret'
      },
      fetcher: createJsonFetcher({
        models: [
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            supportedGenerationMethods: ['generateContent']
          }
        ]
      })
    });

    expect(models).toEqual([
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        supportsFileUpload: true
      }
    ]);
  });

  it('creates Mastra agent language models from the selected provider kind and model', () => {
    expect(() =>
      createAgentLanguageModel({
        kind: 'openai-compatible',
        model: 'workspace-selected-model',
        providerName: 'Workspace OpenAI',
        ctx: {
          baseUrl: 'https://openai-compatible.example.com/v1',
          credential: { apiKey: 'openai-secret' }
        }
      })
    ).not.toThrow();

    expect(() =>
      createAgentLanguageModel({
        kind: 'cliproxyapi',
        model: 'cliproxy-selected-model',
        providerName: 'CLIProxy OpenAI',
        ctx: {
          baseUrl: 'https://proxy.example.com/openai/v1',
          credential: { apiKey: 'cliproxy-secret' }
        }
      })
    ).not.toThrow();

    expect(() =>
      createAgentLanguageModel({
        kind: 'cliproxyapi',
        model: 'gemini-selected-model',
        providerName: 'CLIProxy Gemini',
        ctx: {
          baseUrl: 'https://proxy.example.com/gemini/v1beta',
          credential: { apiKey: 'cliproxy-secret' }
        }
      })
    ).not.toThrow();
  });

  it('rejects CLIProxy Claude-compatible agent routes until an Anthropic AI SDK adapter exists', () => {
    expect(() =>
      createAgentLanguageModel({
        kind: 'cliproxyapi',
        model: 'claude-selected-model',
        providerName: 'CLIProxy Claude',
        ctx: {
          baseUrl: 'https://proxy.example.com/anthropic',
          credential: { apiKey: 'cliproxy-secret' }
        }
      })
    ).toThrow('Claude-compatible routes are not enabled');
  });

  it('returns friendly connection test failures with diagnostics', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const health = await adapter.testConnection({
      baseUrl: 'https://example.com/v1',
      credential: {
        apiKey: 'openai-secret'
      },
      fetcher: async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
          return {
            error: 'Unauthorized'
          };
        },
        async text() {
          return 'Unauthorized';
        }
      })
    });

    expect(health.ok).toBe(false);
    expect(health.message).toBe('Unable to connect to the OpenAI-compatible provider.');
    expect(health.diagnostic).toContain('OpenAI-compatible model discovery failed with 401 Unauthorized');
  });

  it('estimates Gemini text-model cost from the built-in pricing catalog', async () => {
    const adapter = createGeminiAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'gemini-3.1-flash-lite-preview',
        inputTokens: 120_000,
        outputTokens: 8_000
      },
      {
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate).toEqual({
      supported: true,
      estimatedCostUsd: 0.042,
      currency: 'USD',
      basis: 'Gemini 3.1 Flash-Lite Preview standard pricing.'
    });
  });

  it('uses the higher Gemini tier when prompts exceed 200k input tokens', async () => {
    const adapter = createGeminiAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'gemini-2.5-pro',
        inputTokens: 250_000,
        outputTokens: 40_000
      },
      {
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate).toEqual({
      supported: true,
      estimatedCostUsd: 1.225,
      currency: 'USD',
      basis: 'Gemini 2.5 Pro standard pricing for prompts above 200k input tokens.'
    });
  });

  it('estimates OpenAI-compatible text-model cost from current GPT-5.x model ids', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'gpt-5.4-mini-2026-03-17',
        inputTokens: 10_000,
        outputTokens: 2_000
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate).toEqual({
      supported: true,
      estimatedCostUsd: 0.0165,
      currency: 'USD',
      basis: 'OpenAI GPT-5.4 mini text-token pricing.'
    });
  });

  it('applies the GPT-5.4 higher price tier above 272k input tokens', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'gpt-5.4',
        inputTokens: 300_000,
        outputTokens: 40_000
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate).toEqual({
      supported: true,
      estimatedCostUsd: 2.4,
      currency: 'USD',
      basis: 'OpenAI GPT-5.4 text-token pricing for prompts above 272k input tokens.'
    });
  });

  it('uses route-kind-specific GPT-5.x pricing for CLIProxyAPI cost estimates', async () => {
    const adapter = createCLIProxyAPIAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'gpt-5-mini',
        inputTokens: 20_000,
        outputTokens: 5_000
      },
      {
        baseUrl: 'https://proxy.example.com/openai/v1',
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate).toEqual({
      supported: true,
      estimatedCostUsd: 0.015,
      currency: 'USD',
      basis: 'OpenAI GPT-5 mini text-token pricing.'
    });
  });

  it('rejects non-text-token models for cost estimation', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'gpt-realtime-mini',
        inputTokens: 20_000,
        outputTokens: 5_000
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate.supported).toBe(false);
    expect(estimate.estimatedCostUsd).toBeNull();
    expect(estimate.basis).toContain('text-token pricing only');
  });

  it('returns unsupported for CLIProxyAPI Claude-compatible routes', async () => {
    const adapter = createCLIProxyAPIAdapter();
    const estimate = await adapter.estimateCost(
      {
        model: 'claude-3-7-sonnet',
        inputTokens: 20_000,
        outputTokens: 5_000
      },
      {
        baseUrl: 'https://proxy.example.com/anthropic',
        credential: {
          apiKey: 'unused'
        }
      }
    );

    expect(estimate).toEqual({
      supported: false,
      estimatedCostUsd: null,
      currency: 'USD',
      basis:
        'Cost estimation is unavailable for CLIProxyAPI Claude-compatible routes in the current Phase 2 implementation.'
    });
  });

  it('sends inline reference attachments to Gemini generation', async () => {
    const adapter = createGeminiAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];

    await adapter.generateStructured(
      {
        model: 'gemini-2.5-pro',
        prompt: 'Create a deck from the reference.',
        attachments: [
          {
            filename: 'brief.pdf',
            mimeType: 'application/pdf',
            contentBase64: 'cGRmLWJ5dGVz'
          }
        ]
      },
      {
        credential: { apiKey: 'gemini-secret' },
        fetcher: createCapturingFetcher(
          {
            candidates: [{ content: { parts: [{ text: '{"mode":"refusal","reason":"test","userVisibleMessage":"ok"}' }] } }]
          },
          capturedRequests
        )
      }
    );

    const body = JSON.parse(String(capturedRequests[0]?.init.body));
    expect(body.contents[0].parts).toEqual([
      { text: 'Create a deck from the reference.' },
      { inlineData: { mimeType: 'application/pdf', data: 'cGRmLWJ5dGVz' } }
    ]);
  });

  it('passes native Gemini structured output schema and output token budget', async () => {
    const adapter = createGeminiAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];
    const responseJsonSchema = {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['refusal'] }
      }
    };

    await adapter.generateStructured(
      {
        model: 'gemini-3.1-pro-preview',
        prompt: 'Return a refusal.',
        schema: responseJsonSchema,
        maxOutputTokens: 12345
      },
      {
        credential: { apiKey: 'gemini-secret' },
        fetcher: createCapturingFetcher(
          {
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"mode":"refusal","reason":"test","userVisibleMessage":"ok"}' }] } }]
          },
          capturedRequests
        )
      }
    );

    const body = JSON.parse(String(capturedRequests[0]?.init.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema,
      maxOutputTokens: 12345
    });
  });

  it('counts Gemini tokens using generateContentRequest with system instruction and attachments', async () => {
    const adapter = createGeminiAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];

    const result = await adapter.countTokens!(
      {
        model: 'gemini-2.5-pro',
        prompt: 'Create a deck from the reference.',
        systemInstruction: 'Follow the PepeteX contract.',
        attachments: [
          {
            filename: 'brief.pdf',
            mimeType: 'application/pdf',
            contentBase64: 'cGRmLWJ5dGVz'
          }
        ]
      },
      {
        credential: { apiKey: 'gemini-secret' },
        fetcher: createCapturingFetcher({ totalTokens: 321 }, capturedRequests)
      }
    );

    const body = JSON.parse(String(capturedRequests[0]?.init.body));
    expect(capturedRequests[0]?.input).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:countTokens?key=gemini-secret'
    );
    expect(body.generateContentRequest.model).toBe('models/gemini-2.5-pro');
    expect(body.generateContentRequest.contents[0].parts).toEqual([
      { text: 'Create a deck from the reference.' },
      { inlineData: { mimeType: 'application/pdf', data: 'cGRmLWJ5dGVz' } }
    ]);
    expect(body.generateContentRequest.systemInstruction).toEqual({
      parts: [{ text: 'Follow the PepeteX contract.' }]
    });
    expect(result).toEqual({ supported: true, totalTokens: 321 });
  });

  it('estimates token counts for OpenAI-compatible providers without a provider-specific token API', async () => {
    const adapter = createOpenAICompatibleAdapter();

    const result = await adapter.countTokens!(
      {
        model: 'gpt-compatible-model',
        prompt: 'Create a deck from the reference.',
        systemInstruction: 'Follow the PepeteX contract.',
        attachments: [
          {
            filename: 'brief.txt',
            mimeType: 'text/plain',
            sizeBytes: 4_000
          }
        ]
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: { apiKey: 'openai-secret' },
        fetcher: async () => {
          throw new Error('OpenAI-compatible token estimates should not call the provider.');
        }
      }
    );

    expect(result.supported).toBe(true);
    expect(result.estimated).toBe(true);
    expect(result.totalTokens).toBeGreaterThan(1_000);
  });

  it('exposes conservative model input-token limits', () => {
    expect(getModelInputTokenLimit('gemini', 'gemini-2.5-pro')).toBe(1_048_576);
    expect(getModelInputTokenLimit('openai-compatible', 'custom-model')).toBe(128_000);
  });

  it('reports Gemini finishReason when structured output is truncated', async () => {
    const adapter = createGeminiAdapter();

    await expect(
      adapter.generateStructured(
        {
          model: 'gemini-3.1-pro-preview',
          prompt: 'Create a huge deck.'
        },
        {
          credential: { apiKey: 'gemini-secret' },
          fetcher: createJsonFetcher({
            candidates: [
              {
                finishReason: 'MAX_TOKENS',
                content: { parts: [{ text: '{"mode":"deck","deck":{"slides":[{' }] }
              }
            ]
          })
        }
      )
    ).rejects.toThrow('finishReason=MAX_TOKENS');
  });

  it('sends Gemini provider-file references as fileData parts', async () => {
    const adapter = createGeminiAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];

    await adapter.generateStructured(
      {
        model: 'gemini-2.5-pro',
        prompt: 'Create a deck from the uploaded provider file.',
        attachments: [
          {
            filename: 'brief.pdf',
            mimeType: 'application/pdf',
            providerFileId: 'files/abc123xyz',
            providerFileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123xyz'
          }
        ]
      },
      {
        credential: { apiKey: 'gemini-secret' },
        fetcher: createCapturingFetcher(
          {
            candidates: [{ content: { parts: [{ text: '{"mode":"refusal","reason":"test","userVisibleMessage":"ok"}' }] } }]
          },
          capturedRequests
        )
      }
    );

    const body = JSON.parse(String(capturedRequests[0]?.init.body));
    expect(body.contents[0].parts).toEqual([
      { text: 'Create a deck from the uploaded provider file.' },
      {
        fileData: {
          mimeType: 'application/pdf',
          fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123xyz'
        }
      }
    ]);
  });

  it('sends image reference attachments to OpenAI-compatible chat generation', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];

    await adapter.generateStructured(
      {
        model: 'gpt-4.1-mini',
        prompt: 'Use the image reference.',
        attachments: [
          {
            filename: 'moodboard.png',
            mimeType: 'image/png',
            contentBase64: 'aW1hZ2UtYnl0ZXM='
          }
        ]
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: { apiKey: 'openai-secret' },
        fetcher: createCapturingFetcher(
          {
            choices: [{ message: { content: '{"mode":"refusal","reason":"test","userVisibleMessage":"ok"}' } }]
          },
          capturedRequests
        )
      }
    );

    const body = JSON.parse(String(capturedRequests[0]?.init.body));
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Use the image reference.' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' }
        }
      ]
    });
  });

  it('uploads a reference file to Gemini and returns the provider file id', async () => {
    const adapter = createGeminiAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];
    const providerFileRef = await adapter.uploadReferenceFile!(
      {
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        content: new Uint8Array([1, 2, 3, 4])
      },
      {
        credential: {
          apiKey: 'gemini-secret'
        },
        fetcher: createCapturingFetcher(
          {
            file: {
              name: 'files/abc123xyz',
              displayName: 'report.pdf'
            }
          },
          capturedRequests
        )
      }
    );

    expect(providerFileRef).toEqual({ providerFileId: 'files/abc123xyz' });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.input).toContain('/upload/v1beta/files');
    expect(capturedRequests[0]?.input).toContain('uploadType=multipart');
    expect(capturedRequests[0]?.init.method).toBe('POST');
    expect(capturedRequests[0]?.init.headers?.['x-goog-api-key']).toBe('gemini-secret');
    expect(capturedRequests[0]?.init.headers?.['content-type']).toContain('multipart/form-data');
    expect(capturedRequests[0]?.init.body).toBeInstanceOf(Uint8Array);
  });

  it('deletes a reference file from Gemini', async () => {
    const adapter = createGeminiAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];

    await adapter.deleteReferenceFile!(
      {
        providerFileId: 'files/abc123xyz'
      },
      {
        credential: {
          apiKey: 'gemini-secret'
        },
        fetcher: createCapturingFetcher({}, capturedRequests)
      }
    );

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.input).toContain('/abc123xyz');
  });

  it('uploads a reference file to OpenAI-compatible and returns the provider file id', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];
    const providerFileRef = await adapter.uploadReferenceFile!(
      {
        filename: 'data.csv',
        mimeType: 'text/csv',
        content: new Uint8Array([5, 6, 7])
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: {
          apiKey: 'openai-secret'
        },
        fetcher: createCapturingFetcher({ id: 'file-xyz789' }, capturedRequests)
      }
    );

    expect(providerFileRef).toEqual({ providerFileId: 'file-xyz789' });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.input).toBe('https://example.com/v1/files');
    expect(capturedRequests[0]?.init.method).toBe('POST');
    expect(capturedRequests[0]?.init.headers?.Authorization).toBe('Bearer openai-secret');
    expect(capturedRequests[0]?.init.headers?.['content-type']).toContain('multipart/form-data');
  });

  it('deletes a reference file from OpenAI-compatible', async () => {
    const adapter = createOpenAICompatibleAdapter();
    const capturedRequests: Array<{
      input: string;
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | Uint8Array;
      };
    }> = [];

    await adapter.deleteReferenceFile!(
      {
        providerFileId: 'file-xyz789'
      },
      {
        baseUrl: 'https://example.com/v1',
        credential: {
          apiKey: 'openai-secret'
        },
        fetcher: createCapturingFetcher({}, capturedRequests)
      }
    );

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.input).toContain('file-xyz789');
  });

  it('throws on Gemini file upload failure', async () => {
    const adapter = createGeminiAdapter();

    await expect(
      adapter.uploadReferenceFile!(
        {
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          content: new Uint8Array([1, 2, 3])
        },
        {
          credential: {
            apiKey: 'gemini-secret'
          },
          fetcher: async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            async json() {
              return {
                error: 'Forbidden'
              };
            },
            async text() {
              return 'Forbidden';
            }
          })
        }
      )
    ).rejects.toThrow('Gemini file upload failed with 403 Forbidden');
  });

  it('does not throw on Gemini file deletion 404', async () => {
    const adapter = createGeminiAdapter();

    await expect(
      adapter.deleteReferenceFile!(
        {
          providerFileId: 'files/missing'
        },
        {
          credential: {
            apiKey: 'gemini-secret'
          },
          fetcher: async () => ({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            async json() {
              return {};
            },
            async text() {
              return 'Not Found';
            }
          })
        }
      )
    ).resolves.toBeUndefined();
  });
});

function createCapturingFetcher(
  payload: unknown,
  captures: Array<{
    input: string;
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    };
  }>
) {
  return async (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    }
  ) => {
    captures.push({
      input,
      init: init ?? {}
    });

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      }
    };
  };
}

function createJsonFetcher(payload: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  });
}
