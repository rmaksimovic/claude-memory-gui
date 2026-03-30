'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { safeReadDir, readFileOrNull } = require('./fileUtils');

// Strip XML protocol tags (complete pairs and orphaned openers from truncated text)
function stripXmlTags(text) {
  return text
    .replace(/<[a-z][a-z0-9-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z][a-z0-9-]*>/gi, '')
    .replace(/<[a-z][a-z0-9-]*(?:\s[^>]*)?>[\s\S]*/gi, '')
    .trim();
}


function parseConversationMeta(filePath) {
  const stat = fs.statSync(filePath);
  const CHUNK = 65536;          // 64 KB chunks — large enough to complete most lines in one read
  const MAX_BYTES = 10485760;   // scan up to 10 MB before giving up

  let firstUserMessage = '';
  let commandFallback = '';
  let cwd = '';
  let model = '';
  let timestamp = stat.mtime;

  let fd;
  try { fd = fs.openSync(filePath, 'r'); } catch { return null; }

  try {
    let offset = 0;
    let leftover = '';

    while (offset < Math.min(stat.size, MAX_BYTES)) {
      const buf = Buffer.alloc(CHUNK);
      const n = fs.readSync(fd, buf, 0, CHUNK, offset);
      if (n === 0) break;
      offset += n;

      leftover += buf.slice(0, n).toString('utf8');

      const nl = leftover.indexOf('\n');
      if (nl === -1) continue; // no complete line yet, keep reading

      const lines = leftover.split('\n');
      leftover = lines.pop(); // last element may be incomplete

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (r.type === 'user' && r.message?.role === 'user') {
            const c = r.message.content;
            // Find first text block that isn't an image placeholder
            let text = '';
            if (typeof c === 'string') {
              text = c;
            } else if (Array.isArray(c)) {
              for (const b of c) {
                if (b.type === 'text' && !/^\[Image[^\]]*\]/.test((b.text || '').trim())) {
                  text = b.text || '';
                  break;
                }
              }
            }
            const stripped = stripXmlTags(text);
            if (stripped) {
              firstUserMessage = stripped.slice(0, 200);
              cwd = r.cwd || '';
              timestamp = r.timestamp || stat.mtime;
            } else if (!commandFallback) {
              const cmdMsg  = (text.match(/<command-message>([\s\S]*?)<\/command-message>/) || [])[1];
              const cmdName = (text.match(/<command-name>([\s\S]*?)<\/command-name>/) || [])[1];
              if (cmdMsg?.trim()) commandFallback = cmdMsg.trim().slice(0, 200);
              else if (cmdName?.trim()) commandFallback = `/${cmdName.trim()}`;
              if (!cwd) cwd = r.cwd || '';
              if (!timestamp) timestamp = r.timestamp || stat.mtime;
            }
          }
          if (r.type === 'assistant' && r.message?.model && !model) {
            model = r.message.model;
          }
        } catch {}

        if (firstUserMessage && model) break;
      }

      if (firstUserMessage && model) break;
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!firstUserMessage) firstUserMessage = commandFallback;

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

function computeProjectCost(projectPath, pricing) {
  const files = safeReadDir(projectPath).filter(f => f.endsWith('.jsonl'));
  const modelToks = {}; // model → { inp, out, cw5m, cw1h, cr }

  for (const file of files) {
    const content = readFileOrNull(path.join(projectPath, file)) || '';
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.type !== 'assistant') continue;
        const usage = r.message?.usage;
        const model = r.message?.model;
        if (!usage || !model) continue;
        if (!modelToks[model]) modelToks[model] = { inp: 0, out: 0, cw5m: 0, cw1h: 0, cr: 0 };
        const t = modelToks[model];
        t.inp  += usage.input_tokens || 0;
        t.out  += usage.output_tokens || 0;
        t.cr   += usage.cache_read_input_tokens || 0;
        const cc = usage.cache_creation || {};
        t.cw5m += cc.ephemeral_5m_input_tokens || 0;
        t.cw1h += (cc.ephemeral_1h_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      } catch {}
    }
  }

  const M = 1_000_000;
  let total = 0;
  let hasPrice = false;
  for (const [model, t] of Object.entries(modelToks)) {
    const p = pricing.find(pr => model.toLowerCase().includes(pr.match));
    if (!p) continue;
    hasPrice = true;
    total += t.inp / M * p.input + t.out / M * p.output
           + t.cw5m / M * p.cw5m + t.cw1h / M * p.cw1h
           + t.cr  / M * p.cr;
  }
  return hasPrice ? total : null;
}

module.exports = { parseConversationMeta, listConversations, parseFullConversation, forkConversation, summarizeConversation, computeProjectCost };
