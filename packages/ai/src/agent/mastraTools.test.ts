import { describe, expect, it } from 'vitest';

import {
  assertDeckPatchCoversSubmittedComments,
  collectDeckPatchCoveredCommentIds,
  constrainApplyCommentsPatch,
  normalizePatchInput
} from './mastraTools';

describe('normalizePatchInput', () => {
  it('accepts a direct generated slide object as a replace_slide patch', () => {
    const patch = normalizePatchInput({
      id: 'proposal-hero',
      title: 'Pekan Kreasi',
      html: '<section class="pepetex-slide" data-pepetex-slide-id="proposal-hero">Hero</section>',
      css: '.badge { background: #ef4444; }',
      assets: [],
      charts: [],
      diagrams: []
    });

    expect(patch.operations).toHaveLength(1);
    expect(patch.operations[0]).toMatchObject({
      op: 'replace_slide',
      slideId: 'proposal-hero',
      slide: {
        id: 'proposal-hero',
        title: 'Pekan Kreasi',
        css: '.badge { background: #ef4444; }'
      }
    });
  });

  it('accepts slide arrays as replace_slide operations', () => {
    const patch = normalizePatchInput({
      slides: [
        {
          id: 'slide-1',
          title: 'Slide 1',
          html: '<section data-pepetex-slide-id="slide-1"><h1>Slide 1</h1></section>',
          css: ''
        }
      ]
    });

    expect(patch.operations).toEqual([
      expect.objectContaining({
        op: 'replace_slide',
        slideId: 'slide-1'
      })
    ]);
  });

  it('keeps valid operation patches intact', () => {
    const patch = normalizePatchInput({
      operations: [
        {
          op: 'update_text',
          slideId: 'slide-1',
          elementId: 'headline',
          text: 'Updated'
        }
      ]
    });

    expect(patch.operations).toEqual([
      {
        op: 'update_text',
        slideId: 'slide-1',
        elementId: 'headline',
        text: 'Updated'
      }
    ]);
  });

  it('normalizes malformed update_text aliases from agent tool calls', () => {
    const patch = normalizePatchInput({
      slideId: 'proposal-hero',
      operations: [
        {
          command: 'update_text',
          elementId: 'hero-year',
          html: 'Tahun Ajaran 2025/2026'
        }
      ]
    });

    expect(patch.operations).toEqual([
      {
        op: 'update_text',
        slideId: 'proposal-hero',
        elementId: 'hero-year',
        text: 'Tahun Ajaran 2025/2026'
      }
    ]);
  });

  it('normalizes scoped element style, attributes, and html replacement operations', () => {
    const patch = normalizePatchInput({
      slideId: 'proposal-hero',
      operations: [
        {
          command: 'change_color',
          elementId: 'hero-badge',
          styles: { color: '#ef4444' },
          commentIds: ['comment-red']
        },
        {
          command: 'set_attribute',
          elementId: 'hero-image',
          attributes: { alt: 'Updated hero image', title: null },
          commentIds: ['comment-alt']
        },
        {
          command: 'replace_element',
          elementId: 'hero-body',
          replacementHtml: '<p data-pepetex-id="hero-body" data-pepetex-type="body">Updated body</p>',
          commentIds: ['comment-body']
        }
      ]
    });

    expect(patch.operations).toEqual([
      {
        op: 'update_element_style',
        slideId: 'proposal-hero',
        elementId: 'hero-badge',
        styles: { color: '#ef4444' },
        commentIds: ['comment-red']
      },
      {
        op: 'update_element_attributes',
        slideId: 'proposal-hero',
        elementId: 'hero-image',
        attributes: { alt: 'Updated hero image', title: null },
        commentIds: ['comment-alt']
      },
      {
        op: 'replace_element_html',
        slideId: 'proposal-hero',
        elementId: 'hero-body',
        html: '<p data-pepetex-id="hero-body" data-pepetex-type="body">Updated body</p>',
        commentIds: ['comment-body']
      }
    ]);
  });

  it('throws an actionable error for empty patches', () => {
    expect(() => normalizePatchInput({})).toThrow('patch_slide expects patch.operations');
  });
});

describe('comment coverage helpers', () => {
  it('uses explicit operation commentIds when present', () => {
    const patch = normalizePatchInput({
      operations: [
        {
          op: 'update_element_style',
          slideId: 'slide-1',
          elementId: 'badge',
          styles: { color: '#ef4444' },
          commentIds: ['comment-1']
        },
        {
          op: 'update_text',
          slideId: 'slide-1',
          elementId: 'title',
          text: 'Updated title',
          commentIds: ['comment-2']
        }
      ]
    });

    const comments = [
      { id: 'comment-1', slideId: 'slide-1', elementIds: ['badge'], text: 'Change the color to red' },
      { id: 'comment-2', slideId: 'slide-1', elementIds: ['title'], text: 'Update the title' }
    ];

    expect(collectDeckPatchCoveredCommentIds(patch, comments)).toEqual(['comment-1', 'comment-2']);
    expect(() => assertDeckPatchCoversSubmittedComments(patch, comments)).not.toThrow();
  });

  it('fails when a submitted comment id has no matching operation', () => {
    const patch = normalizePatchInput({
      operations: [
        {
          op: 'update_text',
          slideId: 'slide-1',
          elementId: 'title',
          text: 'Updated title',
          commentIds: ['comment-2']
        }
      ]
    });

    expect(() =>
      assertDeckPatchCoversSubmittedComments(patch, [
        { id: 'comment-1', slideId: 'slide-1', elementIds: ['badge'], text: 'Change the color to red' },
        { id: 'comment-2', slideId: 'slide-1', elementIds: ['title'], text: 'Update the title' }
      ])
    ).toThrow('comment-1');
  });

  it('falls back to slide and element targeting for legacy patches without commentIds', () => {
    const patch = normalizePatchInput({
      operations: [
        {
          op: 'update_text',
          slideId: 'slide-1',
          elementId: 'title',
          text: 'Updated title'
        }
      ]
    });

    expect(collectDeckPatchCoveredCommentIds(patch, [
      { id: 'comment-1', slideId: 'slide-1', elementIds: ['title'], text: 'Update the title' }
    ])).toEqual(['comment-1']);
  });
});

describe('constrainApplyCommentsPatch', () => {
  it('converts targeted copy-comment slide replacements into update_text operations', () => {
    const patch = normalizePatchInput({
      id: 'proposal-hero',
      title: 'Pekan Kreativitas & Perayaan Angkatan',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="proposal-hero">
          <h1 data-pepetex-id="hero-title" data-pepetex-type="headline">Pekan Kreativitas &amp;<br>Perayaan Angkatan</h1>
        </section>
      `,
      css: '.pepetex-slide { width: 1920px; height: 1080px; }'
    });

    const constrained = constrainApplyCommentsPatch(patch, [
      {
        slideId: 'proposal-hero',
        elementIds: ['hero-title'],
        text: 'Change "Kreasi" to "Kreativitas"'
      }
    ]);

    expect(constrained.operations).toEqual([
      {
        op: 'update_text',
        slideId: 'proposal-hero',
        elementId: 'hero-title',
        text: 'Pekan Kreativitas & Perayaan Angkatan'
      }
    ]);
  });

  it('keeps visual comment replacements as replace_slide operations', () => {
    const patch = normalizePatchInput({
      id: 'proposal-hero',
      title: 'Pekan Kreasi',
      html: '<section class="pepetex-slide" data-pepetex-slide-id="proposal-hero"><div data-pepetex-id="hero-badge" data-pepetex-type="body">Proposal</div></section>',
      css: '.badge { background: #ef4444; }'
    });

    const constrained = constrainApplyCommentsPatch(patch, [
      {
        slideId: 'proposal-hero',
        elementIds: ['hero-badge'],
        text: 'Change the color to red'
      }
    ]);

    expect(constrained.operations[0]).toMatchObject({
      op: 'replace_slide',
      slideId: 'proposal-hero'
    });
  });

  it('keeps mixed visual and copy comments as replace_slide operations', () => {
    const patch = normalizePatchInput({
      id: 'proposal-vision-mission',
      title: 'Visi & Misi Kegiatan Sekolah',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="proposal-vision-mission">
          <h2 data-pepetex-id="vm-title" data-pepetex-type="headline">Visi &amp; Misi Kegiatan Sekolah</h2>
          <div class="vision-box" data-pepetex-id="vision-group" data-pepetex-type="group">Visi</div>
        </section>
      `,
      css: '.vision-box { background: #ef4444; }'
    });

    const constrained = constrainApplyCommentsPatch(patch, [
      {
        slideId: 'proposal-vision-mission',
        elementIds: ['vision-group'],
        text: 'Change the color to red'
      },
      {
        slideId: 'proposal-vision-mission',
        elementIds: ['vm-title'],
        text: 'Change the text to Visi & Misi Kegiatan Sekolah'
      }
    ]);

    expect(constrained.operations[0]).toMatchObject({
      op: 'replace_slide',
      slideId: 'proposal-vision-mission',
      slide: {
        css: '.vision-box { background: #ef4444; }'
      }
    });
  });

  it('converts multiple copy-comment slide replacements into multiple update_text operations', () => {
    const patch = normalizePatchInput({
      id: 'proposal-hero',
      title: 'Pekan Kreativitas & Perayaan Angkatan',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="proposal-hero">
          <h1 data-pepetex-id="hero-title" data-pepetex-type="headline">Pekan Kreativitas &amp; Perayaan Angkatan</h1>
          <span data-pepetex-id="hero-year" data-pepetex-type="body">Tahun Ajaran 2025/2026</span>
        </section>
      `,
      css: '.pepetex-slide { width: 1920px; height: 1080px; }'
    });

    const constrained = constrainApplyCommentsPatch(patch, [
      {
        slideId: 'proposal-hero',
        elementIds: ['hero-title'],
        text: 'Change the title to Pekan Kreativitas & Perayaan Angkatan'
      },
      {
        slideId: 'proposal-hero',
        elementIds: ['hero-year'],
        text: 'Change the text to Tahun Ajaran 2025/2026'
      }
    ]);

    expect(constrained.operations).toEqual([
      {
        op: 'update_text',
        slideId: 'proposal-hero',
        elementId: 'hero-title',
        text: 'Pekan Kreativitas & Perayaan Angkatan'
      },
      {
        op: 'update_text',
        slideId: 'proposal-hero',
        elementId: 'hero-year',
        text: 'Tahun Ajaran 2025/2026'
      }
    ]);
  });

  it('converts Indonesian targeted copy-comment slide replacements into update_text operations', () => {
    const patch = normalizePatchInput({
      id: 'proposal-hero',
      title: 'Pekan Kreativitas & Perayaan Angkatan',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="proposal-hero">
          <span data-pepetex-id="hero-year" data-pepetex-type="body">Tahun Ajaran 2025/2026</span>
        </section>
      `,
      css: '.pepetex-slide { width: 1920px; height: 1080px; }'
    });

    const constrained = constrainApplyCommentsPatch(patch, [
      {
        slideId: 'proposal-hero',
        elementIds: ['hero-year'],
        text: 'Ubah tahun ajarannya menjadi tahun ajaran 2025/2026'
      }
    ]);

    expect(constrained.operations).toEqual([
      {
        op: 'update_text',
        slideId: 'proposal-hero',
        elementId: 'hero-year',
        text: 'Tahun Ajaran 2025/2026'
      }
    ]);
  });
});
