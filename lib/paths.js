'use strict';

const fs = require('fs');
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
// Claude encodes the project path by replacing '/', '.', and ' ' (space) with '-'.
// We can reverse this accurately by using os.homedir() as a known anchor:
//   1. Encode homedir the same way to find where the home prefix ends.
//   2. Fast-decode the suffix (naive hyphen→slash) and return if the path exists.
//   3. If not (e.g. path had spaces or dots encoded as hyphens), walk the real
//      filesystem from home, encoding each entry name to match the suffix.
//      This handles ambiguous cases without breaking already-working projects.
function realProjectPath(encoded) {
  const home = os.homedir();
  const encodedHome = home.replace(/\//g, '-').replace(/\./g, '-').replace(/^-/, '');
  const stripped = encoded.replace(/^-/, '');

  if (!stripped.startsWith(encodedHome)) {
    return '/' + stripped.replace(/-/g, '/');
  }

  const suffix = stripped.slice(encodedHome.length).replace(/^-/, '');

  // Fast path: naive hyphen-to-slash decode
  const fast = home + (suffix ? '/' + suffix.replace(/-/g, '/') : '');
  if (!suffix || fs.existsSync(fast)) return fast;

  // Fuzzy path: walk filesystem, matching encoded entry names against the suffix.
  // Claude encodes path components by replacing '.', ' ', and '/' with '-'.
  function encodeEntry(name) {
    return name.replace(/[. ]/g, '-');
  }

  function walk(dir, remaining) {
    if (!remaining) return dir;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return null; }
    for (const entry of entries) {
      const enc = encodeEntry(entry);
      if (remaining === enc) return path.join(dir, entry);
      if (remaining.startsWith(enc + '-')) {
        const found = walk(path.join(dir, entry), remaining.slice(enc.length + 1));
        if (found) return found;
      }
    }
    return null;
  }

  return walk(home, suffix) || fast;
}

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR,
  getGlobalMemoryDir,
  getProjectMemoryDir,
  encodeProjectPath,
  realProjectPath,
};
