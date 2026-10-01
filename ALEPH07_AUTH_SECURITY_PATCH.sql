-- ============================================================
-- ALEPH Assignment 07
-- Authentication / Active Session / Ownership Security Patch
--
-- Purpose
-- 1. Require a currently active Supabase Auth session.
-- 2. Apply active-session checks to RLS policies.
-- 3. Protect SECURITY DEFINER RPC functions.
-- 4. Provide explicit 404 ownership checks for plan
--    READ / UPDATE / DELETE operations.
--
-- Never place service-role keys, passwords, or access tokens here.
-- ============================================================


-- ============================================================
-- 1. Active Supabase Auth session check
-- ============================================================

create schema if not exists private;

create or replace function private.is_active_auth_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from auth.sessions s
      where s.id =
        nullif((select auth.jwt()) ->> 'session_id', '')::uuid
        and s.user_id = (select auth.uid())
    );
$$;

revoke all
on function private.is_active_auth_session()
from public;

revoke all
on function private.is_active_auth_session()
from anon;

revoke all
on function private.is_active_auth_session()
from authenticated;

grant usage on schema private to authenticated;

grant execute
on function private.is_active_auth_session()
to authenticated;


-- ============================================================
-- 2. plans RLS
-- ============================================================

alter policy plans_select_own
on public.plans
using (
  user_id = auth.uid()
  and private.is_active_auth_session()
);

alter policy plans_insert_own
on public.plans
with check (
  user_id = auth.uid()
  and private.is_active_auth_session()
);

alter policy plans_update_own
on public.plans
using (
  user_id = auth.uid()
  and private.is_active_auth_session()
)
with check (
  user_id = auth.uid()
  and private.is_active_auth_session()
);

alter policy plans_delete_own
on public.plans
using (
  user_id = auth.uid()
  and private.is_active_auth_session()
);


-- ============================================================
-- 3. plan_revisions RLS
-- ============================================================

alter policy revisions_select_own
on public.plan_revisions
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = plan_revisions.plan_id
      and p.user_id = auth.uid()
  )
);


-- ============================================================
-- 4. tasks RLS
-- ============================================================

alter policy tasks_select_own
on public.tasks
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = tasks.plan_id
      and p.user_id = auth.uid()
  )
);

alter policy tasks_insert_own
on public.tasks
with check (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = tasks.plan_id
      and p.user_id = auth.uid()
  )
);

alter policy tasks_update_own
on public.tasks
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = tasks.plan_id
      and p.user_id = auth.uid()
  )
)
with check (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = tasks.plan_id
      and p.user_id = auth.uid()
  )
);

alter policy tasks_delete_own
on public.tasks
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = tasks.plan_id
      and p.user_id = auth.uid()
  )
);


-- ============================================================
-- 5. work_logs RLS
-- ============================================================

alter policy work_logs_own
on public.work_logs
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.tasks t
    join public.plans p on p.id = t.plan_id
    where t.id = work_logs.task_id
      and p.user_id = auth.uid()
  )
)
with check (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.tasks t
    join public.plans p on p.id = t.plan_id
    where t.id = work_logs.task_id
      and p.user_id = auth.uid()
  )
);


-- ============================================================
-- 6. task_completions RLS
-- ============================================================

alter policy completions_select_own
on public.task_completions
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.tasks t
    join public.plans p on p.id = t.plan_id
    where t.id = task_completions.task_id
      and p.user_id = auth.uid()
  )
);


-- ============================================================
-- 7. reviews RLS
-- ============================================================

alter policy reviews_own
on public.reviews
using (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = reviews.plan_id
      and p.user_id = auth.uid()
  )
)
with check (
  private.is_active_auth_session()
  and exists (
    select 1
    from public.plans p
    where p.id = reviews.plan_id
      and p.user_id = auth.uid()
  )
);


-- ============================================================
-- 8. Explicit ownership-protected READ
--
-- Another user's plan is deliberately reported as 404 so that
-- the caller cannot determine whether that plan exists.
-- ============================================================

create or replace function public.get_plan_owned(
  p_plan_id uuid
)
returns setof public.plans
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise sqlstate 'PGRST'
      using
        message =
          '{"code":"NOT_FOUND","message":"Plan not found","details":null,"hint":null}',
        detail =
          '{"status":404,"headers":{},"status_text":"Not Found"}';
  end if;

  if not private.is_active_auth_session() then
    raise sqlstate 'PGRST'
      using
        message =
          '{"code":"NOT_FOUND","message":"Plan not found","details":null,"hint":null}',
        detail =
          '{"status":404,"headers":{},"status_text":"Not Found"}';
  end if;

  if not exists (
    select 1
    from public.plans p
    where p.id = p_plan_id
      and p.user_id = auth.uid()
  ) then
    raise sqlstate 'PGRST'
      using
        message =
          '{"code":"NOT_FOUND","message":"Plan not found","details":null,"hint":null}',
        detail =
          '{"status":404,"headers":{},"status_text":"Not Found"}';
  end if;

  return query
  select p.*
  from public.plans p
  where p.id = p_plan_id
    and p.user_id = auth.uid();
end;
$function$;

revoke all
on function public.get_plan_owned(uuid)
from public;

revoke all
on function public.get_plan_owned(uuid)
from anon;

grant execute
on function public.get_plan_owned(uuid)
to authenticated;


-- ============================================================
-- 9. Explicit ownership-protected UPDATE
-- ============================================================

create or replace function public.update_plan_owned(
  p_plan_id uuid,
  p_title text
)
returns setof public.plans
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
     or not private.is_active_auth_session()
     or not exists (
       select 1
       from public.plans p
       where p.id = p_plan_id
         and p.user_id = auth.uid()
     )
  then
    raise sqlstate 'PGRST'
      using
        message =
          '{"code":"NOT_FOUND","message":"Plan not found","details":null,"hint":null}',
        detail =
          '{"status":404,"headers":{},"status_text":"Not Found"}';
  end if;

  update public.plans
  set title = p_title,
      updated_at = now()
  where id = p_plan_id
    and user_id = auth.uid();

  return query
  select p.*
  from public.plans p
  where p.id = p_plan_id
    and p.user_id = auth.uid();
end;
$function$;

revoke all
on function public.update_plan_owned(uuid, text)
from public;

revoke all
on function public.update_plan_owned(uuid, text)
from anon;

grant execute
on function public.update_plan_owned(uuid, text)
to authenticated;


-- ============================================================
-- 10. Explicit ownership-protected DELETE
-- ============================================================

create or replace function public.delete_plan_owned(
  p_plan_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
     or not private.is_active_auth_session()
     or not exists (
       select 1
       from public.plans p
       where p.id = p_plan_id
         and p.user_id = auth.uid()
     )
  then
    raise sqlstate 'PGRST'
      using
        message =
          '{"code":"NOT_FOUND","message":"Plan not found","details":null,"hint":null}',
        detail =
          '{"status":404,"headers":{},"status_text":"Not Found"}';
  end if;

  delete from public.plans
  where id = p_plan_id
    and user_id = auth.uid();

  return true;
end;
$function$;

revoke all
on function public.delete_plan_owned(uuid)
from public;

revoke all
on function public.delete_plan_owned(uuid)
from anon;

grant execute
on function public.delete_plan_owned(uuid)
to authenticated;
