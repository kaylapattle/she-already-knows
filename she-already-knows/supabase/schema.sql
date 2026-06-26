-- ─────────────────────────────────────────────────────────────────────────────
-- She Already Knows — Phase 2 schema
-- Run this once in Supabase → SQL Editor (it is safe to re-run).
-- ─────────────────────────────────────────────────────────────────────────────

-- Beta members get a longer free trial (first month) than new users (7 days).
-- Seed this table with the emails of everyone in the beta (see seed-beta.sql).
create table if not exists beta_emails (
  email      text primary key,
  added_at   timestamptz not null default now()
);

-- One row per person, keyed by email. Mirrors the Stripe subscription state and
-- tracks the no-card free trial.
create table if not exists subscribers (
  email                  text primary key,
  name                   text,
  is_beta                boolean      not null default false,
  trial_end              timestamptz,                 -- when the free trial lapses
  status                 text         not null default 'trialing',
                                                       -- trialing | active | past_due | canceled | expired
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,                 -- paid period end (from Stripe)
  created_at             timestamptz  not null default now(),
  updated_at             timestamptz  not null default now()
);

create index if not exists subscribers_customer_idx
  on subscribers (stripe_customer_id);

-- Keep updated_at fresh on every write.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists subscribers_set_updated_at on subscribers;
create trigger subscribers_set_updated_at
  before update on subscribers
  for each row execute function set_updated_at();

-- All access goes through Netlify Functions using the service_role key, which
-- bypasses RLS. We still enable RLS with no public policies so the anon key
-- cannot read or write these tables directly from the browser.
alter table subscribers enable row level security;
alter table beta_emails enable row level security;
