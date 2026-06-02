export interface UsageSnapshot {
  workspaceId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export function totalTokens(snapshot: UsageSnapshot): number {
  return snapshot.inputTokens + snapshot.outputTokens;
}
