import type { AgentDecision, AgentState, AgentToolCall, DeckAgentTool } from './types.js';

export interface AgentExecutorOptions {
  initialState: AgentState;
  tools: readonly DeckAgentTool[];
  decide(state: AgentState, allowedTools: readonly DeckAgentTool[]): Promise<AgentDecision>;
  maxTurns: number;
  maxTimeMs: number;
  maxRepairAttempts: number;
  onStateChange?: (state: AgentState) => Promise<void> | void;
}

export async function executeDeckAgentLoop(options: AgentExecutorOptions): Promise<AgentState> {
  const startedAt = Date.now();
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
  let state = touchState(options.initialState);

  while (!state.done) {
    if (state.turn >= options.maxTurns) {
      return finishState(state, 'Stopped after reaching the maximum agent turns.');
    }

    if (Date.now() - startedAt > options.maxTimeMs) {
      return finishState(state, 'Stopped after reaching the maximum agent runtime.');
    }

    if (state.repairAttempts > options.maxRepairAttempts) {
      return finishState(state, 'Stopped after exceeding the repair-attempt budget.');
    }

    const decision = await options.decide(state, options.tools);
    state = { ...state, turn: state.turn + 1, lastUpdatedAt: new Date().toISOString() };

    if (decision.kind === 'message') {
      const message = {
        id: `agent-message-${state.turn}`,
        role: 'assistant' as const,
        content: decision.content,
        createdAt: state.lastUpdatedAt,
        ...(decision.metadata ? { metadata: decision.metadata } : {})
      };

      state = {
        ...state,
        messages: [...state.messages, message]
      };
      await options.onStateChange?.(state);
      continue;
    }

    if (decision.kind === 'final') {
      return finishState(state, decision.summary);
    }

    if (decision.kind === 'cancel') {
      return finishState(state, decision.reason);
    }

    const tool = toolsByName.get(decision.toolName);
    if (!tool) {
      state = addFailedToolCall(state, decision.toolName, decision.label ?? decision.toolName, `Tool is not allowed: ${decision.toolName}`);
      await options.onStateChange?.(state);
      continue;
    }

    const toolCall: AgentToolCall = {
      id: `agent-tool-${state.turn}`,
      name: tool.name,
      label: decision.label ?? tool.label,
      status: 'running',
      input: decision.input,
      startedAt: state.lastUpdatedAt
    };
    state = { ...state, toolCalls: [...state.toolCalls, toolCall] };
    await options.onStateChange?.(state);

    const result = await tool.execute(decision.input, state);
    state = {
      ...state,
      repairAttempts: result.ok ? state.repairAttempts : state.repairAttempts + 1,
      lastUpdatedAt: new Date().toISOString(),
      toolCalls: state.toolCalls.map((entry) =>
        entry.id === toolCall.id ? completeToolCall(entry, result.ok, result.result, result.errorMessage) : entry
      )
    };
    await options.onStateChange?.(state);
  }

  return state;
}

function completeToolCall(
  toolCall: AgentToolCall,
  ok: boolean,
  result: unknown,
  errorMessage: string | undefined
): AgentToolCall {
  return {
    ...toolCall,
    status: ok ? 'completed' : 'failed',
    completedAt: new Date().toISOString(),
    ...(result !== undefined ? { result } : {}),
    ...(errorMessage ? { errorMessage } : {})
  };
}

function addFailedToolCall(
  state: AgentState,
  name: string,
  label: string,
  errorMessage: string
): AgentState {
  const now = new Date().toISOString();
  return {
    ...state,
    repairAttempts: state.repairAttempts + 1,
    lastUpdatedAt: now,
    toolCalls: [
      ...state.toolCalls,
      {
        id: `agent-tool-${state.turn}`,
        name,
        label,
        status: 'failed',
        errorMessage,
        startedAt: now,
        completedAt: now
      }
    ]
  };
}

function finishState(state: AgentState, finalSummary: string): AgentState {
  return {
    ...state,
    done: true,
    finalSummary,
    lastUpdatedAt: new Date().toISOString()
  };
}

function touchState(state: AgentState): AgentState {
  return {
    ...state,
    lastUpdatedAt: new Date().toISOString()
  };
}