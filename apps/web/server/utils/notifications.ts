import { Prisma, prisma } from '@pepetex/db';

export interface NotificationSummary {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  metadata: unknown;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toNotificationSummary(n: {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationSummary {
  return {
    id: n.id,
    userId: n.userId,
    kind: n.kind,
    title: n.title,
    body: n.body,
    actionUrl: n.actionUrl,
    metadata: n.metadata,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString()
  };
}

export async function listNotifications(
  userId: string,
  options?: { limit?: number; unreadOnly?: boolean }
): Promise<NotificationSummary[]> {
  const limit = Math.min(options?.limit ?? 30, 100);
  const unreadOnly = options?.unreadOnly ?? false;

  const items = await prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { readAt: null } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  return items.map(toNotificationSummary);
}

export async function markNotificationRead(
  id: string,
  userId: string
): Promise<NotificationSummary> {
  // Ensure ownership
  const n = await prisma.notification.findFirst({ where: { id, userId } });
  if (!n) {
    const { createError } = await import('h3');
    throw createError({ statusCode: 404, statusMessage: 'Notification not found.' });
  }

  if (n.readAt) {
    return toNotificationSummary(n);
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() }
  });

  return toNotificationSummary(updated);
}

export async function markAllNotificationsRead(userId: string): Promise<{ updatedCount: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() }
  });
  return { updatedCount: result.count };
}

export async function createNotification(
  userId: string,
  kind: string,
  title: string,
  body?: string,
  actionUrl?: string,
  metadata?: Record<string, unknown>
): Promise<NotificationSummary> {
  const n = await prisma.notification.create({
    data: {
      userId,
      kind,
      title,
      body: body ?? null,
      actionUrl: actionUrl ?? null,
      metadata: metadata === undefined ? undefined : (metadata as Prisma.InputJsonValue)
    }
  });
  return toNotificationSummary(n);
}
