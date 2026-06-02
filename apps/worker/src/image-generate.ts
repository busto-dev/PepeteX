import { randomUUID } from 'node:crypto';

import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';
import {
  classifyImageProviderError,
  createImageProviderAdapter,
  type ImageProviderCredential,
  type ImageProviderKind
} from '@pepetex/image-providers';
import { decryptProviderCredentialPayload } from '@pepetex/providers';
import type { ImageGenerateJobPayload } from '@pepetex/queue';

import { getCachedObjectStorageAdapter } from './object-storage';

const config = loadConfig(process.env);

function requireEncryptionKey(): string {
  const key = config.providerCredentialEncryptionKey;
  if (!key) throw new Error('PROVIDER_CREDENTIAL_ENCRYPTION_KEY is not set.');
  return key;
}

async function resolveImageProviderCredential(
  providerId: string
): Promise<{ credential: ImageProviderCredential; baseUrl: string | null }> {
  const definition = await prisma.providerDefinition.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      kind: true,
      baseUrl: true,
      credentials: {
        where: { scope: 'SYSTEM' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { encryptedPayload: true }
      }
    }
  });

  const encryptedCred = definition.credentials[0];
  if (!encryptedCred) {
    throw new Error(`No system credential found for image provider ${providerId}.`);
  }

  const payload = decryptProviderCredentialPayload(
    encryptedCred.encryptedPayload,
    requireEncryptionKey()
  );

  return {
    baseUrl: definition.baseUrl,
    credential: {
      apiKey: payload.apiKey,
      ...(payload.projectId ? { projectId: payload.projectId } : {})
    }
  };
}

interface ImageJobOwner {
  imageProviderId: string | null;
  createdByUserId: string;
  /** Owner foreign keys written onto the GeneratedImage row. */
  deckId: string | null;
  designSystemId: string | null;
  generationRunId: string | null;
  designSystemGenerationRunId: string | null;
}

export async function runImageGenerateJob(payload: ImageGenerateJobPayload): Promise<void> {
  const {
    generationRunId,
    designSystemGenerationRunId,
    designSystemId,
    generatedImageId,
    slideId,
    elementId,
    prompt,
    model,
    providerKind,
    count,
    gcsBucket,
    gcsObjectPrefix
  } = payload;

  // Resolve the owning run (deck OR design system) to find the image provider + owner FKs.
  let owner: ImageJobOwner | null = null;
  if (generationRunId) {
    const run = await prisma.generationRun.findUnique({
      where: { id: generationRunId },
      select: { deckId: true, workspaceId: true, createdByUserId: true, imageProviderId: true }
    });
    if (run) {
      owner = {
        imageProviderId: run.imageProviderId,
        createdByUserId: run.createdByUserId,
        deckId: run.deckId,
        designSystemId: null,
        generationRunId,
        designSystemGenerationRunId: null
      };
    }
  } else if (designSystemGenerationRunId) {
    const run = await prisma.designSystemGenerationRun.findUnique({
      where: { id: designSystemGenerationRunId },
      select: { designSystemId: true, createdByUserId: true, imageProviderId: true }
    });
    if (run) {
      owner = {
        imageProviderId: run.imageProviderId,
        createdByUserId: run.createdByUserId,
        deckId: null,
        designSystemId: designSystemId ?? run.designSystemId,
        generationRunId: null,
        designSystemGenerationRunId
      };
    }
  }

  if (!owner) {
    console.error('Owning run not found for image job.', { generationRunId, designSystemGenerationRunId });
    return;
  }

  if (!owner.imageProviderId) {
    console.error('No imageProviderId set on the owning run.', { generationRunId, designSystemGenerationRunId });
    if (generatedImageId) {
      await prisma.generatedImage.update({
        where: { id: generatedImageId },
        data: { status: 'FAILED', errorMessage: 'No image provider configured for this run.' }
      }).catch(() => undefined);
    }
    return;
  }

  const { credential, baseUrl } = await resolveImageProviderCredential(owner.imageProviderId);

  const adapter = createImageProviderAdapter(providerKind as ImageProviderKind);

  const gcsStorage = getCachedObjectStorageAdapter(gcsBucket);

  const ownerData = {
    deckId: owner.deckId,
    designSystemId: owner.designSystemId,
    generationRunId: owner.generationRunId,
    designSystemGenerationRunId: owner.designSystemGenerationRunId
  };
  const generatedImageIds: string[] = [];

  try {
    const result = await adapter.generateImages(
      {
        prompt,
        model,
        count,
        mimeType: 'image/png'
      },
      {
        baseUrl,
        credential
      }
    );

    let imageIndex = 0;
    for (const imageData of result.images) {
      // Reuse a pre-created PENDING row (design system asset flow) for the first image.
      const imageId = imageIndex === 0 && generatedImageId ? generatedImageId : randomUUID();
      const objectPath = `${gcsObjectPrefix}/${imageId}.png`;

      const imageBuffer = Buffer.from(imageData.base64, 'base64');
      await gcsStorage.putObject({
        objectPath,
        body: imageBuffer,
        contentType: imageData.mimeType ?? 'image/png',
        metadata: {
          generationRunId: generationRunId ?? designSystemGenerationRunId ?? ''
        }
      });

      const completedData = {
        ...(slideId ? { slideId } : {}),
        ...(elementId ? { elementId } : {}),
        prompt,
        revisedPrompt: imageData.revisedPrompt ?? null,
        model,
        providerKind,
        gcsBucket,
        gcsPath: objectPath,
        mimeType: imageData.mimeType ?? 'image/png',
        width: imageData.width ?? null,
        height: imageData.height ?? null,
        status: 'COMPLETED' as const
      };

      if (imageIndex === 0 && generatedImageId) {
        await prisma.generatedImage.update({ where: { id: generatedImageId }, data: completedData });
      } else {
        await prisma.generatedImage.create({
          data: { id: imageId, ...ownerData, ...completedData, createdByUserId: owner.createdByUserId }
        });
      }
      generatedImageIds.push(imageId);
      imageIndex += 1;
    }

    console.log('Image generation completed.', {
      generationRunId,
      designSystemGenerationRunId,
      generatedImageIds,
      count: generatedImageIds.length
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Image generation job failed.', { generationRunId, designSystemGenerationRunId, error: message });

    // Classify the error into a friendly category
    const httpStatusMatch = message.match(/HTTP (\d+)/);
    const httpStatus = httpStatusMatch ? parseInt(httpStatusMatch[1]!, 10) : undefined;
    const friendly = classifyImageProviderError(httpStatus, message);

    const failedData = {
      prompt,
      model,
      providerKind,
      mimeType: 'image/png',
      status: 'FAILED' as const,
      errorMessage: message,
      friendlyError: friendly.userMessage
    };

    if (generatedImageId) {
      await prisma.generatedImage.update({ where: { id: generatedImageId }, data: failedData }).catch(() => undefined);
    } else {
      await prisma.generatedImage.create({
        data: { ...ownerData, ...(slideId ? { slideId } : {}), ...(elementId ? { elementId } : {}), ...failedData, createdByUserId: owner.createdByUserId }
      });
    }
  }
}
