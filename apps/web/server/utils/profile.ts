import { createError } from 'h3';

import { prisma } from '@pepetex/db';

export interface UpdateProfileInput {
  name?: string;
  avatarUrl?: string | null;
  uiLanguage?: 'en' | 'id';
  themePreference?: 'light' | 'dark' | 'system';
  defaultWorkspaceId?: string | null;
}

const allowedUiLanguages = new Set<NonNullable<UpdateProfileInput['uiLanguage']>>(['en', 'id']);
const allowedThemePreferences = new Set<NonNullable<UpdateProfileInput['themePreference']>>([
  'light',
  'dark',
  'system'
]);

export function assertUpdateProfileInput(input: unknown): UpdateProfileInput {
  const candidate = input as Partial<UpdateProfileInput> | null;

  if (!candidate || typeof candidate !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Profile changes are required.'
    });
  }

  const output: UpdateProfileInput = {};

  if ('name' in candidate) {
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Name must be a non-empty string.'
      });
    }

    output.name = candidate.name.trim();
  }

  if ('avatarUrl' in candidate) {
    if (
      candidate.avatarUrl !== null &&
      typeof candidate.avatarUrl !== 'string'
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Avatar URL must be a string or null.'
      });
    }

    output.avatarUrl = candidate.avatarUrl === null ? null : candidate.avatarUrl.trim();
  }

  if ('uiLanguage' in candidate) {
    if (!allowedUiLanguages.has(candidate.uiLanguage as 'en' | 'id')) {
      throw createError({
        statusCode: 400,
        statusMessage: 'UI language must be `en` or `id`.'
      });
    }

    output.uiLanguage = candidate.uiLanguage;
  }

  if ('themePreference' in candidate) {
    if (
      !allowedThemePreferences.has(
        candidate.themePreference as 'light' | 'dark' | 'system'
      )
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Theme preference must be `light`, `dark`, or `system`.'
      });
    }

    output.themePreference = candidate.themePreference;
  }

  if ('defaultWorkspaceId' in candidate) {
    if (
      candidate.defaultWorkspaceId !== null &&
      typeof candidate.defaultWorkspaceId !== 'string'
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Default workspace must be a string or null.'
      });
    }

    output.defaultWorkspaceId =
      candidate.defaultWorkspaceId === null
        ? null
        : candidate.defaultWorkspaceId.trim();
  }

  if (Object.keys(output).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one profile field must be provided.'
    });
  }

  return output;
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<{
  name: string;
  avatarUrl: string | null;
  uiLanguage: string;
  themePreference: string;
  defaultWorkspaceId: string | null;
}> {
  if (input.defaultWorkspaceId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId: input.defaultWorkspaceId
      }
    });

    if (!membership) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Default workspace must belong to the current user.'
      });
    }
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: input,
    create: {
      userId,
      name: input.name ?? 'PepeteX User',
      avatarUrl: input.avatarUrl ?? null,
      uiLanguage: input.uiLanguage ?? 'en',
      themePreference: input.themePreference ?? 'system',
      defaultWorkspaceId: input.defaultWorkspaceId ?? null
    }
  });

  return {
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    uiLanguage: profile.uiLanguage,
    themePreference: profile.themePreference,
    defaultWorkspaceId: profile.defaultWorkspaceId
  };
}
