import { createServer, request as httpRequest } from 'node:http';

import { createApp, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  passwordResetToken: {
    findUnique: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock('@pepetex/db', () => ({
  prisma: mockPrisma
}));

const authModule = vi.hoisted(() => ({
  hashPasswordResetToken: vi.fn(),
  hashPassword: vi.fn()
}));

vi.mock('@pepetex/auth', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/auth')>('@pepetex/auth');

  return {
    ...actual,
    hashPasswordResetToken: authModule.hashPasswordResetToken,
    hashPassword: authModule.hashPassword
  };
});

import confirmPasswordResetHandler from './password-reset/confirm.post';

describe('password reset confirmation api route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T11:00:00.000Z'));
    authModule.hashPasswordResetToken.mockImplementation((token: string) => `hashed:${token}`);
    authModule.hashPassword.mockResolvedValue('new-password-hash');
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        passwordResetToken: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 })
        },
        user: {
          update: vi.fn().mockResolvedValue({ id: 'user_1' })
        },
        session: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 })
        }
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('confirms a valid password reset token and revokes active sessions', async () => {
    const updatePasswordResetToken = vi.fn().mockResolvedValue({ count: 1 });
    const deletePasswordResetTokens = vi.fn().mockResolvedValue({ count: 2 });
    const updateUser = vi.fn().mockResolvedValue({ id: 'user_1' });
    const updateSessions = vi.fn().mockResolvedValue({ count: 3 });

    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset_1',
      userId: 'user_1',
      consumedAt: null,
      expiresAt: new Date('2026-04-15T12:00:00.000Z')
    });
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        passwordResetToken: {
          updateMany: updatePasswordResetToken,
          deleteMany: deletePasswordResetTokens
        },
        user: {
          update: updateUser
        },
        session: {
          updateMany: updateSessions
        }
      })
    );

    const response = await request('/api/auth/password-reset/confirm', confirmPasswordResetHandler, {
      method: 'POST',
      body: {
        token: ' plain-reset-token ',
        password: 'super-secret-password'
      }
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hashed:plain-reset-token' },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true
      }
    });
    expect(authModule.hashPassword).toHaveBeenCalledWith('super-secret-password');
    expect(updatePasswordResetToken).toHaveBeenCalledWith({
      where: {
        id: 'reset_1',
        consumedAt: null,
        expiresAt: {
          gt: new Date('2026-04-15T11:00:00.000Z')
        }
      },
      data: {
        consumedAt: new Date('2026-04-15T11:00:00.000Z')
      }
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { passwordHash: 'new-password-hash' }
    });
    expect(updateSessions).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        revokedAt: null
      },
      data: {
        revokedAt: new Date('2026-04-15T11:00:00.000Z')
      }
    });
    expect(deletePasswordResetTokens).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        id: {
          not: 'reset_1'
        }
      }
    });
  });

  it('rejects invalid or expired reset tokens', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

    const response = await request('/api/auth/password-reset/confirm', confirmPasswordResetHandler, {
      method: 'POST',
      body: {
        token: 'missing-token',
        password: 'super-secret-password'
      }
    });

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      statusCode: 400,
      statusMessage: 'Password reset token is invalid or has expired.'
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects weak passwords before applying updates', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset_1',
      userId: 'user_1',
      consumedAt: null,
      expiresAt: new Date('2026-04-15T12:00:00.000Z')
    });
    authModule.hashPassword.mockRejectedValue(
      new Error('Password must be at least 8 characters long.')
    );

    const response = await request('/api/auth/password-reset/confirm', confirmPasswordResetHandler, {
      method: 'POST',
      body: {
        token: 'plain-reset-token',
        password: 'short'
      }
    });

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      statusCode: 400,
      statusMessage: 'Password must be at least 8 characters long.'
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid request bodies', async () => {
    const response = await request('/api/auth/password-reset/confirm', confirmPasswordResetHandler, {
      method: 'POST',
      body: {
        token: ''
      }
    });

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      statusCode: 400,
      statusMessage: 'Token and password are required.'
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
