const { icon } = require('../../build/icons');

const { esc, inline } = require('../../build/text');

module.exports = {
  meta: {
    name: 'analogy',
    purpose: 'a real-life analogy, before any technical term',
    props: { label: 'string', text: 'string', bridge: 'string' },
    demo: {
      label: 'Think of a queue at the bank',
      text: 'One line, several tellers. Whoever arrives joins the end, and the next free teller calls them.',
      bridge: 'That line is exactly what a work queue does with messages.'
    }
  },

  css: `
.lx-analogy { border-left: 3px solid var(--lx-accent); }
.lx-analogy-label {
  display: flex; align-items: center; gap: .35rem;
  font-size: .7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--lx-accent);
  margin-bottom: .4rem;
}
.lx-analogy-text   { color: var(--lx-text-2); }
.lx-analogy-bridge {
  margin-top: .6rem;
  padding-top: .6rem;
  border-top: 1px solid var(--lx-border);
  color: var(--lx-text);
  font-weight: 500;
}
`,

  render({ label, text, bridge }) {
    return `  <div class="lx-card lx-analogy">
    <span class="lx-analogy-label">${icon('lightbulb')} ${inline(label)}</span>
    <p class="lx-analogy-text">${inline(text)}</p>
    <p class="lx-analogy-bridge">${inline(bridge)}</p>
  </div>`;
  }
};
