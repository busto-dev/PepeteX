import { beforeAll, describe, expect, it } from 'vitest';

let assertSubmitGenerationRunInput: typeof import('./generation-runs').assertSubmitGenerationRunInput;
let submitGenerationRun: typeof import('./generation-runs').submitGenerationRun;

beforeAll(async () => {
  process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  ({ assertSubmitGenerationRunInput, submitGenerationRun } = await import('./generation-runs'));
});

describe('assertSubmitGenerationRunInput', () => {
  it('requires a text provider for text generation runs', () => {
    expect(() =>
      assertSubmitGenerationRunInput({
        kind: 'AGENT_COMMAND',
        textModelId: 'gemini-3.1-flash-lite'
      })
    ).toThrow('textProviderId is required for text generation.');
  });

  it('requires a text model for text generation runs', () => {
    expect(() =>
      assertSubmitGenerationRunInput({
        kind: 'AGENT_COMMAND',
        textProviderId: 'provider_gemini'
      })
    ).toThrow('textModelId is required for text generation.');
  });

  it('allows image-only generation without a text provider', () => {
    expect(
      assertSubmitGenerationRunInput({
        kind: 'GENERATE_IMAGE',
        imageProviderId: 'image_provider_gemini'
      })
    ).toMatchObject({
      kind: 'GENERATE_IMAGE',
      imageProviderId: 'image_provider_gemini',
      textProviderId: undefined,
      textModelId: undefined
    });
  });

  it('rejects legacy text generation kinds for new submissions', () => {
    expect(() =>
      assertSubmitGenerationRunInput({
        kind: 'FULL_DECK' as never,
        textProviderId: 'provider_gemini',
        textModelId: 'gemini-3.1-flash-lite'
      })
    ).toThrow('Legacy text generation kind FULL_DECK is no longer accepted');
  });

  it('does not queue text generation runs without a text provider', async () => {
    await expect(
      submitGenerationRun(
        'user_1',
        {
          deckId: 'deck_1',
          workspaceId: 'workspace_1',
          kind: 'AGENT_COMMAND',
          textModelId: 'gemini-3.1-flash-lite'
        },
        {} as never
      )
    ).rejects.toThrow('textProviderId is required for text generation.');
  });
});
