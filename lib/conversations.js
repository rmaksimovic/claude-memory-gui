'use strict';

const fs = require('fs');
const path = require('path');
const { safeReadDir, readFileOrNull } = require('./fileUtils');

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

module.exports = { parseConversationMeta, listConversations, parseFullConversation };
