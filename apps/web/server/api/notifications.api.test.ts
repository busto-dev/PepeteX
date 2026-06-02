import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

vi.mock('../utils/authorization', () => ({
  requireAuthenticatedSession: (session: { user?: unknown } | null) => {
    if (!session) {
      const err = Object.assign(new Error('Unauthenticated'), { statusCode: 401 });
      throw err;
    }
  }
}));

const mockListNotifications = vi.hoisted(() => vi.fn());
const mockMarkAllNotificationsRead = vi.hoisted(() => vi.fn());
const mockMarkNotificationRead = vi.hoisted(() => vi.fn());

vi.mock('../utils/notifications', () => ({
  listNotifications: mockListNotifications,
  markAllNotificationsRead: mockMarkAllNotificationsRead,
  markNotificationRead: mockMarkNotificationRead
}));

import notificationsGetHandler from './notifications.get';
import notificationsReadAllPostHandler from './notifications/read-all.post';
import notificationReadPatchHandler from './notifications/[notificationId]/read.patch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session_1',
    user: {
      id: 'user_1',
      email: 'user@example.com',
      globalRole: 'USER',
      profile: null,
      ...overrides
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/notifications', notificationsGetHandler);

    expect(response.status).toBe(401);
  });

  it('returns empty notifications list for authenticated user', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockListNotifications.mockResolvedValue([]);

    const response = await request('/api/notifications', notificationsGetHandler);

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ notifications: [] });
  });

  it('returns notifications for the current user', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockListNotifications.mockResolvedValue([
      {
        id: 'notif_1',
        userId: 'user_1',
        title: 'Generation complete',
        body: 'Your deck is ready.',
        isRead: false,
        createdAt: new Date('2026-04-27T10:00:00Z')
      }
    ]);

    const response = await request('/api/notifications', notificationsGetHandler);

    expect(response.status).toBe(200);
    expect(response.json.notifications).toHaveLength(1);
    expect(response.json.notifications[0].id).toBe('notif_1');
  });
});

describe('POST /api/notifications/read-all', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request(
      '/api/notifications/read-all',
      notificationsReadAllPostHandler,
      { method: 'POST' }
    );

    expect(response.status).toBe(401);
  });

  it('marks all notifications read for the current user', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockMarkAllNotificationsRead.mockResolvedValue({ count: 3 });

    const response = await request(
      '/api/notifications/read-all',
      notificationsReadAllPostHandler,
      { method: 'POST' }
    );

    expect(response.status).toBe(200);
    expect(mockMarkAllNotificationsRead).toHaveBeenCalledWith('user_1');
  });
});

describe('PATCH /api/notifications/:notificationId/read', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request(
      '/api/notifications/notif_1/read',
      notificationReadPatchHandler,
      { method: 'PATCH' },
      '/api/notifications/:notificationId/read'
    );

    expect(response.status).toBe(401);
  });

  it('marks a single notification read', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockMarkNotificationRead.mockResolvedValue({
      id: 'notif_1',
      userId: 'user_1',
      isRead: true
    });

    const response = await request(
      '/api/notifications/notif_1/read',
      notificationReadPatchHandler,
      { method: 'PATCH' },
      '/api/notifications/:notificationId/read'
    );

    expect(response.status).toBe(200);
    expect(mockMarkNotificationRead).toHaveBeenCalledWith('notif_1', 'user_1');
  });
});

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

async function request(
  path: string,
  handler: EventHandler,
  input: {
    method?: string;
    body?: unknown;
  } = {},
  routePath = path
) {
  const app = createApp();
  const router = createRouter();
  router.use(routePath, handler as never);
  app.use(router);

  const server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server.');
    }

    const payload = input.body ? JSON.stringify(input.body) : undefined;
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: input.method ?? 'GET',
          headers: payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload)
              }
            : undefined
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body });
          });
        }
      );

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    return {
      status: response.status,
      json: response.body ? JSON.parse(response.body) : null
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
