-- Fix auth 500 (AuthRetryableFetchError): trigger must never fail signup.
-- Run in Supabase SQL Editor.

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
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case
      when lower(coalesce(new.email, '')) = 'umaev1998@mail.ru' then 'admin'
      else coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'staff')
    end
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = case
      when excluded.full_name <> '' then excluded.full_name
      else public.profiles.full_name
    end,
    -- Never demote an existing admin.
    role = case
      when public.profiles.role = 'admin' then 'admin'
      when excluded.role = 'admin' then 'admin'
      else public.profiles.role
    end,
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

-- Heal existing users without profiles
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  case when lower(coalesce(u.email, '')) = 'umaev1998@mail.ru' then 'admin' else 'staff' end
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  updated_at = now();

update public.profiles
set role = 'admin'
where lower(email) = 'umaev1998@mail.ru';
