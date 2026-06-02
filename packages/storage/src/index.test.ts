import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertAssetUpload,
  assertFontAssetUpload,
  assertReferenceFileUpload,
  createGCSStorageAdapter,
  createLocalFileStorageAdapter,
  extractAssetMetadata,
  extractFontAssetMetadata,
  extractReferenceFileMetadata,
  sanitizeSvg,
  type GCSStorageBucketLike,
  type GCSStorageClientLike,
  type GCSStorageFileLike,
  toManagedAssetUrl
} from './index';

describe('GCSStorageAdapter', () => {
  it('uploads objects and returns normalized metadata', async () => {
    const file = createMockFile({
      metadata: {
        size: '11',
        contentType: 'text/plain',
        generation: 7,
        etag: 'etag-1',
        metadata: {
          source: 'test'
        }
      }
    });
    const adapter = createGCSStorageAdapter({
      bucket: 'pepetex-assets',
      client: createMockClient(file)
    });

    const storedObject = await adapter.putObject({
      objectPath: '/decks/deck-1/hello.txt',
      body: 'hello world',
      contentType: 'text/plain',
      cacheControl: 'private, max-age=60',
      contentDisposition: 'inline',
      metadata: {
        source: 'test'
      }
    });

    expect(file.save).toHaveBeenCalledWith(Buffer.from('hello world'), {
      resumable: false,
      contentType: 'text/plain',
      metadata: {
        cacheControl: 'private, max-age=60',
        contentDisposition: 'inline',
        metadata: {
          source: 'test'
        }
      }
    });
    expect(storedObject).toEqual({
      bucket: 'pepetex-assets',
      objectPath: 'decks/deck-1/hello.txt',
      contentType: 'text/plain',
      sizeBytes: 11,
      generation: '7',
      etag: 'etag-1',
      metadata: {
        source: 'test'
      }
    });
  });

  it('deletes objects idempotently by default', async () => {
    const file = createMockFile();
    const adapter = createGCSStorageAdapter({
      bucket: 'pepetex-assets',
      client: createMockClient(file)
    });

    await adapter.deleteObject({
      objectPath: '/exports/deck-1.pptx'
    });

    expect(file.delete).toHaveBeenCalledWith({
      ignoreNotFound: true
    });
  });

  it('downloads objects and returns normalized metadata', async () => {
    const file = createMockFile({
      metadata: {
        size: '4',
        contentType: 'text/plain',
        generation: 8,
        etag: 'etag-2',
        metadata: {
          source: 'download-test'
        }
      },
      downloadBody: Buffer.from('test')
    });
    const adapter = createGCSStorageAdapter({
      bucket: 'pepetex-assets',
      client: createMockClient(file)
    });

    const object = await adapter.getObject({
      objectPath: '/decks/deck-1/references/test.txt'
    });

    expect(file.download).toHaveBeenCalledOnce();
    expect(object).toEqual({
      body: new Uint8Array(Buffer.from('test')),
      contentType: 'text/plain',
      sizeBytes: 4,
      generation: '8',
      etag: 'etag-2',
      metadata: {
        source: 'download-test'
      }
    });
  });

  it('can request strict deletes when needed', async () => {
    const file = createMockFile();
    const adapter = createGCSStorageAdapter({
      bucket: 'pepetex-assets',
      client: createMockClient(file)
    });

    await adapter.deleteObject({
      objectPath: 'exports/deck-1.pptx',
      ignoreIfMissing: false
    });

    expect(file.delete).toHaveBeenCalledWith({
      ignoreNotFound: false
    });
  });

  it('creates signed read URLs', async () => {
    const file = createMockFile({
      signedUrl: 'https://storage.example.com/signed-url'
    });
    const adapter = createGCSStorageAdapter({
      bucket: 'pepetex-assets',
      client: createMockClient(file)
    });
    const expiresAt = new Date('2026-04-30T00:00:00.000Z');

    const signedUrl = await adapter.createSignedReadUrl({
      objectPath: '/references/report.pdf',
      expiresAt
    });

    expect(file.getSignedUrl).toHaveBeenCalledWith({
      action: 'read',
      version: 'v4',
      expires: expiresAt
    });
    expect(signedUrl).toBe('https://storage.example.com/signed-url');
  });

  it('rejects empty bucket and object paths', async () => {
    expect(() =>
      createGCSStorageAdapter({
        bucket: '   ',
        client: createMockClient(createMockFile())
      })
    ).toThrow('GCS bucket must not be empty.');

    const adapter = createGCSStorageAdapter({
      bucket: 'pepetex-assets',
      client: createMockClient(createMockFile())
    });

    await expect(
      adapter.putObject({
        objectPath: '   ',
        body: 'x',
        contentType: 'text/plain'
      })
    ).rejects.toThrow('Object path must not be empty.');
  });
});

describe('LocalFileStorageAdapter', () => {
  it('stores, reads, signs, and deletes objects on disk', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pepetex-storage-'));

    try {
      const adapter = createLocalFileStorageAdapter({
        bucket: 'local-dev',
        rootDir
      });

      const storedObject = await adapter.putObject({
        objectPath: '/exports/deck-1.pptx',
        body: 'pptx-bytes',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        metadata: { source: 'unit-test' }
      });

      expect(storedObject).toMatchObject({
        bucket: 'local-dev',
        objectPath: 'exports/deck-1.pptx',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sizeBytes: 10,
        metadata: { source: 'unit-test' }
      });
      expect(storedObject.etag).toEqual(expect.any(String));

      const object = await adapter.getObject({ objectPath: 'exports/deck-1.pptx' });
      expect(Buffer.from(object.body).toString()).toBe('pptx-bytes');
      expect(object.metadata).toEqual({ source: 'unit-test' });

      const dataUrl = await adapter.createSignedReadUrl({
        objectPath: 'exports/deck-1.pptx',
        expiresAt: new Date(Date.now() + 60_000)
      });
      expect(dataUrl).toContain('base64');

      await adapter.deleteObject({ objectPath: 'exports/deck-1.pptx' });
      await expect(adapter.getObject({ objectPath: 'exports/deck-1.pptx' })).rejects.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('toManagedAssetUrl', () => {
  it('builds app-managed asset URLs', () => {
    expect(
      toManagedAssetUrl('https://app.example.com/', {
        id: 'asset_1',
        bucket: 'pepetex-assets',
        objectPath: 'references/report.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024
      })
    ).toBe('https://app.example.com/assets/asset_1');
  });
});

describe('reference file helpers', () => {
  it('accepts supported uploads within the configured size limit', () => {
    expect(
      assertReferenceFileUpload({
        filename: 'report.PDF',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        maxSizeBytes: 2048
      })
    ).toEqual({
      originalFilename: 'report.PDF',
      sizeBytes: 1024
    });
  });

  it('rejects unsupported or oversized uploads', () => {
    expect(() =>
      assertReferenceFileUpload({
        filename: 'malware.exe',
        mimeType: 'application/octet-stream',
        sizeBytes: 10,
        maxSizeBytes: 1024
      })
    ).toThrow('PepeteX supports only PDF, TXT, Markdown, CSV, PNG, JPG, and WebP reference files.');

    expect(() =>
      assertReferenceFileUpload({
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        maxSizeBytes: 2048
      })
    ).toThrow('Uploaded file exceeds the maximum allowed size of 2 KB.');
  });

  it('extracts image metadata with normalized mime and extension output', async () => {
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
      0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00,
      0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78,
      0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00, 0x03, 0x03, 0x02, 0x00, 0xef, 0xef, 0xf5, 0x7d,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
    ]);

    await expect(
      extractReferenceFileMetadata({
        filename: 'diagram.png',
        mimeType: 'image/png',
        body: pngBytes
      })
    ).resolves.toEqual({
      originalFilename: 'diagram.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: pngBytes.byteLength,
      imageWidth: 1,
      imageHeight: 1
    });
  });

  it('extracts PDF page-count metadata', async () => {
    const document = await PDFDocument.create();
    document.addPage([300, 144]);
    const pdfBytes = await document.save();

    await expect(
      extractReferenceFileMetadata({
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        body: pdfBytes
      })
    ).resolves.toEqual({
      originalFilename: 'report.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: pdfBytes.byteLength,
      pageCount: 1
    });
  });
});

function createMockClient(file: GCSStorageFileLike): GCSStorageClientLike {
  const bucket: GCSStorageBucketLike = {
    name: 'pepetex-assets',
    file: vi.fn().mockReturnValue(file)
  };

  return {
    bucket: vi.fn().mockReturnValue(bucket)
  };
}

describe('assertAssetUpload', () => {
  it('accepts png, jpg, webp, and svg files', () => {
    expect(() => assertAssetUpload({ filename: 'image.png', mimeType: 'image/png', sizeBytes: 100, maxSizeBytes: 1000 })).not.toThrow();
    expect(() => assertAssetUpload({ filename: 'image.jpg', mimeType: 'image/jpeg', sizeBytes: 100, maxSizeBytes: 1000 })).not.toThrow();
    expect(() => assertAssetUpload({ filename: 'image.webp', mimeType: 'image/webp', sizeBytes: 100, maxSizeBytes: 1000 })).not.toThrow();
    expect(() => assertAssetUpload({ filename: 'icon.svg', mimeType: 'image/svg+xml', sizeBytes: 100, maxSizeBytes: 1000 })).not.toThrow();
  });

  it('rejects pdf and other non-asset file types', () => {
    expect(() => assertAssetUpload({ filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 100, maxSizeBytes: 1000 })).toThrow('PepeteX assets support only PNG, JPG, WebP, and SVG files.');
    expect(() => assertAssetUpload({ filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 100, maxSizeBytes: 1000 })).toThrow('PepeteX assets support only PNG, JPG, WebP, and SVG files.');
  });
});

describe('font asset helpers', () => {
  it('accepts supported font files without allowing them through image assets', async () => {
    expect(() =>
      assertFontAssetUpload({
        filename: 'BrandSans.woff2',
        mimeType: 'font/woff2',
        sizeBytes: 100,
        maxSizeBytes: 1000
      })
    ).not.toThrow();

    expect(() =>
      assertFontAssetUpload({
        filename: 'BrandSerif.otf',
        mimeType: 'application/vnd.ms-opentype',
        sizeBytes: 100,
        maxSizeBytes: 1000
      })
    ).not.toThrow();

    expect(() =>
      assertAssetUpload({
        filename: 'BrandSans.woff2',
        mimeType: 'font/woff2',
        sizeBytes: 100,
        maxSizeBytes: 1000
      })
    ).toThrow('PepeteX assets support only PNG, JPG, WebP, and SVG files.');

    await expect(
      extractFontAssetMetadata({
        filename: 'BrandSans.woff2',
        mimeType: 'font/woff2',
        body: Uint8Array.from([1, 2, 3])
      })
    ).resolves.toEqual({
      originalFilename: 'BrandSans.woff2',
      mimeType: 'font/woff2',
      extension: 'woff2',
      sizeBytes: 3,
      body: Uint8Array.from([1, 2, 3])
    });
  });
});

describe('sanitizeSvg', () => {
  it('strips script tags', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script><rect width="100" height="100"/></svg>`;
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
    expect(result).toContain('<rect');
  });

  it('strips event handler attributes', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('xss')"><rect width="100" height="100"/></svg>`;
    const result = sanitizeSvg(input);
    expect(result).not.toContain('onload');
    expect(result).toContain('<rect');
  });

  it('strips foreignObject elements', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert('xss')</script></body></foreignObject></svg>`;
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<foreignObject');
  });

  it('strips javascript hrefs', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert('xss')"><rect width="100" height="100"/></a></svg>`;
    const result = sanitizeSvg(input);
    expect(result).not.toContain('javascript:');
  });

  it('strips style tags', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg"><style>body { background: url('evil') }</style><rect width="100" height="100"/></svg>`;
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<style');
    expect(result).toContain('<rect');
  });
});

describe('extractAssetMetadata', () => {
  it('extracts dimensions from an SVG with width and height', async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect/></svg>`, 'utf8');
    const meta = await extractAssetMetadata({ filename: 'icon.svg', mimeType: 'image/svg+xml', body: svg });
    expect(meta.extension).toBe('svg');
    expect(meta.imageWidth).toBe(120);
    expect(meta.imageHeight).toBe(80);
  });

  it('extracts dimensions from an SVG with viewBox only', async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect/></svg>`, 'utf8');
    const meta = await extractAssetMetadata({ filename: 'icon.svg', mimeType: 'image/svg+xml', body: svg });
    expect(meta.imageWidth).toBe(1920);
    expect(meta.imageHeight).toBe(1080);
  });
});

function createMockFile(input: {
  metadata?: Awaited<ReturnType<GCSStorageFileLike['getMetadata']>>[0];
  signedUrl?: string;
  downloadBody?: Buffer;
} = {}): GCSStorageFileLike & {
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  getMetadata: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  getSignedUrl: ReturnType<typeof vi.fn>;
} {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue([input.metadata ?? {}]),
    download: vi.fn().mockResolvedValue([input.downloadBody ?? Buffer.from('')]),
    getSignedUrl: vi.fn().mockResolvedValue([input.signedUrl ?? 'https://example.com/signed'])
  };
}
