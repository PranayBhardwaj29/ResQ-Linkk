-- Migration: 20261019000000_create_live_relief_feed.sql
-- Description: Create live_relief_feed table for TinyFish web-agent, search, and fetch relief data

CREATE TABLE IF NOT EXISTS public.live_relief_feed (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('alert', 'shelter', 'news')),
    title TEXT NOT NULL,
    summary TEXT,
    area TEXT,
    severity TEXT CHECK (severity IN ('critical', 'urgent', 'moderate', 'low', 'info')),
    source_url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_live_relief_feed_source_title UNIQUE (source_url, title)
);

-- Index for fast queries by kind, area, and recency
CREATE INDEX IF NOT EXISTS idx_live_relief_feed_kind ON public.live_relief_feed(kind);
CREATE INDEX IF NOT EXISTS idx_live_relief_feed_area ON public.live_relief_feed(area);
CREATE INDEX IF NOT EXISTS idx_live_relief_feed_fetched_at ON public.live_relief_feed(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_relief_feed_is_verified ON public.live_relief_feed(is_verified);

-- Row Level Security (RLS)
ALTER TABLE public.live_relief_feed ENABLE ROW LEVEL SECURITY;

-- Allow read access to anyone (public/anon and authenticated users)
CREATE POLICY "Public read access for live relief feed"
    ON public.live_relief_feed
    FOR SELECT
    USING (true);

-- Allow insert/update for anon and service_role (demo convenience & edge functions)
CREATE POLICY "Allow insert for live relief feed"
    ON public.live_relief_feed
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow update for live relief feed"
    ON public.live_relief_feed
    FOR UPDATE
    USING (true);
