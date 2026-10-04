-- Smart Packing Assistant: accounts and sync.
--
-- Run this once in your Supabase project: Dashboard > SQL Editor > New query,
-- paste this whole file, press Run. Running it again is safe.
--
-- It creates one table, `trips`, holding everyone's saved trips: one row per
-- trip, and a row stays behind (deleted = true) when a trip is deleted so the
-- other devices learn about it. Each person can only read and change their
-- own rows (row-level security); people who aren't signed in can't reach the
-- table at all.

create table if not exists public.trips (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 40),
  name       text        not null default '' check (char_length(name) <= 60),
  data       jsonb       not null default '{}'::jsonb check (octet_length(data::text) < 100000),
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists trips_user_updated on public.trips (user_id, updated_at);

-- Every write is stamped with the server's clock, so each device can ask for
-- "what changed since I last looked" without trusting device clocks.
create or replace function public.trips_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before insert or update on public.trips
  for each row execute function public.trips_touch();

-- Row-level security: each person sees and changes only their own trips.
alter table public.trips enable row level security;

drop policy if exists "Own trips: read" on public.trips;
create policy "Own trips: read" on public.trips
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Own trips: add" on public.trips;
create policy "Own trips: add" on public.trips
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Own trips: change" on public.trips;
create policy "Own trips: change" on public.trips
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Own trips: remove" on public.trips;
create policy "Own trips: remove" on public.trips
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Which roles may use the table at all (Supabase no longer grants this to new
-- tables automatically). Signed-in users only; never anonymous visitors.
revoke all on table public.trips from anon;
grant select, insert, update, delete on table public.trips to authenticated;
grant select, insert, update, delete on table public.trips to service_role;

-- "Delete account" in the app: removes the signed-in user, and with them
-- (through the foreign key above) all their trips.
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
