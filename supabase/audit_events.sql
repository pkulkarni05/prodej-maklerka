-- prodej-maklerka: audit_events table (Option A)
-- Run this in Supabase SQL Editor for your project.

create extension if not exists pgcrypto;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,

  property_id uuid null,
  applicant_id uuid null,
  viewing_token_id uuid null,

  -- Best-effort client fingerprint (avoid storing full PII)
  client_ip text null,
  user_agent text null,

  -- Optional: store a short hash prefix (never the raw token)
  token_hash_prefix text null,

  -- Any extra low-risk context (keep small)
  meta jsonb null
);

create index if not exists audit_events_created_at_idx
  on public.audit_events (created_at desc);

create index if not exists audit_events_event_type_idx
  on public.audit_events (event_type);

create index if not exists audit_events_property_id_idx
  on public.audit_events (property_id);

create index if not exists audit_events_applicant_id_idx
  on public.audit_events (applicant_id);

