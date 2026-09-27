import type { RunEvent } from '../run-store.js';

export interface ExecutionOrder { firstStarted: number; latestStarted: number; attempt: number; transition: number | null }
/** Keep only event positions; payloads, prompts and output never cross this projection. */
export function collectExecutionOrder(events: readonly RunEvent[], index: Map<string, ExecutionOrder>) {
  for (const event of events) {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.key !== 'string') continue;
    const previous = index.get(payload.key);
    if (event.type === 'activation.started' && typeof payload.attempt === 'number') index.set(payload.key, {
      firstStarted: previous?.firstStarted ?? event.seq, latestStarted: event.seq, attempt: payload.attempt, transition: previous?.transition ?? null,
    });
    if (event.type === 'route.decided' && previous) previous.transition = event.seq;
  }
}
