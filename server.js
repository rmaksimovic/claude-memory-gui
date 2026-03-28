const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const { execFile } = require('child_process');

const app = express();
const PORT = 3737;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ── Pricing table (USD per million tokens) ─────────────────────────────────

// More specific entries must come before less specific ones (first match wins).
// Prices from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-03-26)
// cw5m = 5-minute cache write, cw1h = 1-hour cache write, cr = cache read (per MTok)
const MODEL_PRICING = [
  { match: 'claude-opus-4-6',   input:  5.00, output: 25.00, cw5m:  6.25, cw1h: 10.00, cr: 0.50 },
  { match: 'claude-opus-4-5',   input:  5.00, output: 25.00, cw5m:  6.25, cw1h: 10.00, cr: 0.50 },
  { match: 'claude-opus-4-1',   input: 15.00, output: 75.00, cw5m: 18.75, cw1h: 30.00, cr: 1.50 },
  { match: 'claude-opus-4',     input: 15.00, output: 75.00, cw5m: 18.75, cw1h: 30.00, cr: 1.50 },
  { match: 'claude-sonnet-4',   input:  3.00, output: 15.00, cw5m:  3.75, cw1h:  6.00, cr: 0.30 },
  { match: 'claude-haiku-4-5',  input:  1.00, output:  5.00, cw5m:  1.25, cw1h:  2.00, cr: 0.10 },
  { match: 'claude-haiku-3-5',  input:  0.80, output:  4.00, cw5m:  1.00, cw1h:  1.60, cr: 0.08 },
  { match: 'claude-3-5-sonnet', input:  3.00, output: 15.00, cw5m:  3.75, cw1h:  6.00, cr: 0.30 },
  { match: 'claude-3-opus',     input: 15.00, output: 75.00, cw5m: 18.75, cw1h: 30.00, cr: 1.50 },
  { match: 'claude-3-sonnet',   input:  3.00, output: 15.00, cw5m:  3.75, cw1h:  6.00, cr: 0.30 },
  { match: 'claude-3-haiku',    input:  0.25, output:  1.25, cw5m:  0.30, cw1h:  0.50, cr: 0.03 },
];

// ── Project MD file scanner ────────────────────────────────────────────────

const MD_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'vendor',
  'coverage', '.cache', 'out', '.svelte-kit', 'target', '__pycache__',
  '.venv', 'venv', 'env', '.tox', 'bower_components', '.expo', 'Pods',
  '.gradle', 'DerivedData', '.build',
]);

function listProjectMdFiles(realPath, maxDepth = 3) {
  if (!realPath || !fs.existsSync(realPath)) return [];
  const results = [];
  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (entry.isDirectory()) {
        if (!MD_EXCLUDE_DIRS.has(entry.name)) scan(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(filePath);
          results.push({
            filename: entry.name,
            filePath,
            name: entry.name.replace(/\.md$/, ''),
            description: path.relative(realPath, filePath),
            type: entry.name === 'CLAUDE.md' ? 'claude_md' : 'md',
            mtime: stat.mtime,
            size: stat.size,
            lineCount: 0,
          });
        } catch {}
      }
    }
  }
  scan(realPath, 1);
  return results.sort((a, b) => a.description.localeCompare(b.description));
}

// ── Path resolution ────────────────────────────────────────────────────────

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

function getGlobalMemoryDir() {
  return path.join(CLAUDE_DIR, 'memory');
}

function getProjectMemoryDir(encodedProject) {
  return path.join(PROJECTS_DIR, encodedProject, 'memory');
}

function encodeProjectPath(absPath) {
  return absPath.replace(/\//g, '-').replace(/^-/, '');
}

// Reconstruct the real filesystem path from an encoded project ID.
// Claude encodes the project path by replacing every '/' AND '.' with '-'.
// We can reverse this accurately by using os.homedir() as a known anchor:
//   1. Encode homedir the same way to find where the home prefix ends.
//   2. Decode only the suffix after the home prefix (no dots there typically).
//   3. Rejoin with os.homedir() to get the real absolute path.
function realProjectPath(encoded) {
  const home = os.homedir();
  const encodedHome = home.replace(/\//g, '-').replace(/\./g, '-').replace(/^-/, '');
  const stripped = encoded.replace(/^-/, '');
  if (stripped.startsWith(encodedHome)) {
    const suffix = stripped.slice(encodedHome.length).replace(/-/g, '/');
    return home + suffix;
  }
  // Fallback: plain hyphen-to-slash conversion
  return '/' + stripped.replace(/-/g, '/');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function readFileOrNull(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter: fm, body: match[2] };
}

function safeReadDir(dir) {
  try { return fs.readdirSync(dir); }
  catch { return []; }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Project listing ────────────────────────────────────────────────────────

function listProjects() {
  const projects = [];

  // Global scope
  const globalMemDir = getGlobalMemoryDir();
  const globalMemFiles = safeReadDir(globalMemDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const globalClaudeMd = path.join(CLAUDE_DIR, 'CLAUDE.md');
  projects.push({
    id: '__global__',
    label: 'Global',
    path: CLAUDE_DIR,
    memoryDir: globalMemDir,
    claudeMd: fs.existsSync(globalClaudeMd) ? globalClaudeMd : null,
    memoryCount: globalMemFiles.length,
    mdFileCount: safeReadDir(PLANS_DIR).filter(f => f.endsWith('.md')).length,
  });

  // Per-project
  const encoded = safeReadDir(PROJECTS_DIR).filter(e => {
    try { return fs.statSync(path.join(PROJECTS_DIR, e)).isDirectory(); }
    catch { return false; }
  });

  for (const enc of encoded) {
    const memDir = getProjectMemoryDir(enc);
    const memFiles = safeReadDir(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    const projectPath = path.join(PROJECTS_DIR, enc);
    const realPath = realProjectPath(enc);
    const claudeMdPath = path.join(realPath, 'CLAUDE.md');
    // Use the last 2 path segments of the encoded name as a human label
    const segments = enc.replace(/^-/, '').split('-').filter(Boolean);
    const label = segments.length >= 2
      ? segments.slice(-2).join('/')
      : segments.join('/');
    const convFiles = safeReadDir(projectPath).filter(f => f.endsWith('.jsonl'));
    const mdFileCount = listProjectMdFiles(realPath).length;
    projects.push({
      id: enc,
      label,
      path: projectPath,
      realPath,
      memoryDir: memDir,
      claudeMd: fs.existsSync(claudeMdPath) ? claudeMdPath : null,
      memoryCount: memFiles.length,
      conversationCount: convFiles.length,
      mdFileCount,
    });
  }

  return projects;
}

// ── Memory file helpers ────────────────────────────────────────────────────

function listMemoryFiles(memDir) {
  return safeReadDir(memDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = path.join(memDir, f);
      const content = readFileOrNull(filePath) || '';
      const { frontmatter, body } = parseFrontmatter(content);
      const stat = fs.statSync(filePath);
      return {
        filename: f,
        filePath,
        name: frontmatter.name || f.replace('.md', ''),
        description: frontmatter.description || '',
        type: frontmatter.type || 'unknown',
        body: body.trim(),
        raw: content,
        mtime: stat.mtime,
        lineCount: content.split('\n').filter(l => l.trim()).length,
      };
    });
}

function buildSearchIndex(projects) {
  const entries = [];
  for (const proj of projects) {
    const files = listMemoryFiles(proj.memoryDir);
    for (const f of files) {
      entries.push({ ...f, projectId: proj.id, projectLabel: proj.label });
    }
    if (proj.claudeMd) {
      const content = readFileOrNull(proj.claudeMd) || '';
      entries.push({
        filename: 'CLAUDE.md',
        filePath: proj.claudeMd,
        name: 'CLAUDE.md',
        description: 'Project instructions',
        type: 'claude_md',
        body: content,
        raw: content,
        mtime: fs.statSync(proj.claudeMd).mtime,
        projectId: proj.id,
        projectLabel: proj.label,
      });
    }
  }
  return entries;
}

// ── MEMORY.md sync ─────────────────────────────────────────────────────────

function syncMemoryIndex(memDir) {
  const files = safeReadDir(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const entries = [];
  for (const f of files) {
    const content = readFileOrNull(path.join(memDir, f)) || '';
    const { frontmatter } = parseFrontmatter(content);
    const name = frontmatter.name || f.replace('.md', '');
    const desc = frontmatter.description || '';
    entries.push(`- [${name}](${f}) — ${desc}`);
  }
  const indexPath = path.join(memDir, 'MEMORY.md');
  const header = '# Memory Index\n\n';
  fs.writeFileSync(indexPath, header + entries.join('\n') + '\n');
}

// ── Health checks ──────────────────────────────────────────────────────────

function healthCheck(memDir) {
  const issues = [];
  const indexPath = path.join(memDir, 'MEMORY.md');
  const indexContent = readFileOrNull(indexPath) || '';
  const lines = indexContent.split('\n').filter(l => l.startsWith('- ['));

  // Check index line count
  if (lines.length > 190) {
    issues.push({ level: 'warn', message: `MEMORY.md has ${lines.length} entries — approaching 200-line truncation limit` });
  }

  // Check broken pointers
  const linkRe = /\[.*?\]\((.*?)\)/;
  for (const line of lines) {
    const m = line.match(linkRe);
    if (m) {
      const target = path.join(memDir, m[1]);
      if (!fs.existsSync(target)) {
        issues.push({ level: 'error', message: `Broken pointer in MEMORY.md: ${m[1]}` });
      }
    }
  }

  // Check stale project memories (dates more than 30 days in the past)
  const memFiles = listMemoryFiles(memDir).filter(f => f.type === 'project');
  const dateRe = /\b(20\d\d-\d\d-\d\d)\b/g;
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 30);
  const staleDate = staleThreshold.toISOString().slice(0, 10);
  const seen30 = new Set();
  for (const f of memFiles) {
    const dates = [...f.body.matchAll(dateRe)].map(m => m[1]);
    for (const d of dates) {
      if (d < staleDate && !seen30.has(f.name)) {
        seen30.add(f.name);
        issues.push({ level: 'warn', message: `Possibly stale project memory "${f.name}" references past date ${d}` });
      }
    }
  }

  // Detect duplicate names
  const allFiles = listMemoryFiles(memDir);
  const names = allFiles.map(f => f.name.toLowerCase());
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n)) {
      issues.push({ level: 'warn', message: `Duplicate memory name: "${n}"` });
    }
    seen.add(n);
  }

  return issues;
}

// ── Routes ─────────────────────────────────────────────────────────────────

// List projects
app.get('/api/projects', (req, res) => {
  res.json(listProjects());
});

// List memories for a project
app.get('/api/projects/:id/memories', (req, res) => {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(listMemoryFiles(proj.memoryDir));
});

// Get a single file's content
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const content = readFileOrNull(filePath);
  if (content === null) return res.status(404).json({ error: 'File not found' });
  res.json({ content });
});

// Save a file
app.put('/api/file', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'Missing filePath or content' });
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  // Auto-sync MEMORY.md if it's a memory file
  const dir = path.dirname(filePath);
  if (path.basename(filePath) !== 'MEMORY.md' && path.basename(filePath).endsWith('.md')) {
    const memIndex = path.join(dir, 'MEMORY.md');
    if (fs.existsSync(memIndex) || safeReadDir(dir).some(f => f.endsWith('.md'))) {
      try { syncMemoryIndex(dir); } catch {}
    }
  }
  res.json({ ok: true });
});

// Create new memory file
app.post('/api/projects/:id/memories', (req, res) => {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content' });
  ensureDir(proj.memoryDir);
  const filePath = path.join(proj.memoryDir, filename.endsWith('.md') ? filename : filename + '.md');
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'File already exists' });
  fs.writeFileSync(filePath, content, 'utf8');
  syncMemoryIndex(proj.memoryDir);
  res.json({ ok: true, filePath });
});

// Delete a memory file
app.delete('/api/file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing filePath' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filePath);
  const dir = path.dirname(filePath);
  try { syncMemoryIndex(dir); } catch {}
  res.json({ ok: true });
});

// Search across all memory files and CLAUDE.md
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const typeFilter = req.query.type || '';
  if (!q) return res.json([]);
  const projects = listProjects();
  const index = buildSearchIndex(projects);
  const results = index.filter(entry => {
    if (typeFilter && entry.type !== typeFilter) return false;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.body.toLowerCase().includes(q)
    );
  }).map(entry => ({
    ...entry,
    snippet: extractSnippet(entry.body, q),
  }));
  res.json(results);
});

function extractSnippet(text, q) {
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text.slice(0, 120);
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + q.length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// Health check for a project
app.get('/api/projects/:id/health', (req, res) => {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(healthCheck(proj.memoryDir));
});

// Get CLAUDE.md for a project
app.get('/api/projects/:id/claude-md', (req, res) => {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  if (!proj.claudeMd) return res.json({ content: '', filePath: null });
  res.json({ content: readFileOrNull(proj.claudeMd) || '', filePath: proj.claudeMd });
});

// ── Conversations ──────────────────────────────────────────────────────────

function parseConversationMeta(filePath) {
  // Read only first 8KB to extract first user message without loading full file
  let firstChunk = '';
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    firstChunk = buf.slice(0, n).toString('utf8');
  } catch { return null; }

  const stat = fs.statSync(filePath);
  let firstUserMessage = '';
  let cwd = '';
  let model = '';
  let timestamp = stat.mtime;

  for (const line of firstChunk.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.type === 'user' && r.message?.role === 'user' && !firstUserMessage) {
        const c = r.message.content;
        firstUserMessage = typeof c === 'string' ? c
          : Array.isArray(c) ? (c.find(b => b.type === 'text')?.text || '') : '';
        firstUserMessage = firstUserMessage.slice(0, 200);
        cwd = r.cwd || '';
        timestamp = r.timestamp || stat.mtime;
      }
      if (r.type === 'assistant' && r.message?.model && !model) {
        model = r.message.model;
      }
      if (firstUserMessage && model) break;
    } catch {}
  }

  return {
    id: path.basename(filePath, '.jsonl'),
    filePath,
    mtime: stat.mtime,
    size: stat.size,
    firstUserMessage,
    cwd,
    model,
    timestamp,
  };
}

function listConversations(projectPath) {
  return safeReadDir(projectPath)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => parseConversationMeta(path.join(projectPath, f)))
    .filter(Boolean)
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

function parseFullConversation(filePath) {
  const content = readFileOrNull(filePath) || '';
  const messages = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.type === 'user' || r.type === 'assistant') messages.push(r);
    } catch {}
  }
  return messages;
}

// List conversations for a project
app.get('/api/projects/:id/conversations', (req, res) => {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(listConversations(proj.path));
});

// Read a full conversation
app.get('/api/conversation', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  res.json(parseFullConversation(filePath));
});

// ── Project MD files ───────────────────────────────────────────────────────

const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

app.get('/api/projects/:id/mdfiles', (req, res) => {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  if (req.params.id === '__global__') {
    // For global project, expose ~/.claude/plans/*.md
    res.json(listProjectMdFiles(PLANS_DIR, 1));
  } else {
    res.json(listProjectMdFiles(proj.realPath));
  }
});

// ── Commands ───────────────────────────────────────────────────────────────

const GLOBAL_COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');

function listCommandDirs() {
  // Global commands
  const dirs = [{ label: 'Global', dir: GLOBAL_COMMANDS_DIR, scope: 'global' }];
  // Per-project .claude/commands dirs — scan known project paths
  const encoded = safeReadDir(PROJECTS_DIR).filter(e => {
    try { return fs.statSync(path.join(PROJECTS_DIR, e)).isDirectory(); } catch { return false; }
  });
  for (const enc of encoded) {
    const segments = enc.replace(/^-/, '').split('-').filter(Boolean);
    const label = segments.length >= 2 ? segments.slice(-2).join('/') : segments.join('/');
    // Reconstruct best-guess real path for .claude/commands
    // We watch ~/.claude/projects/<enc>/ but project .claude/commands live inside the actual project dir
    // We can't know the exact real path from encoding alone, so skip per-project for now
    // (they'd need to be discovered via filesystem traversal outside ~/.claude)
  }
  return dirs;
}

function listCommands() {
  const results = [];
  for (const { label, dir, scope } of listCommandDirs()) {
    const files = safeReadDir(dir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const filePath = path.join(dir, f);
      const content = readFileOrNull(filePath) || '';
      const firstLine = content.split('\n').find(l => l.trim()) || '';
      results.push({
        name: f.replace(/\.md$/, ''),
        filename: f,
        filePath,
        scope,
        scopeLabel: label,
        description: firstLine.slice(0, 120),
        content,
      });
    }
  }
  return results;
}

// List all commands
app.get('/api/commands', (req, res) => {
  res.json(listCommands());
});

// Create a new command
app.post('/api/commands', (req, res) => {
  const { name, content } = req.body;
  if (!name || content === undefined) return res.status(400).json({ error: 'Missing name or content' });
  ensureDir(GLOBAL_COMMANDS_DIR);
  const filename = name.endsWith('.md') ? name : name + '.md';
  const filePath = path.join(GLOBAL_COMMANDS_DIR, filename);
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Command already exists' });
  fs.writeFileSync(filePath, content, 'utf8');
  res.json({ ok: true, filePath });
});

// ── Git info ───────────────────────────────────────────────────────────────

app.get('/api/gitinfo', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const dir = path.dirname(filePath);
  const file = path.basename(filePath);
  execFile('git', ['-C', dir, 'log', '--follow', '-1', '--format=%H%n%an%n%ct%n%s', '--', file],
    { timeout: 3000 },
    (err, stdout) => {
      if (err || !stdout.trim()) return res.json(null);
      const lines = stdout.trim().split('\n');
      if (lines.length < 4) return res.json(null);
      res.json({
        hash: lines[0].slice(0, 7),
        author: lines[1],
        timestamp: parseInt(lines[2], 10) * 1000,
        subject: lines.slice(3).join(' '),
      });
    }
  );
});

// ── SSE for live file watching ─────────────────────────────────────────────

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(msg);
}

const watcher = chokidar.watch(CLAUDE_DIR, {
  ignored: /(^|[/\\])\../,
  persistent: true,
  ignoreInitial: true,
  depth: 4,
});

watcher.on('all', (event, filePath) => {
  if (filePath.endsWith('.md')) {
    broadcast({ type: 'change', event, filePath });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Claude Memory GUI running at http://localhost:${PORT}`);
});
