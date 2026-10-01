-- ─────────────────────────────────────────────────────────────────────────────
-- Seed guide purchasers (Stan Store) → they get a 30-day no-card trial.
-- Run this each time Kayla sends new purchaser emails. Safe to re-run — emails
-- already on the list are skipped (on conflict do nothing).
-- Emails are matched lowercase; keep them lowercase here.
-- ─────────────────────────────────────────────────────────────────────────────

insert into guide_purchasers (email) values
  ('guide-buyer-1@example.com'),
  ('guide-buyer-2@example.com')
on conflict (email) do nothing;
