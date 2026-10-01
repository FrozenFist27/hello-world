// Inlined rather than referenced from a sprite: <use href="sprite.svg#id"> is
// blocked over file://, and a lesson has to survive being opened from disk.

const fs   = require('fs');
const path = require('path');

const DIR = path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons');

const cache = new Map();

function readIcon(name) {
  if (cache.has(name)) return cache.get(name);

  const file = path.join(DIR, `${name}.svg`);
  if (!fs.existsSync(file)) {
    // Throw: a typo'd icon rendering nothing leaves a hole nobody notices.
    const all  = fs.readdirSync(DIR).map(f => f.replace(/\.svg$/, ''));
    const near = all.filter(n => n.includes(name) || name.includes(n)).slice(0, 6);
    throw new Error(
      `unknown icon "${name}"` +
      (near.length ? `\n         did you mean: ${near.join(', ')}?` : '') +
      `\n         see https://lucide.dev/icons for the full set`
    );
  }

  const raw = fs.readFileSync(file, 'utf8');
  const body = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')    // opening tag, rebuilt below
    .replace(/<\/svg>\s*$/, '')
    .trim();

  cache.set(name, body);
  return body;
}

// No default size: CSS gives 1em, so an icon scales with the text beside it.
function icon(name, { className = '', size = null, label = null } = {}) {
  const body = readIcon(name);
  const cls  = ['lx-icon-svg', className].filter(Boolean).join(' ');
  const dims = size ? ` width="${size}" height="${size}"` : '';
  const a11y = label
    ? ` role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"`
    : ' aria-hidden="true"';

  return `<svg class="${cls}"${dims} viewBox="0 0 24 24" fill="none" ` +
         `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
         `stroke-linejoin="round"${a11y}>${body}</svg>`;
}

function exists(name) {
  return fs.existsSync(path.join(DIR, `${name}.svg`));
}

module.exports = { icon, exists };
