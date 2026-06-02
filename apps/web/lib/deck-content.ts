import type { PreviewSlideDocument, PreviewSlideValidationState } from './slide-preview';

export interface DeckEditableTextField {
  elementId: string;
  elementType: 'headline' | 'body' | 'cta';
  label: string;
  text: string;
}

export interface DeckSlideDetail {
  id: string;
  title: string;
  html: string;
  css: string;
  editableFields: DeckEditableTextField[];
}

export interface DeckFontFace {
  id?: string;
  fontFamily: string;
  fontAliases?: string[];
  mimeType: string;
  dataUrl: string;
  fontWeight?: number | string | null;
  fontStyle?: string | null;
}

export interface DeckRevisionSummary {
  id: string;
  revisionNumber: number;
  label: string;
  source:
    | 'INITIAL'
    | 'MANUAL_TEXT_EDIT'
    | 'SLIDE_DUPLICATED'
    | 'SLIDE_REORDERED'
    | 'SLIDE_DELETED'
    | 'REVISION_RESTORED';
  summary: string | null;
  slideCount: number;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string | null;
  };
  restoredFromRevisionNumber: number | null;
}

export interface DeckDetail {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: 'PERSONAL' | 'SHARED';
  title: string;
  referenceFileCount: number;
  currentUserRole: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER';
  createdAt: string;
  updatedAt: string;
  language: string;
  aspectRatio: '16:9';
  canvas: {
    width: 1920;
    height: 1080;
  };
  fonts?: DeckFontFace[];
  currentRevisionNumber: number;
  slides: DeckSlideDetail[];
  revisions: DeckRevisionSummary[];
}

export const deckSlidePreviewValidation: PreviewSlideValidationState = {
  severity: 'ok',
  errors: [],
  warnings: []
};

export function buildDeckSlidePreview(
  slide: DeckSlideDetail | null,
  deckTitle: string | null
): PreviewSlideDocument {
  if (slide) {
    return {
      id: slide.id,
      title: slide.title,
      html: slide.html,
      css: slide.css
    };
  }

  return {
    id: 'deck_content_empty',
    title: deckTitle ?? 'Deck preview',
    html: `
      <section
        class="pepetex-slide"
        data-pepetex-slide-id="deck_content_empty"
        data-pepetex-width="1920"
        data-pepetex-height="1080"
        style="width: 1920px; height: 1080px; position: relative; overflow: hidden; background: linear-gradient(145deg, #f8fafc 0%, #ecfeff 52%, #fff7ed 100%); color: #0f172a;"
      >
        <div data-pepetex-id="deck_content_empty_eyebrow" data-pepetex-type="headline" style="position: absolute; top: 110px; left: 120px; font-size: 26px; letter-spacing: 0.18em; text-transform: uppercase; color: #0f766e;">
          Phase 6 deck content
        </div>
        <div data-pepetex-id="deck_content_empty_headline" data-pepetex-type="headline" style="position: absolute; top: 172px; left: 120px; width: 980px; font-size: 88px; font-weight: 700; line-height: 1.03;">
          Select a slide from the thumbnail strip.
        </div>
        <div data-pepetex-id="deck_content_empty_body" data-pepetex-type="body" style="position: absolute; top: 418px; left: 120px; width: 780px; font-size: 31px; line-height: 1.44; color: #475569;">
          Persisted slide snapshots and revision history now drive the preview surface, so manual edits and slide operations update something real.
        </div>
      </section>
    `.trim(),
    css: `
      [data-pepetex-slide-id="deck_content_empty"] {
        font-family: "Trebuchet MS", "Avenir Next", Arial, sans-serif;
      }

      [data-pepetex-slide-id="deck_content_empty"] * {
        box-sizing: border-box;
      }
    `.trim()
  };
}

export function getSlideSnippet(slide: DeckSlideDetail): string {
  const bodyField =
    slide.editableFields.find((field) => field.elementType === 'body') ??
    slide.editableFields[0];

  if (!bodyField) {
    return 'No editable text fields';
  }

  return bodyField.text.length > 96 ? `${bodyField.text.slice(0, 93)}...` : bodyField.text;
}

export function formatRevisionSource(source: DeckRevisionSummary['source']): string {
  switch (source) {
    case 'INITIAL':
      return 'Initial scaffold';
    case 'MANUAL_TEXT_EDIT':
      return 'Manual text edit';
    case 'SLIDE_DUPLICATED':
      return 'Slide duplicated';
    case 'SLIDE_REORDERED':
      return 'Slide reordered';
    case 'SLIDE_DELETED':
      return 'Slide deleted';
    case 'REVISION_RESTORED':
      return 'Revision restored';
  }
}
