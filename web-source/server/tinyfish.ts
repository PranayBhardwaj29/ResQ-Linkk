import { RELIEF_SOURCES, isDomainVerified, ReliefSourceConfig } from './tinyfish-config';
import * as fs from 'fs';
import * as path from 'path';

export interface LiveReliefItem {
  id: string;
  kind: 'alert' | 'shelter' | 'news';
  title: string;
  summary: string;
  area: string;
  severity: 'critical' | 'urgent' | 'moderate' | 'low' | 'info';
  source_url: string;
  source_name: string;
  is_verified: boolean;
  fetched_at: string;
  raw: Record<string, any>;
}

const CACHE_FILE = path.join(__dirname, 'data', 'live-relief-store.json');

const DEFAULT_ITEMS: LiveReliefItem[] = [
  {
    id: 'tf-seed-1',
    kind: 'alert',
    title: 'Yamuna Water Level Alert & Floodplain Advisory',
    summary: 'Delhi Disaster Management Authority issues advisory for low-lying areas along Yamuna floodplains. Emergency boats and quick-response teams on standby.',
    area: 'Delhi NCR',
    severity: 'urgent',
    source_url: 'https://ddma.delhi.gov.in/ddma/floods',
    source_name: 'Delhi Disaster Management Authority (DDMA)',
    is_verified: true,
    fetched_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    raw: {},
  },
  {
    id: 'tf-seed-2',
    kind: 'shelter',
    title: 'DUSIB Rain Basera Emergency Relief Camp 14',
    summary: 'Emergency night shelter open with medical kits, dry rations, and waterproof bedding available. Free admission 24/7.',
    area: 'Kashmere Gate, Delhi',
    severity: 'info',
    source_url: 'https://delhishelterboard.in',
    source_name: 'Delhi Shelter Board (DUSIB)',
    is_verified: true,
    fetched_at: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    raw: {},
  },
  {
    id: 'tf-seed-3',
    kind: 'news',
    title: 'Emergency Medical Camp & Water Relief Station Activated',
    summary: 'Indian Red Cross Society deployed 4 mobile disaster ambulances and water purification units near Yamuna Bazar.',
    area: 'Old Delhi',
    severity: 'moderate',
    source_url: 'https://www.indianredcross.org',
    source_name: 'Indian Red Cross Society',
    is_verified: false,
    fetched_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    raw: {},
  },
  {
    id: 'tf-seed-4',
    kind: 'alert',
    title: 'Joshimath-Badrinath NH-7 Landslide Yellow Alert',
    summary: 'Uttarakhand SDMA warns of debris clearance operations between Helang and Govindghat. Travel advised only in daylight hours.',
    area: 'Chamoli / Badrinath',
    severity: 'urgent',
    source_url: 'https://usdma.uk.gov.in',
    source_name: 'Uttarakhand SDMA',
    is_verified: true,
    fetched_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    raw: {},
  },
];

function readLocalCache(): LiveReliefItem[] {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error('[TinyFish] Error reading local cache:', (err as Error).message);
  }
  writeLocalCache(DEFAULT_ITEMS);
  return DEFAULT_ITEMS;
}

function writeLocalCache(items: LiveReliefItem[]) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('[TinyFish] Error writing local cache:', (err as Error).message);
  }
}

/**
 * Helper to fetch with timeout and 1 retry with exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retries: number = 1
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
    } catch (err: any) {
      clearTimeout(timer);
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      const backoffMs = attempt * 1500;
      console.warn(`[TinyFish] Fetch failed (${err.message || 'error'}), retrying in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

/**
 * Defensive JSON extraction from Web Agent responses
 */
function extractJsonArray(rawText: unknown): any[] {
  if (!rawText) return [];
  if (Array.isArray(rawText)) return rawText;
  if (typeof rawText === 'object') {
    // If it's wrapped in an object like { result: [...] } or { shelters: [...] }
    const obj = rawText as Record<string, any>;
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    return [obj];
  }
  if (typeof rawText !== 'string') return [];

  // Try parsing string directly
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
      return [parsed];
    }
  } catch {}

  // Strip code blocks e.g. ```json ... ```
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
    } catch {}
  }

  // Regex match first array [...]
  const arrayMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return [];
}

export class TinyFishReliefService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.TINYFISH_API_KEY || '';
  }

  public hasKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && !this.apiKey.startsWith('your_'));
  }

  /**
   * 1. searchAlerts: Search API with recency filtering (10s timeout, 1 retry)
   */
  async searchAlerts(query: string, location: string): Promise<LiveReliefItem[]> {
    if (!this.hasKey()) {
      console.warn('[TinyFish] Search skipped: TINYFISH_API_KEY not set.');
      return [];
    }

    const params = new URLSearchParams({
      query: `${query} ${location} disaster relief alerts`,
      location: location || 'Delhi',
      language: 'en',
      recency_minutes: '1440', // past 24 hours
      domain_type: 'news',
    });

    try {
      const res = await fetchWithRetry(
        `https://api.search.tinyfish.ai?${params.toString()}`,
        {
          headers: {
            'X-API-Key': this.apiKey,
          },
        },
        10000, // 10 s timeout
        1
      );

      if (!res.ok) {
        console.error(`[TinyFish] Search returned status: ${res.status}`);
        return [];
      }

      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];

      const items: LiveReliefItem[] = results.map((r: any, idx: number) => {
        const url = r.url || '';
        const title = r.title || 'Disaster Alert Update';
        const isOfficial = isDomainVerified(url);
        return {
          id: `tf-search-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'news',
          title: title.trim(),
          summary: (r.snippet || r.description || 'Live alert discovered via TinyFish Search.').trim(),
          area: location,
          severity: 'urgent',
          source_url: url,
          source_name: r.site_name || new URL(url).hostname,
          is_verified: isOfficial,
          fetched_at: new Date().toISOString(),
          raw: r,
        };
      });

      return items;
    } catch (err: any) {
      console.error('[TinyFish] Search failed:', err.message || 'unknown error');
      return [];
    }
  }

  /**
   * 2. fetchPages: Fetch API for clean text extraction
   */
  async fetchPages(urls: string[]): Promise<Array<{ url: string; title: string; text: string }>> {
    if (!this.hasKey() || urls.length === 0) return [];

    try {
      const res = await fetchWithRetry(
        'https://api.fetch.tinyfish.ai',
        {
          method: 'POST',
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ urls }),
        },
        15000, // 15 s timeout
        1
      );

      if (!res.ok) {
        console.error(`[TinyFish] Fetch returned status: ${res.status}`);
        return [];
      }

      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      return results.map((r: any) => ({
        url: r.url || '',
        title: r.title || '',
        text: r.text || r.description || '',
      }));
    } catch (err: any) {
      console.error('[TinyFish] Fetch pages failed:', err.message || 'unknown error');
      return [];
    }
  }

  /**
   * 3. runAgent: Web Agent natural-language browsing (120s timeout, 1 retry)
   */
  async runAgent(url: string, goal: string): Promise<any[]> {
    if (!this.hasKey()) {
      console.warn('[TinyFish] Agent skipped: TINYFISH_API_KEY not set.');
      return [];
    }

    try {
      const res = await fetchWithRetry(
        'https://agent.tinyfish.ai/v1/automation/run',
        {
          method: 'POST',
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, goal }),
        },
        120000, // 120 s timeout
        1
      );

      if (!res.ok) {
        console.error(`[TinyFish] Agent request failed with status: ${res.status}`);
        return [];
      }

      const data = await res.json();
      if (data?.status === 'FAILED') {
        console.warn(`[TinyFish] Agent run finished with status FAILED: ${data.error || 'unknown'}`);
        return [];
      }

      const rawResult = data?.result?.result ?? data?.result ?? data?.data;
      return extractJsonArray(rawResult);
    } catch (err: any) {
      console.error('[TinyFish] Agent execution failed:', err.message || 'unknown error');
      return [];
    }
  }

  /**
   * Run full relief refresh for a given area using configured sources
   */
  async refreshReliefData(area: string = 'Delhi NCR'): Promise<LiveReliefItem[]> {
    const existing = readLocalCache();
    if (!this.hasKey()) {
      console.warn('[TinyFish] No API key; returning existing cached relief feed.');
      return existing;
    }

    const newItems: LiveReliefItem[] = [];

    // 1. Search for live alerts & news (fast: 1-3s)
    try {
      const searchItems = await this.searchAlerts('disaster flood weather warning', area);
      newItems.push(...searchItems);
    } catch (e: any) {
      console.warn('[TinyFish] Search step error:', e.message);
    }

    // 2. Run agent on configured sources matching area
    const areaSources = RELIEF_SOURCES.filter(
      (s) => s.area.toLowerCase().includes(area.toLowerCase()) || s.area === 'National'
    );

    const alertSource = areaSources.find((s) => s.goalType === 'alerts') || RELIEF_SOURCES[0];
    const shelterSource = areaSources.find((s) => s.goalType === 'shelters') || RELIEF_SOURCES[3];

    const agentTasks: Promise<void>[] = [];

    if (alertSource) {
      agentTasks.push((async () => {
        try {
          const alertGoal =
            'Extract the current disaster warnings on this page. Return JSON array: [{title, hazard, severity, area, issued_at, summary}].';
          const alerts = await this.runAgent(alertSource.url, alertGoal);
          for (const a of alerts) {
            if (!a || !a.title) continue;
            newItems.push({
              id: `tf-agent-alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'alert',
              title: a.title,
              summary: a.summary || `${a.hazard || 'Warning'} in ${a.area || alertSource.area}. Severity: ${a.severity || 'Urgent'}`,
              area: a.area || alertSource.area,
              severity: (a.severity?.toLowerCase() === 'critical' ? 'critical' : 'urgent'),
              source_url: alertSource.url,
              source_name: alertSource.name,
              is_verified: isDomainVerified(alertSource.url),
              fetched_at: new Date().toISOString(),
              raw: a,
            });
          }
        } catch (err: any) {
          console.warn('[TinyFish] Alert agent error:', err.message);
        }
      })());
    }

    if (shelterSource) {
      agentTasks.push((async () => {
        try {
          const shelterGoal =
            'Find the list of active relief camps or shelters on this page. Return JSON array: [{name, district, address, capacity, status, contact}].';
          const shelters = await this.runAgent(shelterSource.url, shelterGoal);
          for (const s of shelters) {
            if (!s || !s.name) continue;
            newItems.push({
              id: `tf-agent-shelter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'shelter',
              title: s.name,
              summary: `Relief Shelter in ${s.district || s.address || area}. Status: ${s.status || 'Active'}. Capacity: ${s.capacity || 'Open'}. Contact: ${s.contact || 'N/A'}`,
              area: s.district || area,
              severity: 'info',
              source_url: shelterSource.url,
              source_name: shelterSource.name,
              is_verified: isDomainVerified(shelterSource.url),
              fetched_at: new Date().toISOString(),
              raw: s,
            });
          }
        } catch (err: any) {
          console.warn('[TinyFish] Shelter agent error:', err.message);
        }
      })());
    }

    // Wait for agent tasks with a 25-second cap so HTTP client doesn't time out
    await Promise.race([
      Promise.allSettled(agentTasks),
      new Promise((resolve) => setTimeout(resolve, 25000)),
    ]);

    // Deduplicate on (source_url, title)
    const combined = [...newItems, ...existing];
    const dedupedMap = new Map<string, LiveReliefItem>();
    for (const item of combined) {
      const key = `${item.source_url.toLowerCase().trim()}|${item.title.toLowerCase().trim()}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, item);
      }
    }

    const finalItems = Array.from(dedupedMap.values());
    writeLocalCache(finalItems);
    return finalItems;
  }

  /**
   * Get cached or live relief items
   */
  getItems(filter?: { kind?: string; area?: string }): LiveReliefItem[] {
    let items = readLocalCache();
    if (filter?.kind && filter.kind !== 'all') {
      items = items.filter((i) => i.kind === filter.kind);
    }
    if (filter?.area) {
      const targetArea = filter.area.toLowerCase();
      items = items.filter(
        (i) => i.area.toLowerCase().includes(targetArea) || i.area === 'National'
      );
    }
    return items;
  }
}
