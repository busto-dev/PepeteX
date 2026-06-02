import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspace: {
    findFirst: vi.fn()
  },
  deck: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  deckRevision: {
    create: vi.fn()
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

import deckByIdDeleteHandler from './decks/[deckId].delete';
import deckByIdPatchHandler from './decks/[deckId].patch';
import workspaceDecksGetHandler from './workspaces/[workspaceId]/decks.get';
import workspaceDecksPostHandler from './workspaces/[workspaceId]/decks.post';

describe('/api/workspaces/:workspaceId/decks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (client: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
  });

  it('requires authentication to list workspace decks', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request(
      '/api/workspaces/workspace_1/decks',
      workspaceDecksGetHandler,
      {},
      '/api/workspaces/:workspaceId/decks'
    );

    expect(response.status).toBe(401);
    expect(response.json.statusMessage).toBe('Authentication required.');
  });

  it('lists decks for an accessible workspace', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(createWorkspaceAccessRecord('EDITOR'));
    mockPrisma.deck.findMany.mockResolvedValue([
      createDeckAccessRecord({
        id: 'deck_2',
        title: 'Quarterly Review',
        updatedAt: new Date('2026-04-26T09:00:00.000Z'),
        _count: {
          referenceFiles: 2
        }
      }),
      createDeckAccessRecord({
        id: 'deck_1',
        title: 'Sales Kickoff',
        updatedAt: new Date('2026-04-26T08:00:00.000Z'),
        _count: {
          referenceFiles: 0
        }
      })
    ]);

    const response = await request(
      '/api/workspaces/workspace_1/decks',
      workspaceDecksGetHandler,
      {},
      '/api/workspaces/:workspaceId/decks'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.deck.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace_1'
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: expect.any(Object)
    });
    expect(response.json).toEqual({
      decks: [
        {
          id: 'deck_2',
          workspaceId: 'workspace_1',
          workspaceName: 'Go To Market',
          workspaceType: 'SHARED',
          title: 'Quarterly Review',
          referenceFileCount: 2,
          currentUserRole: 'EDITOR',
          createdAt: '2026-04-26T07:00:00.000Z',
          updatedAt: '2026-04-26T09:00:00.000Z'
        },
        {
          id: 'deck_1',
          workspaceId: 'workspace_1',
          workspaceName: 'Go To Market',
          workspaceType: 'SHARED',
          title: 'Sales Kickoff',
          referenceFileCount: 0,
          currentUserRole: 'EDITOR',
          createdAt: '2026-04-26T07:00:00.000Z',
          updatedAt: '2026-04-26T08:00:00.000Z'
        }
      ]
    });
  });

  it('creates a deck for workspace editors', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(createWorkspaceAccessRecord('EDITOR'));
    mockPrisma.deck.create.mockResolvedValue(
      createDeckAccessRecord({
        id: 'deck_new',
        title: 'Executive Brief',
        _count: {
          referenceFiles: 0
        }
      })
    );

    const response = await request(
      '/api/workspaces/workspace_1/decks',
      workspaceDecksPostHandler,
      {
        method: 'POST',
        body: {
          title: 'Executive Brief'
        }
      },
      '/api/workspaces/:workspaceId/decks'
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.deck.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace_1',
        createdByUserId: 'user_1',
        title: 'Executive Brief',
        contentJson: expect.objectContaining({
          title: 'Executive Brief',
          slides: expect.any(Array)
        }),
        currentRevisionNumber: 1,
        revisions: {
          create: expect.objectContaining({
            revisionNumber: 1,
            source: 'INITIAL',
            createdByUserId: 'user_1'
          })
        }
      },
      include: expect.any(Object)
    });
    expect(response.json.deck).toMatchObject({
      id: 'deck_new',
      title: 'Executive Brief',
      currentUserRole: 'EDITOR'
    });
  });

  it('rejects deck creation for viewers', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(createWorkspaceAccessRecord('VIEWER'));

    const response = await request(
      '/api/workspaces/workspace_1/decks',
      workspaceDecksPostHandler,
      {
        method: 'POST',
        body: {
          title: 'Blocked Deck'
        }
      },
      '/api/workspaces/:workspaceId/decks'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace editor access is required.');
    expect(mockPrisma.deck.create).not.toHaveBeenCalled();
  });
});

describe('/api/decks/:deckId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates a deck title for editors', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue(createDeckAccessRecord());
    mockPrisma.deck.update.mockResolvedValue(
      createDeckAccessRecord({
        title: 'Renamed Deck',
        updatedAt: new Date('2026-04-26T10:00:00.000Z')
      })
    );

    const response = await request(
      '/api/decks/deck_1',
      deckByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          title: 'Renamed Deck'
        }
      },
      '/api/decks/:deckId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.deck.update).toHaveBeenCalledWith({
      where: {
        id: 'deck_1'
      },
      data: expect.objectContaining({
        title: 'Renamed Deck'
      }),
      include: expect.any(Object)
    });
    expect(response.json.deck).toMatchObject({
      id: 'deck_1',
      title: 'Renamed Deck'
    });
  });

  it('returns not found when updating an inaccessible deck', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue(null);

    const response = await request(
      '/api/decks/deck_missing',
      deckByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          title: 'Missing Deck'
        }
      },
      '/api/decks/:deckId'
    );

    expect(response.status).toBe(404);
    expect(response.json.statusMessage).toBe('Deck not found.');
    expect(mockPrisma.deck.update).not.toHaveBeenCalled();
  });

  it('deletes a deck for editors', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue(createDeckAccessRecord());
    mockPrisma.deck.delete.mockResolvedValue({
      id: 'deck_1'
    });

    const response = await request(
      '/api/decks/deck_1',
      deckByIdDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/decks/:deckId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.deck.delete).toHaveBeenCalledWith({
      where: {
        id: 'deck_1'
      }
    });
    expect(response.json).toEqual({ ok: true });
  });

  it('rejects deck deletion for viewers', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue(
      createDeckAccessRecord({
        workspace: {
          id: 'workspace_1',
          name: 'Go To Market',
          type: 'SHARED',
          members: [{ role: 'VIEWER' }]
        }
      })
    );

    const response = await request(
      '/api/decks/deck_1',
      deckByIdDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/decks/:deckId'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace editor access is required.');
    expect(mockPrisma.deck.delete).not.toHaveBeenCalled();
  });
});

function createSession() {
  return {
    sessionId: 'session_1',
    user: {
      id: 'user_1',
      email: 'user@example.com',
      globalRole: 'USER',
      profile: null
    }
  };
}

function createWorkspaceAccessRecord(role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER') {
  return {
    id: 'workspace_1',
    name: 'Go To Market',
    type: 'SHARED',
    createdAt: new Date('2026-04-26T06:00:00.000Z'),
    updatedAt: new Date('2026-04-26T06:10:00.000Z'),
    members: [{ role }]
  };
}

function createDeckAccessRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deck_1',
    title: 'Sales Kickoff',
    contentJson: createDeckContent(),
    currentRevisionNumber: 1,
    createdAt: new Date('2026-04-26T07:00:00.000Z'),
    updatedAt: new Date('2026-04-26T08:00:00.000Z'),
    createdByUserId: 'user_1',
    _count: {
      referenceFiles: 1
    },
    workspace: {
      id: 'workspace_1',
      name: 'Go To Market',
      type: 'SHARED',
      members: [{ role: 'EDITOR' }]
    },
    ...overrides
  };
}

function createDeckContent() {
  return {
    title: 'Sales Kickoff',
    language: 'en',
    aspectRatio: '16:9',
    canvas: {
      width: 1920,
      height: 1080
    },
    slides: [
      {
        id: 'slide_1',
        title: 'Overview',
        html: `
          <section class="pepetex-slide" data-pepetex-slide-id="slide_1" data-pepetex-width="1920" data-pepetex-height="1080" style="width: 1920px; height: 1080px; position: relative; overflow: hidden;">
            <div data-pepetex-id="slide_1_headline" data-pepetex-type="headline">Overview</div>
          </section>
        `.trim(),
        css: '',
        assets: [],
        charts: []
      }
    ]
  };
}

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
