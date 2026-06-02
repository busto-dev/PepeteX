import { createError, defineEventHandler, getRouterParam } from 'h3';

import { prisma, type Prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import {
  assertCanManageDesignSystemForUser,
  assertDesignSystemId
} from '../../../../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  const versionId = getRouterParam(event, 'versionId');

  if (!versionId) {
    throw createError({ statusCode: 400, statusMessage: 'versionId is required.' });
  }

  await assertCanManageDesignSystemForUser(
    designSystemId,
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );

  const restored = await prisma.$transaction(async (tx) => {
    const [designSystem, sourceVersion] = await Promise.all([
      tx.designSystem.findUnique({
        where: { id: designSystemId },
        select: { currentVersionNumber: true }
      }),
      tx.designSystemVersion.findFirst({
        where: { id: versionId, designSystemId },
        select: {
          id: true,
          versionNumber: true,
          label: true,
          summary: true,
          documentJson: true
        }
      })
    ]);

    if (!designSystem) {
      throw createError({ statusCode: 404, statusMessage: 'Design system not found.' });
    }

    if (!sourceVersion) {
      throw createError({ statusCode: 404, statusMessage: 'Design system version not found.' });
    }

    const nextVersionNumber = designSystem.currentVersionNumber + 1;

    return tx.designSystem.update({
      where: { id: designSystemId },
      data: {
        currentVersionNumber: nextVersionNumber,
        versions: {
          create: {
            versionNumber: nextVersionNumber,
            label: `Restored version ${sourceVersion.versionNumber}`,
            summary: sourceVersion.summary ?? `Restored from version ${sourceVersion.versionNumber}.`,
            documentJson: sourceVersion.documentJson as Prisma.InputJsonValue,
            createdByUserId: session.user.id
          }
        }
      },
      select: {
        id: true,
        currentVersionNumber: true
      }
    });
  });

  return {
    ok: true,
    designSystem: restored
  };
});
