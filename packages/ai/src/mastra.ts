import { Mastra } from '@mastra/core';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { PostgresStore } from '@mastra/pg';
import type { AgentLanguageModel } from '@pepetex/providers';
import { createPepeteXGenerationAgents } from './agent/generationSupervisor.js';
import { createPepeteXDesignSystemAgent } from './agent/designSystemStudio.js';
import { createPepeteXAgentMemory } from './agent/memory.js';
import { generateDeckWorkflow } from './workflows/generateDeckWorkflow.js';
import { generateSingleSlideWorkflow } from './workflows/generateSingleSlideWorkflow.js';
import { regenerateSlideWorkflow } from './workflows/regenerateSlideWorkflow.js';
import { applyCommentsWorkflow } from './workflows/applyCommentsWorkflow.js';
import { applyTweaksWorkflow } from './workflows/applyTweaksWorkflow.js';
import { generateImageWorkflow } from './workflows/generateImageWorkflow.js';

export function createPepeteXMastra(options?: {
  storage?: MastraCompositeStore;
  databaseUrl?: string;
  disableTelemetry?: boolean;
  enableAgents?: boolean;
  agentMemoryModel?: AgentLanguageModel;
  agentInputTokenLimit?: number;
}): Mastra {
  const storage = options?.storage ?? createMastraPostgresStorage(options?.databaseUrl);
  const memory = options?.agentMemoryModel
    ? createPepeteXAgentMemory({
        ...(storage ? { storage } : {}),
        observerModel: options.agentMemoryModel,
        ...(options.agentInputTokenLimit
          ? { observationMessageTokens: Math.floor(options.agentInputTokenLimit * 0.8) }
          : {})
      })
    : undefined;
  const agents = options?.enableAgents === false
    ? undefined
    : createPepeteXGenerationAgents({
        ...(memory ? { memory } : {}),
        ...(options?.agentInputTokenLimit ? { inputTokenLimit: options.agentInputTokenLimit } : {})
      });
  const designSystemAgent = options?.enableAgents === false
    ? undefined
    : createPepeteXDesignSystemAgent({
        ...(memory ? { memory } : {}),
        ...(options?.agentInputTokenLimit ? { inputTokenLimit: options.agentInputTokenLimit } : {})
      });

  const mastra = new Mastra({
    ...(agents
      ? {
          agents: {
            pepeteXGenerationSupervisor: agents.supervisorAgent,
            ...(designSystemAgent ? { pepeteXDesignSystemStudio: designSystemAgent } : {})
          }
        }
      : {}),
    workflows: {
      generateDeckWorkflow,
      generateSingleSlideWorkflow,
      regenerateSlideWorkflow,
      applyCommentsWorkflow,
      applyTweaksWorkflow,
      generateImageWorkflow
    },
    ...(storage !== undefined ? { storage } : {}),
    ...(options?.disableTelemetry
      ? { telemetry: { enabled: false } as Record<string, unknown> }
      : {})
  });

  return mastra;
}

function createMastraPostgresStorage(databaseUrl: string | undefined): MastraCompositeStore | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  return new PostgresStore({
    id: 'pepetex-mastra',
    connectionString: databaseUrl
  });
}
