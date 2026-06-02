import type { PreviewSlideDocument, PreviewSlideValidationState } from './slide-preview';

export type DeckWorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export interface DeckShellWorkspaceSummary {
  id: string;
  name: string;
  type: 'PERSONAL' | 'SHARED';
  currentUserRole: DeckWorkspaceRole;
}

export interface DeckShellDeckSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: 'PERSONAL' | 'SHARED';
  title: string;
  referenceFileCount: number;
  currentUserRole: DeckWorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export const deckEditorRoles: ReadonlySet<DeckWorkspaceRole> = new Set([
  'OWNER',
  'ADMIN',
  'EDITOR'
]);

export const deckShellPreviewValidation: PreviewSlideValidationState = {
  severity: 'ok',
  errors: [],
  warnings: []
};

export function canManageDecks(role: DeckWorkspaceRole | null | undefined): boolean {
  return role ? deckEditorRoles.has(role) : false;
}

export function buildDeckShellPreviewSlide(input: {
  deck: DeckShellDeckSummary | null;
  workspace: DeckShellWorkspaceSummary | null;
}): PreviewSlideDocument {
  if (!input.deck || !input.workspace) {
    return {
      id: 'deck_shell_empty',
      title: 'Deck workspace is ready',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="deck_shell_empty"
          data-pepetex-width="1920"
          data-pepetex-height="1080"
          style="width: 1920px; height: 1080px; position: relative; overflow: hidden; background: linear-gradient(140deg, #f8fafc 0%, #ecfeff 44%, #fff7ed 100%); color: #172554;"
        >
          <div data-pepetex-id="eyebrow" data-pepetex-type="headline" style="position: absolute; top: 92px; left: 110px; font-size: 26px; letter-spacing: 0.18em; text-transform: uppercase; color: #0f766e;">
            Phase 6 shell
          </div>
          <div data-pepetex-id="headline" data-pepetex-type="headline" style="position: absolute; top: 150px; left: 110px; width: 860px; font-size: 88px; font-weight: 700; line-height: 1.02;">
            Pick a workspace deck to anchor the generation UI.
          </div>
          <div data-pepetex-id="body" data-pepetex-type="body" style="position: absolute; top: 392px; left: 110px; width: 720px; font-size: 31px; line-height: 1.44; color: #334155;">
            The new deck rail now manages workspace-scoped deck CRUD. Generation controls, provider selection, and file upload attach to this shell next.
          </div>
          <div data-pepetex-id="status_card" data-pepetex-type="card" style="position: absolute; right: 120px; top: 170px; width: 520px; height: 294px; border-radius: 34px; background: rgba(15, 23, 42, 0.96); box-shadow: 0 26px 70px rgba(15, 23, 42, 0.18);">
            <div style="padding: 40px 42px;">
              <div data-pepetex-id="status_label" data-pepetex-type="body" style="font-size: 22px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(153, 246, 228, 0.86);">
                Current state
              </div>
              <div data-pepetex-id="status_value" data-pepetex-type="headline" style="margin-top: 22px; font-size: 82px; font-weight: 700; color: #f8fafc;">
                No deck
              </div>
              <div data-pepetex-id="status_body" data-pepetex-type="body" style="margin-top: 16px; font-size: 22px; line-height: 1.5; color: rgba(226, 232, 240, 0.92);">
                Create a deck in any editable workspace to drive the right-hand preview surface.
              </div>
            </div>
          </div>
          <div data-pepetex-id="pill" data-pepetex-type="cta" style="position: absolute; left: 110px; bottom: 124px; display: inline-flex; align-items: center; justify-content: center; padding: 18px 26px; border-radius: 999px; background: #082f49; color: #e0f2fe; font-size: 22px; font-weight: 600;">
            Deck list plus CRUD are live
          </div>
          <div data-pepetex-id="accent" data-pepetex-type="decorative" style="position: absolute; right: -70px; bottom: -82px; width: 420px; height: 420px; border-radius: 999px; background: radial-gradient(circle, rgba(251, 146, 60, 0.25) 0%, rgba(251, 146, 60, 0) 70%);">
          </div>
        </section>
      `.trim(),
      css: baseDeckShellCss('deck_shell_empty')
    };
  }

  const title = escapeHtml(input.deck.title);
  const workspaceName = escapeHtml(input.workspace.name);
  const deckMode = input.workspace.type === 'PERSONAL' ? 'Personal workspace' : 'Shared workspace';
  const updatedAt = escapeHtml(formatDateLabel(input.deck.updatedAt));
  const referenceFilesLabel = `${input.deck.referenceFileCount} reference ${input.deck.referenceFileCount === 1 ? 'file' : 'files'}`;

  return {
    id: `deck_shell_${input.deck.id}`,
    title: input.deck.title,
    html: `
      <section
        class="pepetex-slide"
        data-pepetex-slide-id="deck_shell_${escapeHtml(input.deck.id)}"
        data-pepetex-width="1920"
        data-pepetex-height="1080"
        style="width: 1920px; height: 1080px; position: relative; overflow: hidden; background: linear-gradient(140deg, #f8fafc 0%, #eff6ff 46%, #fff7ed 100%); color: #0f172a;"
      >
        <div data-pepetex-id="eyebrow" data-pepetex-type="headline" style="position: absolute; top: 92px; left: 110px; font-size: 24px; letter-spacing: 0.18em; text-transform: uppercase; color: #b45309;">
          ${escapeHtml(deckMode)}
        </div>
        <div data-pepetex-id="headline" data-pepetex-type="headline" style="position: absolute; top: 146px; left: 110px; width: 900px; font-size: 88px; font-weight: 700; line-height: 1.02;">
          ${title}
        </div>
        <div data-pepetex-id="body" data-pepetex-type="body" style="position: absolute; top: 382px; left: 110px; width: 720px; font-size: 31px; line-height: 1.42; color: #334155;">
          This deck now anchors the core shell. The left rail manages CRUD and workspace context, while generation controls and reference-file upload attach to this selected deck next.
        </div>
        <div data-pepetex-id="meta_workspace" data-pepetex-type="body" style="position: absolute; left: 110px; bottom: 194px; font-size: 24px; color: #475569;">
          Workspace: ${workspaceName}
        </div>
        <div data-pepetex-id="meta_updated" data-pepetex-type="body" style="position: absolute; left: 110px; bottom: 148px; font-size: 24px; color: #475569;">
          Updated: ${updatedAt}
        </div>
        <div data-pepetex-id="stat_card" data-pepetex-type="card" style="position: absolute; right: 120px; top: 158px; width: 520px; height: 312px; border-radius: 36px; background: rgba(15, 23, 42, 0.96); box-shadow: 0 26px 76px rgba(15, 23, 42, 0.2);">
          <div style="padding: 42px 44px;">
            <div data-pepetex-id="stat_label" data-pepetex-type="body" style="font-size: 22px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(191, 219, 254, 0.88);">
              Deck readiness
            </div>
            <div data-pepetex-id="stat_value" data-pepetex-type="headline" style="margin-top: 22px; font-size: 90px; font-weight: 700; color: #f8fafc;">
              ${escapeHtml(String(input.deck.referenceFileCount))}
            </div>
            <div data-pepetex-id="stat_body" data-pepetex-type="body" style="margin-top: 14px; font-size: 22px; line-height: 1.5; color: rgba(226, 232, 240, 0.92);">
              ${escapeHtml(referenceFilesLabel)} attached so far. Deck generation and upload controls can now bind to a concrete deck record.
            </div>
          </div>
        </div>
        <div data-pepetex-id="pill" data-pepetex-type="cta" style="position: absolute; left: 110px; bottom: 92px; display: inline-flex; align-items: center; justify-content: center; padding: 18px 26px; border-radius: 999px; background: #0f172a; color: #f8fafc; font-size: 22px; font-weight: 600;">
          Deck CRUD unlocked
        </div>
        <div data-pepetex-id="accent" data-pepetex-type="decorative" style="position: absolute; right: -78px; bottom: -92px; width: 420px; height: 420px; border-radius: 999px; background: radial-gradient(circle, rgba(14, 165, 233, 0.22) 0%, rgba(14, 165, 233, 0) 72%);">
        </div>
      </section>
    `.trim(),
    css: baseDeckShellCss(`deck_shell_${input.deck.id}`)
  };
}

function baseDeckShellCss(slideId: string): string {
  return `
    [data-pepetex-slide-id="${slideId}"] {
      font-family: "Trebuchet MS", "Avenir Next", Arial, sans-serif;
    }

    [data-pepetex-slide-id="${slideId}"] * {
      box-sizing: border-box;
    }
  `.trim();
}

function formatDateLabel(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
