export interface PepeteXConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  redisUrl: string;
  gcsBucket: string;
  appUrl: string;
  maxUploadFileBytes: number;
  referenceFileRetentionDays: number;
  maxImagesPerDeck: number;
  /** When true, disables all outbound telemetry/analytics calls (Mastra telemetry, etc.). */
  disableExternalTelemetry: boolean;
  providerCredentialEncryptionKey?: string;
  firstAdminEmail?: string;
  firstAdminPasswordHash?: string;
  firstAdminName?: string;
}

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid PepeteX configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): PepeteXConfig {
  const issues: string[] = [];
  const nodeEnv = parseNodeEnv(env.NODE_ENV, issues);
  const databaseUrl = parseUrlEnv(
    env.DATABASE_URL ?? 'postgresql://pepetex:pepetex@localhost:5435/pepetex',
    'DATABASE_URL',
    ['postgres:', 'postgresql:'],
    issues
  );
  const redisUrl = parseUrlEnv(
    env.REDIS_URL ?? 'redis://localhost:6379',
    'REDIS_URL',
    ['redis:', 'rediss:'],
    issues
  );
  const appUrl = parseUrlEnv(
    env.APP_URL ?? 'http://localhost:3000',
    'APP_URL',
    ['http:', 'https:'],
    issues
  );
  const gcsBucket = parseRequiredText(env.GCS_BUCKET ?? 'pepetex-dev', 'GCS_BUCKET', issues);
  const maxUploadFileBytes = parsePositiveInteger(
    env.MAX_UPLOAD_FILE_BYTES ?? String(30 * 1024 * 1024),
    'MAX_UPLOAD_FILE_BYTES',
    issues
  );
  const referenceFileRetentionDays = parsePositiveInteger(
    env.REFERENCE_FILE_RETENTION_DAYS ?? '30',
    'REFERENCE_FILE_RETENTION_DAYS',
    issues
  );
  const maxImagesPerDeck = parsePositiveInteger(
    env.MAX_IMAGES_PER_DECK ?? '5',
    'MAX_IMAGES_PER_DECK',
    issues
  );
  const providerCredentialEncryptionKey = parseOptionalEncryptionKey(
    env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY,
    'PROVIDER_CREDENTIAL_ENCRYPTION_KEY',
    issues
  );
  const firstAdminEmail = parseOptionalEmail(env.FIRST_ADMIN_EMAIL, 'FIRST_ADMIN_EMAIL', issues);
  const firstAdminPasswordHash = parseOptionalText(
    env.FIRST_ADMIN_PASSWORD_HASH,
    'FIRST_ADMIN_PASSWORD_HASH',
    issues
  );
  const firstAdminName = parseOptionalText(env.FIRST_ADMIN_NAME, 'FIRST_ADMIN_NAME', issues);
  const disableExternalTelemetry =
    env.DISABLE_EXTERNAL_TELEMETRY === 'true' || env.DISABLE_EXTERNAL_TELEMETRY === '1';

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  const config: PepeteXConfig = {
    nodeEnv,
    databaseUrl,
    redisUrl,
    gcsBucket,
    appUrl,
    maxUploadFileBytes,
    referenceFileRetentionDays,
    maxImagesPerDeck,
    disableExternalTelemetry
  };

  if (providerCredentialEncryptionKey) {
    config.providerCredentialEncryptionKey = providerCredentialEncryptionKey;
  }
  if (firstAdminEmail) config.firstAdminEmail = firstAdminEmail;
  if (firstAdminPasswordHash) config.firstAdminPasswordHash = firstAdminPasswordHash;
  if (firstAdminName) config.firstAdminName = firstAdminName;

  return config;
}

function parseNodeEnv(
  value: string | undefined,
  issues: string[]
): PepeteXConfig['nodeEnv'] {
  if (!value || value === 'development') return 'development';
  if (value === 'production' || value === 'test') return value;
  issues.push(`NODE_ENV must be development, test, or production. Received "${value}".`);
  return 'development';
}

function parseUrlEnv(
  value: string,
  name: string,
  allowedProtocols: string[],
  issues: string[]
): string {
  const normalized = value.trim();

  if (!normalized) {
    issues.push(`${name} must not be empty.`);
    return value;
  }

  try {
    const parsed = new URL(normalized);

    if (!allowedProtocols.includes(parsed.protocol)) {
      issues.push(`${name} must use one of: ${allowedProtocols.join(', ')}.`);
    }
  } catch {
    issues.push(`${name} must be a valid URL.`);
  }

  return normalized;
}

function parseRequiredText(value: string, name: string, issues: string[]): string {
  const normalized = value.trim();

  if (!normalized) {
    issues.push(`${name} must not be empty.`);
  }

  return normalized;
}

function parseOptionalText(
  value: string | undefined,
  name: string,
  issues: string[]
): string | undefined {
  if (!value) return undefined;

  const normalized = value.trim();

  if (!normalized) {
    issues.push(`${name} must not be empty when provided.`);
    return undefined;
  }

  return normalized;
}

function parseOptionalEmail(
  value: string | undefined,
  name: string,
  issues: string[]
): string | undefined {
  const normalized = parseOptionalText(value, name, issues);

  if (!normalized) return undefined;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    issues.push(`${name} must be a valid email address.`);
    return undefined;
  }

  return normalized;
}

function parseOptionalEncryptionKey(
  value: string | undefined,
  name: string,
  issues: string[]
): string | undefined {
  const normalized = parseOptionalText(value, name, issues);

  if (!normalized) return undefined;

  let bytes: Buffer;

  try {
    bytes = Buffer.from(normalized, 'base64');
  } catch {
    issues.push(`${name} must be valid base64-encoded data.`);
    return undefined;
  }

  if (bytes.length !== 32) {
    issues.push(`${name} must decode to exactly 32 bytes.`);
    return undefined;
  }

  return normalized;
}

function parsePositiveInteger(
  value: string,
  name: string,
  issues: string[]
): number {
  const normalized = value.trim();

  if (!normalized) {
    issues.push(`${name} must not be empty.`);
    return 1;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push(`${name} must be a positive integer.`);
    return 1;
  }

  return parsed;
}
