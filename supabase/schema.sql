-- Inkwave Supabase schema. Run this in your fresh Supabase project (SQL editor).
--
-- Clerk owns authentication; this table is our own minimal mirror of the user — the email we may
-- need "later down the track" plus the paid-subscription flag M6 gates on. It holds NO content;
-- the writing never touches Supabase (that's the zero-retention promise). Kept deliberately small.

create table if not exists public.profiles (
  clerk_user_id         text primary key,
  email                 text,
  subscription_active   boolean not null default false,
  subscription_provider text,                 -- 'stripe' | 'paypal'
  subscription_id       text,                 -- provider subscription id
  stripe_customer_id    text,
  current_period_end    timestamptz,          -- entitlement expiry (self-expires if a cancel webhook is lost)
  last_event_at         timestamptz,          -- newest provider event applied (webhook ordering guard)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Idempotent migration for projects provisioned before the billing columns existed (audit F3/F4): the
-- billing code reads current_period_end and writes provider/subscription_id/stripe_customer_id, so a
-- DB created from the old schema would 500 every webhook (retry storm; paid user never entitled).
alter table public.profiles
  add column if not exists subscription_provider text,
  add column if not exists subscription_id       text,
  add column if not exists stripe_customer_id     text,
  add column if not exists current_period_end     timestamptz,
  add column if not exists last_event_at          timestamptz;

-- Webhook idempotency (audit F4): processed Stripe/PayPal event ids. The webhooks INSERT the id and
-- treat a unique-violation as "already processed" → short-circuit, so a replay/redelivery can't
-- re-apply a stale subscription change. Server-side (service-role) only.
create table if not exists public.webhook_events (
  id          text primary key,
  created_at  timestamptz not null default now()
);
alter table public.webhook_events enable row level security;

-- Only our server-side /api functions (Supabase service-role key) touch this table. RLS on with no
-- policies means the anon/public client cannot read or write it; the service role bypasses RLS.
alter table public.profiles enable row level security;

-- keep updated_at fresh on writes
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();
