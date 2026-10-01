// A chess position from FEN, rendered as an 8×8 grid of Unicode pieces. The lesson writes
// the FEN (which the engine helper has already verified); the board owns its own layout,
// coordinates, side-to-move line, highlighted squares and arrows, so the yml never carries
// markup for a position. Arrows reuse the page's shared `lx-arrow` marker.

const { esc, inline } = require('../../build/text');

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

function parseFen(fen) {
  const [placement = '', turn = 'w'] = String(fen || '').trim().split(/\s+/);
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`board: a FEN has 8 ranks, "${fen}" has ${ranks.length}`);
  const grid = ranks.map((row, i) => {
    const out = [];
    for (const ch of row) {
      if (/[1-8]/.test(ch)) out.push(...Array(Number(ch)).fill(null));
      else if (/[kqrbnpKQRBNP]/.test(ch)) out.push(ch);
      else throw new Error(`board: "${ch}" is not a piece or a count, in rank ${8 - i} of "${fen}"`);
    }
    if (out.length !== 8) throw new Error(`board: rank ${8 - i} of "${fen}" has ${out.length} squares, not 8`);
    return out;
  });
  return { grid, turn: turn === 'b' ? 'black' : 'white' };
}

function square(name) {
  const m = /^([a-h])([1-8])$/.exec(String(name || '').trim().toLowerCase());
  if (!m) throw new Error(`board: "${name}" is not a square like e4`);
  return { file: FILES.indexOf(m[1]), rank: Number(m[2]) - 1 };
}

function arrow(spec) {
  const s = String(spec || '').trim().toLowerCase();
  if (s.length !== 4) throw new Error(`board: an arrow is two squares like e2e4, not "${spec}"`);
  return { from: square(s.slice(0, 2)), to: square(s.slice(2)) };
}

// Grid position (0..7 from the top-left as drawn) of a square, honouring flip.
const col = (file, flip) => (flip ? 7 - file : file);
const row = (rank, flip) => (flip ? rank : 7 - rank);

module.exports = {
  meta: {
    name: 'board',
    purpose: 'a chess position from FEN, with optional highlighted squares and arrows',
    props: {
      fen:       'string',
      caption:   'string?',
      highlight: 'array<string>?',
      arrows:    'array<string>?',
      flip:      'bool?',
      turn:      'bool?'
    },
    demo: {
      caption: 'After 1.e4 e5 2.Nf3 Nc6 3.Bb5: the bishop eyes the knight that defends e5',
      fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
      highlight: ['c6', 'e5'],
      arrows: ['b5c6', 'f3e5']
    }
  },

  css: `
.lx-board-wrap { max-width: 22rem; margin: 0 auto; padding: .9rem .9rem .6rem; }
.lx-board {
  --lx-board-light: color-mix(in srgb, var(--lx-text) 9%, var(--lx-card));
  --lx-board-dark:  color-mix(in srgb, var(--lx-text) 30%, var(--lx-card));
  --lx-board-white-piece: #f6f5ef;
  --lx-board-black-piece: #1c1b19;
  position: relative;
  display: grid; grid-template-columns: repeat(8, 1fr);
  aspect-ratio: 1;
  border-radius: var(--lx-radius-sm);
  overflow: hidden;
  border: 1px solid var(--lx-border);
  user-select: none;
}
.lx-board-sq { position: relative; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
.lx-board-sq--light { background: var(--lx-board-light); }
.lx-board-sq--dark  { background: var(--lx-board-dark); }
.lx-board-sq--hi::after {
  content: ""; position: absolute; inset: 0;
  box-shadow: inset 0 0 0 .22rem var(--lx-accent);
  pointer-events: none;
}
.lx-board-pc {
  font-size: clamp(1.1rem, 8.5vw, 1.95rem); line-height: 1;
  font-family: "Segoe UI Symbol", "Noto Sans Symbols2", "DejaVu Sans", "Apple Symbols", sans-serif;
}
.lx-board-pc--w { color: var(--lx-board-white-piece); -webkit-text-stroke: .5px var(--lx-board-black-piece);
  text-shadow: 0 0 1px var(--lx-board-black-piece), 0 0 2px var(--lx-board-black-piece); }
.lx-board-pc--b { color: var(--lx-board-black-piece); -webkit-text-stroke: .4px var(--lx-board-white-piece); }
.lx-board-coord {
  position: absolute; font-style: normal; font-size: .58rem; font-weight: 700; line-height: 1;
  color: var(--lx-text-muted); opacity: .9;
}
.lx-board-coord--rank { top: .15rem; left: .2rem; }
.lx-board-coord--file { bottom: .15rem; right: .2rem; }
.lx-board-arrows { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.lx-board-arrow { stroke: var(--lx-accent); stroke-width: 14; stroke-linecap: round; fill: none; opacity: .85; marker-end: url(#lx-arrow); }
.lx-board-turn { display: flex; align-items: center; gap: .45rem; justify-content: center; margin: .6rem 0 0;
  font-size: .78rem; color: var(--lx-text-muted); }
.lx-board-dot { width: .7rem; height: .7rem; border-radius: 50%; border: 1px solid var(--lx-text-muted); }
.lx-board-dot--white { background: var(--lx-board-white-piece, #f6f5ef); }
.lx-board-dot--black { background: var(--lx-board-black-piece, #1c1b19); }
`,

  render({ fen, caption, highlight, arrows, flip, turn }) {
    const pos = parseFen(fen);
    const hi = new Set((highlight || []).map(s => { const q = square(s); return `${q.file},${q.rank}`; }));
    const cells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const file = flip ? 7 - c : c;
        const rank = flip ? r : 7 - r;
        const piece = pos.grid[7 - rank][file];
        const light = (file + rank) % 2 === 1;
        const cls = ['lx-board-sq', light ? 'lx-board-sq--light' : 'lx-board-sq--dark', hi.has(`${file},${rank}`) ? 'lx-board-sq--hi' : '']
          .filter(Boolean).join(' ');
        const coordRank = c === 0 ? `<i class="lx-board-coord lx-board-coord--rank">${rank + 1}</i>` : '';
        const coordFile = r === 7 ? `<i class="lx-board-coord lx-board-coord--file">${FILES[file]}</i>` : '';
        const glyph = piece
          ? `<span class="lx-board-pc ${piece === piece.toUpperCase() ? 'lx-board-pc--w' : 'lx-board-pc--b'}">${GLYPH[piece.toLowerCase()]}</span>`
          : '';
        cells.push(`<div class="${cls}" data-square="${FILES[file]}${rank + 1}">${coordRank}${glyph}${coordFile}</div>`);
      }
    }
    const lines = (arrows || []).map(a => {
      const { from, to } = arrow(a);
      const x1 = (col(from.file, flip) + 0.5) * 100, y1 = (row(from.rank, flip) + 0.5) * 100;
      let x2 = (col(to.file, flip) + 0.5) * 100, y2 = (row(to.rank, flip) + 0.5) * 100;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      x2 -= (dx / len) * 22; y2 -= (dy / len) * 22;   // stop short so the head sits inside the square
      return `<line class="lx-board-arrow" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }).join('');
    const overlay = lines ? `<svg class="lx-board-arrows" viewBox="0 0 800 800" aria-hidden="true">${lines}</svg>` : '';
    const label = `${pos.turn === 'white' ? 'White' : 'Black'} to move`;
    const turnLine = turn === false ? '' :
      `<p class="lx-board-turn"><span class="lx-board-dot lx-board-dot--${pos.turn}"></span>${label}</p>`;
    return `  <figure class="lx-figure">
    <div class="lx-card lx-board-wrap">
      <div class="lx-board" role="img" aria-label="${esc(caption || `Chess position, ${label}`)}">${cells.join('')}${overlay}</div>
      ${turnLine}
    </div>
    ${caption ? `<figcaption class="lx-caption">${inline(caption)}</figcaption>` : ''}
  </figure>`;
  }
};
