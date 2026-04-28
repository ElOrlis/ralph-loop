// lib/criteria/suggestions.js
'use strict';

const ALREADY_TYPED = /`\[(shell|http|file-exists|grep|manual):/;

function suggestForCriterion(text) {
  if (typeof text !== 'string') return [];
  if (ALREADY_TYPED.test(text)) return [];

  // Pattern: Test: Run `cmd` ... OR Run `cmd` and verify ...
  let m = text.match(/(?:Test:\s*Run|Run)\s+`([^`]+)`/i);
  if (m) {
    return [{
      type: 'shell',
      value: m[1].trim(),
      rationale: 'matched "Run `<cmd>`" pattern',
    }];
  }

  // Pattern: METHOD <url> returns <NNN>
  m = text.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+returns\s+(\d{3})\b/i);
  if (m) {
    return [{
      type: 'http',
      value: `${m[1].toUpperCase()} ${m[2]} -> ${m[3]}`,
      rationale: 'matched "METHOD URL returns NNN" pattern',
    }];
  }

  // Pattern: grep `pattern` in `file`
  m = text.match(/grep\s+`([^`]+)`\s+in\s+`([^`]+)`/i);
  if (m) {
    return [{
      type: 'grep',
      value: `${m[1]} in ${m[2]}`,
      rationale: 'matched "grep `<pattern>` in `<file>`" pattern',
    }];
  }

  // Pattern: file `<path>` exists OR Created `<path>` (path-shaped backtick)
  // Reject .com / .org / no-dot-or-slash strings.
  m = text.match(/(?:^|\b)(?:Created|file|File)\s+`([^`]+)`(?:\s+(?:exists|with|is created)\b|$)/);
  if (m && /[\/.]/.test(m[1])) {
    return [{
      type: 'file-exists',
      value: m[1].trim(),
      rationale: 'matched "<file> `<path>` exists" / "Created `<path>`" pattern',
    }];
  }

  return [];
}

module.exports = { suggestForCriterion };
