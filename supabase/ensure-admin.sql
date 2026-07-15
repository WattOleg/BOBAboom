-- Make sure umaev1998@mail.ru stays admin in the database.
-- Run once in Supabase SQL Editor after fixing the app.

insert into public.profiles (id, email, full_name, role)
select
  u.id,
  lower(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  'admin'
from auth.users u
where lower(u.email) = 'umaev1998@mail.ru'
on conflict (id) do update set
  email = excluded.email,
  role = 'admin',
  updated_at = now();

-- Prevent accidental demotion by client bugs: optional hardening via view comment.
-- To promote another admin later:
-- update public.profiles set role = 'admin' where lower(email) = lower('other@email.com');
