import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

vi.mock('../../../utils/auth', () => ({
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

vi.mock('../../../utils/authorization', () => ({
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

const mockListAllExamples = vi.hoisted(() => vi.fn());
const mockCreateExample = vi.hoisted(() => vi.fn());
const mockUpdateExample = vi.hoisted(() => vi.fn());
const mockDeleteExample = vi.hoisted(() => vi.fn());

vi.mock('../../utils/examples', () => ({
  listAllExamples: mockListAllExamples,
  createExample: mockCreateExample,
  updateExample: mockUpdateExample,
  deleteExample: mockDeleteExample
}));

vi.mock('../../../utils/examples', () => ({
  listAllExamples: mockListAllExamples,
  createExample: mockCreateExample,
  updateExample: mockUpdateExample,
  deleteExample: mockDeleteExample
}));

import adminExamplesGetHandler from './examples.get';
import adminExamplesPostHandler from './examples.post';
import adminExamplePatchHandler from './examples/[exampleId].patch';
import adminExampleDeleteHandler from './examples/[exampleId].delete';

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

const sampleExample = {
  id: 'example_1',
  title: 'Sales Pitch',
  category: 'Sales Deck',
  promptEn: 'Create a sales pitch for...',
  promptId: 'Buat presentasi penjualan untuk...',
  isEnabled: true,
  sortOrder: 0,
  thumbnailGcsBucket: null,
  thumbnailGcsPath: null,
  createdAt: new Date('2026-04-27T10:00:00Z'),
  updatedAt: new Date('2026-04-27T10:00:00Z')
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/examples', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request('/api/admin/examples', adminExamplesGetHandler);

    expect(response.status).toBe(403);
  });

  it('requires authentication', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/admin/examples', adminExamplesGetHandler);

    expect(response.status).toBe(401);
  });

  it('returns all examples for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockListAllExamples.mockResolvedValue([sampleExample]);

    const response = await request('/api/admin/examples', adminExamplesGetHandler);

    expect(response.status).toBe(200);
    expect(response.json.examples).toHaveLength(1);
    expect(response.json.examples[0].id).toBe('example_1');
  });
});

describe('POST /api/admin/examples', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request('/api/admin/examples', adminExamplesPostHandler, {
      method: 'POST',
      body: { title: 'Test', category: 'Sales Deck', promptEn: 'En', promptId: 'Id' }
    });

    expect(response.status).toBe(403);
  });

  it('creates an example for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockCreateExample.mockResolvedValue(sampleExample);

    const response = await request('/api/admin/examples', adminExamplesPostHandler, {
      method: 'POST',
      body: {
        title: 'Sales Pitch',
        category: 'Sales Deck',
        promptEn: 'Create a sales pitch for...',
        promptId: 'Buat presentasi penjualan untuk...'
      }
    });

    expect(response.status).toBe(200);
    expect(mockCreateExample).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sales Pitch', category: 'Sales Deck' })
    );
  });
});

describe('PATCH /api/admin/examples/:exampleId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request(
      '/api/admin/examples/example_1',
      adminExamplePatchHandler,
      { method: 'PATCH', body: { title: 'Updated' } },
      '/api/admin/examples/:exampleId'
    );

    expect(response.status).toBe(403);
  });

  it('updates example for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockUpdateExample.mockResolvedValue({ ...sampleExample, title: 'Updated Title' });

    const response = await request(
      '/api/admin/examples/example_1',
      adminExamplePatchHandler,
      { method: 'PATCH', body: { title: 'Updated Title' } },
      '/api/admin/examples/:exampleId'
    );

    expect(response.status).toBe(200);
    expect(mockUpdateExample).toHaveBeenCalledWith(
      'example_1',
      expect.objectContaining({ title: 'Updated Title' })
    );
  });

  it('passes selected provider kind and model id when updating an example', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockUpdateExample.mockResolvedValue({
      ...sampleExample,
      textProviderKind: 'gemini',
      textModelId: 'gemini-3.1-pro-preview'
    });

    const response = await request(
      '/api/admin/examples/example_1',
      adminExamplePatchHandler,
      {
        method: 'PATCH',
        body: {
          textProviderKind: 'gemini',
          textModelId: 'gemini-3.1-pro-preview'
        }
      },
      '/api/admin/examples/:exampleId'
    );

    expect(response.status).toBe(200);
    expect(mockUpdateExample).toHaveBeenCalledWith(
      'example_1',
      expect.objectContaining({
        textProviderKind: 'gemini',
        textModelId: 'gemini-3.1-pro-preview'
      })
    );
  });
});

describe('DELETE /api/admin/examples/:exampleId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createUserSession());

    const response = await request(
      '/api/admin/examples/example_1',
      adminExampleDeleteHandler,
      { method: 'DELETE' },
      '/api/admin/examples/:exampleId'
    );

    expect(response.status).toBe(403);
  });

  it('deletes example for global admin', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createAdminSession());
    mockDeleteExample.mockResolvedValue(undefined);

    const response = await request(
      '/api/admin/examples/example_1',
      adminExampleDeleteHandler,
      { method: 'DELETE' },
      '/api/admin/examples/:exampleId'
    );

    expect(response.status).toBe(200);
    expect(response.json.success).toBe(true);
    expect(mockDeleteExample).toHaveBeenCalledWith('example_1');
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
