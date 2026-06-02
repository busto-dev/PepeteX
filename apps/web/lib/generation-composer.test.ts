import { describe, expect, it } from 'vitest';

import {
  buildGenerationComposerSummary,
  describeProviderCredentialAvailability,
  formatReferenceFileSize,
  pickPreferredModelId
} from './generation-composer';

describe('generation composer helpers', () => {
  it('falls back to the first advertised model when the current selection is missing', () => {
    expect(
      pickPreferredModelId(
        {
          providerId: 'provider_1',
          kind: 'gemini',
          credentialScope: 'system',
          defaultModelId: null,
          models: [
            { id: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
            {
              id: 'gemini-3.1-flash-lite-preview',
              label: 'Gemini 3.1 Flash Lite',
              supportsFileUpload: true
            }
          ]
        },
        'missing-model'
      )
    ).toBe('gemini-2.0-pro');
  });

  it('falls back to the first model when no default is provided', () => {
    expect(
      pickPreferredModelId(
        {
          providerId: 'provider_1',
          kind: 'openai-compatible',
          credentialScope: 'user',
          defaultModelId: null,
          models: [
            { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
            { id: 'gpt-5.4', label: 'GPT-5.4' }
          ]
        },
        null
      )
    ).toBe('gpt-5.4-mini');
  });

  it('reports readiness and file capability warnings for a complete composer draft', () => {
    const summary = buildGenerationComposerSummary({
      selectedDeckTitle: 'Board Update',
      instruction:
        'Build a concise board update deck with product milestones, risks, and next-quarter priorities.',
      selectedProvider: {
        id: 'provider_1',
        name: 'Primary Gemini',
        kind: 'gemini',
        enabled: true,
        allowUserCredentials: false,
        baseUrl: null,
        hasSystemCredential: true,
        userCredentials: []
      },
      selectedModel: {
        id: 'gemini-2.0-pro',
        label: 'Gemini 2.0 Pro',
        supportsFileUpload: false
      },
      selectedDesignSystemLabel: 'No design system selected yet',
      language: 'en',
      referenceFiles: [
        {
          id: 'reference_1',
          deckId: 'deck_1',
          originalFilename: 'notes.pdf',
          mimeType: 'application/pdf',
          extension: 'pdf',
          sizeBytes: 2_400_000,
          pageCount: 12,
          imageWidth: null,
          imageHeight: null,
          storageBucket: 'pepetex-dev',
          storageObjectPath: 'decks/deck_1/references/notes.pdf',
          providerFileId: null,
          providerDefinitionId: null,
          expiresAt: '2026-05-01T00:00:00.000Z',
          createdAt: '2026-04-26T00:00:00.000Z',
          updatedAt: '2026-04-26T00:00:00.000Z'
        }
      ]
    });

    expect(summary.readiness).toBe('ready');
    expect(summary.languageLabel).toBe('English');
    expect(summary.fileCapabilityWarning).toContain('does not advertise reference-file upload support');
    expect(summary.instructionPreview).toContain('Build a concise board update deck');
  });

  it('describes missing credentials for BYOK-enabled providers', () => {
    expect(
      describeProviderCredentialAvailability({
        id: 'provider_1',
        name: 'Custom OpenAI',
        kind: 'openai-compatible',
        enabled: true,
        allowUserCredentials: true,
        baseUrl: 'https://example.com/v1',
        hasSystemCredential: false,
        userCredentials: []
      })
    ).toContain('No credential is configured yet');
  });

  it('formats reference file sizes in human-readable units', () => {
    expect(formatReferenceFileSize(980)).toBe('980 B');
    expect(formatReferenceFileSize(24_000)).toBe('23.4 KB');
    expect(formatReferenceFileSize(2_400_000)).toBe('2.3 MB');
  });
});
