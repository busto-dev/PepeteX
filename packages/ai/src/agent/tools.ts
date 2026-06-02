import type { DeckAgentTool } from './types.js';

export const pepeteXAgentToolNames = [
  'read_deck_state',
  'create_deck_plan',
  'write_slide_html',
  'validate_slide',
  'inspect_slide_quality',
  'apply_direct_edit',
  'save_checkpoint',
  'fork_verifier_agent',
  'commit_deck_revision'
] as const;

export type PepeteXAgentToolName = (typeof pepeteXAgentToolNames)[number];

export interface PepeteXAgentToolDescriptor {
  name: PepeteXAgentToolName;
  label: string;
  description: string;
}

export const pepeteXAgentToolDescriptors: readonly PepeteXAgentToolDescriptor[] = [
  {
    name: 'read_deck_state',
    label: 'Reading deck state',
    description: 'Load the current deck JSON, selected slide, references, and generation constraints.'
  },
  {
    name: 'create_deck_plan',
    label: 'Planning visual direction',
    description: 'Create palette, typography mood, motifs, slide archetypes, density budget, and per-slide intent.'
  },
  {
    name: 'write_slide_html',
    label: 'Writing slide HTML',
    description: 'Generate or rewrite bounded PepeteX slide HTML and CSS.'
  },
  {
    name: 'validate_slide',
    label: 'Validating slide contract',
    description: 'Run schema, HTML contract, targetability, and repair-required checks.'
  },
  {
    name: 'inspect_slide_quality',
    label: 'Inspecting design quality',
    description: 'Detect weak hierarchy, tiny text, repeated layouts, missing anchors, and excessive density.'
  },
  {
    name: 'apply_direct_edit',
    label: 'Apply direct edit',
    description: 'Apply a targeted edit to a slide or element after validation/verifier feedback.'
  },
  {
    name: 'save_checkpoint',
    label: 'Saving checkpoint',
    description: 'Persist a draft deck snapshot and its validation state before committing.'
  },
  {
    name: 'fork_verifier_agent',
    label: 'Fork verifier agent',
    description: 'Run a bounded verifier pass that reports findings back into the visible transcript.'
  },
  {
    name: 'commit_deck_revision',
    label: 'Committing deck revision',
    description: 'Create the final DeckRevision after validation and checkpointing succeed.'
  }
];

export function createPepeteXToolRegistry(
  implementations: Partial<Record<PepeteXAgentToolName, DeckAgentTool['execute']>>
): DeckAgentTool[] {
  return pepeteXAgentToolDescriptors.map((descriptor) => ({
    ...descriptor,
    execute:
      implementations[descriptor.name] ??
      (async () => ({
        callId: descriptor.name,
        ok: false,
        errorMessage: `Tool implementation missing: ${descriptor.name}`
      }))
  }));
}