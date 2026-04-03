'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const { readFileOrNull, ensureDir, safeReadDir, listProjectMdFiles } = require('./lib/fileUtils');
const { listProjects, listMemoryFiles, buildSearchIndex } = require('./lib/projects');
const { syncMemoryIndex, healthCheck } = require('./lib/health');
const { listConversations, parseFullConversation, forkConversation, summarizeConversation, summarizeFile, computeProjectCost } = require('./lib/conversations');
const { MODEL_PRICING } = require('./lib/config');
const { GLOBAL_COMMANDS_DIR, PLANS_DIR, listCommands, listSkills } = require('./lib/commands');
const { gitInfoHandler, blameHandler, gitAutoTrack } = require('./lib/git');
const { setupSSE } = require('./lib/sse');
const { listMcpServers } = require('./lib/mcp');

const app = express();
const PORT = 3737;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ── Middleware ─────────────────────────────────────────────────────────────

function requireProject(req, res, next) {
  const proj = listProjects().find(p => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  req.project = proj;
  next();
}

// ── Routes ─────────────────────────────────────────────────────────────────

// List projects
app.get('/api/projects', (req, res) => {
  res.json(listProjects());
});

// Pricing table (single source of truth — frontend fetches this instead of duplicating)
app.get('/api/pricing', (req, res) => {
  res.json(MODEL_PRICING);
});

// List memories for a project
app.get('/api/projects/:id/memories', requireProject, (req, res) => {
  res.json(listMemoryFiles(req.project.memoryDir));
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
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'Failed to write file: ' + e.message });
  }
  const basename = path.basename(filePath);
  const dir = path.dirname(filePath);
  // Auto-sync MEMORY.md if it's a memory file (but not MEMORY.md itself)
  if (basename !== 'MEMORY.md' && basename.endsWith('.md')) {
    const memIndex = path.join(dir, 'MEMORY.md');
    if (fs.existsSync(memIndex) || safeReadDir(dir).some(f => f.endsWith('.md'))) {
      try { syncMemoryIndex(dir); } catch (e) { console.error('[syncMemoryIndex]', e.message); }
    }
    // Auto-commit the saved file (skip MEMORY.md — it's auto-generated noise)
    gitAutoTrack(filePath, `Update: ${basename}`);
  }
  res.json({ ok: true });
});

// Create new memory file
app.post('/api/projects/:id/memories', requireProject, (req, res) => {
  const proj = req.project;
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content' });
  ensureDir(proj.memoryDir);
  const filePath = path.join(proj.memoryDir, filename.endsWith('.md') ? filename : filename + '.md');
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'File already exists' });
  fs.writeFileSync(filePath, content, 'utf8');
  syncMemoryIndex(proj.memoryDir);
  gitAutoTrack(filePath, `Add memory: ${path.basename(filePath)}`);
  res.json({ ok: true, filePath });
});

// Delete a memory file
app.delete('/api/file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing filePath' });
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to delete file: ' + e.message });
  }
  const dir = path.dirname(filePath);
  try { syncMemoryIndex(dir); } catch (e) { console.error('[syncMemoryIndex]', e.message); }
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
app.get('/api/projects/:id/health', requireProject, (req, res) => {
  res.json(healthCheck(req.project.memoryDir));
});

// Get CLAUDE.md for a project
app.get('/api/projects/:id/claude-md', requireProject, (req, res) => {
  const proj = req.project;
  if (!proj.claudeMd) return res.json({ content: '', filePath: null });
  res.json({ content: readFileOrNull(proj.claudeMd) || '', filePath: proj.claudeMd });
});

// Estimate total cost for a project
app.get('/api/projects/:id/cost', requireProject, (req, res) => {
  res.json({ cost: computeProjectCost(req.project.path, MODEL_PRICING) });
});

// List conversations for a project
app.get('/api/projects/:id/conversations', requireProject, (req, res) => {
  res.json(listConversations(req.project.path));
});

// Read a full conversation
app.get('/api/conversation', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  res.json(parseFullConversation(filePath));
});

// Fork a conversation at a specific message
app.post('/api/fork-conversation', (req, res) => {
  const { filePath, beforeMessageUuid } = req.body;
  if (!filePath || !beforeMessageUuid) return res.status(400).json({ error: 'Missing filePath or beforeMessageUuid' });
  try {
    const result = forkConversation(filePath, beforeMessageUuid);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Summarize a conversation using claude -p
app.post('/api/summarize-conversation', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing filePath' });
  try {
    const summary = await summarizeConversation(filePath);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/summarize-file', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing filePath' });
  try {
    const summary = await summarizeFile(filePath);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Project MD files
app.get('/api/projects/:id/mdfiles', requireProject, (req, res) => {
  if (req.params.id === '__global__') return res.json(listProjectMdFiles(PLANS_DIR, 1));
  res.json(listProjectMdFiles(req.project.realPath));
});

// List all commands (flat, legacy)
app.get('/api/commands', (req, res) => {
  res.json(listCommands());
});

// List skills grouped by scope
app.get('/api/skills', (req, res) => {
  res.json(listSkills());
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
  gitAutoTrack(filePath, `Add command: ${filename}`);
  res.json({ ok: true, filePath });
});

// MCP servers
app.get('/api/mcp', (req, res) => {
  res.json(listMcpServers());
});

// Git info
app.get('/api/gitinfo', gitInfoHandler);

// Git blame (per-line)
app.get('/api/blame', blameHandler);

// SSE for live file watching
setupSSE(app);

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Claude Memory GUI running at http://localhost:${PORT}`);
});
