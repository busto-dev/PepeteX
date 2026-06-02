import { describe, expect, it } from 'vitest';

import {
  createPasswordResetExpiry,
  createPasswordResetToken,
  createSessionExpiry,
  createSessionToken,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
  verifyPassword
} from './index';

describe('auth helpers', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('super-secret-password');

    await expect(verifyPassword('super-secret-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('creates opaque session tokens and stable token hashes', () => {
    const token = createSessionToken();

    expect(token).toHaveLength(43);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('creates opaque password reset tokens and stable token hashes', () => {
    const token = createPasswordResetToken();

    expect(token).toHaveLength(43);
    expect(hashPasswordResetToken(token)).toBe(hashPasswordResetToken(token));
  });

  it('creates future session expiries', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiry = createSessionExpiry(now);

    expect(expiry.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('creates future password reset expiries', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiry = createPasswordResetExpiry(now);

    expect(expiry.toISOString()).toBe('2026-01-01T02:00:00.000Z');
  });
});
