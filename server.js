const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;
const HOME = process.env.HOME || '/Users/bennyai';
const WORKSPACE = path.join(HOME, '.openclaw/workspace');
const OPENCLAW = '/opt/homebrew/bin/openclaw';

app.use(express.static(path.join(__dirname, 'public')));

// Helper: run shell command
function run(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err?.code });
    });
  });
}

// Helper: HTTPS request
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Helper: POST HTTPS
function httpsPost(url, headers = {}, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── API: OpenClaw status ──────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const result = await run(`${OPENCLAW} status`);
  res.json({ ok: result.ok, output: result.stdout || result.stderr });
});

// ── API: Cron jobs ────────────────────────────────────────────────────────────
app.get('/api/crons', async (req, res) => {
  const result = await run(`${OPENCLAW} cron list --json`);
  if (!result.ok) return res.status(500).json({ error: result.stderr });
  try {
    const data = JSON.parse(result.stdout);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to parse cron output', raw: result.stdout });
  }
});

// ── API: Run cron now ─────────────────────────────────────────────────────────
app.post('/api/crons/:id/run', async (req, res) => {
  const result = await run(`${OPENCLAW} cron run ${req.params.id}`, 30000);
  res.json({ ok: result.ok, output: result.stdout || result.stderr });
});

// ── API: Config files ─────────────────────────────────────────────────────────
const ALLOWED_FILES = ['SOUL.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md', 'AGENTS.md', 'IDENTITY.md'];

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
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const content = fs.readFileSync(fp, 'utf8');
  res.json({ name, content });
});

app.put('/api/file/:name', express.json(), (req, res) => {
  const name = req.params.name;
  if (!ALLOWED_FILES.includes(name)) return res.status(403).json({ error: 'Not allowed' });
  const fp = path.join(WORKSPACE, name);
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  // Backup first
  if (fs.existsSync(fp)) {
    fs.writeFileSync(fp + '.bak', fs.readFileSync(fp));
  }
  fs.writeFileSync(fp, content, 'utf8');
  res.json({ ok: true, name });
});

// ── API: Notion LinkedIn Planner ──────────────────────────────────────────────
app.get('/api/notion/linkedin', async (req, res) => {
  const keyFile = path.join(HOME, '.config/notion/api_key');
  if (!fs.existsSync(keyFile)) return res.status(500).json({ error: 'No Notion API key found' });
  const apiKey = fs.readFileSync(keyFile, 'utf8').trim();
  const DB_ID = '311633ae-fde9-804d-ad51-ebfb61a5365b';

  try {
    const data = await httpsPost(
      `https://api.notion.com/v1/data_sources/${DB_ID}/query`,
      {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json'
      },
      { sorts: [{ property: 'Date', direction: 'descending' }], page_size: 50 }
    );

    if (!data.results) return res.status(500).json({ error: 'Notion error', detail: data });

    const items = data.results.map(page => {
      const props = page.properties || {};
      const name = props.Name?.title?.[0]?.plain_text || '(geen titel)';
      const type = props.Select?.select?.name || null;
      const status = props.Status?.status?.name || null;
      const date = props.Date?.date?.start || null;
      const script = props.Script?.rich_text?.[0]?.plain_text || null;
      return { id: page.id, name, type, status, date, script };
    });

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Model / session status ───────────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  const result = await run(`${OPENCLAW} models status`);
  res.json({ ok: result.ok, output: result.stdout });
});

// ── API: Memory files ─────────────────────────────────────────────────────────
app.get('/api/memory', (req, res) => {
  const memDir = path.join(WORKSPACE, 'memory');
  if (!fs.existsSync(memDir)) return res.json({ files: [] });
  const files = fs.readdirSync(memDir)
    .filter(f => f.endsWith('.md') || f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 14);
  res.json({ files });
});

app.get('/api/memory/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const fp = path.join(WORKSPACE, 'memory', name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const content = fs.readFileSync(fp, 'utf8');
  res.json({ name, content });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🧠 Benny Dashboard running at http://localhost:${PORT}\n`);
});
