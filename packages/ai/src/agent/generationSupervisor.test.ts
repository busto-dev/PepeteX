import { describe, expect, it } from 'vitest';

import { buildPepeteXAgentInstructionContract, createPepeteXGenerationAgents } from './generationSupervisor';

describe('PepeteX generation agent instructions', () => {
  it('include the comprehensive app, mode, patch, and tool contracts', () => {
    const contract = buildPepeteXAgentInstructionContract();

    expect(contract).toContain('PepeteX app behavior contract');
    expect(contract).toContain('PepeteX run-mode contract');
    expect(contract).toContain('PepeteX patch operation contract');
    expect(contract).toContain('PepeteX agent tool contract');
    expect(contract).toContain('AGENT_COMMAND is the only active text-generation run mode');
    expect(contract).toContain('Historical text run kinds');
    expect(contract).toContain('"op": "update_text"');
    expect(contract).toContain('"op": "update_element_style"');
    expect(contract).toContain('"op": "replace_element_html"');
    expect(contract).toContain('commentIds');
    expect(contract).toContain('write_slide');
    expect(contract).toContain('patch_slide');
    expect(contract).toContain('finish_generation');
    expect(contract).toContain('write_todos');
    expect(contract).toContain('compact_context');
  });

  it('exposes a single agent that owns every tool with no advisory subagents', async () => {
    const result = createPepeteXGenerationAgents();

    // Only the single supervisor agent is returned now — no advisory specialists.
    expect(Object.keys(result)).toEqual(['supervisorAgent']);

    const supervisorTools = Object.keys(await result.supervisorAgent.listTools());
    expect(supervisorTools).toEqual(expect.arrayContaining([
      'request_clarification',
      'request_approval',
      'read_deck_state',
      'read_design_system',
      'list_reference_files',
      'read_reference_file',
      'list_assets',
      'plan_deck',
      'write_todos',
      'compact_context',
      'write_slide',
      'patch_slide',
      'validate_slide',
      'validate_deck',
      'finish_generation'
    ]));
  });

  it('has no delegated subagents and keeps single-owner instructions', async () => {
    const { supervisorAgent } = createPepeteXGenerationAgents();
    const subagentNames = Object.keys(supervisorAgent.__getStaticAgents() ?? {});
    expect(subagentNames).toEqual([]);

    const instructions = String(await supervisorAgent.getInstructions());
    expect(instructions).toContain('sole mutation owner');
    expect(instructions).not.toContain('agent-intentPlannerAgent');
    expect(instructions).not.toContain('agent-deckAnalystAgent');
    expect(instructions).not.toContain('agent-contentCandidateAgent');
    expect(instructions).not.toContain('agent-patchAdvisorAgent');
  });
});
