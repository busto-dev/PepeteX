import { loadConfig } from '@pepetex/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

import {
  expireReferenceFilesQueueName,
  designSystemGenerationRunQueueName,
  exportPdfQueueName,
  exportPptxQueueName,
  generationRunQueueName,
  imageGenerateQueueName,
  queueNames,
  thumbnailGenerateQueueName,
  type DesignSystemGenerationRunJobPayload,
  type ExpireReferenceFilesJobPayload,
  type ExportPdfJobPayload,
  type ExportPptxJobPayload,
  type GenerationRunJobPayload,
  type ImageGenerateJobPayload,
  type ThumbnailGenerateJobPayload
} from '@pepetex/queue';

import { runExportPdfJob } from './export-pdf';
import { runExportPptxJob } from './export-pptx';
import { runExpireReferenceFilesJob } from './reference-file-retention';
import { runGenerateThumbnailJob } from './thumbnail-generation';
import { runGenerationRunJob } from './generation-run';
import { runImageGenerateJob } from './image-generate';
import { runDesignSystemAgentRun } from './design-system-agent-run';

const config = loadConfig(process.env);
const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null
});

const expireReferenceFilesWorker = new Worker<ExpireReferenceFilesJobPayload>(
  expireReferenceFilesQueueName,
  async (job) => runExpireReferenceFilesJob(job.data),
  {
    connection: redisConnection
  }
);

const thumbnailGenerateWorker = new Worker<ThumbnailGenerateJobPayload>(
  thumbnailGenerateQueueName,
  async (job) => runGenerateThumbnailJob(job.data),
  {
    connection: redisConnection
  }
);

const exportPptxWorker = new Worker<ExportPptxJobPayload>(
  exportPptxQueueName,
  async (job) => runExportPptxJob(job.data),
  {
    connection: redisConnection,
    concurrency: 2
  }
);

const exportPdfWorker = new Worker<ExportPdfJobPayload>(
  exportPdfQueueName,
  async (job) => runExportPdfJob(job.data),
  {
    connection: redisConnection,
    concurrency: 2
  }
);

const generationRunWorker = new Worker<GenerationRunJobPayload>(
  generationRunQueueName,
  async (job) => runGenerationRunJob(job.data),
  {
    connection: redisConnection,
    concurrency: 2
  }
);

const imageGenerateWorker = new Worker<ImageGenerateJobPayload>(
  imageGenerateQueueName,
  async (job) => runImageGenerateJob(job.data),
  {
    connection: redisConnection,
    concurrency: 4
  }
);

const designSystemAgentRunWorker = new Worker<DesignSystemGenerationRunJobPayload>(
  designSystemGenerationRunQueueName,
  async (job) => runDesignSystemAgentRun(job.data),
  {
    connection: redisConnection,
    concurrency: 2
  }
);

console.log('PepeteX worker starting', {
  environment: config.nodeEnv,
  queues: queueNames,
  activeWorkers: [
    expireReferenceFilesQueueName,
    thumbnailGenerateQueueName,
    exportPptxQueueName,
    exportPdfQueueName,
    generationRunQueueName,
    imageGenerateQueueName,
    designSystemGenerationRunQueueName
  ]
});

expireReferenceFilesWorker.on('completed', (job, result) => {
  console.log('Reference-file cleanup job completed.', {
    jobId: job.id,
    result
  });
});

expireReferenceFilesWorker.on('failed', (job, error) => {
  console.error('Reference-file cleanup job failed.', {
    jobId: job?.id,
    error: error.message
  });
});

thumbnailGenerateWorker.on('completed', (job, result) => {
  console.log('Thumbnail generation job completed.', {
    jobId: job.id,
    result
  });
});

thumbnailGenerateWorker.on('failed', (job, error) => {
  console.error('Thumbnail generation job failed.', {
    jobId: job?.id,
    error: error.message
  });
});

exportPptxWorker.on('completed', (job, result) => {
  console.log('PPTX export job completed.', {
    jobId: job.id,
    exportedFileId: (result as { exportedFileId?: string })?.exportedFileId,
    sizeBytes: (result as { sizeBytes?: number })?.sizeBytes
  });
});

exportPptxWorker.on('failed', (job, error) => {
  console.error('PPTX export job failed.', {
    jobId: job?.id,
    error: error.message
  });
});

exportPdfWorker.on('completed', (job, result) => {
  console.log('PDF export job completed.', {
    jobId: job.id,
    exportedFileId: (result as { exportedFileId?: string })?.exportedFileId,
    sizeBytes: (result as { sizeBytes?: number })?.sizeBytes
  });
});

exportPdfWorker.on('failed', (job, error) => {
  console.error('PDF export job failed.', {
    jobId: job?.id,
    error: error.message
  });
});

generationRunWorker.on('completed', (job) => {
  console.log('GenerationRun job completed.', { jobId: job.id });
});

generationRunWorker.on('active', (job) => {
  console.log('GenerationRun job started.', {
    jobId: job.id,
    generationRunId: job.data.generationRunId,
    attemptsMade: job.attemptsMade
  });
});

generationRunWorker.on('stalled', (jobId) => {
  console.warn('GenerationRun job stalled; BullMQ will retry if attempts remain.', { jobId });
});

generationRunWorker.on('failed', (job, error) => {
  console.error('GenerationRun job failed.', {
    jobId: job?.id,
    error: error.message
  });
});

imageGenerateWorker.on('completed', (job) => {
  console.log('Image generate job completed.', { jobId: job.id });
});

imageGenerateWorker.on('failed', (job, error) => {
  console.error('Image generate job failed.', {
    jobId: job?.id,
    error: error.message
  });
});

designSystemAgentRunWorker.on('active', (job) => {
  console.log('Design system agent run started.', {
    jobId: job.id,
    designSystemGenerationRunId: job.data.designSystemGenerationRunId,
    attemptsMade: job.attemptsMade
  });
});

designSystemAgentRunWorker.on('completed', (job) => {
  console.log('Design system agent run completed.', { jobId: job.id });
});

designSystemAgentRunWorker.on('failed', (job, error) => {
  console.error('Design system agent run failed.', {
    jobId: job?.id,
    error: error.message
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await expireReferenceFilesWorker.close();
    await thumbnailGenerateWorker.close();
    await exportPptxWorker.close();
    await exportPdfWorker.close();
    await generationRunWorker.close();
    await imageGenerateWorker.close();
    await designSystemAgentRunWorker.close();
    await redisConnection.quit();
    process.exit(0);
  });
}
