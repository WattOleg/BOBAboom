create extension if not exists pgcrypto;

-- Legacy key-value store (schedule, writeoffs, sections, …).
-- Techcards were migrated out of app_data.key = 'techcards' into public.techcards.
create table if not exists public.app_data (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per tech card (replaces monolithic app_data.techcards JSON blob).
create table if not exists public.techcards (
  id uuid primary key default gen_random_uuid(),
  sheet_name text not null unique,
  name text not null default '',
  name_ru text not null default '',
  category text not null default '',
  yield text not null default '',
  time text not null default '',
  method text not null default '',
  glass text not null default '',
  garnish text not null default '',
  photo_url text not null default '',
  author text not null default '',
  date text not null default '',
  technology text not null default '',
  ingredients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists techcards_category_idx on public.techcards (category);
create index if not exists techcards_updated_at_idx on public.techcards (updated_at desc);

alter table public.app_data enable row level security;
alter table public.techcards enable row level security;

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

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'techcards' and policyname = 'Allow read techcards'
  ) then
    create policy "Allow read techcards" on public.techcards for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'techcards' and policyname = 'Allow insert techcards'
  ) then
    create policy "Allow insert techcards" on public.techcards for insert with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'techcards' and policyname = 'Allow update techcards'
  ) then
    create policy "Allow update techcards" on public.techcards for update using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'techcards' and policyname = 'Allow delete techcards'
  ) then
    create policy "Allow delete techcards" on public.techcards for delete using (true);
  end if;
end
$$;

-- Supabase Storage bucket for card photos (public read).
insert into storage.buckets (id, name, public)
values ('techcards', 'techcards', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read techcards photos'
  ) then
    create policy "Public read techcards photos"
      on storage.objects for select
      using (bucket_id = 'techcards');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Allow upload techcards photos'
  ) then
    create policy "Allow upload techcards photos"
      on storage.objects for insert
      with check (bucket_id = 'techcards');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Allow update techcards photos'
  ) then
    create policy "Allow update techcards photos"
      on storage.objects for update
      using (bucket_id = 'techcards')
      with check (bucket_id = 'techcards');
  end if;
end
$$;
