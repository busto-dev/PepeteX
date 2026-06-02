import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  deck: {
    findFirst: vi.fn(),
    update: vi.fn()
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

import deckByIdGetHandler from './decks/[deckId].get';
import revisionRestoreHandler from './decks/[deckId]/revisions/[revisionId]/restore.post';
import slideReorderHandler from './decks/[deckId]/slides/reorder.patch';
import slideDuplicateHandler from './decks/[deckId]/slides/[slideId]/duplicate.post';
import slideTextPatchHandler from './decks/[deckId]/slides/[slideId]/text.patch';

interface TestRevisionRecord {
  id: string;
  revisionNumber: number;
  label: string;
  source: string;
  summary: string;
  deckJson: ReturnType<typeof createDeckContent>;
  createdAt: Date;
  createdByUser: {
    id: string;
    email: string;
    profile: {
      name: string;
    };
  };
  restoredFromRevision: {
    revisionNumber: number;
  } | null;
}

interface TestDeckRecord {
  id: string;
  title: string;
  contentJson: ReturnType<typeof createDeckContent>;
  currentRevisionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  _count: {
    referenceFiles: number;
  };
  workspace: {
    id: string;
    name: string;
    type: 'SHARED';
    members: Array<{
      role: string;
    }>;
  };
  revisions: TestRevisionRecord[];
}

describe('deck content routes', () => {
  let currentDeck: TestDeckRecord = createDeckDetailRecord();

  beforeEach(() => {
    vi.resetAllMocks();
    currentDeck = createDeckDetailRecord();
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.$transaction.mockImplementation(async (callback: (client: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.deck.findFirst.mockImplementation(async () => currentDeck);
    mockPrisma.deck.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      currentDeck = {
        ...currentDeck,
        title: typeof data.title === 'string' ? data.title : currentDeck.title,
        contentJson: ('contentJson' in data ? data.contentJson : currentDeck.contentJson) as typeof currentDeck.contentJson,
        currentRevisionNumber:
          typeof data.currentRevisionNumber === 'number'
            ? data.currentRevisionNumber
            : currentDeck.currentRevisionNumber,
        updatedAt: new Date('2026-04-26T11:00:00.000Z')
      };

      return currentDeck;
    });
    mockPrisma.deckRevision.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        const revisionNumber = data.revisionNumber as number;
        const restoredFromRevisionId = (data.restoredFromRevisionId as string | undefined) ?? null;
        const revision: TestRevisionRecord = {
          id: `revision_${revisionNumber}`,
          revisionNumber,
          label: data.label as string,
          source: data.source as string,
          summary: (data.summary as string | undefined) ?? '',
          deckJson: data.deckJson as ReturnType<typeof createDeckContent>,
          createdAt: new Date('2026-04-26T11:00:00.000Z'),
          createdByUser: {
            id: data.createdByUserId as string,
            email: 'user@example.com',
            profile: {
              name: 'User One'
            }
          },
          restoredFromRevision: restoredFromRevisionId
            ? {
                revisionNumber:
                  currentDeck.revisions.find(
                    (entry: { id: string; revisionNumber: number }) => entry.id === restoredFromRevisionId
                  )
                    ?.revisionNumber ?? 1
              }
            : null
        };

        currentDeck = {
          ...currentDeck,
          revisions: [revision, ...currentDeck.revisions]
        };

        return revision;
      }
    );
  });

  it('returns persisted deck content for accessible decks', async () => {
    const response = await request('/api/decks/deck_1', deckByIdGetHandler, {}, '/api/decks/:deckId');

    expect(response.status).toBe(200);
    expect(response.json.deck.title).toBe('Sales Kickoff');
    expect(response.json.deck.currentRevisionNumber).toBe(1);
    expect(response.json.deck.slides).toHaveLength(2);
    expect(response.json.deck.revisions[0]).toMatchObject({
      revisionNumber: 1,
      label: 'Initial deck scaffold',
      slideCount: 2
    });
    expect(response.json.deck.slides[0].editableFields[0]).toMatchObject({
      elementId: 'slide_1_headline',
      label: 'Headline',
      text: 'Overview'
    });
  });

  it('rejects slide reordering for viewers', async () => {
    currentDeck = createDeckDetailRecord({
      workspace: {
        id: 'workspace_1',
        name: 'Go To Market',
        type: 'SHARED',
        members: [{ role: 'VIEWER' }]
      }
    });

    const response = await request(
      '/api/decks/deck_1/slides/reorder',
      slideReorderHandler,
      {
        method: 'PATCH',
        body: {
          slideId: 'slide_2',
          toIndex: 0
        }
      },
      '/api/decks/:deckId/slides/reorder'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace editor access is required.');
  });

  it('duplicates a slide and creates a new revision', async () => {
    const response = await request(
      '/api/decks/deck_1/slides/slide_1/duplicate',
      slideDuplicateHandler,
      {
        method: 'POST'
      },
      '/api/decks/:deckId/slides/:slideId/duplicate'
    );

    expect(response.status).toBe(200);
    expect(response.json.deck.currentRevisionNumber).toBe(2);
    expect(response.json.deck.slides).toHaveLength(3);
    expect(response.json.deck.revisions[0]).toMatchObject({
      revisionNumber: 2,
      source: 'SLIDE_DUPLICATED'
    });
  });

  it('updates manual slide text and returns the edited content', async () => {
    const response = await request(
      '/api/decks/deck_1/slides/slide_1/text',
      slideTextPatchHandler,
      {
        method: 'PATCH',
        body: {
          elementId: 'slide_1_headline',
          text: 'Sharper overview'
        }
      },
      '/api/decks/:deckId/slides/:slideId/text'
    );

    expect(response.status).toBe(200);
    expect(response.json.deck.currentRevisionNumber).toBe(2);
    expect(response.json.deck.slides[0].title).toBe('Sharper overview');
    expect(response.json.deck.slides[0].editableFields[0].text).toBe('Sharper overview');
    expect(response.json.deck.revisions[0].source).toBe('MANUAL_TEXT_EDIT');
  });

  it('restores a saved revision into a fresh current revision', async () => {
    const restoredDeck = createDeckContent('Restored Title', 'Restored Title');
    currentDeck = createDeckDetailRecord({
      contentJson: createDeckContent('Current Title', 'Current Title'),
      currentRevisionNumber: 2,
      revisions: [
        createRevisionRecord({
          id: 'revision_2',
          revisionNumber: 2,
          label: 'Edited Current Title',
          source: 'MANUAL_TEXT_EDIT',
          deckJson: createDeckContent('Current Title', 'Current Title')
        }),
        createRevisionRecord({
          id: 'revision_1',
          revisionNumber: 1,
          label: 'Initial deck scaffold',
          source: 'INITIAL',
          deckJson: restoredDeck
        })
      ]
    });

    const response = await request(
      '/api/decks/deck_1/revisions/revision_1/restore',
      revisionRestoreHandler,
      {
        method: 'POST'
      },
      '/api/decks/:deckId/revisions/:revisionId/restore'
    );

    expect(response.status).toBe(200);
    expect(response.json.deck.currentRevisionNumber).toBe(3);
    expect(response.json.deck.title).toBe('Restored Title');
    expect(response.json.deck.revisions[0]).toMatchObject({
      revisionNumber: 3,
      source: 'REVISION_RESTORED',
      restoredFromRevisionNumber: 1
    });
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

function createDeckContent(headline: string, deckTitle = 'Sales Kickoff') {
  return {
    title: deckTitle,
    language: 'en',
    aspectRatio: '16:9',
    canvas: {
      width: 1920,
      height: 1080
    },
    slides: [
      {
        id: 'slide_1',
        title: headline,
        html: `
          <section class="pepetex-slide" data-pepetex-slide-id="slide_1" data-pepetex-width="1920" data-pepetex-height="1080" style="width: 1920px; height: 1080px; position: relative; overflow: hidden;">
            <div data-pepetex-id="slide_1_headline" data-pepetex-type="headline">Overview</div>
            <div data-pepetex-id="slide_1_body" data-pepetex-type="body">Deck summary body</div>
          </section>
        `.trim().replace('Overview', headline),
        css: '',
        assets: [],
        charts: []
      },
      {
        id: 'slide_2',
        title: 'Details',
        html: `
          <section class="pepetex-slide" data-pepetex-slide-id="slide_2" data-pepetex-width="1920" data-pepetex-height="1080" style="width: 1920px; height: 1080px; position: relative; overflow: hidden;">
            <div data-pepetex-id="slide_2_headline" data-pepetex-type="headline">Details</div>
          </section>
        `.trim(),
        css: '',
        assets: [],
        charts: []
      }
    ]
  };
}

function createRevisionRecord(overrides: Record<string, unknown> = {}): TestRevisionRecord {
  return {
    id: 'revision_1',
    revisionNumber: 1,
    label: 'Initial deck scaffold',
    source: 'INITIAL',
    summary: 'Created the starter deck.',
    deckJson: createDeckContent('Overview'),
    createdAt: new Date('2026-04-26T08:30:00.000Z'),
    createdByUser: {
      id: 'user_1',
      email: 'user@example.com',
      profile: {
        name: 'User One'
      }
    },
    restoredFromRevision: null,
    ...overrides
  };
}

function createDeckDetailRecord(overrides: Record<string, unknown> = {}): TestDeckRecord {
  return {
    id: 'deck_1',
    title: 'Sales Kickoff',
    contentJson: createDeckContent('Overview'),
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
    revisions: [createRevisionRecord()],
    ...overrides
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
