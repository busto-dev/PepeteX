import { createServer, request as httpRequest } from 'node:http';

import { createApp, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  workspaceMember: {
    findFirst: vi.fn()
  },
  userProfile: {
    upsert: vi.fn()
  }
}));

vi.mock('@pepetex/db', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/db')>('@pepetex/db');

  return {
    ...actual,
    prisma: mockPrisma
  };
});

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

import profilePatchHandler from './me/profile.patch';

describe('PATCH /api/me/profile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires an authenticated session', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/me/profile', profilePatchHandler, {
      method: 'PATCH',
      body: {
        name: 'Updated User'
      }
    });

    expect(response.status).toBe(401);
    expect(response.json.statusMessage).toBe('Authentication required.');
  });

  it('updates the current user profile', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_1',
      user: {
        id: 'user_1',
        email: 'user@example.com',
        globalRole: 'USER',
        profile: null
      }
    });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      id: 'membership_1'
    });
    mockPrisma.userProfile.upsert.mockResolvedValue({
      name: 'Updated User',
      avatarUrl: 'https://assets.pepetex.test/avatar.png',
      uiLanguage: 'id',
      themePreference: 'dark',
      defaultWorkspaceId: 'workspace_1'
    });

    const response = await request('/api/me/profile', profilePatchHandler, {
      method: 'PATCH',
      body: {
        name: 'Updated User',
        avatarUrl: 'https://assets.pepetex.test/avatar.png',
        uiLanguage: 'id',
        themePreference: 'dark',
        defaultWorkspaceId: 'workspace_1'
      }
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        workspaceId: 'workspace_1'
      }
    });
    expect(mockPrisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      update: {
        name: 'Updated User',
        avatarUrl: 'https://assets.pepetex.test/avatar.png',
        uiLanguage: 'id',
        themePreference: 'dark',
        defaultWorkspaceId: 'workspace_1'
      },
      create: {
        userId: 'user_1',
        name: 'Updated User',
        avatarUrl: 'https://assets.pepetex.test/avatar.png',
        uiLanguage: 'id',
        themePreference: 'dark',
        defaultWorkspaceId: 'workspace_1'
      }
    });
    expect(response.json).toEqual({
      ok: true,
      profile: {
        name: 'Updated User',
        avatarUrl: 'https://assets.pepetex.test/avatar.png',
        uiLanguage: 'id',
        themePreference: 'dark',
        defaultWorkspaceId: 'workspace_1'
      }
    });
  });
});

async function request(
  path: string,
  handler: EventHandler,
  input: {
    method?: string;
    body?: unknown;
  } = {}
) {
  const app = createApp();
  app.use(path, handler as never);

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
          headers: payload ? { 'content-type': 'application/json' } : undefined
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body
            });
          });
        }
      );

      req.on('error', reject);

      if (payload) {
        req.write(payload);
      }

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
