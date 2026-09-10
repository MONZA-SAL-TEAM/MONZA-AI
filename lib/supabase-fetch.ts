/**
 * The `fetch` every server-side Supabase client uses: always a fresh answer.
 *
 * Next.js can keep `fetch` responses in its Data Cache and hand them back on
 * later requests. On 2026-09-10 two API routes (Load more, and the diagnostic)
 * kept answering "That account is not connected" for the Monza SAL accounts —
 * serving a channel_accounts list from before those rows existed — while the
 * inbox page saw them. A database read that can come back stale is a wrong
 * answer, and for sign-in or CRM reads it would be a dangerous one, so every
 * client opts out explicitly instead of relying on each route's settings.
 */
export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });
