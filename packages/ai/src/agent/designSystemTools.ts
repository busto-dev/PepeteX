import { createTool } from '@mastra/core/tools';
import { getPepeteXDesignSystemAgentRequestContext } from './designSystemContext.js';

interface AskOptionInput {
  id: string;
  label: string;
  description?: string;
  value?: unknown;
}

type PassthroughStandardSchema<T> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { value: T };
    readonly jsonSchema: {
      readonly input: () => Record<string, unknown>;
      readonly output: () => Record<string, unknown>;
    };
  };
};

function passthroughObjectSchema<T>(jsonSchema?: Record<string, unknown>): PassthroughStandardSchema<T> {
  const schema = jsonSchema ?? { type: 'object', additionalProperties: true };
  return {
    '~standard': {
      version: 1,
      vendor: 'pepetex-passthrough',
      validate: (value) => ({ value: value as T }),
      jsonSchema: {
        input: () => schema,
        output: () => schema
      }
    }
  };
}

const askOptionItemsSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      value: { type: 'string' }
    },
    required: ['id', 'label']
  }
} as const;

/**
 * Tools for the design system studio agent. Mirrors createPepeteXMastraTools: the
 * suspend tools (request_clarification / request_approval) are behaviourally identical
 * to the deck agent so the worker's WAITING_ASK suspend/resume branch is reused as-is.
 * Document-mutating tools delegate to the worker-supplied runtime.
 */
export function createPepeteXDesignSystemTools() {
  const requestClarificationTool = createTool({
    id: 'request_clarification',
    description: 'Ask the user a targeted clarification question and suspend the current agent run until they answer.',
    inputSchema: passthroughObjectSchema<{ question: string; options?: AskOptionInput[]; allowManualAnswer?: boolean }>({
      type: 'object',
      properties: { question: { type: 'string' }, options: askOptionItemsSchema, allowManualAnswer: { type: 'boolean' } },
      required: ['question']
    }),
    suspendSchema: passthroughObjectSchema<{ question: string; options?: AskOptionInput[]; allowManualAnswer: boolean }>({
      type: 'object',
      properties: { question: { type: 'string' }, options: askOptionItemsSchema, allowManualAnswer: { type: 'boolean' } },
      required: ['question', 'allowManualAnswer']
    }),
    resumeSchema: passthroughObjectSchema<{ answer: string }>({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      if (!context.agent?.suspend) {
        return { status: 'not_available' as const, answer: null, question: input.question };
      }
      if (!context.agent.resumeData) {
        await context.agent.suspend({
          question: input.question,
          ...(input.options ? { options: input.options } : {}),
          allowManualAnswer: input.allowManualAnswer ?? true
        });
      }
      return {
        status: context.agent.resumeData ? ('answered' as const) : ('suspended' as const),
        answer: context.agent.resumeData?.answer ?? null,
        question: input.question
      };
    }
  });

  const requestApprovalTool = createTool({
    id: 'request_approval',
    description: 'Ask the user to approve or deny a risky design system operation (deleting a default bucket, broad rewrites), then suspend until they answer.',
    inputSchema: passthroughObjectSchema<{ question: string; reason?: string; proposedAction?: string }>({
      type: 'object',
      properties: { question: { type: 'string' }, reason: { type: 'string' }, proposedAction: { type: 'string' } },
      required: ['question'],
      additionalProperties: true
    }),
    suspendSchema: passthroughObjectSchema<{ question: string; reason?: string; options: AskOptionInput[]; allowManualAnswer: boolean }>({
      type: 'object',
      properties: { question: { type: 'string' }, reason: { type: 'string' }, options: askOptionItemsSchema, allowManualAnswer: { type: 'boolean' } },
      required: ['question', 'options', 'allowManualAnswer']
    }),
    resumeSchema: passthroughObjectSchema<{ answer: string }>({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      if (!context.agent?.suspend) {
        return { status: 'not_available' as const, approved: false, answer: null, question: input.question };
      }
      const options: AskOptionInput[] = [
        { id: 'approve', label: 'Approve', description: input.proposedAction ?? 'Allow PepeteX to perform this operation.', value: 'approve' },
        { id: 'deny', label: 'Deny', description: 'Do not perform this operation.', value: 'deny' }
      ];
      if (!context.agent.resumeData) {
        await context.agent.suspend({
          question: input.question,
          ...(input.reason ? { reason: input.reason } : {}),
          options,
          allowManualAnswer: true
        });
      }
      const answer = context.agent.resumeData?.answer ?? null;
      const normalized = String(answer ?? '').trim().toLowerCase();
      const approved = normalized === 'approve' || normalized === 'approved' || normalized === 'yes' || normalized.startsWith('approve ');
      return { status: answer ? ('answered' as const) : ('suspended' as const), approved, answer, question: input.question };
    }
  });

  const readStateTool = createTool({
    id: 'read_design_system_state',
    description: 'Read the current draft design system: its name, the buckets/sub-categories/items tree, generation kind, scoped feedback context, and available reference files and assets. Set includeItems true to get full item detail (component/example HTML+CSS).',
    inputSchema: passthroughObjectSchema<{ includeItems?: boolean }>({
      type: 'object',
      properties: { includeItems: { type: 'boolean' } },
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const document = request.runtime.getDraftDocument();
      const meta = request.runtime.getDesignSystemMeta();
      const includeItems = input.includeItems === true;
      return {
        status: 'ok' as const,
        runId: request.runId,
        designSystem: meta,
        generationKind: request.generationKind,
        languageCode: request.languageCode,
        feedbackContext: request.feedbackContext ?? null,
        document: includeItems ? document : summarizeDocumentForTool(document),
        compact: !includeItems,
        note: includeItems ? null : 'Document is a compact summary. Call read_design_system_state with includeItems true when you need full component/example HTML and CSS.'
      };
    }
  });

  const listReferenceFilesTool = createTool({
    id: 'list_reference_files',
    description: 'List uploaded brand reference files and assets attached to this design system, including native multimodal image/PDF references and uploaded font/logo/image assets. Use this early before building from uploads.',
    inputSchema: passthroughObjectSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
    execute: async (_input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      return { status: 'ok' as const, files: request.runtime.listReferenceFiles() };
    }
  });

  const readReferenceFileTool = createTool({
    id: 'read_reference_file',
    description: 'Read a single reference file by id to inspect inline image bytes or extracted text excerpt. PDFs are normally attached directly to the current Mastra agent turn as native file parts, so use the visible multimodal document context for PDF layout/style understanding.',
    inputSchema: passthroughObjectSchema<{ referenceFileId: string }>({
      type: 'object',
      properties: { referenceFileId: { type: 'string' } },
      required: ['referenceFileId'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      return request.runtime.readReferenceFile(input.referenceFileId);
    }
  });

  const listAssetsTool = createTool({
    id: 'list_assets',
    description: 'List brand assets available to reference in asset items: uploaded logo/image/font reference assets and previously generated images, with their availability status. Uploaded logo/image assets should become asset bucket items; uploaded font assets should become typography items.',
    inputSchema: passthroughObjectSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
    execute: async (_input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      return { status: 'ok' as const, assets: request.runtime.listAssets() };
    }
  });

  const upsertBucketTool = createTool({
    id: 'upsert_bucket',
    description: 'Create or update a top-level bucket. Six default buckets always exist (colors, typography, spacing, components, examples, assets). Add new buckets with kind "custom" for concepts that do not fit the defaults. Returns the updated draft.',
    inputSchema: passthroughObjectSchema<{ id?: string; kind: string; label: string; description?: string; summary?: string }>({
      type: 'object',
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['color', 'typography', 'spacing', 'component', 'example', 'asset', 'custom'] },
        label: { type: 'string' },
        description: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['kind', 'label'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const result = await request.runtime.upsertBucket(input);
      return compactMutationResult(result);
    }
  });

  const upsertSubCategoryTool = createTool({
    id: 'upsert_subcategory',
    description: 'Create or update a sub-category inside a bucket (e.g. colors -> "primary"/"neutral"/"gradients"; components -> "stat cards"/"feature cards"; examples -> "title"/"thank you"/"chart"). You decide how many sub-categories each bucket needs.',
    inputSchema: passthroughObjectSchema<{ bucketId: string; id?: string; label: string; description?: string; summary?: string }>({
      type: 'object',
      properties: {
        bucketId: { type: 'string' },
        id: { type: 'string' },
        label: { type: 'string' },
        description: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['bucketId', 'label'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const result = await request.runtime.upsertSubCategory(input);
      return compactMutationResult(result);
    }
  });

  const writeItemTool = createTool({
    id: 'write_item',
    description: 'Add or replace ONE item in a sub-category. The item shape depends on the bucket kind: color {label,value,usage}; typography {label,fontFamily,fontSizePx,fontWeight,lineHeight,fontAssetId?}; spacing {label,valuePx}; component {label,kind,description,html,css}; example {label,purpose,html,css}; asset {label,assetKind,source,referenceFileId|generatedImageId}; custom {label,description,value}. For uploaded font assets, set typography.fontAssetId to the asset id and use the exact fontFamily in CSS. Component/example HTML must carry data-pepetex attributes and substantial CSS. Write one item at a time, check the result, repair errors before continuing.',
    inputSchema: passthroughObjectSchema<{ bucketId: string; subCategoryId: string; item: Record<string, unknown>; summary?: string }>({
      type: 'object',
      properties: {
        bucketId: { type: 'string' },
        subCategoryId: { type: 'string' },
        item: { type: 'object', additionalProperties: true },
        summary: { type: 'string' }
      },
      required: ['bucketId', 'subCategoryId', 'item'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const result = await request.runtime.writeItem(input);
      return compactMutationResult(result);
    }
  });

  const generateAssetImageTool = createTool({
    id: 'generate_asset_image',
    description: 'Generate a brand image (logo, illustration, icon, pattern) from a prompt and add it as a generated asset item in the given asset sub-category. The image renders asynchronously; the item references the generated image id and appears once the image completes.',
    inputSchema: passthroughObjectSchema<{ bucketId: string; subCategoryId: string; label: string; assetKind: string; prompt: string }>({
      type: 'object',
      properties: {
        bucketId: { type: 'string' },
        subCategoryId: { type: 'string' },
        label: { type: 'string' },
        assetKind: { type: 'string' },
        prompt: { type: 'string' }
      },
      required: ['bucketId', 'subCategoryId', 'label', 'assetKind', 'prompt'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      return request.runtime.generateAssetImage(input);
    }
  });

  const deleteNodeTool = createTool({
    id: 'delete_node',
    description: 'Delete an item, a sub-category, or a non-default bucket. Provide bucketId plus optionally subCategoryId and itemId. Use request_approval first before deleting a default bucket or anything the user did not explicitly ask to remove.',
    inputSchema: passthroughObjectSchema<{ bucketId: string; subCategoryId?: string; itemId?: string; summary?: string }>({
      type: 'object',
      properties: {
        bucketId: { type: 'string' },
        subCategoryId: { type: 'string' },
        itemId: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['bucketId'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const result = await request.runtime.deleteNode(input);
      return compactMutationResult(result);
    }
  });

  const validateTool = createTool({
    id: 'validate_design_system',
    description: 'Validate the full draft design system document against the contract (per-kind item rules, component/example HTML+CSS quality). Returns errors and warnings.',
    inputSchema: passthroughObjectSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
    execute: async (_input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const result = await request.runtime.validateDocument();
      return { ok: result.ok, errors: result.errors, warnings: result.warnings };
    }
  });

  const finishTool = createTool({
    id: 'finish_generation',
    description: 'Validate the draft, commit it as a new immutable design system version, and finish the run. The summary is shown to the user, so write a concise model-authored description of what changed.',
    inputSchema: passthroughObjectSchema<{ summary: string }>({
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXDesignSystemAgentRequestContext(context.requestContext);
      const result = await request.runtime.finishGeneration({ summary: input.summary });
      return {
        status: result.completed ? ('completed' as const) : ('incomplete' as const),
        ok: result.ok,
        errors: result.errors,
        warnings: result.warnings,
        versionId: result.versionId ?? null,
        versionNumber: result.versionNumber ?? null,
        summary: result.summary
      };
    }
  });

  return {
    request_clarification: requestClarificationTool,
    request_approval: requestApprovalTool,
    read_design_system_state: readStateTool,
    list_reference_files: listReferenceFilesTool,
    read_reference_file: readReferenceFileTool,
    list_assets: listAssetsTool,
    upsert_bucket: upsertBucketTool,
    upsert_subcategory: upsertSubCategoryTool,
    write_item: writeItemTool,
    generate_asset_image: generateAssetImageTool,
    delete_node: deleteNodeTool,
    validate_design_system: validateTool,
    finish_generation: finishTool
  };
}

// ---------------------------------------------------------------------------
// Compaction helpers — keep tool results small so they do not blow the context.
// ---------------------------------------------------------------------------

function summarizeDocumentForTool(document: { buckets: Array<{ id: string; kind: string; label: string; subCategories: Array<{ id: string; label: string; items: Array<{ id: string; label?: unknown }> }> }> }) {
  return {
    buckets: document.buckets.map((bucket) => ({
      id: bucket.id,
      kind: bucket.kind,
      label: bucket.label,
      subCategories: bucket.subCategories.map((sub) => ({
        id: sub.id,
        label: sub.label,
        itemIds: sub.items.map((item) => item.id),
        itemCount: sub.items.length
      }))
    }))
  };
}

function compactMutationResult(result: {
  ok: boolean;
  errors: string[];
  warnings: string[];
  document: { buckets: Array<{ id: string; kind: string; label: string; subCategories: Array<{ id: string; label: string; items: Array<{ id: string }> }> }> };
  summary: string;
  checkpointId?: string;
}) {
  return {
    status: result.ok ? ('accepted' as const) : ('rejected' as const),
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    summary: result.summary,
    ...(result.checkpointId ? { checkpointId: result.checkpointId } : {}),
    draft: summarizeDocumentForTool(result.document)
  };
}
