'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractServers(mcpServers, configFile, scope, scopeLabel) {
  if (!mcpServers || typeof mcpServers !== 'object') return [];
  return Object.entries(mcpServers).map(([name, cfg]) => ({
    name,
    command: cfg.command || '',
    args: Array.isArray(cfg.args) ? cfg.args : [],
    envKeys: Object.keys(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
    type: cfg.type || null,
    url: cfg.url || null,
    configFile,
    scope,
    scopeLabel,
  }));
}

function listMcpServers() {
  const root = readJsonFile(CLAUDE_JSON);
  if (!root) return [];

  const results = [];

  // Global MCP servers (top-level mcpServers)
  results.push(...extractServers(root.mcpServers, CLAUDE_JSON, 'global', 'Global'));

  // Per-project MCP servers (root.projects["/abs/path"].mcpServers)
  if (root.projects && typeof root.projects === 'object') {
    for (const [projectPath, projectCfg] of Object.entries(root.projects)) {
      if (!projectCfg || !projectCfg.mcpServers) continue;
      const label = projectPath.split('/').slice(-2).join('/');
      results.push(...extractServers(projectCfg.mcpServers, CLAUDE_JSON, 'project', label));
    }
  }

  return results;
}

module.exports = { listMcpServers };
