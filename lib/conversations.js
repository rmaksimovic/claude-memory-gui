'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
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

// Fork a conversation up to (not including) the message with beforeMessageUuid.
// Creates a new .jsonl file in the same directory with a fresh session ID.
// Claude recognises the file by its filename: claude --resume <newSessionId>
function forkConversation(filePath, beforeMessageUuid) {
  const raw = readFileOrNull(filePath) || '';
  const lines = raw.split('\n').filter(l => l.trim());

  // Find the line index of the target message
  let cutIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    try {
      const r = JSON.parse(lines[i]);
      if (r.uuid === beforeMessageUuid) { cutIndex = i; break; }
    } catch {}
  }
  if (cutIndex === -1) throw new Error('Message UUID not found in conversation');
  if (cutIndex === 0) throw new Error('Cannot fork before the first message');

  const linesToKeep = lines.slice(0, cutIndex);

  // Generate a new session ID — Claude simply looks up ~/.claude/projects/<proj>/<id>.jsonl
  // so any UUID v4 is valid as long as the file exists there.
  const newSessionId = crypto.randomUUID();

  // Rewrite sessionId in every entry (uuid/parentUuid chains stay intact)
  const rewritten = linesToKeep.map(line => {
    try {
      const r = JSON.parse(line);
      if ('sessionId' in r) r.sessionId = newSessionId;
      return JSON.stringify(r);
    } catch { return line; }
  });

  const newFilePath = path.join(path.dirname(filePath), `${newSessionId}.jsonl`);
  fs.writeFileSync(newFilePath, rewritten.join('\n') + '\n', 'utf8');

  return { newSessionId, newFilePath };
}

// Build a plain-text transcript from parsed messages, skipping tool noise
function buildTranscript(messages) {
  const lines = [];
  for (const record of messages) {
    const isUser = record.type === 'user';
    const content = record.message?.content;
    let text = '';
    if (typeof content === 'string') {
      text = content.trim();
    } else if (Array.isArray(content)) {
      text = content
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('\n')
        .trim();
    }
    if (!text) continue;
    lines.push(`${isUser ? 'User' : 'Claude'}: ${text}`);
  }
  return lines.join('\n\n');
}

// Run `claude -p <prompt>` with the transcript piped to stdin.
// Returns a Promise<string> with the summary output.
function runClaudeSummarize(transcript) {
  return new Promise((resolve, reject) => {
    const prompt =
      'Summarize the following Claude Code conversation. ' +
      'Return 3 to 5 concise bullet points (using "•"). ' +
      'Each bullet should abstractly describe what was discussed, analyzed, or implemented — ' +
      'no code specifics, just high-level topics, decisions, and outcomes. ' +
      'Be brief and direct.\n\nCONVERSATION:\n' + transcript;

    const proc = spawn('claude', ['-p', prompt], { timeout: 60000 });

    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => reject(new Error(`Failed to run claude CLI: ${e.message}`)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || `claude exited with code ${code}`));
      resolve(out.trim());
    });
  });
}

async function summarizeConversation(filePath) {
  const messages = parseFullConversation(filePath);
  const transcript = buildTranscript(messages);
  if (!transcript) throw new Error('No readable messages in conversation');
  return runClaudeSummarize(transcript);
}

module.exports = { parseConversationMeta, listConversations, parseFullConversation, forkConversation, summarizeConversation };
