-- Focus Mastery · lista de to-dos rápidos (pestaña "To-dos" del tablero)
-- Pega este archivo en Supabase → SQL Editor → Run. Es seguro ejecutarlo más de una vez.

create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 300),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.todos to authenticated;

alter table public.todos enable row level security;
drop policy if exists "todos own" on public.todos;
create policy "todos own" on public.todos for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists todos_user on public.todos (user_id, created_at);
