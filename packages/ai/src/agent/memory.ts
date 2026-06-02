import type { MastraCompositeStore } from '@mastra/core/storage';
import { Memory } from '@mastra/memory';
import type { AgentLanguageModel } from '@pepetex/providers';

export const DEFAULT_OBSERVATION_MESSAGE_TOKENS = 64_000;

export interface CreatePepeteXAgentMemoryOptions {
  storage?: MastraCompositeStore;
  /**
   * Model used by the Observational Memory Observer/Reflector agents. Pass the same
   * language model the run uses so summarization runs through the run's provider and
   * credentials. When omitted, Observational Memory stays disabled (e.g. in tests).
   */
  observerModel?: AgentLanguageModel;
  /**
   * Token count of unobserved messages that triggers Observational Memory's Observer
   * to compress raw history into observations. The worker passes a value derived from
   * the selected run model's budget; this fallback is only for direct callers.
   */
  observationMessageTokens?: number;
}

export function createPepeteXAgentMemory(options: CreatePepeteXAgentMemoryOptions = {}): Memory {
  const { storage, observerModel } = options;
  const observationMessageTokens = Math.max(
    4_096,
    Math.floor(options.observationMessageTokens ?? DEFAULT_OBSERVATION_MESSAGE_TOKENS)
  );
  return new Memory({
    ...(storage ? { storage } : {}),
    options: {
      lastMessages: 40,
      semanticRecall: false,
      workingMemory: {
        enabled: false
      },
      ...(observerModel
        ? {
            observationalMemory: {
              // Sets both the Observer and Reflector model.
              model: observerModel as never,
              observation: { messageTokens: observationMessageTokens }
            }
          }
        : {})
    }
  });
}
