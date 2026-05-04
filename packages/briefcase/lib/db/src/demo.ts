/**
 * Briefcase demo identity contract.
 *
 * The product spec uses the slug `demo_user_pd` (sent over the
 * `x-demo-user` HTTP header) to identify the buildathon demo user, while
 * spec §6.6 stores that user under the deterministic UUID
 * `00000000-0000-0000-0000-00000000beef`.
 *
 * This module is the single source of truth for that mapping. Any
 * middleware or route that resolves `x-demo-user` MUST go through
 * `resolveDemoUserId()` to translate the slug into the database UUID.
 */

export const DEMO_USER_SLUG = "demo_user_pd" as const;
export const DEMO_USER_ID = "00000000-0000-0000-0000-00000000beef" as const;
export const DEMO_USER_EMAIL = "demo-pd@justiceos.local" as const;
export const DEMO_USER_DISPLAY_NAME = "Demo PD" as const;

export const DEMO_USERS: Record<string, string> = {
  [DEMO_USER_SLUG]: DEMO_USER_ID,
};

/** Returns the DB UUID for a `x-demo-user` slug, or `null` if unknown. */
export function resolveDemoUserId(slug: string | undefined | null): string | null {
  if (!slug) return null;
  return DEMO_USERS[slug] ?? null;
}
