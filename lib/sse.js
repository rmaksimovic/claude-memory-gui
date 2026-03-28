'use strict';

const chokidar = require('chokidar');
const { CLAUDE_DIR } = require('./paths');
const { gitAutoTrack } = require('./git');

const sseClients = new Set();

// Debounce timers per file — avoids rapid-fire commits when a file is written in bursts
const commitTimers = new Map();

function scheduleAutoCommit(filePath, event) {
  // Skip MEMORY.md — it's auto-generated and would create noisy commits
  if (filePath.endsWith('MEMORY.md')) return;

  if (commitTimers.has(filePath)) clearTimeout(commitTimers.get(filePath));

  commitTimers.set(filePath, setTimeout(() => {
    commitTimers.delete(filePath);
    const message = event === 'add'
      ? `Add: ${require('path').basename(filePath)}`
      : `Update: ${require('path').basename(filePath)}`;
    gitAutoTrack(filePath, message);
  }, 1500)); // wait 1.5s after last write before committing
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      dead.push(client);
    }
  }
  dead.forEach(c => sseClients.delete(c));
}

function setupSSE(app) {
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  const watcher = chokidar.watch(CLAUDE_DIR, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    depth: 4,
  });

  watcher.on('all', (event, filePath) => {
    if (!filePath.endsWith('.md')) return;
    broadcast({ type: 'change', event, filePath });
    if (event === 'add' || event === 'change') {
      scheduleAutoCommit(filePath, event);
    }
  });

  watcher.on('error', err => console.error('[watcher]', err));

  return watcher;
}

module.exports = { sseClients, setupSSE, broadcast };
