const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;
const HOME = process.env.HOME || '/Users/bennyai';
const WORKSPACE = path.join(HOME, '.openclaw/workspace');
const OPENCLAW = '/opt/homebrew/bin/openclaw';
const NOTION_DB_ID = '311633ae-fde9-804d-ad51-ebfb61a5365b';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err?.code });
    });
  });
}

function getNotionKey() {
  const keyFile = path.join(HOME, '.config/notion/api_key');
  if (!fs.existsSync(keyFile)) throw new Error('No Notion API key');
  return fs.readFileSync(keyFile, 'utf8').trim();
}

function getOpenRouterKey() {
  try {
    const authFile = path.join(HOME, '.openclaw/agents/main/agent/auth-profiles.json');
    const profiles = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const or = profiles.find(p => p.provider === 'openrouter' && p.token);
    return or?.token || null;
  } catch { return null; }
}

function getAnthropicKey() {
  try {
    const authFile = path.join(HOME, '.openclaw/agents/main/agent/auth-profiles.json');
    const profiles = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const ant = profiles.find(p => p.provider === 'anthropic' && p.token);
    return ant?.token || null;
  } catch { return null; }
}

function httpsRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function notionReq(method, path, body = null) {
  const key = getNotionKey();
  return httpsRequest(method, `https://api.notion.com/v1${path}`, {
    'Authorization': `Bearer ${key}`,
    'Notion-Version': '2025-09-03'
  }, body);
}

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const r = await run(`${OPENCLAW} status`);
  res.json({ ok: r.ok, output: r.stdout || r.stderr });
});

// ── Crons ─────────────────────────────────────────────────────────────────────
app.get('/api/crons', async (req, res) => {
  const r = await run(`${OPENCLAW} cron list --json`);
  if (!r.ok) return res.status(500).json({ error: r.stderr });
  try { res.json(JSON.parse(r.stdout)); } catch { res.status(500).json({ error: 'parse error' }); }
});

app.post('/api/crons/:id/run', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write(`data: {"line":"▶ Running cron job..."}\n\n`);
  const r = await run(`${OPENCLAW} cron run ${req.params.id}`, 60000);
  const lines = (r.stdout + r.stderr).split('\n').filter(Boolean);
  for (const line of lines) res.write(`data: ${JSON.stringify({ line })}\n\n`);
  res.write(`data: {"line":"${r.ok ? '✅ Done' : '❌ Failed'}","done":true}\n\n`);
  res.end();
});

// ── Config files ──────────────────────────────────────────────────────────────
const ALLOWED_FILES = ['SOUL.md','USER.md','MEMORY.md','TOOLS.md','HEARTBEAT.md','AGENTS.md','IDENTITY.md'];

app.get('/api/files', (req, res) => {
  const files = ALLOWED_FILES.map(name => {
    const fp = path.join(WORKSPACE, name);
    const exists = fs.existsSync(fp);
    const stat = exists ? fs.statSync(fp) : null;
    return { name, exists, size: stat?.size || 0, modified: stat?.mtime || null };
  });
  res.json({ files });
});

app.get('/api/file/:name', (req, res) => {
  const name = req.params.name;
  if (!ALLOWED_FILES.includes(name)) return res.status(403).json({ error: 'Not allowed' });
  const fp = path.join(WORKSPACE, name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json({ name, content: fs.readFileSync(fp, 'utf8') });
});

app.put('/api/file/:name', (req, res) => {
  const name = req.params.name;
  if (!ALLOWED_FILES.includes(name)) return res.status(403).json({ error: 'Not allowed' });
  const fp = path.join(WORKSPACE, name);
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  if (fs.existsSync(fp)) fs.writeFileSync(fp + '.bak', fs.readFileSync(fp));
  fs.writeFileSync(fp, content, 'utf8');
  res.json({ ok: true });
});

// ── Memory ────────────────────────────────────────────────────────────────────
app.get('/api/memory', (req, res) => {
  const memDir = path.join(WORKSPACE, 'memory');
  if (!fs.existsSync(memDir)) return res.json({ files: [] });
  const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') || f.endsWith('.json')).sort().reverse().slice(0, 30);
  res.json({ files });
});

app.get('/api/memory/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const fp = path.join(WORKSPACE, 'memory', name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json({ name, content: fs.readFileSync(fp, 'utf8') });
});

// ── Notion LinkedIn Planner ───────────────────────────────────────────────────
app.get('/api/notion/linkedin', async (req, res) => {
  try {
    const data = await notionReq('POST', `/data_sources/${NOTION_DB_ID}/query`, {
      sorts: [{ property: 'Date', direction: 'descending' }], page_size: 100
    });
    if (!data.results) return res.status(500).json({ error: 'Notion error', detail: data });
    const items = data.results.map(page => {
      const p = page.properties || {};
      return {
        id: page.id,
        name: p.Name?.title?.[0]?.plain_text || '(geen titel)',
        type: p.Select?.select?.name || null,
        status: p.Status?.status?.name || null,
        date: p.Date?.date?.start || null,
        script: p.Script?.rich_text?.map(r => r.plain_text).join('') || null
      };
    });
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Notion page status (for kanban drag-drop)
app.patch('/api/notion/linkedin/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  try {
    const data = await notionReq('PATCH', `/pages/${req.params.id}`, {
      properties: { Status: { status: { name: status } } }
    });
    res.json({ ok: true, id: data.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generate script for a LinkedIn idea using AI
app.post('/api/notion/linkedin/:id/generate-script', async (req, res) => {
  const { title, type } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const apiKey = getAnthropicKey();
  if (!apiKey) return res.status(500).json({ error: 'No Anthropic key found' });

  const prompt = type === 'video'
    ? `Schrijf een kort, converterend LinkedIn video script voor: "${title}"\n\nRegels:\n- Hook in eerste zin (max 10 woorden, nieuwsgierigheid opwekken)\n- Kernboodschap in 3-5 punten\n- CTA aan het einde ("DM me" of "Stuur me een bericht")\n- Totaal max 90 seconden spreektijd (~150 woorden)\n- Toon: direct, expert, geen filler\n- Context: Bas bouwt apps voor MKB bedrijven met AI/low-code tools in dagen ipv maanden`
    : `Schrijf een korte, converterende LinkedIn tekst post voor: "${title}"\n\nRegels:\n- Sterke openingszin die stopt met scrollen\n- 3-5 korte alinea's\n- Witte ruimte tussen alinea's\n- CTA aan het einde\n- Max 300 woorden\n- Toon: direct, expert, geen filler\n- Context: Bas bouwt apps voor MKB bedrijven met AI/low-code tools in dagen ipv maanden`;

  try {
    const result = await httpsRequest('POST', 'https://api.anthropic.com/v1/messages', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }, {
      model: 'claude-haiku-3-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const script = result.content?.[0]?.text || '';
    if (!script) return res.status(500).json({ error: 'No script generated' });

    // Save to Notion
    await notionReq('PATCH', `/pages/${req.params.id}`, {
      properties: {
        Script: { rich_text: [{ text: { content: script.slice(0, 2000) } }] },
        Status: { status: { name: 'Draft' } }
      }
    });

    res.json({ ok: true, script });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GitHub ────────────────────────────────────────────────────────────────────
app.get('/api/github/repos', async (req, res) => {
  const r = await run('gh repo list --json name,description,updatedAt,url,isPrivate --limit 10 2>&1');
  if (!r.ok) return res.status(500).json({ error: r.stderr });
  try { res.json(JSON.parse(r.stdout)); } catch { res.status(500).json({ error: 'parse error' }); }
});

app.get('/api/github/runs', async (req, res) => {
  const r = await run('gh run list --limit 5 --json displayTitle,status,conclusion,createdAt,url,workflowName 2>&1');
  if (!r.ok) return res.json([]);
  try { res.json(JSON.parse(r.stdout)); } catch { res.json([]); }
});

// ── Live logs (SSE) ───────────────────────────────────────────────────────────
app.get('/api/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const today = new Date().toISOString().slice(0, 10);
  const logFile = `/tmp/openclaw/openclaw-${today}.log`;

  res.write(`data: ${JSON.stringify({ line: `📡 Connecting to ${logFile}...`, ts: Date.now() })}\n\n`);

  if (!fs.existsSync(logFile)) {
    res.write(`data: ${JSON.stringify({ line: '⚠️ Log file not found (gateway might be off)', ts: Date.now() })}\n\n`);
    res.end();
    return;
  }

  // Send last 20 lines first
  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-20);
    for (const line of lines) res.write(`data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`);
  } catch {}

  // Then tail live
  const tail = spawn('tail', ['-f', '-n', '0', logFile]);
  tail.stdout.on('data', data => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) res.write(`data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`);
  });

  req.on('close', () => tail.kill());
});

// ── Models ────────────────────────────────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  const r = await run(`${OPENCLAW} models status`);
  res.json({ ok: r.ok, output: r.stdout });
});

// ── Agent chat ────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const apiKey = getAnthropicKey();
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  const messages = [
    ...history.slice(-10),
    { role: 'user', content: message }
  ];

  try {
    const result = await httpsRequest('POST', 'https://api.anthropic.com/v1/messages', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }, {
      model: 'claude-haiku-3-5',
      max_tokens: 1024,
      system: 'Je bent Benny, een directe AI-assistent voor Bas. Geef korte, bruikbare antwoorden. Dit is een dashboard chat — wees compact.',
      messages
    });
    const reply = result.content?.[0]?.text || '';
    res.json({ ok: true, reply });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🧠 Benny Dashboard  →  http://localhost:${PORT}\n`);
  console.log('  Pages: / | /crons.html | /files.html | /memory.html');
  console.log('         /notion.html | /kanban.html | /logs.html | /chat.html | /github.html\n');
});
