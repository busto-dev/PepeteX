import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);

export const SESSION_COOKIE_NAME = 'pepetex_session';
export const SESSION_TTL_DAYS = 30;
export const PASSWORD_RESET_TTL_HOURS = 2;
const PASSWORD_HASH_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;

export type AuthSessionState = 'active' | 'expired' | 'revoked';

export interface SessionActor {
  userId: string;
  workspaceId?: string;
  globalAdmin: boolean;
}

export interface SessionRecord {
  id: string;
  actor: SessionActor;
  state: AuthSessionState;
  expiresAt: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  globalRole: 'USER' | 'GLOBAL_ADMIN';
  profile: {
    name: string;
    avatarUrl?: string | null;
    uiLanguage: string;
    themePreference: string;
    defaultWorkspaceId?: string | null;
  } | null;
}

export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);

  const salt = randomBytes(16).toString('base64url');
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;

  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [algorithm, salt, encodedHash] = storedHash.split('$');

  if (
    algorithm !== PASSWORD_HASH_PREFIX ||
    !salt ||
    !encodedHash ||
    !password
  ) {
    return false;
  }

  const storedBuffer = Buffer.from(encodedHash, 'base64url');
  const candidateBuffer = (await scrypt(password, salt, storedBuffer.length)) as Buffer;

  return (
    storedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(storedBuffer, candidateBuffer)
  );
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function createPasswordResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createPasswordResetExpiry(now = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);
}

export function isSessionActive(session: SessionRecord, nowIso: string): boolean {
  return session.state === 'active' && new Date(session.expiresAt) > new Date(nowIso);
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }
}
