const { esc, inline, rich } = require('../../build/text');
const { t } = require('../../build/strings');

module.exports = {
  meta: {
    name: 'quiz',
    purpose: 'multiple choice, marked on the page itself',
    props: {
      question: 'string',
      options:  'array<{text: string, correct: bool}>',
      ok:       'string',
      bad:      'string',
      phase:    'string?'
    },
    demo: {
      question: 'Which of these does a cache NOT solve?',
      options: [
        { text: 'Reading the same data again and again', correct: false },
        { text: 'Concurrent writes to the same row', correct: true }
      ],
      ok: 'Right. A cache relieves reads; concurrent writes are still the database\'s problem.',
      bad: 'Repeated reads are exactly what a cache solves.'
    }
  },

  css: `
.lx-quiz-label {
  display: block;
  font-size: .68rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--lx-text-subtle);
  margin-bottom: .45rem;
}
`,

  render({ question, options, ok, bad, phase }) {
    const name = `quiz-${Math.abs(String(question).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`;
    const opts = options.map((o, i) => `
      <label class="lx-choice">
        <input type="radio" name="${name}" value="${i}" data-correct="${o && o.correct ? '1' : '0'}" />
        <span>${inline(o && o.text)}</span>
      </label>`).join('');

    return `  <div class="lx-card lx-quiz" data-phase="${esc(phase || '')}"
       data-ok="${esc(ok)}" data-bad="${esc(bad)}">
    <span class="lx-quiz-label">${t('quiz.pickOne')}</span>
    <div class="lx-ask-q">${rich(question)}</div>
    ${opts}
    <p class="lx-inline-fb"></p>
  </div>`;
  }
};
