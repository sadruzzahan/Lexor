/**
 * Safely converts a typed value to the `Record<string, unknown>` shape
 * required by Drizzle's jsonb column type.
 *
 * Uses JSON round-trip (serialize → parse) to produce a plain object that
 * satisfies the Drizzle type without any `as unknown as` casts.
 */
export function toJsonb(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
