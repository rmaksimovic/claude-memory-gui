'use strict';

const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR, PROJECTS_DIR } = require('./paths');
const { safeReadDir, readFileOrNull } = require('./fileUtils');

const GLOBAL_COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

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

module.exports = { GLOBAL_COMMANDS_DIR, PLANS_DIR, listCommandDirs, listCommands };
