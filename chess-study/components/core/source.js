const { icon } = require('../../build/icons');
const { t } = require('../../build/strings');

const { esc, inline } = require('../../build/text');

// Only http(s). An authored link is content, and content should never be able to
// smuggle javascript: into an href.
const safeHref = url => (/^https?:\/\//i.test(String(url)) ? String(url) : null);

module.exports = {
  meta: {
    name: 'source',
    purpose: 'the primary source the lesson stands on',
    props: { title: 'string', url: 'string?', note: 'string?' },
    demo: {
      title: 'Designing Data-Intensive Applications — ch. 5',
      url: 'https://dataintensive.net/',
      note: 'The discussion of leader-follower replication and how each mode fails.'
    }
  },

  css: `
.lx-source-label {
  display: flex; align-items: center; gap: .35rem;
  color: var(--lx-text-subtle);
  font-size: .7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
  margin-bottom: .4rem;
}
.lx-source-title { color: var(--lx-text); font-weight: 600; }
.lx-source-note  { color: var(--lx-text-muted); font-size: .85rem; margin-top: .3rem; }
`,

  render({ title, url, note }) {
    const href = url ? safeHref(url) : null;
    const name = inline(title);
    return `  <div class="lx-card lx-source">
    <p class="lx-source-label">${icon('book-open')} ${t('source.label')}</p>
    <p class="lx-source-title">${href ? `<a class="lx-link" href="${esc(href)}" rel="noopener noreferrer" target="_blank">${name}</a>` : name}</p>
    ${note ? `<p class="lx-source-note">${inline(note)}</p>` : ''}
  </div>`;
  }
};
