'use strict';

const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR, PROJECTS_DIR, getGlobalMemoryDir, getProjectMemoryDir, realProjectPath } = require('./paths');
const { safeReadDir, readFileOrNull, parseFrontmatter, listProjectMdFiles } = require('./fileUtils');

// PLANS_DIR is needed here to count global mdFileCount — import lazily via commands to avoid circular dep
// Instead, define it inline (same value as in commands.js)
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

function listProjects() {
  const projects = [];

  // Global scope
  const globalMemDir = getGlobalMemoryDir();
  const globalMemFiles = safeReadDir(globalMemDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const globalClaudeMd = path.join(CLAUDE_DIR, 'CLAUDE.md');
  projects.push({
    id: '__global__',
    label: 'Global',
    path: CLAUDE_DIR,
    memoryDir: globalMemDir,
    claudeMd: fs.existsSync(globalClaudeMd) ? globalClaudeMd : null,
    memoryCount: globalMemFiles.length,
    mdFileCount: safeReadDir(PLANS_DIR).filter(f => f.endsWith('.md')).length,
  });

  // Per-project
  const encoded = safeReadDir(PROJECTS_DIR).filter(e => {
    try { return fs.statSync(path.join(PROJECTS_DIR, e)).isDirectory(); }
    catch { return false; }
  });

  for (const enc of encoded) {
    const memDir = getProjectMemoryDir(enc);
    const memFiles = safeReadDir(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    const projectPath = path.join(PROJECTS_DIR, enc);
    const realPath = realProjectPath(enc);
    const claudeMdPath = path.join(realPath, 'CLAUDE.md');
    // Use the last 2 path segments of the encoded name as a human label
    const segments = enc.replace(/^-/, '').split('-').filter(Boolean);
    const label = segments.length >= 2
      ? segments.slice(-2).join('/')
      : segments.join('/');
    const convFiles = safeReadDir(projectPath).filter(f => f.endsWith('.jsonl'));
    const mdFileCount = listProjectMdFiles(realPath).length;
    projects.push({
      id: enc,
      label,
      path: projectPath,
      realPath,
      memoryDir: memDir,
      claudeMd: fs.existsSync(claudeMdPath) ? claudeMdPath : null,
      memoryCount: memFiles.length,
      conversationCount: convFiles.length,
      mdFileCount,
    });
  }

  return projects;
}

function listMemoryFiles(memDir) {
  return safeReadDir(memDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = path.join(memDir, f);
      const content = readFileOrNull(filePath) || '';
      const { frontmatter, body } = parseFrontmatter(content);
      const stat = fs.statSync(filePath);
      return {
        filename: f,
        filePath,
        name: frontmatter.name || f.replace('.md', ''),
        description: frontmatter.description || '',
        type: frontmatter.type || 'unknown',
        body: body.trim(),
        raw: content,
        mtime: stat.mtime,
        lineCount: content.split('\n').filter(l => l.trim()).length,
      };
    });
}

function buildSearchIndex(projects) {
  const entries = [];
  for (const proj of projects) {
    const files = listMemoryFiles(proj.memoryDir);
    for (const f of files) {
      entries.push({ ...f, projectId: proj.id, projectLabel: proj.label });
    }
    if (proj.claudeMd) {
      const content = readFileOrNull(proj.claudeMd) || '';
      entries.push({
        filename: 'CLAUDE.md',
        filePath: proj.claudeMd,
        name: 'CLAUDE.md',
        description: 'Project instructions',
        type: 'claude_md',
        body: content,
        raw: content,
        mtime: fs.statSync(proj.claudeMd).mtime,
        projectId: proj.id,
        projectLabel: proj.label,
      });
    }
  }
  return entries;
}

module.exports = { listProjects, listMemoryFiles, buildSearchIndex };
