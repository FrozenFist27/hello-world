// Not a `table`: its phone fallback is built for short cells and wrecks long prose.

const { icon } = require('../../build/icons');
const { t } = require('../../build/strings');

const { inline } = require('../../build/text');

module.exports = {
  meta: {
    name: 'rubric',
    purpose: 'a project\'s grading criteria — what is enough and what is not',
    props: {
      criteria: 'array<{title: string, ok: string, bad: string}>',
      caption:  'string?'
    },
    demo: {
      caption: 'The rubric is here before you start, on purpose.',
      criteria: [
        {
          title: 'Event identity',
          ok:    'Every event carries a stable id that does not change between attempts.',
          bad:   'An id generated per attempt — the client has no way to tell it is a repeat.'
        },
        {
          title: 'Retry policy',
          ok:    'Exponential backoff with jitter, a cap and a declared maximum number of attempts.',
          bad:   'A fixed interval, or "retry until it works" with no limit.'
        }
      ]
    }
  },

  css: `
.lx-rubric { display: flex; flex-direction: column; gap: .75rem; }
.lx-rubric-item { padding: .9rem 1rem; }
.lx-rubric-title {
  color: var(--lx-text);
  font-size: .95rem; font-weight: 650;
  margin-bottom: .6rem;
}
.lx-rubric-line {
  display: flex; align-items: flex-start; gap: .55rem;
  font-size: .875rem;
  color: var(--lx-text-2);
}
.lx-rubric-line + .lx-rubric-line { margin-top: .5rem; }
/* The icon is the only carrier of the verdict, so it never shrinks and never
   inherits the line's own colour. */
.lx-rubric-mark { flex: 0 0 auto; margin-top: .12em; }
.lx-rubric-line--ok  .lx-rubric-mark { color: var(--lx-good); }
.lx-rubric-line--bad .lx-rubric-mark { color: var(--lx-bad); }
.lx-rubric-line--bad { color: var(--lx-text-subtle); }
`,

  render({ criteria, caption }) {
    const items = (criteria || []).map(c => `
      <div class="lx-card lx-rubric-item">
        <p class="lx-rubric-title">${inline(c && c.title)}</p>
        <p class="lx-rubric-line lx-rubric-line--ok">
          <span class="lx-rubric-mark">${icon('check', { label: t('rubric.ok') })}</span>
          <span>${inline(c && c.ok)}</span>
        </p>
        <p class="lx-rubric-line lx-rubric-line--bad">
          <span class="lx-rubric-mark">${icon('x', { label: t('rubric.bad') })}</span>
          <span>${inline(c && c.bad)}</span>
        </p>
      </div>`).join('');

    return `  <figure class="lx-figure">
    <div class="lx-rubric">${items}
    </div>
    ${caption ? `<figcaption class="lx-caption">${inline(caption)}</figcaption>` : ''}
  </figure>`;
  }
};
