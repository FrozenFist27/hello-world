const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Private-use codepoints, which cannot occur in prose: the restore pass must
// match a marker, not any run of digits ("90 segundos" would lose its 90).
const OPEN = '';
const SHUT = '';

function inline(text) {
  // Escaped first, so authored content can never inject markup.
  let s = esc(text);
  // Code is lifted out before the rest, so ** or * inside a span stays literal.
  const code = [];
  s = s.replace(/`([^`]+)`/g, (_, c) =>
    OPEN + (code.push(`<code class="lx-code">${c}</code>`) - 1) + SHUT);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="lx-link" href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(new RegExp(`${OPEN}(\\d+)${SHUT}`, 'g'), (_, i) => code[+i]);
  // One element, not loose text and <code> siblings: inside a flex container each
  // sibling would become its own column.
  return `<span class="lx-inline">${s}</span>`;
}

function blocks(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n').map(l => l.trim());
      if (lines.every(l => /^[-*]\s+/.test(l))) {
        const items = lines.map(l => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('');
        return `<ul class="lx-list">${items}</ul>`;
      }
      return `<p>${inline(block)}</p>`;
    })
    .join('\n    ');
}

// Wears the `code` component's classes so there is one code appearance, not two.
const hljs = require('highlight.js');
const PLAIN = new Set(['text', 'txt', 'plain', 'none', 'output', 'log']);
const FENCE = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;

function fenced(source, lang) {
  const code = String(source).replace(/\s+$/, '');
  let body;

  if (!lang || PLAIN.has(lang.toLowerCase())) body = esc(code);
  else if (hljs.getLanguage(lang)) body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  else {
    // A typo'd language rendered as plain text looks deliberate; refuse it.
    throw new Error(
      `unknown language "${lang}" in a fenced block. Use one highlight.js knows ` +
      `(js, ts, ruby, python, sql, bash, json, yaml, go, rust…), or "text" for none.`);
  }

  return `<div class="lx-card lx-codeblock">` +
    (lang ? `<span class="lx-codeblock-lang">${esc(lang)}</span>` : '') +
    `<pre><code class="hljs">${body}</code></pre></div>`;
}

// Fences are split out first: indentation inside code would otherwise read as a list.
function rich(text) {
  const src = String(text ?? '');
  const out = [];
  let last = 0;

  src.replace(FENCE, (match, lang, code, at) => {
    out.push(blocks(src.slice(last, at)));
    out.push(fenced(code, lang));
    last = at + match.length;
    return match;
  });
  out.push(blocks(src.slice(last)));

  return out.filter(Boolean).join('\n    ');
}

// For places that cannot hold markup, such as the <title> of the page.
const plain = text => esc(String(text ?? '').replace(/[`*]/g, ''));

module.exports = { esc, inline, rich, plain };
