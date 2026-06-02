import { describe, expect, it } from 'vitest'

import {
  parseInitialGenerationQuery,
  serializeInitialGenerationQuery
} from './initial-generation-settings'

describe('initial generation settings query', () => {
  it('round-trips full homepage generation settings', () => {
    const query = serializeInitialGenerationQuery({
      manualInstruction: 'Build a launch deck',
      textProviderId: 'provider_text',
      textModelId: 'gemini-3.1-flash-lite-preview',
      customPromptId: 'prompt_exec',
      designSystemId: 'design_telco',
      languageCode: 'id',
      enableImageGeneration: true,
      imageProviderId: 'provider_image',
      imageModelId: 'imagen-3.0-generate'
    })

    expect(query).toEqual({
      prompt: 'Build a launch deck',
      textProviderId: 'provider_text',
      textModelId: 'gemini-3.1-flash-lite-preview',
      customPromptId: 'prompt_exec',
      designSystemId: 'design_telco',
      languageCode: 'id',
      enableImageGeneration: '1',
      imageProviderId: 'provider_image',
      imageModelId: 'imagen-3.0-generate'
    })
    expect(parseInitialGenerationQuery(query)).toEqual({
      manualInstruction: 'Build a launch deck',
      textProviderId: 'provider_text',
      textModelId: 'gemini-3.1-flash-lite-preview',
      customPromptId: 'prompt_exec',
      designSystemId: 'design_telco',
      languageCode: 'id',
      enableImageGeneration: true,
      imageProviderId: 'provider_image',
      imageModelId: 'imagen-3.0-generate',
      prefillOnly: false
    })
  })

  it('serializes prefillOnly when set', () => {
    const query = serializeInitialGenerationQuery({
      manualInstruction: 'Pitch deck',
      textProviderId: null,
      textModelId: null,
      customPromptId: null,
      designSystemId: null,
      languageCode: 'en',
      enableImageGeneration: false,
      imageProviderId: null,
      imageModelId: null,
      prefillOnly: true
    })
    expect(query.prefillOnly).toBe('1')
    expect(parseInitialGenerationQuery(query)?.prefillOnly).toBe(true)
  })

  it('keeps old prompt-only links valid', () => {
    expect(parseInitialGenerationQuery({ prompt: 'Board update' })).toMatchObject({
      manualInstruction: 'Board update',
      textProviderId: null,
      textModelId: null,
      languageCode: 'en',
      enableImageGeneration: false,
      prefillOnly: false
    })
  })

  it('parses template settings even when the prompt is missing', () => {
    expect(parseInitialGenerationQuery({
      textProviderId: 'provider_text',
      textModelId: 'gemini-3.1-pro-preview',
      designSystemId: 'design_global',
      prefillOnly: '1'
    })).toEqual({
      manualInstruction: '',
      textProviderId: 'provider_text',
      textModelId: 'gemini-3.1-pro-preview',
      customPromptId: null,
      designSystemId: 'design_global',
      languageCode: 'en',
      enableImageGeneration: false,
      imageProviderId: null,
      imageModelId: null,
      prefillOnly: true
    })
  })
})
