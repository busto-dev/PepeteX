import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { Storage } from '@google-cloud/storage';
import { imageSize } from 'image-size';
import { PDFDocument } from 'pdf-lib';

type StorageConstructorOptions = NonNullable<ConstructorParameters<typeof Storage>[0]>;

export interface StoredObject {
  bucket: string;
  objectPath: string;
  contentType: string;
  sizeBytes: number;
  generation?: string;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface StoredAsset extends StoredObject {
  id: string;
}

export interface PutObjectInput {
  objectPath: string;
  body: string | Uint8Array | ArrayBuffer;
  contentType: string;
  cacheControl?: string;
  contentDisposition?: string;
  metadata?: Record<string, string>;
}

export interface DeleteObjectInput {
  objectPath: string;
  ignoreIfMissing?: boolean;
}

export interface CreateSignedReadUrlInput {
  objectPath: string;
  expiresAt: Date;
}

export interface GetObjectInput {
  objectPath: string;
}

export interface RetrievedObject {
  body: Uint8Array;
  contentType: string | null;
  sizeBytes: number;
  generation?: string;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface ObjectStorageAdapter {
  readonly kind: 'gcs' | 'local';
  readonly bucket: string;
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(input: GetObjectInput): Promise<RetrievedObject>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  createSignedReadUrl(input: CreateSignedReadUrlInput): Promise<string>;
}

export interface GCSStorageAdapterOptions {
  bucket: string;
  projectId?: string;
  apiEndpoint?: string;
  keyFilename?: string;
  credentials?: StorageConstructorOptions['credentials'];
  client?: GCSStorageClientLike;
}

export interface LocalFileStorageAdapterOptions {
  bucket: string;
  rootDir: string;
}

export type ObjectStorageAdapterOptions =
  | ({ kind?: 'gcs' } & GCSStorageAdapterOptions)
  | ({ kind: 'local' } & LocalFileStorageAdapterOptions);

export interface GCSStorageClientLike {
  bucket(name: string): GCSStorageBucketLike;
}

export interface GCSStorageBucketLike {
  readonly name: string;
  file(path: string): GCSStorageFileLike;
}

export interface GCSStorageFileLike {
  save(
    data: Buffer,
    options?: {
      resumable?: boolean;
      contentType?: string;
      metadata?: {
        cacheControl?: string;
        contentDisposition?: string;
        metadata?: Record<string, string>;
      };
    }
  ): Promise<void>;
  delete(options?: {
    ignoreNotFound?: boolean;
  }): Promise<unknown>;
  getMetadata(): Promise<[GCSStoredObjectMetadata, ...unknown[]]>;
  download(): Promise<[Buffer]>;
  getSignedUrl(options: {
    action: 'read';
    version: 'v4';
    expires: Date;
  }): Promise<[string]>;
}

export interface GCSStoredObjectMetadata {
  size?: string | number;
  contentType?: string;
  generation?: string | number;
  etag?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReferenceFileUploadInput {
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  maxSizeBytes: number;
}

export interface ExtractReferenceFileMetadataInput {
  filename: string;
  mimeType?: string;
  body: Uint8Array | ArrayBuffer;
}

export interface ReferenceFileMetadata {
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  pageCount?: number;
  imageWidth?: number;
  imageHeight?: number;
}

type SupportedReferenceFileType = {
  extension: string;
  mimeType: string;
  alternateMimeTypes?: string[];
  extractMetadata?: (buffer: Buffer) => Promise<Partial<ReferenceFileMetadata>>;
};

const SUPPORTED_REFERENCE_FILE_TYPES: readonly SupportedReferenceFileType[] = [
  {
    extension: 'pdf',
    mimeType: 'application/pdf',
    extractMetadata: async (buffer) => {
      const document = await PDFDocument.load(buffer);

      return {
        pageCount: document.getPageCount()
      };
    }
  },
  {
    extension: 'txt',
    mimeType: 'text/plain'
  },
  {
    extension: 'md',
    mimeType: 'text/markdown',
    alternateMimeTypes: ['text/x-markdown']
  },
  {
    extension: 'markdown',
    mimeType: 'text/markdown',
    alternateMimeTypes: ['text/x-markdown']
  },
  {
    extension: 'csv',
    mimeType: 'text/csv',
    alternateMimeTypes: ['application/csv', 'application/vnd.ms-excel']
  },
  {
    extension: 'png',
    mimeType: 'image/png',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'webp',
    mimeType: 'image/webp',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  }
] as const;

const SUPPORTED_ASSET_FILE_TYPES: readonly SupportedReferenceFileType[] = [
  {
    extension: 'png',
    mimeType: 'image/png',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'webp',
    mimeType: 'image/webp',
    extractMetadata: async (buffer) => extractImageDimensions(buffer)
  },
  {
    extension: 'svg',
    mimeType: 'image/svg+xml',
    extractMetadata: async (buffer) => extractSvgDimensions(buffer)
  }
] as const;

const SUPPORTED_FONT_FILE_TYPES: readonly SupportedReferenceFileType[] = [
  {
    extension: 'ttf',
    mimeType: 'font/ttf',
    alternateMimeTypes: ['application/x-font-ttf', 'application/font-sfnt']
  },
  {
    extension: 'otf',
    mimeType: 'font/otf',
    alternateMimeTypes: ['application/x-font-otf', 'application/vnd.ms-opentype', 'application/font-sfnt']
  },
  {
    extension: 'woff',
    mimeType: 'font/woff',
    alternateMimeTypes: ['application/font-woff', 'application/x-font-woff']
  },
  {
    extension: 'woff2',
    mimeType: 'font/woff2',
    alternateMimeTypes: ['application/font-woff2', 'application/x-font-woff2']
  }
] as const;

export class GCSStorageAdapter implements ObjectStorageAdapter {
  readonly kind = 'gcs';
  readonly bucket: string;

  private readonly bucketHandle: GCSStorageBucketLike;

  constructor(options: GCSStorageAdapterOptions) {
    const bucket = normalizeRequiredText(options.bucket, 'GCS bucket');
    const client =
      options.client ??
      new Storage({
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.apiEndpoint ? { apiEndpoint: options.apiEndpoint } : {}),
        ...(options.keyFilename ? { keyFilename: options.keyFilename } : {}),
        ...(options.credentials ? { credentials: options.credentials } : {})
      });

    this.bucket = bucket;
    this.bucketHandle = client.bucket(bucket);
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const objectPath = normalizeObjectPath(input.objectPath);
    const contentType = normalizeRequiredText(input.contentType, 'Object content type');
    const body = toBuffer(input.body);
    const file = this.bucketHandle.file(objectPath);

    await file.save(body, {
      resumable: false,
      contentType,
      metadata: {
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
        ...(input.contentDisposition
          ? { contentDisposition: input.contentDisposition }
          : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
      }
    });

    const [metadata] = await file.getMetadata();
    const normalizedMetadata = normalizeStoredObjectMetadata(metadata.metadata);

    return {
      bucket: this.bucket,
      objectPath,
      contentType: normalizeOptionalText(metadata.contentType) ?? contentType,
      sizeBytes: parseStoredObjectSize(metadata.size) ?? body.byteLength,
      ...(metadata.generation !== undefined
        ? { generation: String(metadata.generation) }
        : {}),
      ...(normalizeOptionalText(metadata.etag) ? { etag: metadata.etag } : {}),
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {})
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    const objectPath = normalizeObjectPath(input.objectPath);

    await this.bucketHandle.file(objectPath).delete({
      ignoreNotFound: input.ignoreIfMissing ?? true
    });
  }

  async getObject(input: GetObjectInput): Promise<RetrievedObject> {
    const objectPath = normalizeObjectPath(input.objectPath);
    const file = this.bucketHandle.file(objectPath);
    const [[body], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const normalizedMetadata = normalizeStoredObjectMetadata(metadata.metadata);

    return {
      body: new Uint8Array(body),
      contentType: normalizeOptionalText(metadata.contentType) ?? null,
      sizeBytes: parseStoredObjectSize(metadata.size) ?? body.byteLength,
      ...(metadata.generation !== undefined
        ? { generation: String(metadata.generation) }
        : {}),
      ...(normalizeOptionalText(metadata.etag) ? { etag: metadata.etag } : {}),
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {})
    };
  }

  async createSignedReadUrl(input: CreateSignedReadUrlInput): Promise<string> {
    const objectPath = normalizeObjectPath(input.objectPath);

    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
      throw new Error('Signed URL expiry must be a valid Date.');
    }

    const [signedUrl] = await this.bucketHandle.file(objectPath).getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: input.expiresAt
    });

    return signedUrl;
  }
}

export function createGCSStorageAdapter(options: GCSStorageAdapterOptions): GCSStorageAdapter {
  return new GCSStorageAdapter(options);
}

export class LocalFileStorageAdapter implements ObjectStorageAdapter {
  readonly kind = 'local';
  readonly bucket: string;

  private readonly bucketRootDir: string;

  constructor(options: LocalFileStorageAdapterOptions) {
    this.bucket = normalizeRequiredText(options.bucket, 'Storage bucket');
    const rootDir = normalizeRequiredText(options.rootDir, 'Local storage root');
    this.bucketRootDir = resolve(rootDir, this.bucket);
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const objectPath = normalizeObjectPath(input.objectPath);
    const contentType = normalizeRequiredText(input.contentType, 'Object content type');
    const body = toBuffer(input.body);
    const filePath = this.resolveObjectFilePath(objectPath);
    const metadataPath = this.resolveMetadataFilePath(objectPath);
    const metadata = {
      contentType,
      sizeBytes: body.byteLength,
      etag: createHash('sha256').update(body).digest('hex'),
      metadata: input.metadata ?? {},
      cacheControl: input.cacheControl ?? null,
      contentDisposition: input.contentDisposition ?? null,
      updatedAt: new Date().toISOString()
    };

    await mkdir(dirname(filePath), { recursive: true });
    await mkdir(dirname(metadataPath), { recursive: true });
    await Promise.all([
      writeFile(filePath, body),
      writeFile(metadataPath, JSON.stringify(metadata, null, 2))
    ]);

    return {
      bucket: this.bucket,
      objectPath,
      contentType,
      sizeBytes: body.byteLength,
      etag: metadata.etag,
      ...(input.metadata ? { metadata: input.metadata } : {})
    };
  }

  async getObject(input: GetObjectInput): Promise<RetrievedObject> {
    const objectPath = normalizeObjectPath(input.objectPath);
    const filePath = this.resolveObjectFilePath(objectPath);
    const [body, fileStat, metadata] = await Promise.all([
      readFile(filePath),
      stat(filePath),
      this.readMetadata(objectPath)
    ]);
    const normalizedMetadata = normalizeStoredObjectMetadata(metadata?.metadata);

    return {
      body: new Uint8Array(body),
      contentType: metadata?.contentType ?? null,
      sizeBytes: metadata?.sizeBytes ?? fileStat.size,
      ...(metadata?.etag ? { etag: metadata.etag } : {}),
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {})
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    const objectPath = normalizeObjectPath(input.objectPath);
    const filePath = this.resolveObjectFilePath(objectPath);
    const metadataPath = this.resolveMetadataFilePath(objectPath);
    const ignoreIfMissing = input.ignoreIfMissing ?? true;

    await Promise.all([
      unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (ignoreIfMissing && error.code === 'ENOENT') return;
        throw error;
      }),
      unlink(metadataPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return;
        throw error;
      })
    ]);
  }

  async createSignedReadUrl(input: CreateSignedReadUrlInput): Promise<string> {
    const object = await this.getObject({ objectPath: input.objectPath });
    const contentType = object.contentType ?? 'application/octet-stream';
    const base64 = Buffer.from(object.body).toString('base64');

    return `data:${contentType};base64,${base64}`;
  }

  private resolveObjectFilePath(objectPath: string): string {
    return resolvePathInside(this.bucketRootDir, objectPath);
  }

  private resolveMetadataFilePath(objectPath: string): string {
    return resolvePathInside(this.bucketRootDir, `.metadata/${objectPath}.json`);
  }

  private async readMetadata(objectPath: string): Promise<LocalStoredObjectMetadata | null> {
    try {
      const raw = await readFile(this.resolveMetadataFilePath(objectPath), 'utf8');
      const parsed = JSON.parse(raw) as Partial<LocalStoredObjectMetadata>;

      const metadata: LocalStoredObjectMetadata = {
        contentType: typeof parsed.contentType === 'string' ? parsed.contentType : null
      };

      if (typeof parsed.sizeBytes === 'number') metadata.sizeBytes = parsed.sizeBytes;
      if (typeof parsed.etag === 'string') metadata.etag = parsed.etag;
      if (parsed.metadata && typeof parsed.metadata === 'object') {
        metadata.metadata = parsed.metadata as Record<string, string | number | boolean | null>;
      }

      return metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

export function createLocalFileStorageAdapter(
  options: LocalFileStorageAdapterOptions
): LocalFileStorageAdapter {
  return new LocalFileStorageAdapter(options);
}

export function createObjectStorageAdapter(
  options: ObjectStorageAdapterOptions
): ObjectStorageAdapter {
  if (options.kind === 'local') {
    return createLocalFileStorageAdapter(options);
  }

  const { kind: _kind, ...gcsOptions } = options;
  return createGCSStorageAdapter(gcsOptions);
}

export function toManagedAssetUrl(host: string, asset: StoredAsset): string {
  return `${host.replace(/\/$/, '')}/assets/${asset.id}`;
}

export function assertReferenceFileUpload(input: ReferenceFileUploadInput): {
  originalFilename: string;
  sizeBytes: number;
} {
  const originalFilename = normalizeFilename(input.filename);

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error('Uploaded files must not be empty.');
  }

  if (!Number.isSafeInteger(input.maxSizeBytes) || input.maxSizeBytes <= 0) {
    throw new Error('Upload size limit must be a positive integer.');
  }

  if (input.sizeBytes > input.maxSizeBytes) {
    throw new Error(
      `Uploaded file exceeds the maximum allowed size of ${formatBytes(input.maxSizeBytes)}.`
    );
  }

  resolveSupportedReferenceFileType(originalFilename, input.mimeType);

  return {
    originalFilename,
    sizeBytes: input.sizeBytes
  };
}

export async function extractReferenceFileMetadata(
  input: ExtractReferenceFileMetadataInput
): Promise<ReferenceFileMetadata> {
  const originalFilename = normalizeFilename(input.filename);
  const body = toBuffer(input.body);
  const supportedType = resolveSupportedReferenceFileType(originalFilename, input.mimeType);
  const metadata = supportedType.extractMetadata
    ? await supportedType.extractMetadata(body)
    : undefined;

  return {
    originalFilename,
    mimeType: supportedType.mimeType,
    extension: supportedType.extension,
    sizeBytes: body.byteLength,
    ...(metadata?.pageCount !== undefined ? { pageCount: metadata.pageCount } : {}),
    ...(metadata?.imageWidth !== undefined ? { imageWidth: metadata.imageWidth } : {}),
    ...(metadata?.imageHeight !== undefined ? { imageHeight: metadata.imageHeight } : {})
  };
}

export function assertAssetUpload(input: ReferenceFileUploadInput): {
  originalFilename: string;
  sizeBytes: number;
} {
  const originalFilename = normalizeFilename(input.filename);

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error('Uploaded files must not be empty.');
  }

  if (!Number.isSafeInteger(input.maxSizeBytes) || input.maxSizeBytes <= 0) {
    throw new Error('Upload size limit must be a positive integer.');
  }

  if (input.sizeBytes > input.maxSizeBytes) {
    throw new Error(
      `Uploaded file exceeds the maximum allowed size of ${formatBytes(input.maxSizeBytes)}.`
    );
  }

  resolveSupportedAssetFileType(originalFilename, input.mimeType);

  return {
    originalFilename,
    sizeBytes: input.sizeBytes
  };
}

export interface ExtractAssetMetadataInput {
  filename: string;
  mimeType?: string;
  body: Uint8Array | ArrayBuffer;
}

export interface AssetMetadata extends ReferenceFileMetadata {
  body: Uint8Array;
}

export async function extractAssetMetadata(
  input: ExtractAssetMetadataInput
): Promise<AssetMetadata> {
  const originalFilename = normalizeFilename(input.filename);
  let body = toBuffer(input.body);
  const supportedType = resolveSupportedAssetFileType(originalFilename, input.mimeType);

  if (supportedType.extension === 'svg') {
    const sanitized = sanitizeSvg(body.toString('utf8'));
    body = Buffer.from(sanitized, 'utf8');
  }

  const metadata = supportedType.extractMetadata
    ? await supportedType.extractMetadata(body)
    : undefined;

  return {
    originalFilename,
    mimeType: supportedType.mimeType,
    extension: supportedType.extension,
    sizeBytes: body.byteLength,
    body: new Uint8Array(body),
    ...(metadata?.pageCount !== undefined ? { pageCount: metadata.pageCount } : {}),
    ...(metadata?.imageWidth !== undefined ? { imageWidth: metadata.imageWidth } : {}),
    ...(metadata?.imageHeight !== undefined ? { imageHeight: metadata.imageHeight } : {})
  };
}

export function assertFontAssetUpload(input: ReferenceFileUploadInput): {
  originalFilename: string;
  sizeBytes: number;
} {
  const originalFilename = normalizeFilename(input.filename);

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error('Uploaded files must not be empty.');
  }

  if (!Number.isSafeInteger(input.maxSizeBytes) || input.maxSizeBytes <= 0) {
    throw new Error('Upload size limit must be a positive integer.');
  }

  if (input.sizeBytes > input.maxSizeBytes) {
    throw new Error(
      `Uploaded file exceeds the maximum allowed size of ${formatBytes(input.maxSizeBytes)}.`
    );
  }

  resolveSupportedFontFileType(originalFilename, input.mimeType);

  return {
    originalFilename,
    sizeBytes: input.sizeBytes
  };
}

export async function extractFontAssetMetadata(
  input: ExtractAssetMetadataInput
): Promise<AssetMetadata> {
  const originalFilename = normalizeFilename(input.filename);
  const body = toBuffer(input.body);
  const supportedType = resolveSupportedFontFileType(originalFilename, input.mimeType);

  return {
    originalFilename,
    mimeType: supportedType.mimeType,
    extension: supportedType.extension,
    sizeBytes: body.byteLength,
    body: new Uint8Array(body)
  };
}

export function sanitizeSvg(svgText: string): string {
  // Strip XML comments
  let sanitized = svgText.replace(/<!--[\s\S]*?-->/g, '');

  // Strip <script> elements and their contents
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // Strip <foreignObject> elements and their contents
  sanitized = sanitized.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '');

  // Remove event handler attributes (onload, onclick, etc.)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  // Remove javascript: and data:text/html hrefs / xlink:href
  sanitized = sanitized.replace(
    /(\s+(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*')/gi,
    (_match, prefix, value) => {
      const raw = value.slice(1, -1).trim().toLowerCase();
      if (raw.startsWith('javascript:') || raw.startsWith('data:text/html')) {
        return `${prefix}""`;
      }
      return `${prefix}${value}`;
    }
  );

  // Remove <style> tags (inline CSS can contain dangerous urls/expressions)
  sanitized = sanitized.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  return sanitized;
}

function normalizeObjectPath(value: string): string {
  const normalized = normalizeRequiredText(value, 'Object path').replace(/^\/+/, '');

  if (!normalized) {
    throw new Error('Object path must not be empty.');
  }

  return normalized;
}

function normalizeFilename(value: string): string {
  const normalized = normalizeRequiredText(value, 'Filename')
    .split(/[\\/]/)
    .pop()
    ?.trim();

  if (!normalized) {
    throw new Error('Filename must not be empty.');
  }

  return normalized;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function parseStoredObjectSize(value: string | number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function normalizeStoredObjectMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }

  const normalizedEntries = Object.entries(metadata)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => [key, String(value)] as const);

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

interface LocalStoredObjectMetadata {
  contentType: string | null;
  sizeBytes?: number;
  etag?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function resolvePathInside(rootDir: string, objectPath: string): string {
  const resolvedRoot = resolve(rootDir);
  const resolvedPath = resolve(resolvedRoot, objectPath);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Object path must stay within the storage root.');
  }

  return resolvedPath;
}

function toBuffer(value: string | Uint8Array | ArrayBuffer): Buffer {
  if (typeof value === 'string') {
    return Buffer.from(value);
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  return Buffer.from(value);
}

function resolveSupportedReferenceFileType(
  filename: string,
  mimeType: string | undefined
): SupportedReferenceFileType {
  const extension = getFilenameExtension(filename);
  const normalizedMimeType = normalizeMimeType(mimeType);
  const byExtension = extension
    ? SUPPORTED_REFERENCE_FILE_TYPES.find((entry) => entry.extension === extension)
    : undefined;
  const byMimeType = normalizedMimeType
    ? SUPPORTED_REFERENCE_FILE_TYPES.find((entry) => matchesMimeType(entry, normalizedMimeType))
    : undefined;

  if (byExtension && byMimeType && byExtension.mimeType !== byMimeType.mimeType) {
    throw new Error('Uploaded file type does not match its filename extension.');
  }

  const resolved = byExtension ?? byMimeType;

  if (!resolved) {
    throw new Error(
      'PepeteX supports only PDF, TXT, Markdown, CSV, PNG, JPG, and WebP reference files.'
    );
  }

  return resolved;
}

function getFilenameExtension(filename: string): string | null {
  const lastDotIndex = filename.lastIndexOf('.');

  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
    return null;
  }

  return filename.slice(lastDotIndex + 1).trim().toLowerCase();
}

function normalizeMimeType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  return normalized.split(';', 1)[0];
}

function matchesMimeType(
  supportedType: SupportedReferenceFileType,
  mimeType: string
): boolean {
  return (
    supportedType.mimeType === mimeType ||
    supportedType.alternateMimeTypes?.includes(mimeType) === true
  );
}

async function extractImageDimensions(buffer: Buffer): Promise<Partial<ReferenceFileMetadata>> {
  const dimensions = imageSize(buffer);

  return {
    ...(dimensions.width !== undefined ? { imageWidth: dimensions.width } : {}),
    ...(dimensions.height !== undefined ? { imageHeight: dimensions.height } : {})
  };
}

async function extractSvgDimensions(buffer: Buffer): Promise<Partial<ReferenceFileMetadata>> {
  const text = buffer.toString('utf8');
  const widthMatch = /\swidth\s*=\s*["']([^"']+)["']/i.exec(text);
  const heightMatch = /\sheight\s*=\s*["']([^"']+)["']/i.exec(text);
  const viewBoxMatch = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(text);

  let width: number | undefined;
  let height: number | undefined;

  if (widthMatch && typeof widthMatch[1] === 'string') {
    const parsed = Number.parseFloat(widthMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) width = Math.round(parsed);
  }
  if (heightMatch && typeof heightMatch[1] === 'string') {
    const parsed = Number.parseFloat(heightMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) height = Math.round(parsed);
  }

  if ((!width || !height) && viewBoxMatch && typeof viewBoxMatch[1] === 'string') {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const vbWidth = Number.parseFloat(parts[2] ?? '');
      const vbHeight = Number.parseFloat(parts[3] ?? '');
      if (Number.isFinite(vbWidth) && vbWidth > 0) width = Math.round(vbWidth);
      if (Number.isFinite(vbHeight) && vbHeight > 0) height = Math.round(vbHeight);
    }
  }

  return {
    ...(width !== undefined ? { imageWidth: width } : {}),
    ...(height !== undefined ? { imageHeight: height } : {})
  };
}

function resolveSupportedAssetFileType(
  filename: string,
  mimeType: string | undefined
): SupportedReferenceFileType {
  const extension = getFilenameExtension(filename);
  const normalizedMimeType = normalizeMimeType(mimeType);
  const byExtension = extension
    ? SUPPORTED_ASSET_FILE_TYPES.find((entry) => entry.extension === extension)
    : undefined;
  const byMimeType = normalizedMimeType
    ? SUPPORTED_ASSET_FILE_TYPES.find((entry) => matchesMimeType(entry, normalizedMimeType))
    : undefined;

  if (byExtension && byMimeType && byExtension.mimeType !== byMimeType.mimeType) {
    throw new Error('Uploaded file type does not match its filename extension.');
  }

  const resolved = byExtension ?? byMimeType;

  if (!resolved) {
    throw new Error(
      'PepeteX assets support only PNG, JPG, WebP, and SVG files.'
    );
  }

  return resolved;
}

function resolveSupportedFontFileType(
  filename: string,
  mimeType: string | undefined
): SupportedReferenceFileType {
  const extension = getFilenameExtension(filename);
  const normalizedMimeType = normalizeMimeType(mimeType);
  const byExtension = extension
    ? SUPPORTED_FONT_FILE_TYPES.find((entry) => entry.extension === extension)
    : undefined;
  const byMimeType = normalizedMimeType
    ? SUPPORTED_FONT_FILE_TYPES.find((entry) => matchesMimeType(entry, normalizedMimeType))
    : undefined;

  if (byExtension && byMimeType && byExtension.mimeType !== byMimeType.mimeType) {
    throw new Error('Uploaded file type does not match its filename extension.');
  }

  const resolved = byExtension ?? byMimeType;

  if (!resolved) {
    throw new Error(
      'PepeteX font assets support only TTF, OTF, WOFF, and WOFF2 files.'
    );
  }

  return resolved;
}

function formatBytes(value: number): string {
  if (value % (1024 * 1024) === 0) {
    return `${value / (1024 * 1024)} MB`;
  }

  if (value % 1024 === 0) {
    return `${value / 1024} KB`;
  }

  return `${value} bytes`;
}
