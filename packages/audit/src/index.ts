export interface AuditEvent {
  actorUserId: string;
  action: string;
  occurredAt: string;
  targetId?: string;
}

export const adminAuditActions = [
  'admin.user.create',
  'admin.user.reset-password',
  'admin.user.delete',
  'admin.provider-credential.reveal'
] as const;

export type AdminAuditAction = (typeof adminAuditActions)[number];

export interface CreateAuditLogInput {
  actorUserId: string;
  action: AdminAuditAction;
  targetType: 'user' | 'provider_credential';
  targetId: string;
  metadata?: Record<string, unknown>;
}

export function isSensitiveAuditAction(action: string): boolean {
  return action.includes('reveal') || action.includes('reset-password');
}
