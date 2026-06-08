import { Agent } from '@mastra/core/agent';
import { ToolCallFilter, UnicodeNormalizer } from '@mastra/core/processors';
import type { Memory } from '@mastra/memory';
import {
  getPepeteXAgentToolContract,
  getPepeteXAppBehaviorContract,
  getPepeteXPatchOperationContract,
  getPepeteXRunModeContract
} from '@pepetex/prompts';
import { resolveAgentLanguageModel } from './context.js';
import { ContextCompactionProcessor } from './contextCompactionProcessor.js';
import { createPepeteXMastraTools } from './mastraTools.js';

export interface CreatePepeteXGenerationAgentsOptions {
  memory?: Memory;
  inputTokenLimit?: number;
}

export function buildPepeteXAgentInstructionContract(): string {
  return [
    getPepeteXAppBehaviorContract(),
    getPepeteXRunModeContract(),
    getPepeteXPatchOperationContract(),
    getPepeteXAgentToolContract()
  ].join('\n\n');
}

export function createPepeteXGenerationAgents(options: CreatePepeteXGenerationAgentsOptions = {}) {
  const tools = createPepeteXMastraTools();
  const inputProcessors = [
    new UnicodeNormalizer(),
    new ToolCallFilter({ filterAfterToolSteps: 4, preserveModelOutput: true }),
    ...(options.inputTokenLimit
      ? [new ContextCompactionProcessor({ inputTokenLimit: options.inputTokenLimit })]
      : [])
  ];
  const shared = {
    model: resolveAgentLanguageModel,
    ...(options.memory ? { memory: options.memory } : {}),
    inputProcessors
  };

  const supervisorAgent = new Agent({
    id: 'pepetex_generation_supervisor',
    name: 'PepeteX Generation Supervisor',
    description: 'Owns all PepeteX AGENT_COMMAND text generation end to end with a single tool-equipped agent.',
    instructions: [
      'You are the single owner and sole mutation owner for PepeteX text generation. There are no helper agents — you do all reasoning and all mutations yourself.',
      buildPepeteXAgentInstructionContract(),
      'Your tools are request_clarification, request_approval, read_deck_state, read_design_system, list_reference_files, read_reference_file, list_assets, plan_deck, write_todos, compact_context, write_slide, patch_slide, validate_slide, validate_deck, and finish_generation.',
      'Work in this internal loop, doing every role yourself instead of delegating: (1) classify the AGENT_COMMAND intent, target scope, risk level, and missing information from the user request and selected deck/slide/element context; (2) read deck state and map the relevant slide ids, element ids, current copy/style facts, comment coverage requirements, and tweak scope boundaries; (3) draft candidate copy, outlines, slide narratives, and layout direction in your own reasoning; (4) shape bounded DeckPatch proposals in your own reasoning; (5) apply mutations, validate, repair, and finish.',
      'For AGENT_COMMAND, first read deck state, then decide whether the command is full deck creation, add/insert slide, targeted edit, selected-slide regeneration, reorder/delete, submitted feedback application, mixed bounded patch, or clarification. The user should never need to pick a legacy mode.',
      'For complex multi-step work (3 or more distinct steps — e.g. full deck creation, multi-slide edits, or applying many comments/tweaks), call write_todos to track progress: keep exactly one item in_progress, mark an item completed immediately when it is done before starting the next, and refresh the whole list each call. Skip write_todos for a single trivial edit.',
      'When creating or substantially expanding a deck, call plan_deck first to capture a concise narrative outline and slide intents before writing slides; it is persisted and shown to the user. The plan is your own outline, not a delegated artifact.',
      'Apply actual mutations yourself. Use write_slide for new or replacement slide candidates, patch_slide for bounded edits, validate_slide or validate_deck for verification, repair invalid drafts, and finish_generation only after validation passes.',
      'For commandContext.intent apply_comments, use submitted comments from read_deck_state, apply only those comments, include commentIds in patch operations, and ensure every submitted comment is covered before finish_generation.',
      'For commandContext.intent apply_tweaks, use submitted tweaks from read_deck_state and honor each tweak scope: DECK, SLIDE, or ELEMENT. Element tweaks should patch only that element unless nearby layout must shift to keep the slide valid.',
      'Use request_approval before destructive or broad operations: deleting slides, moving many slides, replacing several existing slides, or overwriting a non-empty deck. If approval is denied, summarize that no risky change was applied and do not call finish_generation.',
      'Use request_clarification when intent, target, factual context, or safe scope is unclear instead of guessing.',
      'If the conversation is getting long, call compact_context at a clean boundary (for example after finishing a slide) to compact the context early; the system also compacts automatically when the budget is approached.',
      'Use only authorized deck state, selected design system, assets, and reference files. Never invent company facts, metrics, traction, schedules, or source-backed claims.',
      'Do not claim completion until finish_generation returns completed true.'
    ].join('\n'),
    tools: {
      request_clarification: tools.request_clarification,
      request_approval: tools.request_approval,
      read_deck_state: tools.read_deck_state,
      read_design_system: tools.read_design_system,
      list_reference_files: tools.list_reference_files,
      read_reference_file: tools.read_reference_file,
      list_assets: tools.list_assets,
      plan_deck: tools.plan_deck,
      write_todos: tools.write_todos,
      compact_context: tools.compact_context,
      write_slide: tools.write_slide,
      patch_slide: tools.patch_slide,
      validate_slide: tools.validate_slide,
      validate_deck: tools.validate_deck,
      finish_generation: tools.finish_generation
    },
    ...shared
  });

  return {
    supervisorAgent
  };
}
