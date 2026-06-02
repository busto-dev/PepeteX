/**
 * Ephemeral chat image attachments. These ride a single agent turn as multimodal
 * content (text + image parts) so a vision-capable provider "sees" the image; they are
 * NOT persisted as managed reference files. Stored transiently on the triggering USER
 * message's metadata.attachments by the submit utils and read by the worker per turn.
 */
export interface AgentImageAttachment {
  mimeType: string;
  dataBase64: string;
  filename?: string;
  kind: 'image';
}

export interface AgentFileAttachment {
  mimeType: string;
  dataBase64: string;
  filename?: string;
  kind: 'file';
}

export type AgentMediaAttachment = AgentImageAttachment | AgentFileAttachment;

export function parseImageAttachments(metadata: unknown): AgentImageAttachment[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = (metadata as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const mimeType = (entry as { mimeType?: unknown }).mimeType;
      const dataBase64 = (entry as { dataBase64?: unknown }).dataBase64;
      if (
        typeof mimeType === 'string' &&
        mimeType.startsWith('image/') &&
        typeof dataBase64 === 'string' &&
        dataBase64.length > 0
      ) {
        return { mimeType, dataBase64, kind: 'image' as const };
      }
      return null;
    })
    .filter((a): a is AgentImageAttachment => a !== null);
}

export type AgentStreamMessage =
  | string
  | Array<{ role: 'user'; content: Array<Record<string, unknown>> }>;

/**
 * Builds the agent.stream input: a plain string when there are no images, or a single
 * multimodal user message (text + image parts) the AI SDK forwards to the provider
 * (Gemini inlineData, OpenAI image_url, etc.).
 */
export function buildAgentStreamMessage(promptText: string, attachments: AgentMediaAttachment[]): AgentStreamMessage {
  if (attachments.length === 0) return promptText;
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: promptText },
        ...attachments.map((a) => {
          const dataUrl = `data:${a.mimeType};base64,${a.dataBase64}`;
          if (a.kind === 'file' || !a.mimeType.startsWith('image/')) {
            return {
              type: 'file',
              data: dataUrl,
              mediaType: a.mimeType,
              ...(a.filename ? { filename: a.filename } : {})
            };
          }
          return {
            type: 'image',
            image: dataUrl,
            mediaType: a.mimeType
          };
        })
      ]
    }
  ];
}
