-- Fix recursive RLS on profiles (can break signup/login profile writes).
-- Run in Supabase SQL Editor.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "Profiles read own or admin" on public.profiles;
drop policy if exists "Profiles update own or admin" on public.profiles;
drop policy if exists "Profiles insert own" on public.profiles;

create policy "Profiles read own or admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Profiles update own or admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "Profiles insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Ensure current user has a profile row (replace email if needed):
insert into public.profiles (id, email, full_name, role)
select id, email, coalesce(raw_user_meta_data->>'full_name', ''), 'staff'
from auth.users
on conflict (id) do update set
  email = excluded.email,
  updated_at = now();

update public.profiles
set role = 'admin'
where lower(email) = 'umaev1998@mail.ru';
