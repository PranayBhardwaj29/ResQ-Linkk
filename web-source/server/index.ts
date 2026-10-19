import express, { Request, Response } from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { TinyFishReliefService } from './tinyfish';
import { RELIEF_SOURCES } from './tinyfish-config';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3001;
const tinyFishService = new TinyFishReliefService();

// Allow requests from all origins (localhost, Wi-Fi LAN IP, mobile devices)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '64kb' }));
// Also accept url-encoded bodies (some proxies rewrite Content-Type)
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// ── Data directory ────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sync-store.json');
const NGO_FILE  = path.join(DATA_DIR, 'ngo-store.json');

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); }
  catch (e) { console.error('[DataDir] mkdir error:', e); }
}

// ── Sync Store (existing) ─────────────────────────────────────────────────────
interface SyncStore {
  requests: any[];
  resolvedIds: string[];
  helpingIds: string[];
  version: number;
}

function readStore(): SyncStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) { console.error('[SyncStore] Read error:', e); }
  return { requests: [], resolvedIds: [], helpingIds: [], version: 1 };
}

function writeStore(data: SyncStore) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('[SyncStore] Write error:', e); }
}

let syncStore = readStore();

// ── NGO Store (new) ───────────────────────────────────────────────────────────

type RescueTaskStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'AWAITING_CONFIRMATION'
  | 'RESCUED'
  | 'CANCELLED';

type VolunteerMemberStatus = 'AVAILABLE' | 'ON_MISSION' | 'OFFLINE';

interface NgoProfile {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  serviceArea: string;
  description: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'SUSPENDED';
  passwordHash: string;
  createdAt: number;
}

interface VolunteerMember {
  id: string;
  ngoId: string;
  fullName: string;
  phone: string;
  email: string;
  skills: string[];
  status: VolunteerMemberStatus;
  currentTaskId: string | null;
  joinedAt: number;
}

interface RescueTask {
  id: string;
  requestId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  location: string;
  coords: { x: number; y: number };
  peopleCount: number;
  contactName: string;
  contactPhone: string;
  region: string;
  status: RescueTaskStatus;
  assignedNgoId: string | null;
  assignedNgoName: string | null;
  assignedVolunteerId: string | null;
  assignedVolunteerName: string | null;
  createdAt: number;
  assignedAt: number | null;
  startedAt: number | null;
  completionRequestedAt: number | null;
  confirmedAt: number | null;
  completedAt: number | null;
  confirmedByNgoId: string | null;
  confirmedByName: string | null;
  cancelledAt: number | null;
  cancelReason: string | null;
}

interface NgoStore {
  ngos: NgoProfile[];
  volunteers: VolunteerMember[];
  tasks: RescueTask[];
  version: number;
}

function readNgoStore(): NgoStore {
  try {
    if (fs.existsSync(NGO_FILE)) {
      const raw = fs.readFileSync(NGO_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) { console.error('[NgoStore] Read error:', e); }
  return { ngos: [], volunteers: [], tasks: [], version: 1 };
}

function writeNgoStore(data: NgoStore) {
  // Throws on failure — callers must wrap in try/catch to handle gracefully
  fs.writeFileSync(NGO_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let ngoStore = readNgoStore();

/**
 * Simple deterministic hash (not cryptographic — demo only).
 * For production replace with bcrypt.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(36) + str.length.toString(36);
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Gemini client ─────────────────────────────────────────────────────────────
const API_KEY    = process.env.GEMINI_API_KEY;
const GEMINI_READY = !!(API_KEY && API_KEY.trim() && !API_KEY.startsWith('your_'));

const SYSTEM_INSTRUCTION = `You are the Disaster Assistant for a disaster-management application called ResQLink.

Your responsibilities are:
1. Explain how the application works.
2. Provide simple, basic, safety-focused disaster guidance.
3. Help users find resources using ONLY the application data provided to you in the context.
4. Adapt your responses to the currently selected region.
5. NEVER invent locations, shelter names, shelter capacity, available beds, hospitals, food points, water points, rescue locations, distances, or any other resource details.
6. Keep answers short, clear, and practical — maximum 4-5 sentences or 5 bullet points.
7. Use numbered steps or bullet points for emergency guidance.
8. Use simple language suitable for someone under stress.
9. If the user appears to be facing immediate danger, first say: call emergency services immediately, then move to the nearest safe location.
10. Do not provide dangerous, experimental, or risky instructions.
11. Do not pretend to be a doctor, firefighter, rescue worker, or emergency responder.
12. If you do not know something, say so clearly instead of guessing.
13. Reply in English when asked in English; reply in Hindi/Hinglish when asked in Hindi/Hinglish.
14. For resources (shelters, hospitals, food, water, rescue), only reference what appears in the structured app data given to you.
15. If the requested information is not in the app data, say: "I don't currently have that information in the app."`;

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    gemini: GEMINI_READY,
    tinyfish: tinyFishService.hasKey(),
    syncRequestsCount: syncStore.requests.length,
    ngoCount: ngoStore.ngos.length,
    rescueTaskCount: ngoStore.tasks.length,
    tinyfishReliefCount: tinyFishService.getItems().length,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TINYFISH RELIEF ENDPOINTS (Search, Fetch, Web Agent)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/tinyfish-relief — get current cached/live relief feed items
app.get('/api/tinyfish-relief', (req: Request, res: Response) => {
  const kind = (req.query.kind as string) || undefined;
  const area = (req.query.area as string) || undefined;
  const items = tinyFishService.getItems({ kind, area });
  res.json({
    ok: true,
    configured: tinyFishService.hasKey(),
    count: items.length,
    items,
  });
});

// POST /api/tinyfish-relief/refresh — fetch live relief data from TinyFish
app.post('/api/tinyfish-relief/refresh', async (req: Request, res: Response) => {
  const area = (req.body?.area as string) || 'Delhi NCR';
  try {
    const items = await tinyFishService.refreshReliefData(area);
    res.json({
      ok: true,
      refreshed: true,
      count: items.length,
      items,
    });
  } catch (err: any) {
    console.error('[TinyFish] Refresh route error:', err.message || err);
    res.json({
      ok: false,
      error: 'Failed to refresh TinyFish live data, returned cached data.',
      items: tinyFishService.getItems({ area }),
    });
  }
});

// POST /api/tinyfish-relief/search — search alerts via TinyFish Search API
app.post('/api/tinyfish-relief/search', async (req: Request, res: Response) => {
  const { query, location } = req.body as { query: string; location: string };
  try {
    const items = await tinyFishService.searchAlerts(query || 'disaster flood', location || 'Delhi');
    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Search failed' });
  }
});

// POST /api/tinyfish-relief/fetch — fetch clean page content via TinyFish Fetch API
app.post('/api/tinyfish-relief/fetch', async (req: Request, res: Response) => {
  const { urls } = req.body as { urls: string[] };
  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ ok: false, error: 'urls array required' });
    return;
  }
  try {
    const results = await tinyFishService.fetchPages(urls);
    res.json({ ok: true, results });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Fetch failed' });
  }
});

// POST /api/tinyfish-relief/agent — run Web Agent on page with custom goal
app.post('/api/tinyfish-relief/agent', async (req: Request, res: Response) => {
  const { url, goal } = req.body as { url: string; goal: string };
  if (!url || !goal) {
    res.status(400).json({ ok: false, error: 'url and goal are required' });
    return;
  }
  try {
    const results = await tinyFishService.runAgent(url, goal);
    res.json({ ok: true, results });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Agent failed' });
  }
});

// POST /api/tinyfish-relief/summary — AI bilingual situation summary
app.post('/api/tinyfish-relief/summary', async (req: Request, res: Response) => {
  const area = (req.body?.area as string) || 'Delhi NCR';
  const items = tinyFishService.getItems({ area }).slice(0, 8);

  if (items.length === 0) {
    res.json({
      ok: true,
      summaryEn: `No active disaster warnings reported in ${area} at this time. Regular monitoring active.`,
      summaryHi: `${area} में इस समय कोई सक्रिय आपदा चेतावनी नहीं है। निगरानी जारी है।`,
      itemCount: 0,
    });
    return;
  }

  if (!GEMINI_READY) {
    const topAlerts = items.map((i) => `• ${i.title} (${i.source_name})`).join('\n');
    res.json({
      ok: true,
      summaryEn: `Active alerts for ${area} from verified sources:\n${topAlerts}`,
      summaryHi: `${area} के लिए लाइव अलर्ट प्राप्त हुए हैं। कृपया सुरक्षा दिशानिर्देशों का पालन करें।`,
      itemCount: items.length,
    });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY! });
    const prompt = `You are the ResQ Linkk AI coordinator. Below are live disaster relief items fetched from the open web via TinyFish for the area "${area}":
${JSON.stringify(items.map(i => ({ title: i.title, summary: i.summary, severity: i.severity, source: i.source_name })))}

Provide a concise, 3-bullet-point situational briefing in two languages:
1. English (brief summary of hazards, affected areas, and action advice)
2. Hindi (हिंदी में सरल, स्पष्ट सारांश)

Return strict JSON format:
{
  "summaryEn": "...",
  "summaryHi": "..."
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 600,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      ok: true,
      summaryEn: parsed.summaryEn || 'Situation monitoring active.',
      summaryHi: parsed.summaryHi || 'स्थिति की निगरानी जारी है।',
      itemCount: items.length,
    });
  } catch (err: any) {
    console.error('[TinyFish] Situation summary generation error:', err.message || err);
    res.json({
      ok: true,
      summaryEn: `Live relief data updated for ${area} with ${items.length} verified alerts and resources.`,
      summaryHi: `${area} के लिए लाइव राहत डेटा अपडेट हो गया है।`,
      itemCount: items.length,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EXISTING SYNC ENDPOINTS (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/sync', (_req: Request, res: Response) => {
  res.json(syncStore);
});

app.post('/api/sync/request', (req: Request, res: Response) => {
  const newReq = req.body;
  if (!newReq || !newReq.id) {
    res.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  const idx = syncStore.requests.findIndex((r) => r.id === newReq.id);
  if (idx >= 0) {
    syncStore.requests[idx] = newReq;
  } else {
    syncStore.requests.unshift(newReq);
  }
  syncStore.resolvedIds = syncStore.resolvedIds.filter((id) => id !== newReq.id);
  syncStore.version += 1;
  writeStore(syncStore);
  res.json({ ok: true, store: syncStore });
});

app.post('/api/sync/resolve', (req: Request, res: Response) => {
  const { id } = req.body as { id: string };
  if (!id) { res.status(400).json({ error: 'Missing request id.' }); return; }
  if (!syncStore.resolvedIds.includes(id)) syncStore.resolvedIds.push(id);
  syncStore.requests = syncStore.requests.filter((r) => r.id !== id);
  syncStore.version += 1;
  writeStore(syncStore);
  res.json({ ok: true, store: syncStore });
});

app.post('/api/sync/help', (req: Request, res: Response) => {
  const { id } = req.body as { id: string };
  if (!id) { res.status(400).json({ error: 'Missing request id.' }); return; }
  if (!syncStore.helpingIds.includes(id)) syncStore.helpingIds.push(id);
  syncStore.version += 1;
  writeStore(syncStore);
  res.json({ ok: true, store: syncStore });
});

app.post('/api/sync/cancel-help', (req: Request, res: Response) => {
  const { id } = req.body as { id: string };
  if (!id) { res.status(400).json({ error: 'Missing request id.' }); return; }
  syncStore.helpingIds = syncStore.helpingIds.filter((item) => item !== id);
  syncStore.version += 1;
  writeStore(syncStore);
  res.json({ ok: true, store: syncStore });
});

app.post('/api/sync/restore', (_req: Request, res: Response) => {
  syncStore.resolvedIds = [];
  syncStore.version += 1;
  writeStore(syncStore);
  res.json({ ok: true, store: syncStore });
});

// ═════════════════════════════════════════════════════════════════════════════
// NGO AUTHENTICATION ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

/** POST /api/ngo/register */
app.post('/api/ngo/register', (req: Request, res: Response) => {
  // Guard: body-parser sets req.body to undefined if Content-Type is not application/json
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({
      error: 'Request body is missing or not JSON. Send Content-Type: application/json.',
    });
    return;
  }

  const { name, contactPerson, phone, email, serviceArea, description, password } =
    req.body as {
      name: string; contactPerson: string; phone: string; email: string;
      serviceArea: string; description: string; password: string;
    };

  if (!name || !contactPerson || !phone || !email || !password) {
    res.status(400).json({ error: 'name, contactPerson, phone, email, and password are required.' });
    return;
  }

  // Prevent duplicate email
  const existing = ngoStore.ngos.find((n) => n.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'An NGO with this email already exists.' });
    return;
  }

  const ngo: NgoProfile = {
    id: generateId('ngo'),
    name: name.trim(),
    contactPerson: contactPerson.trim(),
    phone: phone.trim(),
    email: email.trim().toLowerCase(),
    serviceArea: (serviceArea || '').trim(),
    description: (description || '').trim(),
    verificationStatus: 'PENDING',
    passwordHash: simpleHash(password),
    createdAt: Date.now(),
  };

  ngoStore.ngos.push(ngo);
  ngoStore.version += 1;

  try {
    writeNgoStore(ngoStore);
  } catch (writeErr) {
    console.error('[NGO Register] Failed to persist ngo-store.json:', writeErr);
    // Remove the in-memory push so state stays consistent
    ngoStore.ngos.pop();
    res.status(500).json({
      error: 'Registration could not be saved. Please try again.',
    });
    return;
  }

  // Return profile without passwordHash
  const { passwordHash: _ph, ...safeProfile } = ngo;
  res.json({ ok: true, ngo: safeProfile });
});

/** POST /api/ngo/login */
app.post('/api/ngo/login', (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Request body is missing or not JSON.' });
    return;
  }
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' });
    return;
  }

  const ngo = ngoStore.ngos.find((n) => n.email.toLowerCase() === email.trim().toLowerCase());
  if (!ngo || ngo.passwordHash !== simpleHash(password)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (ngo.verificationStatus === 'SUSPENDED') {
    res.status(403).json({ error: 'This NGO account has been suspended.' });
    return;
  }

  const { passwordHash: _ph, ...safeProfile } = ngo;
  res.json({ ok: true, ngo: safeProfile });
});

/** GET /api/ngo/:ngoId — fetch NGO profile */
app.get('/api/ngo/:ngoId', (req: Request, res: Response) => {
  const ngo = ngoStore.ngos.find((n) => n.id === req.params.ngoId);
  if (!ngo) { res.status(404).json({ error: 'NGO not found.' }); return; }
  const { passwordHash: _ph, ...safeProfile } = ngo;
  res.json(safeProfile);
});

/** PUT /api/ngo/:ngoId — update NGO profile */
app.put('/api/ngo/:ngoId', (req: Request, res: Response) => {
  const idx = ngoStore.ngos.findIndex((n) => n.id === req.params.ngoId);
  if (idx < 0) { res.status(404).json({ error: 'NGO not found.' }); return; }

  const allowed = ['name', 'contactPerson', 'phone', 'serviceArea', 'description'];
  const update  = req.body as Partial<NgoProfile>;
  const ngo     = ngoStore.ngos[idx];

  for (const key of allowed) {
    if (update[key as keyof NgoProfile] !== undefined) {
      (ngo as any)[key] = (update as any)[key];
    }
  }

  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  const { passwordHash: _ph, ...safeProfile } = ngo;
  res.json({ ok: true, ngo: safeProfile });
});

// ═════════════════════════════════════════════════════════════════════════════
// VOLUNTEER MEMBER ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

/** GET /api/ngo/:ngoId/volunteers */
app.get('/api/ngo/:ngoId/volunteers', (req: Request, res: Response) => {
  const members = ngoStore.volunteers.filter((v) => v.ngoId === req.params.ngoId);
  res.json(members);
});

/** POST /api/ngo/:ngoId/volunteers — add a volunteer to an NGO */
app.post('/api/ngo/:ngoId/volunteers', (req: Request, res: Response) => {
  const ngoId = req.params.ngoId;
  const ngo   = ngoStore.ngos.find((n) => n.id === ngoId);
  if (!ngo) { res.status(404).json({ error: 'NGO not found.' }); return; }

  const { fullName, phone, email, skills } = req.body as {
    fullName: string; phone: string; email?: string; skills?: string[];
  };

  if (!fullName || !phone) {
    res.status(400).json({ error: 'fullName and phone are required.' });
    return;
  }

  // Prevent duplicate phone within same NGO
  const dup = ngoStore.volunteers.find((v) => v.ngoId === ngoId && v.phone === phone.trim());
  if (dup) {
    res.status(409).json({ error: 'A volunteer with this phone is already in your NGO.' });
    return;
  }

  const member: VolunteerMember = {
    id: generateId('vmem'),
    ngoId,
    fullName: fullName.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    skills: Array.isArray(skills) ? skills : [],
    status: 'AVAILABLE',
    currentTaskId: null,
    joinedAt: Date.now(),
  };

  ngoStore.volunteers.push(member);
  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, volunteer: member });
});

/** PUT /api/ngo/volunteers/:volunteerId/status — update volunteer status */
app.put('/api/ngo/volunteers/:volunteerId/status', (req: Request, res: Response) => {
  const idx = ngoStore.volunteers.findIndex((v) => v.id === req.params.volunteerId);
  if (idx < 0) { res.status(404).json({ error: 'Volunteer not found.' }); return; }

  const { status } = req.body as { status: VolunteerMemberStatus };
  const valid: VolunteerMemberStatus[] = ['AVAILABLE', 'ON_MISSION', 'OFFLINE'];
  if (!valid.includes(status)) {
    res.status(400).json({ error: 'Invalid status.' });
    return;
  }

  ngoStore.volunteers[idx].status = status;
  if (status !== 'ON_MISSION') ngoStore.volunteers[idx].currentTaskId = null;
  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, volunteer: ngoStore.volunteers[idx] });
});

/** DELETE /api/ngo/volunteers/:volunteerId */
app.delete('/api/ngo/volunteers/:volunteerId', (req: Request, res: Response) => {
  const idx = ngoStore.volunteers.findIndex((v) => v.id === req.params.volunteerId);
  if (idx < 0) { res.status(404).json({ error: 'Volunteer not found.' }); return; }

  // Only delete if not currently on a mission
  if (ngoStore.volunteers[idx].status === 'ON_MISSION') {
    res.status(409).json({ error: 'Cannot remove a volunteer who is currently on a mission.' });
    return;
  }

  ngoStore.volunteers.splice(idx, 1);
  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// RESCUE TASK ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

/** GET /api/rescue-tasks — all tasks (public, filtered by status for volunteer view) */
app.get('/api/rescue-tasks', (req: Request, res: Response) => {
  const { status, region, ngoId } = req.query as {
    status?: string; region?: string; ngoId?: string;
  };

  let tasks = [...ngoStore.tasks];
  if (status)  tasks = tasks.filter((t) => t.status === status);
  if (region)  tasks = tasks.filter((t) => t.region === region);
  if (ngoId)   tasks = tasks.filter((t) => t.assignedNgoId === ngoId);

  // Sort newest first
  tasks.sort((a, b) => b.createdAt - a.createdAt);
  res.json(tasks);
});

/** GET /api/rescue-tasks/available — only AVAILABLE tasks (volunteer list view) */
app.get('/api/rescue-tasks/available', (_req: Request, res: Response) => {
  const available = ngoStore.tasks
    .filter((t) => t.status === 'AVAILABLE')
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(available);
});

/** GET /api/rescue-tasks/:taskId */
app.get('/api/rescue-tasks/:taskId', (req: Request, res: Response) => {
  const task = ngoStore.tasks.find((t) => t.id === req.params.taskId);
  if (!task) { res.status(404).json({ error: 'Task not found.' }); return; }
  res.json(task);
});

/** POST /api/rescue-tasks — create a rescue task from an AidRequest */
app.post('/api/rescue-tasks', (req: Request, res: Response) => {
  const body = req.body as {
    requestId: string; title: string; description: string;
    category: string; priority: string; location: string;
    coords: { x: number; y: number }; peopleCount: number;
    contactName: string; contactPhone: string; region: string;
  };

  if (!body.requestId || !body.title) {
    res.status(400).json({ error: 'requestId and title are required.' });
    return;
  }

  // Idempotent: if a task already exists for this requestId, return it
  const existing = ngoStore.tasks.find((t) => t.requestId === body.requestId);
  if (existing) {
    res.json({ ok: true, task: existing, alreadyExists: true });
    return;
  }

  const task: RescueTask = {
    id: generateId('task'),
    requestId:    body.requestId,
    title:        body.title,
    description:  body.description || '',
    category:     body.category   || 'rescue',
    priority:     body.priority   || 'urgent',
    location:     body.location   || '',
    coords:       body.coords     || { x: 50, y: 50 },
    peopleCount:  body.peopleCount || 1,
    contactName:  body.contactName || '',
    contactPhone: body.contactPhone || '',
    region:       body.region     || 'ncr',
    status:       'AVAILABLE',
    assignedNgoId:        null,
    assignedNgoName:      null,
    assignedVolunteerId:  null,
    assignedVolunteerName: null,
    createdAt:               Date.now(),
    assignedAt:              null,
    startedAt:               null,
    completionRequestedAt:   null,
    confirmedAt:             null,
    completedAt:             null,
    confirmedByNgoId:        null,
    confirmedByName:         null,
    cancelledAt:             null,
    cancelReason:            null,
  };

  ngoStore.tasks.push(task);
  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, task });
});

/**
 * POST /api/rescue-tasks/:taskId/assign
 *
 * ATOMIC ASSIGNMENT — the critical section.
 * Uses a synchronous file-read + write cycle as a pessimistic lock.
 * The in-process ngoStore is the source of truth; all other requests
 * wait for the synchronous write before responding.
 */
app.post('/api/rescue-tasks/:taskId/assign', (req: Request, res: Response) => {
  const { volunteerId, ngoId } = req.body as { volunteerId: string; ngoId: string };
  if (!volunteerId || !ngoId) {
    res.status(400).json({ error: 'volunteerId and ngoId are required.' });
    return;
  }

  // Re-read from disk to get the absolute latest state before assigning
  // (guards against concurrent requests when the server has multiple replicas
  //  or when a previous in-flight write hasn't been reflected in memory yet)
  ngoStore = readNgoStore();

  const taskIdx = ngoStore.tasks.findIndex((t) => t.id === req.params.taskId);
  if (taskIdx < 0) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const task = ngoStore.tasks[taskIdx];

  // ── Atomic check: only AVAILABLE tasks may be assigned ────────────────────
  if (task.status !== 'AVAILABLE') {
    res.status(409).json({
      ok: false,
      alreadyAssigned: true,
      error: 'This rescue request has already been assigned to another volunteer.',
      currentStatus: task.status,
      assignedVolunteerName: task.assignedVolunteerName,
    });
    return;
  }

  const volunteerIdx = ngoStore.volunteers.findIndex((v) => v.id === volunteerId);
  if (volunteerIdx < 0) {
    res.status(404).json({ error: 'Volunteer not found.' });
    return;
  }

  const volunteer = ngoStore.volunteers[volunteerIdx];

  // Ensure volunteer is AVAILABLE
  if (volunteer.status !== 'AVAILABLE') {
    res.status(409).json({
      ok: false,
      error: 'This volunteer is already on a mission or offline.',
      volunteerStatus: volunteer.status,
    });
    return;
  }

  const ngo = ngoStore.ngos.find((n) => n.id === ngoId);

  // ── Apply the assignment atomically ───────────────────────────────────────
  task.status               = 'ASSIGNED';
  task.assignedNgoId        = ngoId;
  task.assignedNgoName      = ngo ? ngo.name : 'Unknown NGO';
  task.assignedVolunteerId  = volunteerId;
  task.assignedVolunteerName = volunteer.fullName;
  task.assignedAt           = Date.now();

  volunteer.status          = 'ON_MISSION';
  volunteer.currentTaskId   = task.id;

  ngoStore.version += 1;
  // Synchronous write — guarantees persistence before response is sent
  writeNgoStore(ngoStore);

  res.json({ ok: true, task, volunteer });
});

/** POST /api/rescue-tasks/:taskId/start — ASSIGNED → IN_PROGRESS */
app.post('/api/rescue-tasks/:taskId/start', (req: Request, res: Response) => {
  const { volunteerId } = req.body as { volunteerId: string };

  ngoStore = readNgoStore();
  const taskIdx = ngoStore.tasks.findIndex((t) => t.id === req.params.taskId);
  if (taskIdx < 0) { res.status(404).json({ error: 'Task not found.' }); return; }

  const task = ngoStore.tasks[taskIdx];

  if (task.status !== 'ASSIGNED') {
    res.status(409).json({ error: `Cannot start a task with status ${task.status}.` });
    return;
  }

  if (task.assignedVolunteerId !== volunteerId) {
    res.status(403).json({ error: 'Only the assigned volunteer can start this task.' });
    return;
  }

  task.status    = 'IN_PROGRESS';
  task.startedAt = Date.now();

  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, task });
});

/** POST /api/rescue-tasks/:taskId/complete — IN_PROGRESS → AWAITING_CONFIRMATION */
app.post('/api/rescue-tasks/:taskId/complete', (req: Request, res: Response) => {
  const { volunteerId } = req.body as { volunteerId: string };

  ngoStore = readNgoStore();
  const taskIdx = ngoStore.tasks.findIndex((t) => t.id === req.params.taskId);
  if (taskIdx < 0) { res.status(404).json({ error: 'Task not found.' }); return; }

  const task = ngoStore.tasks[taskIdx];

  if (task.status !== 'IN_PROGRESS') {
    res.status(409).json({ error: `Cannot complete a task with status ${task.status}.` });
    return;
  }

  if (task.assignedVolunteerId !== volunteerId) {
    res.status(403).json({ error: 'Only the assigned volunteer can request completion.' });
    return;
  }

  task.status                  = 'AWAITING_CONFIRMATION';
  task.completionRequestedAt   = Date.now();

  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, task });
});

/** POST /api/rescue-tasks/:taskId/confirm — AWAITING_CONFIRMATION → RESCUED (NGO only) */
app.post('/api/rescue-tasks/:taskId/confirm', (req: Request, res: Response) => {
  const { ngoId, confirmedByName } = req.body as { ngoId: string; confirmedByName: string };
  if (!ngoId) { res.status(400).json({ error: 'ngoId is required.' }); return; }

  ngoStore = readNgoStore();
  const taskIdx = ngoStore.tasks.findIndex((t) => t.id === req.params.taskId);
  if (taskIdx < 0) { res.status(404).json({ error: 'Task not found.' }); return; }

  const task = ngoStore.tasks[taskIdx];

  if (task.status !== 'AWAITING_CONFIRMATION') {
    res.status(409).json({ error: `Cannot confirm a task with status ${task.status}.` });
    return;
  }

  if (task.assignedNgoId !== ngoId) {
    res.status(403).json({ error: 'Only the assigned NGO can confirm this rescue.' });
    return;
  }

  const now = Date.now();
  task.status           = 'RESCUED';
  task.confirmedAt      = now;
  task.completedAt      = now;
  task.confirmedByNgoId = ngoId;
  task.confirmedByName  = confirmedByName || 'NGO Admin';

  // Free the volunteer
  const volunteerIdx = ngoStore.volunteers.findIndex(
    (v) => v.id === task.assignedVolunteerId
  );
  if (volunteerIdx >= 0) {
    ngoStore.volunteers[volunteerIdx].status        = 'AVAILABLE';
    ngoStore.volunteers[volunteerIdx].currentTaskId = null;
  }

  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, task });
});

/** POST /api/rescue-tasks/:taskId/cancel — cancel and optionally make AVAILABLE again */
app.post('/api/rescue-tasks/:taskId/cancel', (req: Request, res: Response) => {
  const { ngoId, reason, makeAvailable } = req.body as {
    ngoId: string; reason?: string; makeAvailable?: boolean;
  };

  ngoStore = readNgoStore();
  const taskIdx = ngoStore.tasks.findIndex((t) => t.id === req.params.taskId);
  if (taskIdx < 0) { res.status(404).json({ error: 'Task not found.' }); return; }

  const task = ngoStore.tasks[taskIdx];

  // Cancellable statuses
  const cancellable: RescueTaskStatus[] = ['AVAILABLE', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];
  if (!cancellable.includes(task.status)) {
    res.status(409).json({ error: `Task with status ${task.status} cannot be cancelled.` });
    return;
  }

  // Free the volunteer if one was assigned
  if (task.assignedVolunteerId) {
    const volunteerIdx = ngoStore.volunteers.findIndex(
      (v) => v.id === task.assignedVolunteerId
    );
    if (volunteerIdx >= 0) {
      ngoStore.volunteers[volunteerIdx].status        = 'AVAILABLE';
      ngoStore.volunteers[volunteerIdx].currentTaskId = null;
    }
  }

  if (makeAvailable) {
    // Reset to AVAILABLE for reassignment
    task.status               = 'AVAILABLE';
    task.assignedNgoId        = null;
    task.assignedNgoName      = null;
    task.assignedVolunteerId  = null;
    task.assignedVolunteerName = null;
    task.assignedAt           = null;
    task.startedAt            = null;
    task.completionRequestedAt = null;
    task.cancelledAt          = null;
    task.cancelReason         = null;
  } else {
    task.status       = 'CANCELLED';
    task.cancelledAt  = Date.now();
    task.cancelReason = reason || 'Cancelled by NGO';
  }

  ngoStore.version += 1;
  writeNgoStore(ngoStore);
  res.json({ ok: true, task });
});

/** GET /api/ngo-store/version — lightweight version poll for change detection */
app.get('/api/ngo-store/version', (_req: Request, res: Response) => {
  res.json({ version: ngoStore.version });
});

/** GET /api/ngo-store — full store (for polling sync) */
app.get('/api/ngo-store', (_req: Request, res: Response) => {
  // Strip password hashes before sending
  const safe = {
    ...ngoStore,
    ngos: ngoStore.ngos.map(({ passwordHash: _ph, ...rest }) => rest),
  };
  res.json(safe);
});

// ═════════════════════════════════════════════════════════════════════════════
// EXISTING CHAT ENDPOINT (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, context } = req.body as {
    message: string;
    context: {
      region: string;
      locationLabel: string;
      shelters: { name: string; address: string; capacity: number; occupied: number; status: string; amenities: string[] }[];
      resources: { type: string; name: string; address: string; status: string; phone: string; tags: string[] }[];
      activeRequests: { category: string; priority: string; title: string; peopleCount: number }[];
      gps?: string;
    };
  };

  if (!message || typeof message !== 'string' || message.length > 2000) {
    res.status(400).json({ error: 'Invalid message.' });
    return;
  }
  if (!GEMINI_READY) {
    res.status(503).json({ error: 'Gemini not configured.' });
    return;
  }

  const shelterLines = (context?.shelters ?? []).map(s => {
    const beds = s.capacity - s.occupied;
    return `  • ${s.name} (${s.address}) — Status: ${s.status}, Beds available: ${beds}/${s.capacity}, Amenities: ${s.amenities.join(', ')}`;
  }).join('\n');

  const resourceLines = (context?.resources ?? []).map(r =>
    `  • [${r.type.toUpperCase()}] ${r.name}, ${r.address} — ${r.status} | ☎ ${r.phone} | Tags: ${r.tags.join(', ')}`
  ).join('\n');

  const requestLines = (context?.activeRequests ?? []).map(r =>
    `  • [${r.priority.toUpperCase()}] ${r.category}: ${r.title}${r.peopleCount > 0 ? ` (${r.peopleCount} people)` : ''}`
  ).join('\n');

  const appContext = `
=== CURRENT APP CONTEXT ===
Region: ${context?.locationLabel ?? 'Unknown'}
${context?.gps ? `User GPS: ${context.gps}` : 'GPS: not available'}

SHELTERS (${(context?.shelters ?? []).length}):
${shelterLines || '  (none)'}

RESOURCES / HELP POINTS (${(context?.resources ?? []).length}):
${resourceLines || '  (none)'}

ACTIVE AID REQUESTS (${(context?.activeRequests ?? []).length}):
${requestLines || '  (none)'}
===========================`;

  try {
    const ai     = new GoogleGenAI({ apiKey: API_KEY });
    const model  = 'gemini-2.0-flash';
    const prompt = `${appContext}\n\nUser question: ${message}`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction: SYSTEM_INSTRUCTION, maxOutputTokens: 512 },
    });

    const text = response.text ?? '';
    if (!text) { res.status(502).json({ error: 'Empty response from Gemini.' }); return; }

    res.json({ reply: text, mode: 'online' });
  } catch (err: unknown) {
    console.error('[Gemini error]', err);
    res.status(502).json({ error: 'Gemini request failed.' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// EXISTING AI TRIAGE ENDPOINT (unchanged)
// ═════════════════════════════════════════════════════════════════════════════

const TRIAGE_SYSTEM_INSTRUCTION = `You are an emergency triage AI for a disaster-management system called ResQLink.

Your job is to analyze an emergency message — which may be in English, Hindi, or Hinglish — and extract structured information.

You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanation — just the raw JSON.

The JSON must follow this exact schema:
{
  "incidentType": one of ["Flood","Fire","Earthquake","Landslide","Medical Emergency","Trapped","Building Collapse","Unknown"],
  "location": string or null (the location mentioned, or null if unclear),
  "locationConfidence": one of ["high","medium","low"],
  "people": number or null (total people affected, null if not mentioned),
  "vulnerable": {
    "elderly": number (0 if not mentioned),
    "children": number (0 if not mentioned),
    "pregnant": number (0 if not mentioned),
    "disabled": number (0 if not mentioned),
    "injured": number (0 if not mentioned)
  },
  "dangerIndicators": array of strings (e.g. ["Water level: first floor", "No boat access", "Rising rapidly"]),
  "medicalEmergency": boolean,
  "requiredResources": array of strings (e.g. ["Evacuation","Rescue Boat","Medical Assistance","Food","Water"]),
  "priority": one of ["CRITICAL","HIGH","MEDIUM","LOW"],
  "priorityReasons": array of strings (each reason on why this priority was assigned)
}

Priority rules:
- CRITICAL: trapped person, elderly/child/pregnant/disabled in immediate danger, serious injury, rapidly rising water, fire/collapse, immediate evacuation required
- HIGH: dangerous conditions, multiple people affected, limited time
- MEDIUM: assistance needed but relatively safe for now
- LOW: information request, non-urgent

Translate Hindi/Hinglish terms:
- "phas gaye" = trapped
- "bujurg/elderly" = elderly person
- "pani/paani" = water
- "aag" = fire
- "bhukamp" = earthquake
- "pahad/landslide" = landslide
- "bachcha/bacche" = children
- "garbhwati" = pregnant

If a field cannot be determined, use null for strings/numbers, false for booleans, and empty arrays for arrays.
Do NOT invent location names. If the location is ambiguous, set locationConfidence to "low".`;

app.post('/api/triage', async (req: Request, res: Response) => {
  const { message, region, locationLabel } = req.body as {
    message: string; region?: string; locationLabel?: string;
  };

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'Message is required.' });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: 'Message too long (max 2000 characters).' });
    return;
  }
  if (!GEMINI_READY) {
    res.status(503).json({ error: 'Gemini not configured — use offline fallback.' });
    return;
  }

  const prompt = `Current region context: ${locationLabel || region || 'Unknown'}

Emergency message to analyze:
"${message}"

Respond with ONLY the JSON object as described.`;

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY! });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        systemInstruction: TRIAGE_SYSTEM_INSTRUCTION,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    });

    const raw = response.text ?? '';
    if (!raw) { res.status(502).json({ error: 'Empty response from Gemini.' }); return; }

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(502).json({ error: 'Gemini returned invalid JSON.', raw: cleaned.slice(0, 200) });
      return;
    }

    res.json({ ...parsed, parsedBy: 'gemini' });
  } catch (err: unknown) {
    console.error('[Triage Gemini error]', err);
    res.status(502).json({ error: 'Gemini triage request failed.' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC VOLUNTEER REGISTRATION ENDPOINT
// Fallback used by the frontend when Supabase env vars are not configured.
// Persists records in ngo-store.json under a "publicVolunteers" array.
// Upserts by email so re-submissions never create duplicate records.
// ═════════════════════════════════════════════════════════════════════════════

interface PublicVolunteer {
  id: string;
  fullName: string;
  gender: string;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  locationPermission: boolean;
  registeredAt: number;
}

function getPublicVolunteers(): PublicVolunteer[] {
  return ((ngoStore as any).publicVolunteers as PublicVolunteer[]) ?? [];
}

function savePublicVolunteers(vols: PublicVolunteer[]): void {
  (ngoStore as any).publicVolunteers = vols;
  ngoStore.version += 1;
  writeNgoStore(ngoStore);
}

/** POST /api/volunteer/register — upsert a public volunteer by email */
app.post('/api/volunteer/register', (req: Request, res: Response) => {
  const { fullName, gender, phone, email, latitude, longitude, locationPermission } =
    req.body as {
      fullName: string; gender?: string; phone: string; email: string;
      latitude?: number | null; longitude?: number | null;
      locationPermission?: boolean;
    };

  if (!fullName?.trim() || !phone?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'fullName, phone, and email are required.' });
    return;
  }

  const normalEmail = email.trim().toLowerCase();
  const vols = getPublicVolunteers();
  const existingIdx = vols.findIndex((v) => v.email === normalEmail);

  if (existingIdx >= 0) {
    // Update in place — no duplicate
    vols[existingIdx] = {
      ...vols[existingIdx],
      fullName:           fullName.trim(),
      gender:             gender || vols[existingIdx].gender,
      phone:              phone.trim(),
      latitude:           locationPermission ? (latitude ?? null) : vols[existingIdx].latitude,
      longitude:          locationPermission ? (longitude ?? null) : vols[existingIdx].longitude,
      locationPermission: Boolean(locationPermission),
    };
    savePublicVolunteers(vols);
    console.info(`[Volunteer] Updated existing volunteer: ${normalEmail}`);
    res.json({ ok: true, volunteer: vols[existingIdx], updated: true });
    return;
  }

  const volunteer: PublicVolunteer = {
    id:                 generateId('vol'),
    fullName:           fullName.trim(),
    gender:             gender || 'prefer_not_to_say',
    phone:              phone.trim(),
    email:              normalEmail,
    latitude:           locationPermission ? (latitude ?? null) : null,
    longitude:          locationPermission ? (longitude ?? null) : null,
    locationPermission: Boolean(locationPermission),
    registeredAt:       Date.now(),
  };

  vols.push(volunteer);
  savePublicVolunteers(vols);
  console.info(`[Volunteer] New volunteer registered: ${normalEmail}`);
  res.json({ ok: true, volunteer, updated: false });
});

/** GET /api/volunteer/list — list all public volunteers (debug / admin use) */
app.get('/api/volunteer/list', (_req: Request, res: Response) => {
  res.json(getPublicVolunteers());
});

// ── Single app.listen ─────────────────────────────────────────────────────────
// Global error handler — catches any unhandled exception thrown inside a route
// and returns a structured JSON error instead of Express's default empty 500.
// This means the frontend always receives `{ error: "..." }` even in unexpected cases.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[ResQLink API] Unhandled error:', err);
  // Avoid double-sending if headers already sent
  if (res.headersSent) return;
  res.status(500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`[ResQLink API] Running on http://localhost:${PORT}`);
  console.log(`[ResQLink API] Gemini configured: ${GEMINI_READY}`);
  console.log(`[ResQLink API] TinyFish configured: ${tinyFishService.hasKey()}`);
  if (!GEMINI_READY) console.log('[ResQLink API] Add GEMINI_API_KEY to server/.env to enable AI responses');
  if (!tinyFishService.hasKey()) console.log('[ResQLink API] Add TINYFISH_API_KEY to server/.env to enable live web relief feed');
  // Bootstrap ngo-store.json on first start so it exists before any request
  if (!fs.existsSync(NGO_FILE)) {
    writeNgoStore(ngoStore);
    console.log(`[ResQLink API] Created ${NGO_FILE}`);
  }
});
