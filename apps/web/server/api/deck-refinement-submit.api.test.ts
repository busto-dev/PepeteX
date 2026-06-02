import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  quit: vi.fn()
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis)
}));

vi.mock('@pepetex/config', () => ({
  loadConfig: vi.fn(() => ({ redisUrl: 'redis://localhost:6379' }))
}));

const mockPrisma = vi.hoisted(() => ({
  comment: {
    updateMany: vi.fn()
  },
  tweakBatch: {
    updateMany: vi.fn()
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

const mockSubmitComments = vi.hoisted(() => vi.fn());

vi.mock('../utils/comments', () => ({
  submitComments: mockSubmitComments
}));

const mockSubmitTweakBatch = vi.hoisted(() => vi.fn());

vi.mock('../utils/tweaks', () => ({
  submitTweakBatch: mockSubmitTweakBatch
}));

const mockResolveDeckRefinementGenerationDefaults = vi.hoisted(() => vi.fn());
const mockSubmitGenerationRun = vi.hoisted(() => vi.fn());

vi.mock('../utils/generation-runs', () => ({
  resolveDeckRefinementGenerationDefaults: mockResolveDeckRefinementGenerationDefaults,
  submitGenerationRun: mockSubmitGenerationRun
}));

import commentsSubmitHandler from './decks/[deckId]/comments/submit.post';
import tweaksSubmitHandler from './decks/[deckId]/tweaks/submit.post';

describe('deck refinement submit endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.quit.mockResolvedValue(undefined);
    mockGetAuthenticatedSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockResolveDeckRefinementGenerationDefaults.mockResolvedValue({
      workspaceId: 'workspace_1',
      textProviderId: 'provider_1',
      textModelId: 'model_1'
    });
    mockSubmitGenerationRun.mockResolvedValue({ id: 'run_1', kind: 'AGENT_COMMAND' });
  });

  it('submits comments as an AGENT_COMMAND with apply_comments context', async () => {
    mockSubmitComments.mockResolvedValue({
      submittedCount: 2,
      comments: [
        { id: 'comment_1' },
        { id: 'comment_2' }
      ]
    });

    const response = await request(
      '/api/decks/deck_1/comments/submit',
      commentsSubmitHandler,
      '/api/decks/:deckId/comments/submit'
    );

    expect(response.status).toBe(200);
    expect(mockSubmitGenerationRun).toHaveBeenCalledWith(
      'user_1',
      {
        deckId: 'deck_1',
        workspaceId: 'workspace_1',
        kind: 'AGENT_COMMAND',
        textProviderId: 'provider_1',
        textModelId: 'model_1',
        manualInstruction: 'Apply the submitted comments to this deck.',
        commandContextJson: {
          source: 'comments_submit',
          intent: 'apply_comments',
          commentIds: ['comment_1', 'comment_2']
        }
      },
      mockRedis
    );
    expect(response.json.generationRun).toEqual({ id: 'run_1', kind: 'AGENT_COMMAND' });
  });

  it('submits tweaks as an AGENT_COMMAND with apply_tweaks context', async () => {
    mockSubmitTweakBatch.mockResolvedValue({
      batchId: 'batch_1',
      submittedCount: 3
    });

    const response = await request(
      '/api/decks/deck_1/tweaks/submit',
      tweaksSubmitHandler,
      '/api/decks/:deckId/tweaks/submit'
    );

    expect(response.status).toBe(200);
    expect(mockSubmitGenerationRun).toHaveBeenCalledWith(
      'user_1',
      {
        deckId: 'deck_1',
        workspaceId: 'workspace_1',
        kind: 'AGENT_COMMAND',
        textProviderId: 'provider_1',
        textModelId: 'model_1',
        manualInstruction: 'Apply the submitted tweak batch to this deck.',
        commandContextJson: {
          source: 'tweaks_submit',
          intent: 'apply_tweaks',
          tweakBatchId: 'batch_1'
        }
      },
      mockRedis
    );
    expect(response.json.generationRun).toEqual({ id: 'run_1', kind: 'AGENT_COMMAND' });
  });
});

async function request(path: string, handler: EventHandler, routePath: string) {
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

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: 'POST'
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
