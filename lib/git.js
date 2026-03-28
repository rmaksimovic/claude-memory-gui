'use strict';

const path = require('path');
const { execFile } = require('child_process');

function gitInfoHandler(req, res) {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const dir = path.dirname(filePath);
  const file = path.basename(filePath);
  execFile('git', ['-C', dir, 'log', '--follow', '-1', '--format=%H%n%an%n%ct%n%s', '--', file],
    { timeout: 3000 },
    (err, stdout) => {
      if (err || !stdout.trim()) return res.json(null);
      const lines = stdout.trim().split('\n');
      if (lines.length < 4) return res.json(null);
      res.json({
        hash: lines[0].slice(0, 7),
        author: lines[1],
        timestamp: parseInt(lines[2], 10) * 1000,
        subject: lines.slice(3).join(' '),
      });
    }
  );
}

function blameHandler(req, res) {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  const dir = path.dirname(filePath);
  const file = path.basename(filePath);
  execFile('git', ['-C', dir, 'blame', '--line-porcelain', '--', file],
    { timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => {
      if (err || !stdout.trim()) return res.json(null);
      const result = [];
      let curTimestamp = null;
      let curAuthor = null;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('author ') && !line.startsWith('author-')) {
          curAuthor = line.slice(7);
        } else if (line.startsWith('author-time ')) {
          curTimestamp = parseInt(line.slice(12), 10) * 1000;
        } else if (line.startsWith('\t')) {
          result.push({ timestamp: curTimestamp, author: curAuthor });
          curTimestamp = null; curAuthor = null;
        }
      }
      res.json(result);
    }
  );
}

// Stage and commit a newly created file so git blame works immediately.
// Runs silently — if the directory isn't a git repo the commands simply fail with no side effects.
function gitAutoTrack(filePath, message) {
  const dir = path.dirname(filePath);
  const file = path.basename(filePath);
  execFile('git', ['-C', dir, 'add', '--', file], { timeout: 3000 }, (addErr) => {
    if (addErr) return; // not a git repo or other issue — skip silently
    execFile('git', ['-C', dir, 'commit', '-m', message || `Track: ${file}`], { timeout: 5000 }, () => {});
  });
}

module.exports = { gitInfoHandler, blameHandler, gitAutoTrack };
