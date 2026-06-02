import { createError } from 'h3';

import { prisma, type TweakScope, type TweakBatchStatus } from '@pepetex/db';
import { canEditDeck, type WorkspaceRole } from '@pepetex/rbac';

import { getWorkspaceForUser } from './workspaces';

export const TWEAK_CATEGORIES = [
  'color_scheme',
  'spacing_scale',
  'headline_tone',
  'visual_density',
  'border_radius',
  'shadow_intensity',
  'background_style',
  'image_style',
  'chart_style',
  'typography_mood',
  'formality',
  'brand_strictness',
  'content_density'
] as const;

export type TweakCategory = (typeof TWEAK_CATEGORIES)[number];

export interface TweakItemInput {
  scope: TweakScope;
  slideId?: string | null;
  elementId?: string | null;
  category: string;
  value: unknown;
}

export interface TweakItemDetail {
  id: string;
  scope: TweakScope;
  slideId: string | null;
  elementId: string | null;
  category: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TweakBatchDetail {
  id: string;
  deckId: string;
  status: TweakBatchStatus;
  submittedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  items: TweakItemDetail[];
}

async function getDeckEditorRole(
  deckId: string,
  userId: string
): Promise<{ workspaceId: string; role: WorkspaceRole }> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { workspaceId: true }
  });

  if (!deck) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });
  }

  const workspace = await getWorkspaceForUser(deck.workspaceId, userId);

  return { workspaceId: deck.workspaceId, role: workspace.currentUserRole as WorkspaceRole };
}

function formatBatch(
  batch: {
    id: string;
    deckId: string;
    status: TweakBatchStatus;
    submittedAt: Date | null;
    appliedAt: Date | null;
    createdAt: Date;
    items: Array<{
      id: string;
      scope: TweakScope;
      slideId: string | null;
      elementId: string | null;
      category: string;
      value: unknown;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }
): TweakBatchDetail {
  return {
    id: batch.id,
    deckId: batch.deckId,
    status: batch.status,
    submittedAt: batch.submittedAt?.toISOString() ?? null,
    appliedAt: batch.appliedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    items: batch.items.map((item) => ({
      id: item.id,
      scope: item.scope,
      slideId: item.slideId,
      elementId: item.elementId,
      category: item.category,
      value: item.value,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }))
  };
}

const batchWithItemsSelect = {
  id: true,
  deckId: true,
  status: true,
  submittedAt: true,
  appliedAt: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      scope: true,
      slideId: true,
      elementId: true,
      category: true,
      value: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: { createdAt: 'asc' as const }
  }
} as const;

export async function getPendingTweakBatch(
  deckId: string,
  userId: string
): Promise<TweakBatchDetail | null> {
  await getDeckEditorRole(deckId, userId);

  const batch = await prisma.tweakBatch.findFirst({
    where: { deckId, status: 'PENDING' },
    select: batchWithItemsSelect,
    orderBy: { createdAt: 'desc' }
  });

  return batch ? formatBatch(batch) : null;
}

export async function upsertTweakItem(
  deckId: string,
  userId: string,
  input: TweakItemInput
): Promise<TweakBatchDetail> {
  const { role } = await getDeckEditorRole(deckId, userId);

  if (!canEditDeck(role)) {
    throw createError({ statusCode: 403, statusMessage: 'You need editor or higher role to add tweaks.' });
  }

  if (!TWEAK_CATEGORIES.includes(input.category as TweakCategory)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid tweak category: ${input.category}` });
  }

  let batch = await prisma.tweakBatch.findFirst({
    where: { deckId, status: 'PENDING' },
    select: { id: true }
  });

  if (!batch) {
    batch = await prisma.tweakBatch.create({
      data: { deckId },
      select: { id: true }
    });
  }

  const existing = await prisma.tweakItem.findFirst({
    where: {
      batchId: batch.id,
      scope: input.scope,
      slideId: input.slideId ?? null,
      elementId: input.elementId ?? null,
      category: input.category
    },
    select: { id: true }
  });

  if (existing) {
    await prisma.tweakItem.update({
      where: { id: existing.id },
      data: { value: input.value as object }
    });
  } else {
    await prisma.tweakItem.create({
      data: {
        batchId: batch.id,
        scope: input.scope,
        slideId: input.slideId ?? null,
        elementId: input.elementId ?? null,
        category: input.category,
        value: input.value as object
      }
    });
  }

  const updated = await prisma.tweakBatch.findUniqueOrThrow({
    where: { id: batch.id },
    select: batchWithItemsSelect
  });

  return formatBatch(updated);
}

export async function updateTweakItem(
  deckId: string,
  tweakItemId: string,
  userId: string,
  value: unknown
): Promise<TweakItemDetail> {
  const { role } = await getDeckEditorRole(deckId, userId);

  if (!canEditDeck(role)) {
    throw createError({ statusCode: 403, statusMessage: 'You need editor or higher role to update tweaks.' });
  }

  const item = await prisma.tweakItem.findUnique({
    where: { id: tweakItemId },
    select: {
      id: true, scope: true, slideId: true, elementId: true, category: true, value: true,
      createdAt: true, updatedAt: true,
      batch: { select: { deckId: true, status: true } }
    }
  });

  if (!item || item.batch.deckId !== deckId) {
    throw createError({ statusCode: 404, statusMessage: 'Tweak item not found.' });
  }

  if (item.batch.status !== 'PENDING') {
    throw createError({ statusCode: 409, statusMessage: 'Only items in a PENDING batch can be updated.' });
  }

  const updated = await prisma.tweakItem.update({
    where: { id: tweakItemId },
    data: { value: value as object },
    select: {
      id: true, scope: true, slideId: true, elementId: true, category: true, value: true,
      createdAt: true, updatedAt: true
    }
  });

  return {
    id: updated.id,
    scope: updated.scope,
    slideId: updated.slideId,
    elementId: updated.elementId,
    category: updated.category,
    value: updated.value,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString()
  };
}

export async function deleteTweakItem(
  deckId: string,
  tweakItemId: string,
  userId: string
): Promise<void> {
  const { role } = await getDeckEditorRole(deckId, userId);

  if (!canEditDeck(role)) {
    throw createError({ statusCode: 403, statusMessage: 'You need editor or higher role to remove tweaks.' });
  }

  const item = await prisma.tweakItem.findUnique({
    where: { id: tweakItemId },
    select: { id: true, batch: { select: { deckId: true, status: true } } }
  });

  if (!item || item.batch.deckId !== deckId) {
    throw createError({ statusCode: 404, statusMessage: 'Tweak item not found.' });
  }

  if (item.batch.status !== 'PENDING') {
    throw createError({ statusCode: 409, statusMessage: 'Only items in a PENDING batch can be deleted.' });
  }

  await prisma.tweakItem.delete({ where: { id: tweakItemId } });
}

export async function submitTweakBatch(
  deckId: string,
  userId: string
): Promise<{ batchId: string; batch: TweakBatchDetail }> {
  const { role } = await getDeckEditorRole(deckId, userId);

  if (!canEditDeck(role)) {
    throw createError({ statusCode: 403, statusMessage: 'You need editor or higher role to submit tweaks.' });
  }

  const batch = await prisma.tweakBatch.findFirst({
    where: { deckId, status: 'PENDING' },
    select: { id: true, items: { select: { id: true } } }
  });

  if (!batch) {
    throw createError({ statusCode: 404, statusMessage: 'No pending tweak batch found for this deck.' });
  }

  if (batch.items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Tweak batch has no items to submit.' });
  }

  const updated = await prisma.tweakBatch.update({
    where: { id: batch.id },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
    select: batchWithItemsSelect
  });

  return { batchId: batch.id, batch: formatBatch(updated) };
}
