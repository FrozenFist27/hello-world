const { icon } = require('./icons');
const { t, runtimeStrings } = require('./strings');

const { esc, inline, plain } = require('./text');

// Relative so the page works over file:// as well as http://.
function assetPrefix(depth = 1) { return '../'.repeat(depth); }

function phasesOf(blocks = []) {
  return blocks
    .filter(b => b && b.component === 'phase' && b.props && b.props.id != null)
    .map(b => String(b.props.id));
}

function hasComponent(blocks, name) {
  return (blocks || []).some(b =>
    b && (b.component === name || hasComponent(b.children, name))
  );
}

// Inline and before first paint: restored by the deferred runtime, the theme
// would flash wrong for one frame on every load.
const THEME_BOOT = `<script>(function(){try{var d=document.documentElement,` +
  `t=localStorage.getItem('lx-theme'),a=localStorage.getItem('lx-accent');` +
  `if(t&&t!=='auto')d.setAttribute('data-theme',t);` +
  `if(a&&a!=='azul')d.setAttribute('data-accent',a)}catch(e){}})()</script>`;

function topBar(a) {
  return `  <nav class="lx-topbar">
    <a class="lx-topbar-home" href="${a}" title="${t('nav.home')}">
      ${icon('house', { className: 'lx-topbar-icon' })}
      <span>learno</span>
    </a>
    <div class="lx-topbar-right">
      <a class="lx-topbar-link" href="${a}reference/library.html" title="${t('nav.library')}">
        ${icon('library')}
        <span>${t('nav.library')}</span>
      </a>
      ${settings()}
    </div>
  </nav>`;
}

// <details> rather than a button plus JS: click-outside, Escape and focus are
// all handled by the browser, and it still opens if the runtime never loads.
function settings() {
  return `<details class="lx-settings">
      <summary class="lx-settings-btn" title="${t('settings.title')}" aria-label="${t('settings.title')}" role="button">
        ${icon('settings')}
      </summary>
      <div class="lx-settings-panel">
        <div class="lx-settings-group">
          <p class="lx-settings-label">${t('settings.theme')}</p>
          <div class="lx-settings-row">
            <button type="button" class="lx-settings-opt" data-theme-set="light" title="${t('settings.light')}">${icon('sun')}</button>
            <button type="button" class="lx-settings-opt" data-theme-set="auto" title="${t('settings.auto')}">${icon('monitor')}</button>
            <button type="button" class="lx-settings-opt" data-theme-set="dark" title="${t('settings.dark')}">${icon('moon')}</button>
          </div>
        </div>
        <div class="lx-settings-group">
          <p class="lx-settings-label">${t('settings.accent')}</p>
          <div class="lx-settings-row">
            <button type="button" class="lx-settings-opt" data-accent-set="azul" title="${t('settings.blue')}"><span class="lx-settings-dot lx-settings-dot--azul"></span>${t('settings.blue')}</button>
            <button type="button" class="lx-settings-opt" data-accent-set="roxo" title="${t('settings.purple')}"><span class="lx-settings-dot lx-settings-dot--roxo"></span>${t('settings.purple')}</button>
            <button type="button" class="lx-settings-opt" data-accent-set="rosa" title="${t('settings.pink')}"><span class="lx-settings-dot lx-settings-dot--rosa"></span>${t('settings.pink')}</button>
          </div>
        </div>
      </div>
    </details>`;
}

function page({ id, title, subtitle, tag, icon: lessonIcon, blocks, concepts = [], body, depth = 1 }) {
  const a       = assetPrefix(depth);
  const phases  = phasesOf(blocks);
  const needsJs = phases.length ||
                  hasComponent(blocks, 'recall') ||
                  hasComponent(blocks, 'quiz') ||
                  hasComponent(blocks, 'teachback');

  // Data, not generated code, so nothing is ever escaped into a JS context.
  const config = JSON.stringify({ lesson: id, concepts, phases, strings: runtimeStrings() });

  const progress = phases.length
    ? `  <div class="lx-progress" role="presentation">
${phases.map(p => `    <span class="lx-progress-seg" data-seg="${esc(p)}"></span>`).join('\n')}
  </div>`
    : '';

  const titleIcon = lessonIcon
    ? `<span class="lx-title-icon">${icon(lessonIcon)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="${t('html.lang')}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${plain(title || id)}</title>
<link rel="stylesheet" href="${a}assets/learno.css" />
<link rel="stylesheet" href="${a}assets/components.css" />
${THEME_BOOT}
</head>
<body class="lx-shell" data-lesson="${esc(id)}">


<!-- Shared arrowhead. Authored diagrams reference #lx-arrow and never carry
     their own marker definition. -->
<svg class="lx-defs" aria-hidden="true">
  <defs>
    <marker id="lx-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path class="lx-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
    </marker>
  </defs>
</svg>

${topBar(a)}

<div class="lx-wrap">
  <header class="lx-lesson-head">
    ${tag ? `<span class="lx-badge">${inline(tag)}</span>` : ''}
    <h1 class="lx-title">${titleIcon}<span>${inline(title || id)}</span></h1>
    ${subtitle ? `<p class="lx-subtitle">${inline(subtitle)}</p>` : ''}
  </header>

  <div class="lx-offline-banner" id="lx-banner" hidden>
    ${t('offline.banner')}
  </div>

${progress}

  <div class="lx-blocks">
${body}
  </div>

  <footer class="lx-lesson-foot">
    <a class="lx-btn lx-btn--outline" href="${a}reference/my-learning.html">${t('nav.dashboard')}</a>
    <a class="lx-btn lx-btn--outline" href="${a}reference/glossary.html">${t('nav.glossary')}</a>
    ${needsJs ? `<button type="button" class="lx-btn lx-btn--ghost" data-action="restart"
      title="${t('run.restartTitle')}">${t('run.restart')}</button>` : ''}
  </footer>
</div>
${needsJs ? `
<script type="application/json" id="lx-config">${config}</script>` : ''}
<script src="${a}assets/learno.js" defer></script>
</body>
</html>
`;
}

module.exports = { page, esc, phasesOf, topBar, THEME_BOOT };
