const { esc, inline } = require('../../build/text');

module.exports = {
  meta: {
    name: 'compare',
    purpose: 'two or three options side by side',
    props: {
      columns: 'array<{label: string, body: string}>',
      caption: 'string?'
    },
    demo: {
      caption: 'Where each one breaks',
      columns: [
        { label: 'Long polling', body: 'Simple to run. Holds one waiting connection per client.' },
        { label: 'WebSocket',    body: 'Two-way and cheap per message. Server-side state complicates load balancing.' }
      ]
    }
  },

  css: `
.lx-compare { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
.lx-compare-col { display: flex; flex-direction: column; }
.lx-compare-label {
  color: var(--lx-accent);
  font-size: .7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
  margin-bottom: .45rem;
}
.lx-compare-body { color: var(--lx-text-2); font-size: .9rem; }

@media (max-width: 560px) {
  .lx-compare { grid-template-columns: 1fr; gap: .85rem; }
}
`,

  render({ columns, caption }) {
    const cols = columns.map(c => `
      <div class="lx-card lx-compare-col">
        <span class="lx-compare-label">${inline(c && c.label)}</span>
        <p class="lx-compare-body">${inline(c && c.body)}</p>
      </div>`).join('');

    return `  <figure class="lx-figure">
    <div class="lx-compare">${cols}
    </div>
    ${caption ? `<figcaption class="lx-caption">${inline(caption)}</figcaption>` : ''}
  </figure>`;
  }
};
