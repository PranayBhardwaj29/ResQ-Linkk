// Supabase Edge Function: tinyfish-relief
// Follows standard Deno serve format for Supabase Edge Functions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const VERIFIED_DOMAINS = [
  "ndma.gov.in",
  "imd.gov.in",
  "mausam.imd.gov.in",
  "ddma.delhi.gov.in",
  "usdma.uk.gov.in",
  "uk.gov.in",
  "delhi.gov.in",
  "india-water.gov.in",
  "gov.in",
  "nic.in",
];

const SOURCES = [
  {
    id: "ndma-official",
    name: "National Disaster Management Authority (NDMA)",
    url: "https://ndma.gov.in",
    area: "National",
    isOfficial: true,
    goalType: "alerts",
  },
  {
    id: "ddma-delhi",
    name: "Delhi Disaster Management Authority (DDMA)",
    url: "https://ddma.delhi.gov.in/ddma/floods",
    area: "Delhi NCR",
    isOfficial: true,
    goalType: "alerts",
  },
  {
    id: "ddma-shelters",
    name: "Delhi Relief & Night Shelter Board (DUSIB)",
    url: "https://delhishelterboard.in",
    area: "Delhi NCR",
    isOfficial: true,
    goalType: "shelters",
  },
  {
    id: "usdma-uttarakhand",
    name: "Uttarakhand State Disaster Management Authority",
    url: "https://usdma.uk.gov.in",
    area: "Badrinath / Uttarakhand",
    isOfficial: true,
    goalType: "alerts",
  },
  {
    id: "redcross-india",
    name: "Indian Red Cross Society Disaster Relief",
    url: "https://www.indianredcross.org",
    area: "National",
    isOfficial: false,
    goalType: "shelters",
  },
];

function isDomainVerified(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    return VERIFIED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retries = 1
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        throw new Error(`Server error ${res.status}`);
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      attempt++;
      if (attempt > retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

function extractJsonArray(rawText: unknown): any[] {
  if (!rawText) return [];
  if (Array.isArray(rawText)) return rawText;
  if (typeof rawText === "object") {
    const obj = rawText as Record<string, any>;
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    return [obj];
  }
  if (typeof rawText !== "string") return [];

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
      return [parsed];
    }
  } catch {}

  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  const arrayMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return [];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("TINYFISH_API_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

  let supabase: any = null;
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "feed";
    const area = body.area || "Delhi NCR";

    // 1. Return cached feed from Supabase table if requested
    if (action === "feed" && supabase) {
      const { data, error } = await supabase
        .from("live_relief_feed")
        .select("*")
        .order("fetched_at", { ascending: false })
        .limit(50);

      if (!error && data && data.length > 0) {
        return new Response(JSON.stringify({ ok: true, items: data, source: "supabase" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Refresh action: fetch from TinyFish Search and Agent
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "TINYFISH_API_KEY environment variable is not configured.",
          items: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const items: any[] = [];

    // TinyFish Search API (10s timeout, 1 retry)
    try {
      const searchParams = new URLSearchParams({
        query: `disaster flood weather alert ${area}`,
        location: area,
        language: "en",
        recency_minutes: "1440",
        domain_type: "news",
      });

      const searchRes = await fetchWithRetry(
        `https://api.search.tinyfish.ai?${searchParams.toString()}`,
        { headers: { "X-API-Key": apiKey } },
        10000,
        1
      );

      if (searchRes.ok) {
        const searchJson = await searchRes.json();
        const results = Array.isArray(searchJson?.results) ? searchJson.results : [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const url = r.url || "";
          items.push({
            id: `tf-search-${Date.now()}-${i}`,
            kind: "news",
            title: r.title || "Live Disaster News",
            summary: r.snippet || r.description || "Live alert via TinyFish Search",
            area,
            severity: "urgent",
            source_url: url,
            source_name: r.site_name || "Disaster News",
            is_verified: isDomainVerified(url),
            fetched_at: new Date().toISOString(),
            raw: r,
          });
        }
      }
    } catch (e) {
      console.error("[TinyFish Edge] Search error:", e);
    }

    // TinyFish Web Agent API (120s timeout, 1 retry)
    try {
      const source = SOURCES.find((s) => s.area.toLowerCase().includes(area.toLowerCase())) || SOURCES[0];
      const goal =
        source.goalType === "shelters"
          ? "Find the list of active relief camps or shelters on this page. Return JSON array: [{name, district, address, capacity, status, contact}]."
          : "Extract the current disaster warnings on this page. Return JSON array: [{title, hazard, severity, area, issued_at, summary}].";

      const agentRes = await fetchWithRetry(
        "https://agent.tinyfish.ai/v1/automation/run",
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: source.url, goal }),
        },
        120000,
        1
      );

      if (agentRes.ok) {
        const agentJson = await agentRes.json();
        const rawResult = agentJson?.result?.result ?? agentJson?.result;
        const parsed = extractJsonArray(rawResult);

        for (let j = 0; j < parsed.length; j++) {
          const item = parsed[j];
          if (!item || (!item.title && !item.name)) continue;
          const isShelter = source.goalType === "shelters";
          items.push({
            id: `tf-agent-${Date.now()}-${j}`,
            kind: isShelter ? "shelter" : "alert",
            title: isShelter ? item.name : item.title,
            summary: isShelter
              ? `Shelter in ${item.district || area}. Capacity: ${item.capacity || "Open"}. Contact: ${item.contact || "N/A"}`
              : item.summary || `${item.hazard || "Warning"} in ${item.area || area}`,
            area: item.area || item.district || area,
            severity: isShelter ? "info" : item.severity?.toLowerCase() === "critical" ? "critical" : "urgent",
            source_url: source.url,
            source_name: source.name,
            is_verified: isDomainVerified(source.url),
            fetched_at: new Date().toISOString(),
            raw: item,
          });
        }
      }
    } catch (e) {
      console.error("[TinyFish Edge] Agent error:", e);
    }

    // Deduplicate on (source_url, title)
    const dedupedMap = new Map<string, any>();
    for (const item of items) {
      const key = `${item.source_url.toLowerCase().trim()}|${item.title.toLowerCase().trim()}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, item);
      }
    }
    const finalItems = Array.from(dedupedMap.values());

    // Upsert into Supabase table if client available
    if (supabase && finalItems.length > 0) {
      try {
        await supabase.from("live_relief_feed").upsert(
          finalItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            summary: item.summary,
            area: item.area,
            severity: item.severity,
            source_url: item.source_url,
            source_name: item.source_name,
            is_verified: item.is_verified,
            fetched_at: item.fetched_at,
            raw: item.raw,
          })),
          { onConflict: "source_url,title" }
        );
      } catch (upsertErr) {
        console.error("[TinyFish Edge] Supabase upsert error:", upsertErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, items: finalItems, refreshed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
