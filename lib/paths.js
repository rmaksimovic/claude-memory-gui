'use strict';

const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

function getGlobalMemoryDir() {
  return path.join(CLAUDE_DIR, 'memory');
}

function getProjectMemoryDir(encodedProject) {
  return path.join(PROJECTS_DIR, encodedProject, 'memory');
}

function encodeProjectPath(absPath) {
  return absPath.replace(/\//g, '-').replace(/^-/, '');
}

// Reconstruct the real filesystem path from an encoded project ID.
// Claude encodes the project path by replacing every '/' AND '.' with '-'.
// We can reverse this accurately by using os.homedir() as a known anchor:
//   1. Encode homedir the same way to find where the home prefix ends.
//   2. Decode only the suffix after the home prefix (no dots there typically).
//   3. Rejoin with os.homedir() to get the real absolute path.
function realProjectPath(encoded) {
  const home = os.homedir();
  const encodedHome = home.replace(/\//g, '-').replace(/\./g, '-').replace(/^-/, '');
  const stripped = encoded.replace(/^-/, '');
  if (stripped.startsWith(encodedHome)) {
    const suffix = stripped.slice(encodedHome.length).replace(/-/g, '/');
    return home + suffix;
  }
  // Fallback: plain hyphen-to-slash conversion
  return '/' + stripped.replace(/-/g, '/');
}

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR,
  getGlobalMemoryDir,
  getProjectMemoryDir,
  encodeProjectPath,
  realProjectPath,
};
