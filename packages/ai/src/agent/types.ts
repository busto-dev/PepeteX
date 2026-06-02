export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'verifier' | 'tool';
export type AgentToolCallStatus = 'running' | 'completed' | 'failed';
export type AgentDecisionKind = 'message' | 'tool_call' | 'final' | 'cancel';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  label: string;
  status: AgentToolCallStatus;
  input?: unknown;
  result?: unknown;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AgentToolResult {
  callId: string;
  ok: boolean;
  result?: unknown;
  errorMessage?: string;
}

export interface AgentState {
  runId: string;
  deckId: string;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  turn: number;
  repairAttempts: number;
  startedAt: string;
  lastUpdatedAt: string;
  done: boolean;
  finalSummary?: string;
}

export type AgentDecision =
  | { kind: 'message'; content: string; metadata?: Record<string, unknown> }
  | { kind: 'tool_call'; toolName: string; input?: unknown; label?: string }
  | { kind: 'final'; summary: string }
  | { kind: 'cancel'; reason: string };

export interface DeckAgentTool {
  name: string;
  label: string;
  description: string;
  execute(input: unknown, state: AgentState): Promise<AgentToolResult>;
}