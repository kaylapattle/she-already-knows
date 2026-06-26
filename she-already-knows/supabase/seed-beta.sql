-- ─────────────────────────────────────────────────────────────────────────────
-- Seed beta members → they get the 30-day "first month free" trial.
-- Replace the example emails with the real beta list, then run in Supabase.
-- Emails are matched lowercase; keep them lowercase here.
-- ─────────────────────────────────────────────────────────────────────────────

insert into beta_emails (email) values
  ('beta-member-1@example.com'),
  ('beta-member-2@example.com')
on conflict (email) do nothing;
