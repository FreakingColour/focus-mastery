-- Focus Mastery · esquema de base de datos para Supabase
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Es seguro ejecutarlo más de una vez.

-- =========================================================
-- PERFILES (públicos)
-- =========================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  bio          text check (char_length(bio) <= 280),
  start_time   text check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  created_at   timestamptz not null default now()
);

-- =========================================================
-- DÍAS: pomodoros, objetivos cumplidos y check-in (públicos)
-- =========================================================
create table if not exists public.days (
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day         date not null,
  pomos       int  not null default 0 check (pomos between 0 and 40),
  goals_done  int  not null default 0 check (goals_done >= 0),
  goals_total int  not null default 0 check (goals_total >= 0),
  first_at    text,
  checked_in  boolean not null default false,
  checkin_at  timestamptz,
  note        text check (char_length(note) <= 280),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

-- =========================================================
-- BUDDIES (relación mutua: solicitud → aceptada)
-- =========================================================
create table if not exists public.buddies (
  id         bigint generated always as identity primary key,
  requester  uuid not null references public.profiles(id) on delete cascade,
  addressee  uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists buddies_pair
  on public.buddies (least(requester, addressee), greatest(requester, addressee));

-- =========================================================
-- CHECKS DIARIOS ENTRE BUDDIES ("he visto tu día")
-- =========================================================
create table if not exists public.check_acks (
  day        date not null,
  from_user  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (day, from_user, to_user)
);

-- =========================================================
-- PRIVADO: tareas, objetivos (texto) y diario
-- =========================================================
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  project    text check (char_length(project) <= 40),
  estimate   int  not null default 0 check (estimate between 0 and 500),
  spent      int  not null default 0 check (spent >= 0),
  col        text not null default 'todo' check (col in ('todo','doing','done')),
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 200),
  scope      text not null check (scope in ('day','week','month')),
  period     text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.journal (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day        date not null,
  text       text not null default '' check (char_length(text) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- =========================================================
-- FUNCIONES
-- =========================================================
create or replace function public.is_buddy(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.buddies
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- Suma un pomodoro de forma atómica (sin carreras entre pestañas o dispositivos)
create or replace function public.add_pomodoro(p_day date, p_first_at text)
returns void language sql security invoker set search_path = public as $$
  insert into public.days (user_id, day, pomos, first_at)
  values (auth.uid(), p_day, 1, p_first_at)
  on conflict (user_id, day) do update
    set pomos = public.days.pomos + 1,
        first_at = coalesce(public.days.first_at, excluded.first_at),
        updated_at = now();
$$;

-- =========================================================
-- PERMISOS DE LA API (por si el proyecto no los da automáticamente)
-- Quién ve qué fila lo deciden las reglas RLS de abajo.
-- =========================================================
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.days, public.buddies, public.check_acks to anon;
grant select, insert, update, delete on
  public.profiles, public.days, public.buddies, public.check_acks,
  public.tasks, public.goals, public.journal
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_buddy(uuid, uuid) to anon, authenticated;
grant execute on function public.add_pomodoro(date, text) to authenticated;
revoke execute on function public.add_pomodoro(date, text) from anon, public;

-- =========================================================
-- SEGURIDAD (Row Level Security)
-- =========================================================
alter table public.profiles   enable row level security;
alter table public.days       enable row level security;
alter table public.buddies    enable row level security;
alter table public.check_acks enable row level security;
alter table public.tasks      enable row level security;
alter table public.goals      enable row level security;
alter table public.journal    enable row level security;

-- Perfiles: cualquiera los ve; cada uno edita el suyo
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select using (true);
create policy "profiles insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Días: públicos; cada uno escribe los suyos
drop policy if exists "days read"  on public.days;
drop policy if exists "days write" on public.days;
create policy "days read"  on public.days for select using (true);
create policy "days write" on public.days for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Buddies: las relaciones aceptadas son públicas; las pendientes solo las ven los implicados
drop policy if exists "buddies read"   on public.buddies;
drop policy if exists "buddies insert" on public.buddies;
drop policy if exists "buddies accept" on public.buddies;
drop policy if exists "buddies delete" on public.buddies;
create policy "buddies read"   on public.buddies for select
  using (status = 'accepted' or auth.uid() in (requester, addressee));
create policy "buddies insert" on public.buddies for insert
  with check (requester = auth.uid() and status = 'pending');
create policy "buddies accept" on public.buddies for update
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
create policy "buddies delete" on public.buddies for delete
  using (auth.uid() in (requester, addressee));
-- Al aceptar solo se puede cambiar el estado, nunca quién está en la relación
revoke update on public.buddies from anon, authenticated;
grant update (status) on public.buddies to authenticated;

-- Checks: públicos; solo puedes dar el visto a tus buddies
drop policy if exists "acks read"   on public.check_acks;
drop policy if exists "acks write"  on public.check_acks;
drop policy if exists "acks update" on public.check_acks;
drop policy if exists "acks delete" on public.check_acks;
create policy "acks read"   on public.check_acks for select using (true);
create policy "acks write"  on public.check_acks for insert
  with check (from_user = auth.uid() and public.is_buddy(from_user, to_user));
create policy "acks update" on public.check_acks for update
  using (from_user = auth.uid()) with check (from_user = auth.uid() and public.is_buddy(from_user, to_user));
create policy "acks delete" on public.check_acks for delete using (from_user = auth.uid());

-- Privado: solo el dueño
drop policy if exists "tasks own"   on public.tasks;
drop policy if exists "goals own"   on public.goals;
drop policy if exists "journal own" on public.journal;
create policy "tasks own"   on public.tasks   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "goals own"   on public.goals   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "journal own" on public.journal for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists days_user_day   on public.days (user_id, day desc);
create index if not exists acks_to_day     on public.check_acks (to_user, day);
create index if not exists tasks_user      on public.tasks (user_id);
create index if not exists goals_user      on public.goals (user_id, scope, period);
