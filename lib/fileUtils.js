'use strict';

const fs = require('fs');
const path = require('path');
const { MD_EXCLUDE_DIRS } = require('./config');

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
          // Read first 600 bytes for snippet — avoids loading huge files fully
          const fd = fs.openSync(filePath, 'r');
          const buf = Buffer.alloc(600);
          const bytesRead = fs.readSync(fd, buf, 0, 600, 0);
          fs.closeSync(fd);
          const head = buf.slice(0, bytesRead).toString('utf8');
          const lineCount = fs.readFileSync(filePath, 'utf8').split('\n').length;
          // Strip frontmatter, then strip markdown syntax for plain-text snippet
          const body = head.replace(/^---[\s\S]*?---\n?/, '');
          const plain = body
            .replace(/^#{1,6}\s+/gm, '')   // headings
            .replace(/[*_`~]/g, '')          // inline formatting
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
            .replace(/\n+/g, ' ')
            .trim();
          const words = plain.split(/\s+/).filter(Boolean);
          const snippet = words.slice(0, 12).join(' ') + (words.length > 12 ? '…' : '');
          results.push({
            filename: entry.name,
            filePath,
            name: entry.name.replace(/\.md$/, ''),
            description: path.relative(realPath, filePath),
            type: entry.name === 'CLAUDE.md' ? 'claude_md' : 'md',
            mtime: stat.mtime,
            size: stat.size,
            lineCount,
            snippet,
          });
        } catch {}
      }
    }
  }
  scan(realPath, 1);
  return results.sort((a, b) => a.description.localeCompare(b.description));
}

module.exports = {
  readFileOrNull,
  parseFrontmatter,
  safeReadDir,
  ensureDir,
  listProjectMdFiles,
};
