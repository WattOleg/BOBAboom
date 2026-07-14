-- Auth profiles for BOBA BOOM (email-only, no phone).
-- Run in Supabase SQL Editor after supabase-schema.sql.
--
-- Dashboard settings (manual):
-- Authentication → Providers → Email: ON, Confirm email: OFF
-- Authentication → URL Configuration: add your app URL + /reset-password

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('staff', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles read own or admin'
  ) then
    create policy "Profiles read own or admin"
      on public.profiles for select
      using (
        auth.uid() = id
        or exists (
          select 1 from public.profiles admin_profile
          where admin_profile.id = auth.uid() and admin_profile.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles update own or admin'
  ) then
    create policy "Profiles update own or admin"
      on public.profiles for update
      using (
        auth.uid() = id
        or exists (
          select 1 from public.profiles admin_profile
          where admin_profile.id = auth.uid() and admin_profile.role = 'admin'
        )
      )
      with check (
        auth.uid() = id
        or exists (
          select 1 from public.profiles admin_profile
          where admin_profile.id = auth.uid() and admin_profile.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles insert own'
  ) then
    create policy "Profiles insert own"
      on public.profiles for insert
      with check (auth.uid() = id);
  end if;
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'staff')
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
exception
  when others then
    raise warning 'handle_new_user failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Promote your account to admin (replace email):
-- update public.profiles set role = 'admin' where lower(email) = lower('you@example.com');
