/**
 * IEventSink: typed contract for all event sinks.
 * Both DbSink (background fire-and-forget path) and LiveSink (SSE response path)
 * implement this interface with no unsafe casts required.
 */
export interface IEventSink {
  /** Emit an event. The sink is responsible for assigning the monotonic idx. */
  emit(eventType: string, payload: Record<string, unknown>): void;
  /** Total events emitted so far (used for done.totalEvents). */
  readonly totalEvents: number;
  /** Close the sink (end HTTP response if applicable). */
  close(): void;
  /** Whether the sink is closed. */
  isClosed(): boolean;
}
