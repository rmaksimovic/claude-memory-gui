'use strict';

const fs = require('fs');
const path = require('path');
const { safeReadDir, readFileOrNull, parseFrontmatter } = require('./fileUtils');
const { listMemoryFiles } = require('./projects');

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

function healthCheck(memDir) {
  // Auto-repair the index before checking — catches manual deletions / external changes
  try { syncMemoryIndex(memDir); } catch {}
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

module.exports = { syncMemoryIndex, healthCheck };
