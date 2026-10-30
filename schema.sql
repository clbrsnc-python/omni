-- OmniScholar Supabase schema
-- Run in Supabase SQL Editor. Creates profiles, activity logs and private encrypted-key storage.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create or replace function public.handle_new_omnischolar_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_omnischolar on auth.users;
create trigger on_auth_user_created_omnischolar
after insert on auth.users for each row execute procedure public.handle_new_omnischolar_user();

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_user_created_idx on public.activity_logs(user_id, created_at desc);
create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);

-- Ciphertext and IV are written/read only by the Edge Function using service_role.
create table if not exists public.user_scopus_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.activity_logs enable row level security;
alter table public.user_scopus_keys enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create or replace function public.is_omnischolar_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and is_admin = true); $$;

drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles for select to authenticated using (public.is_omnischolar_admin());
-- No client update policy for is_admin; promote administrators only from SQL Editor.

drop policy if exists "Users insert own activity" on public.activity_logs;
create policy "Users insert own activity" on public.activity_logs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Admins read activity logs" on public.activity_logs;
create policy "Admins read activity logs" on public.activity_logs for select to authenticated using (public.is_omnischolar_admin());
-- No direct client access policies on user_scopus_keys: service-role Edge Function only.

-- After registering your own account, promote it to admin using its verified email:
-- update public.profiles set is_admin = true where email = 'YOUR_ADMIN_EMAIL';

-- Explicit API grants used by the front end; row access remains constrained by RLS.
grant select on public.profiles to authenticated;
grant insert, select on public.activity_logs to authenticated;
revoke all on public.user_scopus_keys from anon, authenticated;
grant all on public.user_scopus_keys to service_role;
