#!/usr/bin/env node
/**
 * PreToolUse guard for tg-parser.
 *
 * Blocks the two mistakes that are unrecoverable in this project:
 *   1. writing Telegram runtime state (session strings, phone numbers) into the repository
 *   2. putting a live credential into a file or printing one into the transcript
 *
 * Wired from .claude/settings.json. Exit code 2 blocks the tool call and returns
 * the stderr message to Claude. Any internal failure exits 0 so the guard can
 * never wedge a session.
 */

const BLOCKED_PATH_RULES = [
  {
    test: (p) => /(^|[\\/])data[\\/]/.test(p) || /(^|[\\/])data$/.test(p),
    reason:
      'data/ holds Telegram runtime state (session strings, phone numbers). It is git-ignored and must not be written from a tool call. See .claude/rules/telegram.md (Known Deviations).',
  },
  {
    test: (p) => /(^|[\\/])\.env(\.|$)/.test(p),
    reason:
      '.env holds live credentials. Edit it by hand, outside the agent. See .claude/rules/api-security.md.',
  },
  {
    test: (p) => /\.session$/.test(p),
    reason: 'Session files are full account credentials and are never written by a tool call.',
  },
];

// A GramJS StringSession is a long base64 run; real ones are ~350 chars.
const SESSION_STRING = /\b1[A-Za-z0-9+/=_-]{199,}/;
const API_HASH_ASSIGNMENT = /(api[_-]?hash|TELEGRAM_API_HASH)\s*[:=]\s*['"]?[0-9a-f]{32}\b/i;

const CONTENT_RULES = [
  {
    pattern: SESSION_STRING,
    reason:
      'This content contains what looks like a Telegram session string, a full account credential. It must never be written to a repository file, a test fixture, a report, or a memory file. See .claude/rules/telegram.md.',
  },
  {
    pattern: API_HASH_ASSIGNMENT,
    reason:
      'This content assigns a literal 32-character API hash. Credentials are read through src/config/ from the environment only. See .claude/rules/api-security.md.',
  },
];

const BASH_RULES = [
  {
    pattern: /(cat|type|head|tail|more|less|Get-Content)\s+[^|;&]*data[\\/](sessions|auth-states)\.json/i,
    reason:
      'Printing data/sessions.json or data/auth-states.json puts live session strings and phone numbers into the transcript. Inspect the shape of the file instead of its contents.',
  },
  {
    pattern: /git\s+add\s+[^;&|]*(-f|--force)[^;&|]*data/i,
    reason:
      'Force-adding data/ would commit live Telegram credentials. The directory is git-ignored deliberately.',
  },
];

function collectStrings(value, out, depth) {
  if (depth > 6 || out.length > 200) return;
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) collectStrings(value[key], out, depth + 1);
  }
}

function block(reason) {
  process.stderr.write('Blocked by .claude/hooks/guard-secrets.js\n\n' + reason + '\n');
  process.exit(2);
}

function main(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = payload.tool_name || '';
  const toolInput = payload.tool_input || {};

  if (toolName === 'Bash') {
    const command = String(toolInput.command || '');
    for (const rule of BASH_RULES) {
      if (rule.pattern.test(command)) block(rule.reason);
    }
    process.exit(0);
  }

  const filePath = String(toolInput.file_path || toolInput.notebook_path || '');
  if (filePath) {
    const normalized = filePath.replace(/^[A-Za-z]:/, '');
    for (const rule of BLOCKED_PATH_RULES) {
      if (rule.test(normalized)) block(rule.reason + '\n\nPath: ' + filePath);
    }
  }

  const strings = [];
  collectStrings(toolInput, strings, 0);
  for (const text of strings) {
    if (text.length < 32) continue;
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(text)) block(rule.reason);
    }
  }

  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    main(input);
  } catch {
    process.exit(0);
  }
});
setTimeout(() => process.exit(0), 5000).unref();
