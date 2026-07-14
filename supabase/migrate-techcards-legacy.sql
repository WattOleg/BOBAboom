-- Optional one-time migration in Supabase SQL Editor.
-- Prefer the automatic in-app migration (runs on first load after deploy).
-- Run this only if you need to migrate manually without opening the app.

-- 1) Ensure table exists (see ../supabase-schema.sql for full setup).

insert into public.techcards (
  sheet_name,
  name,
  name_ru,
  category,
  yield,
  time,
  method,
  glass,
  garnish,
  photo_url,
  author,
  date,
  technology,
  ingredients,
  updated_at
)
select
  coalesce(nullif(trim(elem->>'sheetName'), ''), nullif(trim(elem->>'sheet_name'), ''), 'legacy-' || gen_random_uuid()::text) as sheet_name,
  coalesce(elem->>'name', '') as name,
  coalesce(elem->>'nameRu', elem->>'name_ru', '') as name_ru,
  coalesce(elem->>'category', '') as category,
  coalesce(elem->>'yield', '') as yield,
  coalesce(elem->>'time', '') as time,
  coalesce(elem->>'method', '') as method,
  coalesce(elem->>'glass', '') as glass,
  coalesce(elem->>'garnish', '') as garnish,
  coalesce(elem->>'photoUrl', elem->>'photo_url', '') as photo_url,
  coalesce(elem->>'author', '') as author,
  coalesce(elem->>'date', '') as date,
  coalesce(elem->>'technology', '') as technology,
  coalesce(elem->'ingredients', '[]'::jsonb) as ingredients,
  now() as updated_at
from public.app_data,
     jsonb_array_elements(value) as elem
where key = 'techcards'
  and jsonb_typeof(value) = 'array'
on conflict (sheet_name) do update set
  name = excluded.name,
  name_ru = excluded.name_ru,
  category = excluded.category,
  yield = excluded.yield,
  time = excluded.time,
  method = excluded.method,
  glass = excluded.glass,
  garnish = excluded.garnish,
  photo_url = excluded.photo_url,
  author = excluded.author,
  date = excluded.date,
  technology = excluded.technology,
  ingredients = excluded.ingredients,
  updated_at = excluded.updated_at;

insert into public.app_data (key, value, updated_at)
values (
  'techcards_migrated_v1',
  jsonb_build_object(
    'migrated', true,
    'at', now(),
    'source', 'sql_manual'
  ),
  now()
)
on conflict (key) do update set
  value = excluded.value,
  updated_at = excluded.updated_at;
