import { beforeAll, describe, expect, it } from 'vitest';

import type { DeckPatch, GeneratedDeck } from '@pepetex/ai';

let applyDeckPatchToContent: typeof import('./generation-run').applyDeckPatchToContent;
let buildAgentStoppedBeforeFinishMessage: typeof import('./generation-run').buildAgentStoppedBeforeFinishMessage;
let buildWorkflowFailureMessage: typeof import('./generation-run').buildWorkflowFailureMessage;
let buildRepeatedDraftErrorEscalation: typeof import('./generation-run').buildRepeatedDraftErrorEscalation;
let normalizeGeneratedDeckTitleForCommit: typeof import('./generation-run').normalizeGeneratedDeckTitleForCommit;

beforeAll(async () => {
  process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  ({
    applyDeckPatchToContent,
    buildAgentStoppedBeforeFinishMessage,
    buildWorkflowFailureMessage,
    buildRepeatedDraftErrorEscalation,
    normalizeGeneratedDeckTitleForCommit
  } = await import('./generation-run'));
});

const baseDeck: GeneratedDeck = {
  title: 'Test Deck',
  language: 'en',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  slides: [
    {
      id: 'slide_1',
      title: 'Old title',
      html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1"><h1 data-pepetex-id="headline_1" data-pepetex-type="headline">Old title</h1><p data-pepetex-id="body_1" data-pepetex-type="body">Body text</p></section>',
      css: '',
      assets: [],
      charts: [],
      diagrams: []
    }
  ]
};

describe('applyDeckPatchToContent', () => {
  it('applies update_text patches to slide HTML', () => {
    const patch: DeckPatch = {
      operations: [
        {
          op: 'update_text',
          slideId: 'slide_1',
          elementId: 'headline_1',
          text: 'Updated title'
        }
      ]
    };

    const result = applyDeckPatchToContent(baseDeck, patch);

    expect(result.slides[0]?.title).toBe('Updated title');
    expect(result.slides[0]?.html).toContain('Updated title');
    expect(result.slides[0]?.html).not.toContain('Old title');
  });

  it('throws when a patch operation targets a missing element', () => {
    const patch: DeckPatch = {
      operations: [
        {
          op: 'update_text',
          slideId: 'slide_1',
          elementId: 'missing_element',
          text: 'Updated title'
        }
      ]
    };

    expect(() => applyDeckPatchToContent(baseDeck, patch)).toThrow(
      'Slide element not found for update_text: missing_element'
    );
  });

  it('applies targeted element style patches to slide CSS', () => {
    const patch: DeckPatch = {
      operations: [
        {
          op: 'update_element_style',
          slideId: 'slide_1',
          elementId: 'body_1',
          styles: {
            color: '#ef4444'
          },
          commentIds: ['comment-red']
        }
      ]
    };

    const result = applyDeckPatchToContent(baseDeck, patch);

    expect(result.slides[0]?.css).toContain('[data-pepetex-slide-id="slide_1"] [data-pepetex-id="body_1"]');
    expect(result.slides[0]?.css).toContain('color: #ef4444');
    expect(result.slides[0]?.html).toBe(baseDeck.slides[0]?.html);
  });

  it('applies safe attribute patches to selected elements', () => {
    const patch: DeckPatch = {
      operations: [
        {
          op: 'update_element_attributes',
          slideId: 'slide_1',
          elementId: 'body_1',
          attributes: {
            title: 'Updated body label'
          },
          commentIds: ['comment-title']
        }
      ]
    };

    const result = applyDeckPatchToContent(baseDeck, patch);

    expect(result.slides[0]?.html).toContain('title="Updated body label"');
  });

  it('replaces selected element HTML without replacing the whole slide', () => {
    const patch: DeckPatch = {
      operations: [
        {
          op: 'replace_element_html',
          slideId: 'slide_1',
          elementId: 'body_1',
          html: '<p data-pepetex-id="body_1" data-pepetex-type="body">Updated body block</p>',
          commentIds: ['comment-body']
        }
      ]
    };

    const result = applyDeckPatchToContent(baseDeck, patch);

    expect(result.slides[0]?.html).toContain('Updated body block');
    expect(result.slides[0]?.html).not.toContain('Body text');
    expect(result.slides[0]?.html).toContain('Old title');
  });

  it('throws when replacement element HTML changes the selected id', () => {
    const patch: DeckPatch = {
      operations: [
        {
          op: 'replace_element_html',
          slideId: 'slide_1',
          elementId: 'body_1',
          html: '<p data-pepetex-id="other_body" data-pepetex-type="body">Updated body block</p>'
        }
      ]
    };

    expect(() => applyDeckPatchToContent(baseDeck, patch)).toThrow('preserve data-pepetex-id');
  });
});

describe('buildWorkflowFailureMessage', () => {
  it('includes nested workflow error details when available', () => {
    expect(
      buildWorkflowFailureMessage({
        status: 'failed',
        error: {
          message: 'AI output failed schema validation: result.assumptions must be an array.'
        }
      })
    ).toBe(
      'Workflow ended with status: failed: AI output failed schema validation: result.assumptions must be an array.'
    );
  });
});

describe('buildAgentStoppedBeforeFinishMessage', () => {
  it('includes stream, tool, and draft details for stopped agent runs', () => {
    expect(
      buildAgentStoppedBeforeFinishMessage({
        draftSlideCount: 8,
        latestCheckpointId: 'checkpoint_1',
        latestCheckpointSummary: 'Added slide 9.',
        finishReason: 'length',
        lastChunkType: 'finish',
        lastToolName: 'write_slide',
        lastToolStatus: 'COMPLETED',
        chunkCount: 42,
        failedToolErrors: ['write_slide: CSS property "mix-blend-mode" is not allowed.']
      })
    ).toContain('finishReason=length');
  });

  it('states when the latest valid draft was committed as fallback', () => {
    expect(
      buildAgentStoppedBeforeFinishMessage({
        draftSlideCount: 8,
        committedFallback: true,
        latestCheckpointId: 'checkpoint_1'
      })
    ).toContain('committed the latest valid draft checkpoint');
  });
});

describe('normalizeGeneratedDeckTitleForCommit', () => {
  it('derives a title from the initial instruction when the model leaves a generic title', () => {
    const result = normalizeGeneratedDeckTitleForCommit(
      {
        ...baseDeck,
        title: 'Untitled deck'
      },
      'Build a 10-slide investor update deck for Q3 product momentum, executive tone.'
    );

    expect(result.title).toBe('investor update for Q3 product momentum');
  });

  it('keeps a specific generated title', () => {
    const result = normalizeGeneratedDeckTitleForCommit(
      {
        ...baseDeck,
        title: 'Q3 Product Momentum'
      },
      'Build a deck'
    );

    expect(result.title).toBe('Q3 Product Momentum');
  });
});

describe('buildRepeatedDraftErrorEscalation', () => {
  it('names the allowed element types and the headline directive so the agent stops looping', () => {
    const message = buildRepeatedDraftErrorEscalation(3);

    expect(message).toContain('3 times in a row');
    expect(message).toContain('Stop retrying the same fix');
    // The exact failure mode that caused the runaway loop: title typed as "header"/"title".
    expect(message).toContain('data-pepetex-type="headline"');
    expect(message).toContain('not "header"/"title"');
    // The valid type list must be present so the model can self-correct in one shot.
    expect(message).toContain('headline');
    expect(message).toContain('header');
    expect(message).toContain('decorative');
  });
});
