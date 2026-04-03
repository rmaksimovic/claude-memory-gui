'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CLAUDE_DIR } = require('./paths');
const { listProjects } = require('./projects');
const { safeReadDir, readFileOrNull } = require('./fileUtils');

const GLOBAL_COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

function shortPath(p) {
  return p.replace(os.homedir(), '~');
}

function extractSkillsFromDir(dir) {
  const skills = [];
  const entries = safeReadDir(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }

    if (stat.isFile() && entry.endsWith('.md')) {
      const content = readFileOrNull(fullPath) || '';
      const firstLine = content.split('\n').find(l => l.trim()) || '';
      skills.push({
        name: entry.replace(/\.md$/, ''),
        namespace: null,
        filename: entry,
        filePath: fullPath,
        description: firstLine.slice(0, 120),
        content,
      });
    } else if (stat.isDirectory()) {
      // One level of namespace subdirectory (e.g. claude-md-management/revise-claude-md.md)
      const namespace = entry;
      const subEntries = safeReadDir(fullPath);
      for (const sub of subEntries) {
        if (!sub.endsWith('.md')) continue;
        const subPath = path.join(fullPath, sub);
        const content = readFileOrNull(subPath) || '';
        const firstLine = content.split('\n').find(l => l.trim()) || '';
        skills.push({
          name: namespace + ':' + sub.replace(/\.md$/, ''),
          namespace,
          filename: sub,
          filePath: subPath,
          description: firstLine.slice(0, 120),
          content,
        });
      }
    }
  }

  return skills;
}

function listSkills() {
  const groups = [];

  // Global ~/.claude/commands/
  const globalSkills = extractSkillsFromDir(GLOBAL_COMMANDS_DIR);
  if (globalSkills.length > 0) {
    groups.push({
      scope: 'global',
      scopeLabel: 'Global',
      dir: GLOBAL_COMMANDS_DIR,
      dirDisplay: shortPath(GLOBAL_COMMANDS_DIR),
      projectId: null,
      skills: globalSkills,
    });
  }

  // Per-project <realPath>/.claude/commands/
  const projects = listProjects();
  for (const project of projects) {
    if (!project.realPath) continue;
    const commandsDir = path.join(project.realPath, '.claude', 'commands');
    // Skip if this resolves to the same path as the global commands dir
    if (path.resolve(commandsDir) === path.resolve(GLOBAL_COMMANDS_DIR)) continue;
    let isDir = false;
    try { isDir = fs.statSync(commandsDir).isDirectory(); } catch {}
    if (!isDir) continue;
    const projectSkills = extractSkillsFromDir(commandsDir);
    if (projectSkills.length === 0) continue;
    groups.push({
      scope: 'project',
      scopeLabel: project.label,
      dir: commandsDir,
      dirDisplay: shortPath(commandsDir),
      projectId: project.id,
      skills: projectSkills,
    });
  }

  return groups;
}

// Flat list for backward compat (used by POST handler)
function listCommands() {
  return listSkills().flatMap(g =>
    g.skills.map(s => ({ ...s, scope: g.scope, scopeLabel: g.scopeLabel }))
  );
}

module.exports = { GLOBAL_COMMANDS_DIR, PLANS_DIR, listCommands, listSkills };
