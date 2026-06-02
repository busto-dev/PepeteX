import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  user: { count: vi.fn() },
  workspace: { count: vi.fn() },
  deck: { count: vi.fn() },
  generationRun: {
    count: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn()
  },
  auditLog: { findMany: vi.fn() }
}));

vi.mock('@pepetex/db', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/db')>('@pepetex/db');

  return {
    ...actual,
    prisma: mockPrisma
  };
});

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

vi.mock('../../utils/authorization', () => ({
  requireGlobalAdminSession: (session: { user?: { globalRole?: string } } | null) => {
    if (!session) {
      const err = Object.assign(new Error('Unauthenticated'), { statusCode: 401 });
      throw err;
    }

    if (session.user?.globalRole !== 'GLOBAL_ADMIN') {
      const err = Object.assign(new Error('Forbidden'), { statusCode: 403 });
      throw err;
    }
  }
}));

import dashboardGetHandler from './dashboard.get';
import usageGetHandler from './usage.get';
import jobsGetHandler from './jobs.get';
import auditLogsGetHandler from './audit-logs.get';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAdminSession() {
  return {
    sessionId: 'session_admin',
    user: {
      id: 'admin_1',
      email: 'admin@example.com',
      globalRole: 'GLOBAL_ADMIN',
      profile: null
    }
  };
}

function createUserSession() {
  return {
    sessionId: 'session_user',
    user: {
      id: 'user_1',
      email: 'user@example.com',
      globalRole: 'USER',
      profile: null
    }
  };
}

// ---------------------------------------------------------------------------
// Dashboard tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/dashboard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/admin/dashboard', dashboardGetHandler);

    expect(response.status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request('/api/admin/dashboard', dashboardGetHandler);

    expect(response.status).toBe(403);
  });

  it('returns dashboard stats for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockPrisma.user.count.mockResolvedValue(5);
    mockPrisma.workspace.count.mockResolvedValue(3);
    mockPrisma.deck.count.mockResolvedValue(12);
    mockPrisma.generationRun.count
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(10) // failed
      .mockResolvedValueOnce(2) // pending
      .mockResolvedValueOnce(1); // running

    const response = await request('/api/admin/dashboard', dashboardGetHandler);

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      userCount: 5,
      workspaceCount: 3,
      deckCount: 12,
      generationRunCount: 100,
      failedRunCount: 10,
      pendingRunCount: 2,
      activeRunCount: 1
    });
  });
});

// ---------------------------------------------------------------------------
// Usage tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/usage', () => {
  beforeEach(() => vi.resetAllMocks());

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/admin/usage', usageGetHandler);

    expect(response.status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request('/api/admin/usage', usageGetHandler);

    expect(response.status).toBe(403);
  });

  it('returns usage stats for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockPrisma.generationRun.count
      .mockResolvedValueOnce(50) // total
      .mockResolvedValueOnce(40) // completed
      .mockResolvedValueOnce(5) // failed
      .mockResolvedValueOnce(3) // pending
      .mockResolvedValueOnce(2); // running
    mockPrisma.generationRun.groupBy.mockResolvedValue([
      { kind: 'FULL_DECK', _count: { id: 30 } },
      { kind: 'SINGLE_SLIDE', _count: { id: 20 } }
    ]);

    const response = await request('/api/admin/usage', usageGetHandler);

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      totalRuns: 50,
      completedRuns: 40,
      failedRuns: 5,
      pendingRuns: 3,
      activeRuns: 2
    });
    expect(response.json.byKind).toEqual([
      { kind: 'FULL_DECK', count: 30 },
      { kind: 'SINGLE_SLIDE', count: 20 }
    ]);
  });
});

// ---------------------------------------------------------------------------
// Jobs tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/jobs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/admin/jobs', jobsGetHandler);

    expect(response.status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request('/api/admin/jobs', jobsGetHandler);

    expect(response.status).toBe(403);
  });

  it('returns paginated jobs for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockPrisma.generationRun.findMany.mockResolvedValue([
      {
        id: 'run_1',
        deckId: 'deck_1',
        workspaceId: 'workspace_1',
        kind: 'FULL_DECK',
        status: 'COMPLETED',
        textProviderId: null,
        imageProviderId: null,
        errorMessage: null,
        startedAt: new Date('2026-04-27T09:00:00Z'),
        completedAt: new Date('2026-04-27T09:01:00Z'),
        createdAt: new Date('2026-04-27T08:59:00Z')
      }
    ]);

    const response = await request('/api/admin/jobs', jobsGetHandler);

    expect(response.status).toBe(200);
    expect(response.json.runs).toHaveLength(1);
    expect(response.json.runs[0].id).toBe('run_1');
  });
});

// ---------------------------------------------------------------------------
// Audit logs tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-logs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/admin/audit-logs', auditLogsGetHandler);

    expect(response.status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request('/api/admin/audit-logs', auditLogsGetHandler);

    expect(response.status).toBe(403);
  });

  it('returns audit logs for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log_1',
        action: 'admin.user.create',
        actorUserId: 'admin_1',
        metadata: {},
        createdAt: new Date('2026-04-27T10:00:00Z')
      }
    ]);

    const response = await request('/api/admin/audit-logs', auditLogsGetHandler);

    expect(response.status).toBe(200);
    expect(response.json.logs).toHaveLength(1);
    expect(response.json.logs[0].action).toBe('admin.user.create');
    expect(response.json.hasMore).toBe(false);
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
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }); });
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
