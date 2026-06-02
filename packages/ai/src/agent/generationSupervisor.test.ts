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
  });

  it('keeps mutation and suspend tools on the supervisor, not advisory specialists', async () => {
    const {
      supervisorAgent,
      intentPlannerAgent,
      deckAnalystAgent,
      contentCandidateAgent,
      patchAdvisorAgent
    } = createPepeteXGenerationAgents();

    const supervisorTools = Object.keys(await supervisorAgent.listTools());
    expect(supervisorTools).toEqual(expect.arrayContaining([
      'request_clarification',
      'request_approval',
      'write_slide',
      'patch_slide',
      'validate_slide',
      'validate_deck',
      'finish_generation'
    ]));

    for (const specialist of [intentPlannerAgent, deckAnalystAgent, contentCandidateAgent, patchAdvisorAgent]) {
      const toolNames = Object.keys(await specialist.listTools());
      expect(toolNames).not.toContain('request_clarification');
      expect(toolNames).not.toContain('request_approval');
      expect(toolNames).not.toContain('write_slide');
      expect(toolNames).not.toContain('patch_slide');
      expect(toolNames).not.toContain('validate_slide');
      expect(toolNames).not.toContain('validate_deck');
      expect(toolNames).not.toContain('finish_generation');
    }

    const instructions = String(await supervisorAgent.getInstructions());
    expect(instructions).not.toContain('You do not have write_slide');
    expect(instructions).not.toContain('agent-composerAgent');
    expect(instructions).not.toContain('agent-refinementAgent');
    expect(instructions).toContain('sole mutation owner');
    expect(instructions).toContain('agent-intentPlannerAgent');
    expect(instructions).toContain('agent-deckAnalystAgent');
    expect(instructions).toContain('agent-contentCandidateAgent');
    expect(instructions).toContain('agent-patchAdvisorAgent');
  });

  it('exposes only advisory helper subagents to the supervisor', () => {
    const { supervisorAgent } = createPepeteXGenerationAgents();
    const subagentNames = Object.keys(supervisorAgent.__getStaticAgents() ?? {});

    expect(subagentNames).toEqual([
      'intentPlannerAgent',
      'deckAnalystAgent',
      'contentCandidateAgent',
      'patchAdvisorAgent'
    ]);
    expect(subagentNames).not.toContain('composerAgent');
    expect(subagentNames).not.toContain('refinementAgent');
  });
});
