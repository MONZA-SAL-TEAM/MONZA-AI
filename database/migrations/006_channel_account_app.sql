-- =============================================================================
-- 006_channel_account_app.sql — which Meta app an account belongs to.
--
-- Monza's three brands live in three Meta business portfolios, each with its
-- own app, and each app signs webhook deliveries with its OWN secret. The
-- webhook now verifies against one secret per app (META_APP_SECRETS) and learns
-- WHICH app signed. This column is how it then knows which accounts that app
-- may speak for: a delivery signed by MHERO's app must never be filed under a
-- VOYAH account, even if its body names one.
--
-- Nullable, and deliberately so. An account with no app recorded is EXCLUDED
-- once app binding is configured — unassigned is not the same as allowed — and
-- is treated exactly as before 006 while it is not. So applying this changes
-- nothing on its own; binding starts only when META_APP_SECRETS is set.
--
-- Safe to re-run: `if not exists`, and `comment on` simply replaces itself.
--
-- Rollout order, so VOYAH never stops:
--   1. apply this migration
--   2. set app_id on every connected account
--   3. set META_APP_SECRETS in Vercel and redeploy
-- The code tolerates the column being absent, so deploying it first is safe.
-- =============================================================================

alter table public.channel_accounts
  add column if not exists app_id text;

comment on column public.channel_accounts.app_id is
  'Meta app id this account''s webhook deliveries are signed by. With META_APP_SECRETS set, a delivery verified by app X may only speak for accounts whose app_id is X; NULL is excluded.';
