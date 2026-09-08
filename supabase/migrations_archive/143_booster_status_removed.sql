-- New terminal status for a permanently expelled booster (Auth-banned, no
-- row deleted). Isolated in its own migration -- Postgres doesn't allow
-- using a freshly added enum value inside the same transaction that added
-- it. See docs/superpowers/specs/2026-08-03-booster-suspend-expel-design.md.
alter type public.booster_status add value 'removed';
