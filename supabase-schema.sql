create extension if not exists pgcrypto;

create table if not exists public.app_data (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_data'
      and policyname = 'Allow read access'
  ) then
    create policy "Allow read access" on public.app_data
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_data'
      and policyname = 'Allow write access'
  ) then
    create policy "Allow write access" on public.app_data
      for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_data'
      and policyname = 'Allow update access'
  ) then
    create policy "Allow update access" on public.app_data
      for update
      using (true)
      with check (true);
  end if;
end
$$;
