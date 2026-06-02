import { randomUUID } from 'node:crypto';

import { createError } from 'h3';
import { JSDOM } from 'jsdom';

import {
  validateGeneratedDeck,
  type GeneratedDeck,
  type GeneratedDeckFont,
  type GeneratedSlide
} from '@pepetex/ai';
import {
  DeckRevisionSource,
  prisma,
  type Prisma,
  type WorkspaceType
} from '@pepetex/db';
import { canEditDeck, type WorkspaceRole } from '@pepetex/rbac';

import { getWorkspaceForUser, type WorkspaceSummary } from './workspaces';

const MAX_DECK_TITLE_LENGTH = 160;
const MAX_MANUAL_TEXT_LENGTH = 1_200;
const STARTER_DECK_CANVAS = {
  width: 1920,
  height: 1080
} as const;
const editableElementTypes = new Set(['headline', 'body', 'cta']);

export interface DeckInput {
  title: string;
}

export interface DeckWorkspaceOperationInput {
  targetWorkspaceId: string;
}

export interface DeckSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: 'PERSONAL' | 'SHARED';
  title: string;
  referenceFileCount: number;
  currentUserRole: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

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

export interface DeckRevisionSummary {
  id: string;
  revisionNumber: number;
  label: string;
  source: DeckRevisionSource;
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

export interface DeckDetail extends DeckSummary {
  language: string;
  aspectRatio: '16:9';
  canvas: {
    width: 1920;
    height: 1080;
  };
  fonts?: GeneratedDeckFont[];
  currentRevisionNumber: number;
  slides: DeckSlideDetail[];
  revisions: DeckRevisionSummary[];
}

export interface ReorderDeckSlideInput {
  slideId: string;
  toIndex: number;
}

export interface ManualTextEditInput {
  elementId: string;
  text: string;
}

interface DeckAccessRecord {
  id: string;
  title: string;
  contentJson: Prisma.JsonValue | null;
  currentRevisionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  _count: {
    referenceFiles: number;
  };
  workspace: {
    id: string;
    name: string;
    type: WorkspaceType;
    members: Array<{
      role: WorkspaceRole;
    }>;
  };
}

interface DeckDetailRecord extends DeckAccessRecord {
  revisions: Array<{
    id: string;
    revisionNumber: number;
    label: string;
    source: DeckRevisionSource;
    summary: string | null;
    deckJson: Prisma.JsonValue;
    createdAt: Date;
    createdByUser: {
      id: string;
      email: string;
      profile: {
        name: string;
      } | null;
    };
    restoredFromRevision: {
      revisionNumber: number;
    } | null;
  }>;
}

interface PersistRevisionOptions {
  source: DeckRevisionSource;
  label: string;
  summary?: string;
  restoredFromRevisionId?: string;
}

type PrismaDeckClient = Prisma.TransactionClient | typeof prisma;

function asJsonInput(value: GeneratedDeck): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function trimDeckTitle(value: string): string {
  return value.trim().slice(0, MAX_DECK_TITLE_LENGTH);
}

export function assertWorkspaceDeckInput(input: unknown): DeckInput {
  const candidate = input as Partial<DeckInput> | null;

  if (!candidate || typeof candidate !== 'object' || typeof candidate.title !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Deck title is required.'
    });
  }

  const title = candidate.title.trim();

  if (!title) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Deck title is required.'
    });
  }

  if (title.length > MAX_DECK_TITLE_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Deck title must be ${MAX_DECK_TITLE_LENGTH} characters or fewer.`
    });
  }

  return { title };
}

export function assertDeckWorkspaceOperationInput(input: unknown): DeckWorkspaceOperationInput {
  const candidate = input as Partial<DeckWorkspaceOperationInput> | null;

  if (!candidate || typeof candidate !== 'object' || typeof candidate.targetWorkspaceId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Target workspace id is required.'
    });
  }

  const targetWorkspaceId = candidate.targetWorkspaceId.trim();

  if (!targetWorkspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Target workspace id is required.'
    });
  }

  return { targetWorkspaceId };
}

export function assertManagedDeckId(input: string | undefined): string {
  const deckId = input?.trim();

  if (!deckId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Deck id is required.'
    });
  }

  return deckId;
}

export function assertManagedSlideId(input: string | undefined): string {
  const slideId = input?.trim();

  if (!slideId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Slide id is required.'
    });
  }

  return slideId;
}

export function assertManagedRevisionId(input: string | undefined): string {
  const revisionId = input?.trim();

  if (!revisionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Revision id is required.'
    });
  }

  return revisionId;
}

export function assertReorderDeckSlideInput(input: unknown): ReorderDeckSlideInput {
  const candidate = input as Partial<ReorderDeckSlideInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.slideId !== 'string' ||
    typeof candidate.toIndex !== 'number' ||
    !Number.isInteger(candidate.toIndex)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Slide id and target index are required.'
    });
  }

  return {
    slideId: assertManagedSlideId(candidate.slideId),
    toIndex: candidate.toIndex
  };
}

export function assertManualTextEditInput(input: unknown): ManualTextEditInput {
  const candidate = input as Partial<ManualTextEditInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.elementId !== 'string' ||
    typeof candidate.text !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Element id and text are required.'
    });
  }

  const elementId = candidate.elementId.trim();
  const text = candidate.text.trim();

  if (!elementId || !text) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Element id and text are required.'
    });
  }

  if (text.length > MAX_MANUAL_TEXT_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Manual text edits must be ${MAX_MANUAL_TEXT_LENGTH} characters or fewer.`
    });
  }

  return { elementId, text };
}

export async function listWorkspaceDecks(
  workspaceId: string,
  userId: string
): Promise<DeckSummary[]> {
  const workspace = await getWorkspaceForUser(workspaceId, userId);
  const decks = await prisma.deck.findMany({
    where: {
      workspaceId
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: deckInclude(userId)
  });

  return decks.map((deck) => mapDeckSummary(deck as unknown as DeckAccessRecord, workspace.currentUserRole));
}

export async function createDeck(
  workspaceId: string,
  userId: string,
  input: DeckInput
): Promise<DeckSummary> {
  const workspace = await getWorkspaceForUser(workspaceId, userId);
  assertCanEditDeck(workspace.currentUserRole);
  const emptyDeck = createEmptyDeck(input.title);

  const deck = await prisma.deck.create({
    data: {
      workspaceId,
      createdByUserId: userId,
      title: input.title,
      contentJson: asJsonInput(emptyDeck),
      currentRevisionNumber: 1,
      revisions: {
        create: {
          revisionNumber: 1,
          label: 'Initial empty deck',
          source: DeckRevisionSource.INITIAL,
          summary: 'Created an empty deck ready for chat-first generation.',
          deckJson: asJsonInput(emptyDeck),
          createdByUserId: userId
        }
      }
    },
    include: deckInclude(userId)
  });

  return mapDeckSummary(deck as unknown as DeckAccessRecord, workspace.currentUserRole);
}

export async function updateDeck(
  deckId: string,
  userId: string,
  input: DeckInput
): Promise<DeckSummary> {
  const deck = await findDeckAccessRecord(deckId, userId);
  const currentUserRole = getDeckRole(deck);
  assertCanEditDeck(currentUserRole);

  const currentContent = parseDeckContent(deck.contentJson);
  const nextContent = currentContent ? { ...currentContent, title: input.title } : null;

  const updatedDeck = await prisma.deck.update({
    where: {
      id: deckId
    },
    data: {
      title: input.title,
      ...(nextContent ? { contentJson: asJsonInput(nextContent) } : {})
    },
    include: deckInclude(userId)
  });

  return mapDeckSummary(updatedDeck as unknown as DeckAccessRecord, currentUserRole);
}

export async function deleteDeck(deckId: string, userId: string): Promise<void> {
  const deck = await findDeckAccessRecord(deckId, userId);
  assertCanEditDeck(getDeckRole(deck));

  await prisma.deck.delete({
    where: {
      id: deckId
    }
  });
}

export async function forkDeckToWorkspace(
  deckId: string,
  userId: string,
  input: DeckWorkspaceOperationInput
): Promise<DeckSummary> {
  return copyDeckIntoWorkspace(deckId, userId, input.targetWorkspaceId, 'Fork');
}

export async function copyDeckToWorkspace(
  deckId: string,
  userId: string,
  input: DeckWorkspaceOperationInput
): Promise<DeckSummary> {
  return copyDeckIntoWorkspace(deckId, userId, input.targetWorkspaceId, 'Copy');
}

export async function moveDeckToWorkspace(
  deckId: string,
  userId: string,
  input: DeckWorkspaceOperationInput
): Promise<DeckSummary> {
  const deck = await findDeckAccessRecord(deckId, userId);
  const sourceRole = getDeckRole(deck);
  assertCanEditDeck(sourceRole);
  const targetWorkspace = await getWorkspaceForUser(input.targetWorkspaceId, userId);
  assertCanEditDeck(targetWorkspace.currentUserRole);

  const updatedDeck = await prisma.deck.update({
    where: { id: deckId },
    data: { workspaceId: input.targetWorkspaceId },
    include: deckInclude(userId)
  });

  return mapDeckSummary(updatedDeck as unknown as DeckAccessRecord, targetWorkspace.currentUserRole);
}

async function copyDeckIntoWorkspace(
  deckId: string,
  userId: string,
  targetWorkspaceId: string,
  operationLabel: 'Copy' | 'Fork'
): Promise<DeckSummary> {
  let deck = await findDeckDetailRecord(deckId, userId);
  deck = await ensureDeckContentInitialized(deck, userId);
  const targetWorkspace = await getWorkspaceForUser(targetWorkspaceId, userId);
  assertCanEditDeck(targetWorkspace.currentUserRole);
  const content = requireDeckContent(deck);
  const titleSuffix = operationLabel === 'Fork' ? 'Fork' : 'Copy';
  const nextTitle = trimDeckTitle(`${deck.title} ${titleSuffix}`);

  const createdDeck = await prisma.deck.create({
    data: {
      workspaceId: targetWorkspaceId,
      createdByUserId: userId,
      title: nextTitle,
      contentJson: asJsonInput({ ...content, title: nextTitle }),
      currentRevisionNumber: 1,
      revisions: {
        create: {
          revisionNumber: 1,
          label: `${operationLabel}ed from ${deck.title}`,
          source: DeckRevisionSource.INITIAL,
          summary: `${operationLabel}ed from "${deck.title}". Reference files, comments, exports, and generation runs remain with the source deck.`,
          deckJson: asJsonInput({ ...content, title: nextTitle }),
          createdByUserId: userId
        }
      }
    },
    include: deckInclude(userId)
  });

  return mapDeckSummary(createdDeck as unknown as DeckAccessRecord, targetWorkspace.currentUserRole);
}

export async function getDeckDetail(deckId: string, userId: string): Promise<DeckDetail> {
  let deck = await findDeckDetailRecord(deckId, userId);
  deck = await ensureDeckContentInitialized(deck, userId);

  return mapDeckDetail(deck, getDeckRole(deck));
}

export async function duplicateDeckSlide(
  deckId: string,
  slideId: string,
  userId: string
): Promise<DeckDetail> {
  let deck = await findDeckDetailRecord(deckId, userId);
  const currentUserRole = getDeckRole(deck);
  assertCanEditDeck(currentUserRole);
  deck = await ensureDeckContentInitialized(deck, userId);

  const content = requireDeckContent(deck);
  const slideIndex = content.slides.findIndex((slide) => slide.id === slideId);

  if (slideIndex < 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Slide not found.'
    });
  }

  const targetSlide = content.slides[slideIndex];
  if (!targetSlide) {
    throw createError({ statusCode: 404, statusMessage: 'Slide not found.' });
  }

  const duplicate = cloneSlideWithFreshIds(targetSlide);
  const nextSlides = [...content.slides];
  nextSlides.splice(slideIndex + 1, 0, duplicate);

  return persistDeckRevision(
    deck,
    userId,
    {
      ...content,
      slides: nextSlides
    },
    {
      source: DeckRevisionSource.SLIDE_DUPLICATED,
      label: `Duplicated ${targetSlide.title}`,
      summary: `Inserted a duplicate of "${targetSlide.title}" after slide ${slideIndex + 1}.`
    }
  );
}

export async function reorderDeckSlide(
  deckId: string,
  userId: string,
  input: ReorderDeckSlideInput
): Promise<DeckDetail> {
  let deck = await findDeckDetailRecord(deckId, userId);
  const currentUserRole = getDeckRole(deck);
  assertCanEditDeck(currentUserRole);
  deck = await ensureDeckContentInitialized(deck, userId);

  const content = requireDeckContent(deck);
  const slideIndex = content.slides.findIndex((slide) => slide.id === input.slideId);

  if (slideIndex < 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Slide not found.'
    });
  }

  if (input.toIndex < 0 || input.toIndex >= content.slides.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Target slide index is out of range.'
    });
  }

  if (slideIndex === input.toIndex) {
    return mapDeckDetail(deck, currentUserRole);
  }

  const nextSlides = [...content.slides];
  const [movedSlide] = nextSlides.splice(slideIndex, 1);
  if (!movedSlide) {
    throw createError({ statusCode: 404, statusMessage: 'Slide not found.' });
  }
  nextSlides.splice(input.toIndex, 0, movedSlide);

  return persistDeckRevision(
    deck,
    userId,
    {
      ...content,
      slides: nextSlides
    },
    {
      source: DeckRevisionSource.SLIDE_REORDERED,
      label: `Reordered ${movedSlide?.title ?? 'slide'}`,
      summary: `Moved "${movedSlide?.title ?? 'slide'}" to position ${input.toIndex + 1}.`
    }
  );
}

export async function deleteDeckSlide(
  deckId: string,
  slideId: string,
  userId: string
): Promise<DeckDetail> {
  let deck = await findDeckDetailRecord(deckId, userId);
  const currentUserRole = getDeckRole(deck);
  assertCanEditDeck(currentUserRole);
  deck = await ensureDeckContentInitialized(deck, userId);

  const content = requireDeckContent(deck);
  const slideIndex = content.slides.findIndex((slide) => slide.id === slideId);

  if (slideIndex < 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Slide not found.'
    });
  }

  if (content.slides.length <= 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A deck must keep at least one slide.'
    });
  }

  const deletedSlide = content.slides[slideIndex];
  if (!deletedSlide) {
    throw createError({ statusCode: 404, statusMessage: 'Slide not found.' });
  }
  const nextSlides = content.slides.filter((slide) => slide.id !== slideId);

  return persistDeckRevision(
    deck,
    userId,
    {
      ...content,
      slides: nextSlides
    },
    {
      source: DeckRevisionSource.SLIDE_DELETED,
      label: `Deleted ${deletedSlide?.title ?? 'slide'}`,
      summary: `Removed "${deletedSlide?.title ?? 'slide'}" from the deck.`
    }
  );
}

export async function updateDeckSlideText(
  deckId: string,
  slideId: string,
  userId: string,
  input: ManualTextEditInput
): Promise<DeckDetail> {
  let deck = await findDeckDetailRecord(deckId, userId);
  const currentUserRole = getDeckRole(deck);
  assertCanEditDeck(currentUserRole);
  deck = await ensureDeckContentInitialized(deck, userId);

  const content = requireDeckContent(deck);
  const slideIndex = content.slides.findIndex((slide) => slide.id === slideId);

  if (slideIndex < 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Slide not found.'
    });
  }

  const targetSlide = content.slides[slideIndex];
  if (!targetSlide) {
    throw createError({ statusCode: 404, statusMessage: 'Slide not found.' });
  }

  const updatedSlide = applySlideTextEdit(targetSlide, input);
  const nextSlides = [...content.slides];
  nextSlides.splice(slideIndex, 1, updatedSlide);

  return persistDeckRevision(
    deck,
    userId,
    {
      ...content,
      slides: nextSlides
    },
    {
      source: DeckRevisionSource.MANUAL_TEXT_EDIT,
      label: `Edited ${updatedSlide.title}`,
      summary: `Updated "${input.elementId}" on "${updatedSlide.title}".`
    }
  );
}

export async function restoreDeckRevision(
  deckId: string,
  revisionId: string,
  userId: string
): Promise<DeckDetail> {
  let deck = await findDeckDetailRecord(deckId, userId);
  const currentUserRole = getDeckRole(deck);
  assertCanEditDeck(currentUserRole);
  deck = await ensureDeckContentInitialized(deck, userId);

  const revision = deck.revisions.find((entry) => entry.id === revisionId);

  if (!revision) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Revision not found.'
    });
  }

  const restoredDeck = parseDeckContent(revision.deckJson);

  if (!restoredDeck) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Saved deck revision is invalid.'
    });
  }

  return persistDeckRevision(
    deck,
    userId,
    restoredDeck,
    {
      source: DeckRevisionSource.REVISION_RESTORED,
      label: `Restored revision #${revision.revisionNumber}`,
      summary: `Restored the deck to revision #${revision.revisionNumber}.`,
      restoredFromRevisionId: revision.id
    }
  );
}

async function findDeckAccessRecord(deckId: string, userId: string): Promise<DeckAccessRecord> {
  return findDeckAccessRecordWithClient(prisma, deckId, userId);
}

async function findDeckDetailRecord(deckId: string, userId: string): Promise<DeckDetailRecord> {
  return findDeckDetailRecordWithClient(prisma, deckId, userId);
}

async function ensureDeckContentInitialized(
  deck: DeckDetailRecord,
  actorUserId: string
): Promise<DeckDetailRecord> {
  const existingContent = parseDeckContent(deck.contentJson);

  if (existingContent && deck.currentRevisionNumber > 0) {
    return deck;
  }

  const emptyDeck = createEmptyDeck(deck.title);
  const revisionAuthorId = deck.createdByUserId || actorUserId;

  return prisma.$transaction(async (tx) => {
    await tx.deck.update({
      where: {
        id: deck.id
      },
      data: {
        contentJson: asJsonInput(emptyDeck),
        currentRevisionNumber: 1
      }
    });

    await tx.deckRevision.create({
      data: {
        deckId: deck.id,
        revisionNumber: 1,
        label: 'Initial empty deck',
        source: DeckRevisionSource.INITIAL,
        summary: 'Backfilled an empty deck state for chat-first generation.',
        deckJson: asJsonInput(emptyDeck),
        createdByUserId: revisionAuthorId
      }
    });

    return findDeckDetailRecordWithClient(tx, deck.id, actorUserId);
  });
}

async function persistDeckRevision(
  deck: DeckDetailRecord,
  userId: string,
  nextDeck: GeneratedDeck,
  options: PersistRevisionOptions
): Promise<DeckDetail> {
  const currentUserRole = getDeckRole(deck);
  const detailRecord = await prisma.$transaction(async (tx) => {
    const currentDeck = await findDeckDetailRecordWithClient(tx, deck.id, userId);
    const nextRevisionNumber = Math.max(currentDeck.currentRevisionNumber, 0) + 1;

    await tx.deck.update({
      where: {
        id: deck.id
      },
      data: {
        title: nextDeck.title,
        contentJson: asJsonInput(nextDeck),
        currentRevisionNumber: nextRevisionNumber
      }
    });

    await tx.deckRevision.create({
      data: {
        deckId: deck.id,
        revisionNumber: nextRevisionNumber,
        label: options.label,
        source: options.source,
        summary: options.summary,
        deckJson: asJsonInput(nextDeck),
        createdByUserId: userId,
        restoredFromRevisionId: options.restoredFromRevisionId
      }
    });

    return findDeckDetailRecordWithClient(tx, deck.id, userId);
  });

  return mapDeckDetail(detailRecord, currentUserRole);
}

async function findDeckAccessRecordWithClient(
  client: PrismaDeckClient,
  deckId: string,
  userId: string
): Promise<DeckAccessRecord> {
  const deck = await client.deck.findFirst({
    where: {
      id: deckId,
      workspace: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    include: deckInclude(userId)
  });

  if (!deck) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deck not found.'
    });
  }

  return deck as unknown as DeckAccessRecord;
}

async function findDeckDetailRecordWithClient(
  client: PrismaDeckClient,
  deckId: string,
  userId: string
): Promise<DeckDetailRecord> {
  const deck = await client.deck.findFirst({
    where: {
      id: deckId,
      workspace: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    include: deckDetailInclude(userId)
  });

  if (!deck) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deck not found.'
    });
  }

  return deck as unknown as DeckDetailRecord;
}

export function assertCanEditDeck(role: WorkspaceRole): void {
  if (!canEditDeck(role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace editor access is required.'
    });
  }
}

function getDeckRole(deck: DeckAccessRecord): WorkspaceRole {
  const currentUserRole = deck.workspace.members[0]?.role;

  if (!currentUserRole) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Workspace membership is missing for the current user.'
    });
  }

  return currentUserRole;
}

function mapDeckSummary(
  deck: DeckAccessRecord,
  currentUserRole: WorkspaceSummary['currentUserRole']
): DeckSummary {
  return {
    id: deck.id,
    workspaceId: deck.workspace.id,
    workspaceName: deck.workspace.name,
    workspaceType: deck.workspace.type,
    title: deck.title,
    referenceFileCount: deck._count.referenceFiles,
    currentUserRole,
    createdAt: deck.createdAt.toISOString(),
    updatedAt: deck.updatedAt.toISOString()
  };
}

function mapDeckDetail(deck: DeckDetailRecord, currentUserRole: WorkspaceRole): DeckDetail {
  const content = requireDeckContent(deck);

  return {
    ...mapDeckSummary(deck, currentUserRole),
    language: content.language,
    aspectRatio: content.aspectRatio,
    canvas: content.canvas,
    ...(content.fonts ? { fonts: content.fonts } : {}),
    currentRevisionNumber: deck.currentRevisionNumber,
    slides: content.slides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      html: slide.html,
      css: slide.css,
      editableFields: extractEditableFields(slide)
    })),
    revisions: deck.revisions.map((revision) => {
      const revisionDeck = parseDeckContent(revision.deckJson);

      return {
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        label: revision.label,
        source: revision.source,
        summary: revision.summary,
        slideCount: revisionDeck?.slides.length ?? 0,
        createdAt: revision.createdAt.toISOString(),
        createdBy: {
          id: revision.createdByUser.id,
          email: revision.createdByUser.email,
          name: revision.createdByUser.profile?.name ?? null
        },
        restoredFromRevisionNumber: revision.restoredFromRevision?.revisionNumber ?? null
      };
    })
  };
}

function requireDeckContent(deck: Pick<DeckDetailRecord, 'contentJson'>): GeneratedDeck {
  const content = parseDeckContent(deck.contentJson);

  if (!content) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Deck content is missing.'
    });
  }

  return content;
}

function parseDeckContent(input: Prisma.JsonValue | null): GeneratedDeck | null {
  if (!input) {
    return null;
  }

  const result = validateGeneratedDeck(input);

  if (!result.ok) {
    throw createError({
      statusCode: 500,
      statusMessage: `Saved deck content is invalid: ${result.errors.join('; ')}`
    });
  }

  return result.value;
}

function extractEditableFields(slide: GeneratedSlide): DeckEditableTextField[] {
  const dom = new JSDOM(`<!doctype html><body>${slide.html}</body>`);
  const document = dom.window.document;
  const nodes = Array.from(document.querySelectorAll('[data-pepetex-id][data-pepetex-type]'));

  return nodes
    .map((element) => {
      const elementId = element.getAttribute('data-pepetex-id');
      const elementType = element.getAttribute('data-pepetex-type');
      const text = element.textContent?.trim() ?? '';
      const hasNestedEditableChild = element.querySelector('[data-pepetex-id]') !== null;

      if (
        !elementId ||
        !elementType ||
        !editableElementTypes.has(elementType) ||
        !text ||
        hasNestedEditableChild
      ) {
        return null;
      }

      return {
        elementId,
        elementType: elementType as DeckEditableTextField['elementType'],
        label: humanizeEditableFieldLabel(slide.id, elementId),
        text
      };
    })
    .filter((field): field is DeckEditableTextField => field !== null);
}

function applySlideTextEdit(slide: GeneratedSlide, input: ManualTextEditInput): GeneratedSlide {
  const dom = new JSDOM(`<!doctype html><body>${slide.html}</body>`);
  const document = dom.window.document;
  const selector = `[data-pepetex-id="${escapeAttributeSelector(input.elementId)}"]`;
  const element = document.querySelector(selector);

  if (!(element instanceof dom.window.HTMLElement)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Editable text field not found on this slide.'
    });
  }

  const elementType = element.getAttribute('data-pepetex-type');
  if (!elementType || !editableElementTypes.has(elementType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This slide element does not support manual text editing.'
    });
  }

  element.textContent = input.text;

  return {
    ...slide,
    title: deriveSlideTitle(document, slide),
    html: document.body.innerHTML.trim()
  };
}

function deriveSlideTitle(document: Document, slide: GeneratedSlide): string {
  const headline = document.querySelector('[data-pepetex-type="headline"]');
  const title = headline?.textContent?.trim();

  return title || slide.title;
}

function cloneSlideWithFreshIds(slide: GeneratedSlide): GeneratedSlide {
  const nextSlideId = createSlideId();
  const dom = new JSDOM(`<!doctype html><body>${slide.html}</body>`);
  const document = dom.window.document;
  const root = document.body.firstElementChild;

  if (!root) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Slide HTML is missing a root element.'
    });
  }

  root.setAttribute('data-pepetex-slide-id', nextSlideId);
  const editableNodes = Array.from(document.querySelectorAll('[data-pepetex-id]'));

  for (const [index, node] of editableNodes.entries()) {
    const currentId = node.getAttribute('data-pepetex-id') ?? `field_${index + 1}`;
    const suffix = sanitizeElementIdSuffix(currentId, slide.id, index + 1);
    node.setAttribute('data-pepetex-id', `${nextSlideId}_${suffix}`);
  }

  return {
    ...slide,
    id: nextSlideId,
    title: `${slide.title} Copy`,
    html: document.body.innerHTML.trim()
  };
}

function sanitizeElementIdSuffix(
  currentElementId: string,
  currentSlideId: string,
  fallbackIndex: number
): string {
  const normalized = currentElementId.startsWith(`${currentSlideId}_`)
    ? currentElementId.slice(currentSlideId.length + 1)
    : currentElementId;
  const sanitized = normalized.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

  return sanitized || `field_${fallbackIndex}`;
}

function humanizeEditableFieldLabel(slideId: string, elementId: string): string {
  const withoutSlidePrefix = elementId.startsWith(`${slideId}_`)
    ? elementId.slice(slideId.length + 1)
    : elementId;

  return withoutSlidePrefix
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeAttributeSelector(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function createSlideId(): string {
  return `slide_${randomUUID().replaceAll('-', '')}`;
}

function createEmptyDeck(title: string): GeneratedDeck {
  return {
    title,
    language: 'en',
    aspectRatio: '16:9',
    canvas: STARTER_DECK_CANVAS,
    slides: []
  };
}

function deckInclude(userId: string): Prisma.DeckInclude {
  return {
    _count: {
      select: {
        referenceFiles: true
      }
    },
    workspace: {
      select: {
        id: true,
        name: true,
        type: true,
        members: {
          where: {
            userId
          },
          select: {
            role: true
          }
        }
      }
    }
  };
}

function deckDetailInclude(userId: string): Prisma.DeckInclude {
  return {
    ...deckInclude(userId),
    revisions: {
      orderBy: [{ revisionNumber: 'desc' }],
      select: {
        id: true,
        revisionNumber: true,
        label: true,
        source: true,
        summary: true,
        deckJson: true,
        createdAt: true,
        createdByUser: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                name: true
              }
            }
          }
        },
        restoredFromRevision: {
          select: {
            revisionNumber: true
          }
        }
      }
    }
  };
}
