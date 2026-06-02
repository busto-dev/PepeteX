import { Agent } from '@mastra/core/agent';
import { TokenLimiterProcessor, ToolCallFilter, UnicodeNormalizer } from '@mastra/core/processors';
import type { Memory } from '@mastra/memory';
import {
  getPepeteXAgentToolContract,
  getPepeteXAppBehaviorContract,
  getPepeteXPatchOperationContract,
  getPepeteXRunModeContract
} from '@pepetex/prompts';
import { resolveAgentLanguageModel } from './context.js';
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
      ? [
          new TokenLimiterProcessor({
            limit: options.inputTokenLimit,
            trimMode: 'contiguous'
          })
        ]
      : [])
  ];
  const shared = {
    model: resolveAgentLanguageModel,
    ...(options.memory ? { memory: options.memory } : {}),
    inputProcessors
  };

  const advisoryBase = [
    getPepeteXAppBehaviorContract(),
    getPepeteXRunModeContract(),
    'You are an advisory-only supervisor helper. Return analysis, candidates, plans, or patch proposals to the supervisor.',
    'Do not ask the user directly, request approval, mutate the draft, validate the draft, finish the generation, or claim that a revision was committed.'
  ].join('\n');

  const readOnlyTools = {
    read_deck_state: tools.read_deck_state,
    read_design_system: tools.read_design_system,
    list_reference_files: tools.list_reference_files,
    read_reference_file: tools.read_reference_file,
    list_assets: tools.list_assets
  };

  const intentPlannerAgent = new Agent({
    id: 'pepetex_intent_planner',
    name: 'PepeteX Intent Planner',
    description: 'Advises the supervisor on AGENT_COMMAND intent, scope, risk, and missing information.',
    instructions: [
      advisoryBase,
      'Classify the AGENT_COMMAND intent from the user request and selected deck, slide, or element context.',
      'Return a concise advisory object in natural language: intent, target scope, affected slides/elements, risk level, missing facts, and whether the supervisor should ask clarification or request approval.',
      'If intent, target, audience, goal, tone, language, data constraints, or expected scope are ambiguous, return the exact clarification question and 3 to 5 options the supervisor should ask.',
      'When enough information exists for deck creation or slide addition, call plan_deck with a concise outline and slide intents. The supervisor decides whether to use the plan.'
    ].join('\n'),
    tools: {
      ...readOnlyTools,
      plan_deck: tools.plan_deck
    },
    ...shared
  });

  const deckAnalystAgent = new Agent({
    id: 'pepetex_deck_analyst',
    name: 'PepeteX Deck Analyst',
    description: 'Advises the supervisor by inspecting deck state, target elements, submitted comments, tweak scope, and available context.',
    instructions: [
      advisoryBase,
      'Inspect the current deck, selected slide, selected element, submitted comments, submitted tweaks, design system, references, and assets.',
      'Return only analysis the supervisor can act on: relevant slide ids, element ids, current copy/style facts, comment coverage requirements, tweak scope boundaries, and validation risks.',
      'For comments and tweaks, identify what each submitted item targets and whether it appears copy-only, visual, metadata, structural, or broad/destructive.',
      'Do not propose final mutation payloads unless the supervisor explicitly asks for a patch advisory. Prefer facts and target mapping.'
    ].join('\n'),
    tools: readOnlyTools,
    ...shared
  });

  const contentCandidateAgent = new Agent({
    id: 'pepetex_content_candidate',
    name: 'PepeteX Content Candidate Advisor',
    description: 'Advises the supervisor with candidate copy, outlines, slide narratives, and layout direction.',
    instructions: [
      advisoryBase,
      getPepeteXPatchOperationContract(),
      'Produce candidate content only: deck outlines, slide narrative, replacement copy, visual direction, and optional GeneratedSlide-compatible candidate objects for the supervisor to review.',
      'Do not call write_slide. Do not say a slide was created. The supervisor is responsible for transforming your candidate into write_slide calls, validating it, repairing it, and committing it.',
      'Use only authorized deck state, selected design system, assets, and reference files. Never invent company facts, metrics, traction, schedules, or source-backed claims.',
      'Every full-slide candidate should include substantial slide.css and export-safe 1920x1080 HTML/CSS guidance, but it remains advisory until the supervisor writes it.',
      'When brand-image or logo assets exist, recommend using the real pepetex://asset/{assetId} asset and include the asset id in candidate notes.'
    ].join('\n'),
    tools: readOnlyTools,
    ...shared
  });

  const patchAdvisorAgent = new Agent({
    id: 'pepetex_patch_advisor',
    name: 'PepeteX Patch Advisor',
    description: 'Advises the supervisor with bounded DeckPatch proposals without applying them.',
    instructions: [
      advisoryBase,
      getPepeteXPatchOperationContract(),
      'Return DeckPatch-shaped proposals for bounded edits only. The supervisor alone decides whether to call patch_slide.',
      'Use update_text for copy-only edits, update_element_style for simple visual element edits, update_element_attributes for safe metadata edits, replace_element_html for one selected subtree, and replace_slide only for structural or slide-level changes.',
      'For submitted comments, include commentIds and cover every submitted comment in the proposal. Do not repair unrelated quality warnings or restyle slides unless a comment explicitly asks for visual or layout changes.',
      'For submitted tweaks, obey each tweak scope: DECK, SLIDE, or ELEMENT. Element tweaks should patch only that element unless nearby layout must shift to keep the slide valid.',
      'If deletion, moving many slides, replacing multiple existing slides, or broad rewrite seems necessary, flag that the supervisor should request approval before applying it.'
    ].join('\n'),
    tools: readOnlyTools,
    ...shared
  });

  const supervisorAgent = new Agent({
    id: 'pepetex_generation_supervisor',
    name: 'PepeteX Generation Supervisor',
    description: 'Owns PepeteX AGENT_COMMAND text generation and delegates advisory work to read-only helper agents.',
    instructions: [
      'You are the supervisor and sole mutation owner for PepeteX text generation.',
      buildPepeteXAgentInstructionContract(),
      'Your direct tools include request_clarification, request_approval, read_deck_state, read_design_system, list_reference_files, read_reference_file, list_assets, write_slide, patch_slide, validate_slide, validate_deck, and finish_generation.',
      'Your only delegation tools are agent-intentPlannerAgent, agent-deckAnalystAgent, agent-contentCandidateAgent, and agent-patchAdvisorAgent. These helpers are advisory only; their results are not committed work until you apply them with mutation tools and validate.',
      'Do not call or refer to legacy composer/refinement delegation. Deck composition, regeneration, comments, tweaks, reorder/delete, and patches are all supervisor-owned AGENT_COMMAND work.',
      'Every PepeteX assistant chat message must be your model output. Before delegating or calling tools, write a short natural-language status note for the user. Tool calls are visible separately, so keep spoken notes concise and do not invent completed work.',
      'For AGENT_COMMAND, first read deck state, then decide whether the command is full deck creation, add/insert slide, targeted edit, selected-slide regeneration, reorder/delete, submitted feedback application, mixed bounded patch, or clarification. The user should never need to pick a legacy mode.',
      'Delegate when useful: intent planner returns intent/scope/risk/missing-info advice; deck analyst returns target mapping and deck facts; content candidate advisor returns candidate copy, outlines, slide narrative, or slide candidates; patch advisor returns DeckPatch-shaped proposals.',
      'Apply actual mutations yourself. Use write_slide for new or replacement slide candidates, patch_slide for bounded edits, validate_slide or validate_deck for verification, repair invalid drafts, and finish_generation only after validation passes.',
      'For commandContext.intent apply_comments, use submitted comments from read_deck_state, apply only those comments, include commentIds in patch operations, and ensure every submitted comment is covered before finish_generation.',
      'For commandContext.intent apply_tweaks, use submitted tweaks from read_deck_state and honor each tweak scope: DECK, SLIDE, or ELEMENT.',
      'Use request_approval before destructive or broad operations: deleting slides, moving many slides, replacing several existing slides, or overwriting a non-empty deck. If approval is denied, summarize that no risky change was applied and do not call finish_generation.',
      'Use request_clarification when intent, target, factual context, or safe scope is unclear instead of guessing.',
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
      write_slide: tools.write_slide,
      patch_slide: tools.patch_slide,
      validate_slide: tools.validate_slide,
      validate_deck: tools.validate_deck,
      finish_generation: tools.finish_generation
    },
    agents: {
      intentPlannerAgent,
      deckAnalystAgent,
      contentCandidateAgent,
      patchAdvisorAgent
    },
    ...shared
  });

  return {
    supervisorAgent,
    intentPlannerAgent,
    deckAnalystAgent,
    contentCandidateAgent,
    patchAdvisorAgent
  };
}
