import type { PromptAssemblyInput, ReferenceFilePromptInput } from '@pepetex/prompts';

/**
 * Builds a PromptAssemblyInput from a plain record, omitting undefined optional properties
 * to comply with exactOptionalPropertyTypes.
 */
export function pickDefinedPromptInput(raw: Record<string, unknown>): PromptAssemblyInput {
  const result: PromptAssemblyInput = {};
  if (typeof raw.workspaceInstruction === 'string') result.workspaceInstruction = raw.workspaceInstruction;
  if (typeof raw.designSystemInstruction === 'string') result.designSystemInstruction = raw.designSystemInstruction;
  if (typeof raw.customPromptInstruction === 'string') result.customPromptInstruction = raw.customPromptInstruction;
  if (typeof raw.manualInstruction === 'string') result.manualInstruction = raw.manualInstruction;
  if (Array.isArray(raw.referenceFiles)) result.referenceFiles = raw.referenceFiles as ReferenceFilePromptInput[];
  if (typeof raw.deckState === 'string') result.deckState = raw.deckState;
  if (typeof raw.commentsAndTweaks === 'string') result.commentsAndTweaks = raw.commentsAndTweaks;
  return result;
}
