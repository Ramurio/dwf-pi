/** Live-probe tracking for current-invocation ls execution and later outbound consumption. */

export type Invocation = "first" | "second";

export interface OutboundToolCall {
  name: string;
  id: string;
}

export interface OutboundToolResult {
  id: string;
}

export interface ToolIoTurn {
  invocation: Invocation;
  index: number;
  calls: OutboundToolCall[];
  results: OutboundToolResult[];
}

export interface SuccessfulLsCompletion {
  invocation: Invocation;
  toolName: "ls";
  succeeded: true;
  toolCallId: string;
  afterRequestIndex: number;
}

export interface ToolRoundTrip extends SuccessfulLsCompletion {
  consumedRequestIndex: number;
}

export function isLsName(name: string): boolean {
  return name === "ls" || name.endsWith(".ls") || name.endsWith("/ls");
}

/** Responses transport uses call_id; the SDK toolCallId is `{call_id}|{item_id}`. */
export function normalizeTransportToolCallId(id: string): string {
  if (typeof id !== "string") return "";
  const trimmed = id.trim();
  if (!trimmed) return "";
  const separator = trimmed.indexOf("|");
  return (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
}

export function lastOutboundIndex(turns: readonly { invocation: Invocation }[], invocation: Invocation): number {
  let count = 0;
  for (const turn of turns) {
    if (turn.invocation === invocation) count++;
  }
  return count - 1;
}

export function extractToolIO(payload: unknown): { calls: OutboundToolCall[]; results: OutboundToolResult[] } {
  const calls: OutboundToolCall[] = [];
  const results: OutboundToolResult[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "function_call" && typeof record.name === "string" && typeof record.call_id === "string" && record.call_id) {
      calls.push({ name: record.name, id: record.call_id });
    }
    if (record.type === "function_call_output" && typeof record.call_id === "string" && record.call_id) {
      results.push({ id: record.call_id });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  return { calls, results };
}

export function recordSuccessfulLsCompletion(
  completions: SuccessfulLsCompletion[],
  input: { invocation: Invocation; toolCallId: string; afterRequestIndex: number },
): SuccessfulLsCompletion | undefined {
  const toolCallId = normalizeTransportToolCallId(input.toolCallId);
  if (!toolCallId || !Number.isInteger(input.afterRequestIndex) || input.afterRequestIndex < 0) return;
  const completion: SuccessfulLsCompletion = {
    invocation: input.invocation,
    toolName: "ls",
    succeeded: true,
    toolCallId,
    afterRequestIndex: input.afterRequestIndex,
  };
  completions.push(completion);
  return completion;
}

export function consumedRequestIndex(
  completion: SuccessfulLsCompletion,
  turns: readonly ToolIoTurn[],
): number | undefined {
  if (!completion.succeeded || completion.toolName !== "ls" || !completion.toolCallId) return;
  for (const turn of turns) {
    if (turn.invocation !== completion.invocation) continue;
    if (!Number.isInteger(turn.index) || turn.index <= completion.afterRequestIndex) continue;
    const hasCall = turn.calls.some(call => call.id === completion.toolCallId);
    const hasResult = turn.results.some(result => result.id === completion.toolCallId);
    if (hasCall && hasResult) return turn.index;
  }
}

export function provenLsRoundTrips(
  completions: readonly SuccessfulLsCompletion[],
  turns: readonly ToolIoTurn[],
): ToolRoundTrip[] {
  const trips: ToolRoundTrip[] = [];
  for (const completion of completions) {
    const consumed = consumedRequestIndex(completion, turns);
    if (consumed === undefined) continue;
    trips.push({ ...completion, consumedRequestIndex: consumed });
  }
  return trips;
}

export function lsRoundTripConsumed(
  completions: readonly SuccessfulLsCompletion[],
  turns: readonly ToolIoTurn[],
  invocation: Invocation,
): boolean {
  return provenLsRoundTrips(completions, turns).some(trip => trip.invocation === invocation);
}

export function publishedLsRoundTrips(
  completions: readonly SuccessfulLsCompletion[],
  turns: readonly ToolIoTurn[],
  redact: (id: string) => string,
): ToolRoundTrip[] {
  return provenLsRoundTrips(completions, turns).map(trip => ({ ...trip, toolCallId: redact(trip.toolCallId) }));
}
