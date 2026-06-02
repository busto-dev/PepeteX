import { createServer, request as httpRequest } from 'node:http';

import { createApp, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn()
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock('@pepetex/db', () => ({
  prisma: mockPrisma
}));

const authModule = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  createSessionToken: vi.fn(),
  hashSessionToken: vi.fn(),
  createSessionExpiry: vi.fn(),
  SESSION_COOKIE_NAME: 'pepetex_session'
}));

vi.mock('@pepetex/auth', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/auth')>('@pepetex/auth');

  return {
    ...actual,
    verifyPassword: authModule.verifyPassword,
    createSessionToken: authModule.createSessionToken,
    hashSessionToken: authModule.hashSessionToken,
    createSessionExpiry: authModule.createSessionExpiry,
    SESSION_COOKIE_NAME: authModule.SESSION_COOKIE_NAME
  };
});

import loginHandler from './login.post';
import logoutHandler from './logout.post';

describe('auth api routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authModule.createSessionToken.mockReturnValue('plain-session-token');
    authModule.hashSessionToken.mockImplementation((token: string) => `hashed:${token}`);
    authModule.createSessionExpiry.mockReturnValue(new Date('2026-06-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a user in and sets the session cookie', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'admin@example.com',
      globalRole: 'GLOBAL_ADMIN',
      passwordHash: 'stored-hash',
      profile: {
        name: 'PepeteX Admin',
        avatarUrl: null,
        uiLanguage: 'en',
        themePreference: 'system',
        defaultWorkspaceId: null
      }
    });
    authModule.verifyPassword.mockResolvedValue(true);
    mockPrisma.session.create.mockResolvedValue({
      id: 'session_1',
      expiresAt: new Date('2026-06-01T00:00:00.000Z')
    });

    const response = await request('/api/auth/login', loginHandler, {
      method: 'POST',
      body: {
        email: 'ADMIN@example.com',
        password: 'super-secret-password'
      }
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      sessionId: 'session_1',
      user: {
        id: 'user_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN'
      }
    });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      include: { profile: true }
    });
    expect(mockPrisma.session.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        tokenHash: 'hashed:plain-session-token',
        expiresAt: new Date('2026-06-01T00:00:00.000Z')
      }
    });
    expect(response.setCookie).toContain('pepetex_session=plain-session-token');
  });

  it('revokes the current session and clears the cookie on logout', async () => {
    mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });

    const response = await request('/api/auth/logout', logoutHandler, {
      method: 'POST',
      headers: {
        cookie: 'pepetex_session=plain-session-token'
      }
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: 'hashed:plain-session-token',
        revokedAt: null
      },
      data: {
        revokedAt: expect.any(Date)
      }
    });
    expect(response.setCookie).toContain('pepetex_session=');
  });
});

async function request(
  path: string,
  handler: EventHandler,
  input: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
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
    const response = await new Promise<{
      status: number;
      body: string;
      setCookie: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: input.method ?? 'GET',
          headers: {
            ...(payload ? { 'content-type': 'application/json' } : {}),
            ...input.headers
          }
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
              body,
              setCookie: Array.isArray(res.headers['set-cookie'])
                ? res.headers['set-cookie'].join('; ')
                : res.headers['set-cookie'] ?? ''
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

    const json = response.body ? JSON.parse(response.body) : null;

    return {
      status: response.status,
      json,
      setCookie: response.setCookie
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
