-- Viper Route — Phase 6 (accounts) schema. Paste into Supabase → SQL Editor → Run.
-- Safe to re-run: everything is "if not exists" / "or replace".

-- One row per user, created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique,
  avatar jsonb,                       -- 16 rows × 16 chars, see src/lib/avatar.ts
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handle_format check (handle is null or handle ~ '^[a-z0-9_]{3,20}$')
);

-- Saved stations.
create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  station_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, station_id)
);

-- Row-level security: users see and edit only their own rows.
alter table public.profiles enable row level security;
alter table public.favorites enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id);
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "favorites: all own" on public.favorites;
create policy "favorites: all own" on public.favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Create the profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute procedure public.touch_updated_at();
