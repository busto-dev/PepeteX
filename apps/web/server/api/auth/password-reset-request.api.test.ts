import { createServer, request as httpRequest } from 'node:http';

import { createApp, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock('@pepetex/db', () => ({
  prisma: mockPrisma
}));

const authModule = vi.hoisted(() => ({
  createPasswordResetToken: vi.fn(),
  hashPasswordResetToken: vi.fn(),
  createPasswordResetExpiry: vi.fn()
}));

vi.mock('@pepetex/auth', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/auth')>('@pepetex/auth');

  return {
    ...actual,
    createPasswordResetToken: authModule.createPasswordResetToken,
    hashPasswordResetToken: authModule.hashPasswordResetToken,
    createPasswordResetExpiry: authModule.createPasswordResetExpiry
  };
});

import requestPasswordResetHandler from './password-reset/request.post';

describe('password reset request api route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authModule.createPasswordResetToken.mockReturnValue('plain-reset-token');
    authModule.hashPasswordResetToken.mockImplementation((token: string) => `hashed:${token}`);
    authModule.createPasswordResetExpiry.mockReturnValue(new Date('2026-06-01T00:00:00.000Z'));
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        passwordResetToken: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: 'reset_1' })
        }
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a password reset token for an existing user', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({ id: 'reset_1' });

    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1' });
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        passwordResetToken: {
          deleteMany,
          create
        }
      })
    );

    const response = await request('/api/auth/password-reset/request', requestPasswordResetHandler, {
      method: 'POST',
      body: {
        email: 'ADMIN@example.com'
      }
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      select: { id: true }
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        consumedAt: null
      }
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        tokenHash: 'hashed:plain-reset-token',
        expiresAt: new Date('2026-06-01T00:00:00.000Z')
      }
    });
  });

  it('returns success without issuing a token for an unknown email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await request('/api/auth/password-reset/request', requestPasswordResetHandler, {
      method: 'POST',
      body: {
        email: 'missing@example.com'
      }
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'missing@example.com' },
      select: { id: true }
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid request bodies', async () => {
    const response = await request('/api/auth/password-reset/request', requestPasswordResetHandler, {
      method: 'POST',
      body: {}
    });

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      statusCode: 400,
      statusMessage: 'Email is required.'
    });
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
