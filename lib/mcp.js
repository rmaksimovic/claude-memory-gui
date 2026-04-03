'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CLAUDE_DIR } = require('./paths');
const { listProjects } = require('./projects');

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function extractServers(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj).map(([name, cfg]) => ({
    name,
    command: cfg.command || '',
    args: Array.isArray(cfg.args) ? cfg.args : [],
    envKeys: Object.keys(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
    type: cfg.type || (cfg.url ? 'http' : 'stdio'),
    url: cfg.url || null,
    rawConfig: cfg,
  }));
}

function shortPath(p) {
  return p.replace(os.homedir(), '~');
}

function projectLabelFromPath(absPath) {
  const parts = absPath.split('/').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('/') : parts.join('/');
}

function listMcpServers() {
  const groups = [];

  // 1a. Legacy global — ~/.claude.json → mcpServers
  const legacyCfg = readJsonFile(CLAUDE_JSON);
  if (legacyCfg?.mcpServers) {
    groups.push({
      scope: 'global',
      scopeLabel: 'Global',
      configFile: CLAUDE_JSON,
      configFileDisplay: shortPath(CLAUDE_JSON),
      readOnly: false,
      servers: extractServers(legacyCfg.mcpServers),
    });
  }

  // 1b. Legacy project-scoped — ~/.claude.json → projects["/path"].mcpServers
  if (legacyCfg?.projects) {
    for (const [projectPath, projectCfg] of Object.entries(legacyCfg.projects)) {
      if (!projectCfg?.mcpServers) continue;
      const servers = extractServers(projectCfg.mcpServers);
      if (servers.length === 0) continue;
      groups.push({
        scope: 'project',
        scopeLabel: projectLabelFromPath(projectPath),
        projectId: null, // legacy format uses abs path, not encoded ID
        configFile: CLAUDE_JSON,
        configFileDisplay: shortPath(CLAUDE_JSON),
        readOnly: false,
        servers,
      });
    }
  }

  // 2. New global — ~/.claude/settings.json → mcpServers
  const newCfg = readJsonFile(path.join(CLAUDE_DIR, 'settings.json'));
  if (newCfg?.mcpServers) {
    const configFile = path.join(CLAUDE_DIR, 'settings.json');
    groups.push({
      scope: 'global',
      scopeLabel: 'Global',
      configFile,
      configFileDisplay: shortPath(configFile),
      readOnly: false,
      servers: extractServers(newCfg.mcpServers),
    });
  }

  // 3. Plugins — ~/.claude/plugins/installed_plugins.json
  const pluginsDir = path.join(CLAUDE_DIR, 'plugins');
  const installed = readJsonFile(path.join(pluginsDir, 'installed_plugins.json'));
  if (installed?.plugins) {
    for (const [pluginId, installs] of Object.entries(installed.plugins)) {
      if (!Array.isArray(installs) || installs.length === 0) continue;
      const install = installs[installs.length - 1];
      const mcpJsonPath = path.join(install.installPath, '.mcp.json');
      const mcpJson = readJsonFile(mcpJsonPath);
      if (!mcpJson) continue;
      // .mcp.json format varies: { "mcpServers": {...} } or { "serverName": {...} }
      const rawServers = mcpJson.mcpServers || mcpJson;
      const servers = extractServers(rawServers);
      if (servers.length === 0) continue;
      groups.push({
        scope: 'plugin',
        scopeLabel: pluginId,
        configFile: mcpJsonPath,
        configFileDisplay: shortPath(mcpJsonPath),
        readOnly: true,
        pluginVersion: install.version,
        servers,
      });
    }
  }

  // 4. Project-scoped (new format) — scan each project's real directory
  // Track config files already added in earlier sections to avoid duplicates
  // (e.g. home-dir project resolves .claude/settings.json to the same global file)
  const seenConfigFiles = new Set(groups.map(g => path.resolve(g.configFile)));

  const projects = listProjects();
  for (const project of projects) {
    if (!project.realPath) continue;

    // <project>/.claude/settings.json
    const settingsPath = path.resolve(path.join(project.realPath, '.claude', 'settings.json'));
    if (!seenConfigFiles.has(settingsPath)) {
      const projSettings = readJsonFile(settingsPath);
      if (projSettings?.mcpServers) {
        seenConfigFiles.add(settingsPath);
        groups.push({
          scope: 'project',
          scopeLabel: project.label,
          projectId: project.id,
          configFile: settingsPath,
          configFileDisplay: shortPath(settingsPath),
          readOnly: false,
          servers: extractServers(projSettings.mcpServers),
        });
      }
    }

    // <project>/.mcp.json
    const mcpJsonPath = path.resolve(path.join(project.realPath, '.mcp.json'));
    if (!seenConfigFiles.has(mcpJsonPath)) {
      const mcpJson = readJsonFile(mcpJsonPath);
      if (mcpJson) {
        const rawServers = mcpJson.mcpServers || mcpJson;
        const servers = extractServers(rawServers);
        if (servers.length > 0) {
          seenConfigFiles.add(mcpJsonPath);
          groups.push({
            scope: 'project',
            scopeLabel: project.label,
            projectId: project.id,
            configFile: mcpJsonPath,
            configFileDisplay: shortPath(mcpJsonPath),
            readOnly: false,
            servers,
          });
        }
      }
    }
  }

  return groups;
}

module.exports = { listMcpServers };
