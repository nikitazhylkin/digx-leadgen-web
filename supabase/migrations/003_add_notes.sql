-- Free-form notes per lead. Shown in the side drawer and editable inline.
-- Use case: a teammate or Nikita jots observations during outreach
-- ("replied on LinkedIn 4/22 — meeting Fri", "wrong company size", etc.)

alter table public.leads add column if not exists notes text;
