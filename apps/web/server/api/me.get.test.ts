import { createServer, request as httpRequest } from 'node:http';

import { createApp, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { describe, expect, it, vi } from 'vitest';

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

import meHandler from './me.get';

describe('GET /api/me', () => {
  it('returns the authenticated user payload', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_1',
      user: {
        id: 'user_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: {
          name: 'PepeteX Admin',
          avatarUrl: null,
          uiLanguage: 'en',
          themePreference: 'system',
          defaultWorkspaceId: null
        }
      }
    });

    const response = await request('/api/me', meHandler);

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      authenticated: true,
      user: {
        id: 'user_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: {
          name: 'PepeteX Admin',
          avatarUrl: null,
          uiLanguage: 'en',
          themePreference: 'system',
          defaultWorkspaceId: null
        }
      }
    });
  });

  it('returns an anonymous response when no session exists', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/me', meHandler);

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      authenticated: false,
      user: null
    });
  });
});

async function request(path: string, handler: EventHandler) {
  const app = createApp();
  app.use(path, handler);

  const server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server.');
    }

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: 'GET'
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
