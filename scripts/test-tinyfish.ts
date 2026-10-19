/**
 * TinyFish Integration Verification Script
 * Zero external dependencies — runs directly with tsx or node!
 *
 * Demonstrates: Search API, Fetch API, and Web Agent extraction.
 *
 * Usage:
 *   npx --yes tsx scripts/test-tinyfish.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Read TINYFISH_API_KEY from process.env or web-source/server/.env
function getApiKey(): string {
  if (process.env.TINYFISH_API_KEY) return process.env.TINYFISH_API_KEY;

  const envPaths = [
    path.join(__dirname, '..', 'web-source', 'server', '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), 'web-source', 'server', '.env'),
    path.join(process.cwd(), '.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/TINYFISH_API_KEY\s*=\s*(["']?)(.*?)\1(?:\r?\n|$)/);
      if (match && match[2] && !match[2].startsWith('your_')) {
        return match[2].trim();
      }
    }
  }

  return '';
}

const API_KEY = getApiKey();

const VERIFIED_DOMAINS = [
  'ndma.gov.in',
  'imd.gov.in',
  'mausam.imd.gov.in',
  'ddma.delhi.gov.in',
  'usdma.uk.gov.in',
  'delhi.gov.in',
  'gov.in',
  'nic.in',
];

function isVerified(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return VERIFIED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

async function runDemo() {
  console.log('========================================================');
  console.log('🐟 ResQ Linkk · TinyFish Disaster Relief Integration Demo');
  console.log('========================================================\n');

  if (!API_KEY) {
    console.error('❌ TINYFISH_API_KEY is not set.');
    process.exit(1);
  }

  console.log(`🔑 Using TinyFish API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}`);

  // ── TEST 1: TinyFish Search API ──────────────────────────────────────────────
  console.log('\n--- 1. Testing TinyFish Search API (Alerts & News) ---');
  try {
    const query = 'delhi flood alert';
    const location = 'Delhi';
    const params = new URLSearchParams({
      query: `${query} ${location}`,
      location,
      language: 'en',
      recency_minutes: '1440',
      domain_type: 'news',
    });

    const searchStart = Date.now();
    const searchRes = await fetch(`https://api.search.tinyfish.ai?${params.toString()}`, {
      headers: { 'X-API-Key': API_KEY },
    });
    const searchLatency = Date.now() - searchStart;

    if (searchRes.ok) {
      const data = await searchRes.json();
      const results = (data.results || []).slice(0, 3);
      console.log(`✅ Search succeeded in ${searchLatency}ms! Found ${data.results?.length ?? 0} results.`);
      results.forEach((r: any, idx: number) => {
        const verified = isVerified(r.url);
        console.log(`  [${idx + 1}] ${r.title}`);
        console.log(`      Source: ${r.site_name || r.url} | Verified Domain: ${verified ? 'YES (Official)' : 'NO'}`);
        console.log(`      Snippet: ${r.snippet?.slice(0, 90)}...`);
      });
    } else {
      console.warn(`⚠️ Search returned HTTP ${searchRes.status}`);
    }
  } catch (err: any) {
    console.error('❌ Search error:', err.message);
  }

  // ── TEST 2: TinyFish Fetch API ───────────────────────────────────────────────
  console.log('\n--- 2. Testing TinyFish Fetch API (Clean Text Extraction) ---');
  try {
    const targetUrl = 'https://ddma.delhi.gov.in/ddma/floods';
    const fetchStart = Date.now();
    const fetchRes = await fetch('https://api.fetch.tinyfish.ai', {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls: [targetUrl] }),
    });
    const fetchLatency = Date.now() - fetchStart;

    if (fetchRes.ok) {
      const data = await fetchRes.json();
      const page = data.results?.[0];
      console.log(`✅ Fetch succeeded in ${fetchLatency}ms!`);
      console.log(`   Page Title: ${page?.title || 'N/A'}`);
      console.log(`   Text sample: ${page?.text?.slice(0, 160).replace(/\n/g, ' ')}...`);
    } else {
      console.warn(`⚠️ Fetch returned HTTP ${fetchRes.status}`);
    }
  } catch (err: any) {
    console.error('❌ Fetch error:', err.message);
  }

  // ── TEST 3: TinyFish Web Agent API ──────────────────────────────────────────
  console.log('\n--- 3. Testing TinyFish Web Agent (Autonomous Shelter / Alert Scraping) ---');
  try {
    const agentStart = Date.now();
    const agentRes = await fetch('https://agent.tinyfish.ai/v1/automation/run', {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://ddma.delhi.gov.in/ddma/floods',
        goal: 'Extract the current disaster warnings on this page. Return JSON array: [{title, hazard, severity, area, issued_at, summary}].',
      }),
    });
    const agentLatency = Date.now() - agentStart;

    if (agentRes.ok) {
      const data = await agentRes.json();
      console.log(`✅ Web Agent run completed in ${(agentLatency / 1000).toFixed(1)}s (Status: ${data.status})`);
      const raw = data.result?.result ?? data.result;
      console.log('   Extracted Items:', JSON.stringify(raw, null, 2).slice(0, 400));
    } else {
      console.warn(`⚠️ Agent returned HTTP ${agentRes.status}`);
    }
  } catch (err: any) {
    console.error('❌ Agent error:', err.message);
  }

  console.log('\n========================================================');
  console.log('🎉 TinyFish Relief System Verification Completed');
  console.log('========================================================');
}

runDemo();
