import { describe, expect, it } from 'vitest';

import { buildAgentStreamMessage } from './agent-attachments';

describe('buildAgentStreamMessage', () => {
  it('builds native Mastra image and file message parts', () => {
    const message = buildAgentStreamMessage('Inspect these references.', [
      {
        kind: 'image',
        filename: 'logo.png',
        mimeType: 'image/png',
        dataBase64: 'aW1hZ2U='
      },
      {
        kind: 'file',
        filename: 'brand-deck.pdf',
        mimeType: 'application/pdf',
        dataBase64: 'cGRm'
      }
    ]);

    expect(message).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect these references.' },
          {
            type: 'image',
            image: 'data:image/png;base64,aW1hZ2U=',
            mediaType: 'image/png'
          },
          {
            type: 'file',
            data: 'data:application/pdf;base64,cGRm',
            mediaType: 'application/pdf',
            filename: 'brand-deck.pdf'
          }
        ]
      }
    ]);
  });
});
