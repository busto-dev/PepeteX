import { describe, expect, it } from 'vitest';

import { buildDeckShellPreviewSlide, canManageDecks } from './deck-shell';

describe('deck shell helpers', () => {
  it('allows deck management only for owner/admin/editor roles', () => {
    expect(canManageDecks('OWNER')).toBe(true);
    expect(canManageDecks('ADMIN')).toBe(true);
    expect(canManageDecks('EDITOR')).toBe(true);
    expect(canManageDecks('COMMENTER')).toBe(false);
    expect(canManageDecks('VIEWER')).toBe(false);
    expect(canManageDecks(null)).toBe(false);
  });

  it('builds an empty-state preview when no deck is selected', () => {
    const slide = buildDeckShellPreviewSlide({
      deck: null,
      workspace: null
    });

    expect(slide.id).toBe('deck_shell_empty');
    expect(slide.title).toBe('Deck workspace is ready');
    expect(slide.html).toContain('Create a deck');
  });

  it('escapes deck and workspace labels in the preview slide html', () => {
    const slide = buildDeckShellPreviewSlide({
      workspace: {
        id: 'workspace_1',
        name: 'Growth <Workspace>',
        type: 'SHARED',
        currentUserRole: 'EDITOR'
      },
      deck: {
        id: 'deck_1',
        workspaceId: 'workspace_1',
        workspaceName: 'Growth <Workspace>',
        workspaceType: 'SHARED',
        title: 'Q2 <script>alert(1)</script>',
        referenceFileCount: 2,
        currentUserRole: 'EDITOR',
        createdAt: '2026-04-26T07:00:00.000Z',
        updatedAt: '2026-04-26T08:00:00.000Z'
      }
    });

    expect(slide.html).toContain('Q2 &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(slide.html).toContain('Growth &lt;Workspace&gt;');
    expect(slide.html).not.toContain('<script>alert(1)</script>');
  });
});
