-- Focus Mastery · ampliación: revisión semanal, distracciones, toques y salas de foco
-- Ejecuta schema.sql antes (ya lo hiciste). Luego pega este archivo en
-- Supabase → SQL Editor → Run. Es seguro ejecutarlo más de una vez.

-- =========================================================
-- REVISIÓN SEMANAL (privada)
-- =========================================================
create table if not exists public.reviews (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  week       date not null,                       -- lunes de la semana
  worked     text not null default '' check (char_length(worked) <= 4000),
  distracted text not null default '' check (char_length(distracted) <= 4000),
  change     text not null default '' check (char_length(change) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (user_id, week)
);

-- =========================================================
-- REGISTRO DE DISTRACCIONES (privado)
-- =========================================================
create table if not exists public.distractions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('phone','people','side','social','thoughts','other')),
  created_at timestamptz not null default now()
);

-- =========================================================
-- TOQUES ENTRE BUDDIES ("¡haz tu check-in!")
-- Solo los ven quien lo da y quien lo recibe.
-- =========================================================
create table if not exists public.nudges (
  day        date not null,
  from_user  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (day, from_user, to_user)
);

-- =========================================================
-- SALAS DE FOCO
-- 'general' = todas las personas con cuenta.
-- <id de usuaria> = sala privada de esa persona y sus buddies.
-- =========================================================
create or replace function public.can_room(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    r = 'general'
    or r = auth.uid()::text
    or (r ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public.is_buddy(auth.uid(), r::uuid))
  );
$$;

-- Pomodoro compartido de la sala: si mode = 'work', termina en ends_at
-- y después vienen 5 minutos de descanso.
create table if not exists public.room_state (
  room       text primary key check (room = 'general' or room ~ '^[0-9a-f-]{36}$'),
  mode       text not null default 'idle' check (mode in ('idle','work')),
  ends_at    timestamptz,
  by_user    uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.room_messages (
  id         bigint generated always as identity primary key,
  room       text not null check (room = 'general' or room ~ '^[0-9a-f-]{36}$'),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

-- =========================================================
-- PERMISOS DE LA API
-- =========================================================
grant select, insert, update, delete on
  public.reviews, public.distractions, public.nudges, public.room_state, public.room_messages
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.can_room(text) to authenticated;
revoke execute on function public.can_room(text) from anon, public;
-- Los toques no se editan
revoke update on public.nudges from authenticated;

-- =========================================================
-- SEGURIDAD (Row Level Security)
-- =========================================================
alter table public.reviews       enable row level security;
alter table public.distractions  enable row level security;
alter table public.nudges        enable row level security;
alter table public.room_state    enable row level security;
alter table public.room_messages enable row level security;

drop policy if exists "reviews own"      on public.reviews;
drop policy if exists "distractions own" on public.distractions;
create policy "reviews own"      on public.reviews      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "distractions own" on public.distractions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "nudges read"   on public.nudges;
drop policy if exists "nudges write"  on public.nudges;
drop policy if exists "nudges delete" on public.nudges;
create policy "nudges read"   on public.nudges for select using (auth.uid() in (from_user, to_user));
create policy "nudges write"  on public.nudges for insert
  with check (from_user = auth.uid() and public.is_buddy(from_user, to_user)
              and day between current_date - 1 and current_date + 1);
create policy "nudges delete" on public.nudges for delete using (auth.uid() in (from_user, to_user));

drop policy if exists "room state read"   on public.room_state;
drop policy if exists "room state insert" on public.room_state;
drop policy if exists "room state update" on public.room_state;
create policy "room state read"   on public.room_state for select using (public.can_room(room));
create policy "room state insert" on public.room_state for insert with check (public.can_room(room) and by_user = auth.uid());
create policy "room state update" on public.room_state for update using (public.can_room(room)) with check (public.can_room(room) and by_user = auth.uid());

drop policy if exists "room msgs read"   on public.room_messages;
drop policy if exists "room msgs write"  on public.room_messages;
drop policy if exists "room msgs delete" on public.room_messages;
create policy "room msgs read"   on public.room_messages for select using (public.can_room(room));
create policy "room msgs write"  on public.room_messages for insert with check (user_id = auth.uid() and public.can_room(room));
create policy "room msgs delete" on public.room_messages for delete using (user_id = auth.uid());

create index if not exists distractions_user_day on public.distractions (user_id, day);
create index if not exists nudges_to_day         on public.nudges (to_user, day);
create index if not exists room_msgs_room        on public.room_messages (room, created_at desc);

-- =========================================================
-- TIEMPO REAL: el chat y el pomodoro de la sala se actualizan solos
-- =========================================================
do $$
declare t text;
begin
  foreach t in array array['room_messages','room_state'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
