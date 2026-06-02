import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadConfig } from './index';

describe('loadConfig', () => {
  it('returns validated defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      databaseUrl: 'postgresql://pepetex:pepetex@localhost:5435/pepetex',
      redisUrl: 'redis://localhost:6379',
      gcsBucket: 'pepetex-dev',
      appUrl: 'http://localhost:3000',
      maxUploadFileBytes: 30 * 1024 * 1024,
      referenceFileRetentionDays: 30,
      maxImagesPerDeck: 5,
      disableExternalTelemetry: false
    });
  });

  it('maps optional admin seed fields', () => {
    expect(
      loadConfig({
        PROVIDER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
        FIRST_ADMIN_EMAIL: 'admin@example.com',
        FIRST_ADMIN_NAME: 'PepeteX Admin',
        FIRST_ADMIN_PASSWORD_HASH: 'hashed-secret',
        MAX_UPLOAD_FILE_BYTES: '5242880',
        REFERENCE_FILE_RETENTION_DAYS: '14'
      })
    ).toMatchObject({
      providerCredentialEncryptionKey: Buffer.alloc(32, 3).toString('base64'),
      firstAdminEmail: 'admin@example.com',
      firstAdminName: 'PepeteX Admin',
      firstAdminPasswordHash: 'hashed-secret',
      maxUploadFileBytes: 5_242_880,
      referenceFileRetentionDays: 14
    });
  });

  it('rejects invalid provider credential encryption keys', () => {
    expect(() =>
      loadConfig({
        PROVIDER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16, 9).toString('base64')
      })
    ).toThrow(ConfigValidationError);
  });

  it('throws for invalid values', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'staging',
        APP_URL: 'not-a-url',
        FIRST_ADMIN_EMAIL: 'invalid-email',
        MAX_UPLOAD_FILE_BYTES: '0',
        REFERENCE_FILE_RETENTION_DAYS: '-1',
        MAX_IMAGES_PER_DECK: '0'
      })
    ).toThrow(ConfigValidationError);
  });
});
