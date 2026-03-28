'use strict';

const chokidar = require('chokidar');
const { CLAUDE_DIR } = require('./paths');

const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(msg);
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
    if (filePath.endsWith('.md')) {
      broadcast({ type: 'change', event, filePath });
    }
  });

  return watcher;
}

module.exports = { sseClients, setupSSE, broadcast };
