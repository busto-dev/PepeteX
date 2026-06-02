import {
  createObjectStorageAdapter,
  type ObjectStorageAdapter
} from '@pepetex/storage';

export function getCachedObjectStorageAdapter(bucket: string): ObjectStorageAdapter {
  const globalObject = globalThis as typeof globalThis & {
    __pepetexObjectStorageAdapters?: Map<string, ObjectStorageAdapter>;
  };
  const normalizedBucket = bucket.trim();

  if (!normalizedBucket) {
    throw new Error('Object storage bucket must not be empty.');
  }

  if (!globalObject.__pepetexObjectStorageAdapters) {
    globalObject.__pepetexObjectStorageAdapters = new Map();
  }

  const existingAdapter = globalObject.__pepetexObjectStorageAdapters.get(normalizedBucket);

  if (existingAdapter) {
    return existingAdapter;
  }

  const adapter = createConfiguredObjectStorageAdapter(normalizedBucket);

  globalObject.__pepetexObjectStorageAdapters.set(normalizedBucket, adapter);

  return adapter;
}

function createConfiguredObjectStorageAdapter(bucket: string): ObjectStorageAdapter {
  const driver = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase();

  if (driver === 'local' || driver === 'filesystem') {
    return createObjectStorageAdapter({
      kind: 'local',
      bucket,
      rootDir: process.env.LOCAL_OBJECT_STORAGE_ROOT?.trim() || '/data/pepetex-storage'
    });
  }

  return createObjectStorageAdapter({
    kind: 'gcs',
    bucket
  });
}
