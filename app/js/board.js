// board.js - the board renderer and tap input. It draws what it is told and never decides
// legality: setPosition() takes a chess.js instance only to read chess.board(); move()/unmove()
// take a verbose move and animate it; marks, state and input mode are declarative attributes.
// Imports nothing from the app except contract.js.

import { DOM, TIMING, PIECE_WORDS, COLOR_WORDS, PIECE_SYMBOL_PREFIX, timing } from './contract.js';

const FILES = 'abcdefgh';
const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => Number(sq[1]);
const isSquare = (s) => typeof s === 'string' && /^[a-h][1-8]$/.test(s);
const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const MARK_CLASSES = [DOM.sq.tint, DOM.sq.dot, DOM.sq.ring, DOM.sq.amber, DOM.sq.ok, DOM.sq.glow, DOM.sq.lit];

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function fastMode() {
  return document.documentElement.dataset.fast === '1';
}
// A motion duration in ms: 0 under reduced motion or fast mode (CSS zeroes the same durations).
function motionMs(name) {
  return fastMode() || reducedMotion() ? 0 : TIMING[name];
}

function pieceLabel(code, square) {
  const color = COLOR_WORDS[code[0] === 'w' ? 'w' : 'b'];
  const word = PIECE_WORDS[code[1].toLowerCase()] || 'piece';
  const c = color.charAt(0).toUpperCase() + color.slice(1);
  return `${c} ${word} on ${square}`;
}

function pieceSvg(code) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${PIECE_SYMBOL_PREFIX}${code}`);
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${PIECE_SYMBOL_PREFIX}${code}`);
  svg.appendChild(use);
  return svg;
}

function placeEl(el, square) {
  el.style.setProperty('--tx', `${fileOf(square) * 100}%`);
  el.style.setProperty('--ty', `${(8 - rankOf(square)) * 100}%`);
  el.dataset.square = square;
}

function setPieceCode(el, code) {
  el.dataset.piece = code;
  const use = el.querySelector('use');
  if (use) {
    use.setAttribute('href', `#${PIECE_SYMBOL_PREFIX}${code}`);
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${PIECE_SYMBOL_PREFIX}${code}`);
  }
  el.setAttribute('aria-label', pieceLabel(code, el.dataset.square));
}

// The square a capture removes a piece from: the landing square, or for en passant (flag 'e')
// the pawn behind it, on the mover's origin rank.
function capturedSquare(mv) {
  if (!mv.captured) return null;
  if (String(mv.flags || '').includes('e')) return mv.to[0] + mv.from[1];
  return mv.to;
}
function castleRook(mv) {
  const flags = String(mv.flags || '');
  const rank = mv.from[1];
  if (flags.includes('k')) return { from: `h${rank}`, to: `f${rank}` };
  if (flags.includes('q')) return { from: `a${rank}`, to: `d${rank}` };
  return null;
}

export function createBoard(root, { onTap } = {}) {
  if (!root) throw new Error('createBoard needs the board root element');
  const q = (id) => root.querySelector(`#${id}`);
  const squaresEl = q(DOM.ids.squares) || root.appendChild(Object.assign(document.createElement('div'), { id: DOM.ids.squares, className: 'squares' }));
  const piecesEl = q(DOM.ids.pieces) || root.appendChild(Object.assign(document.createElement('div'), { id: DOM.ids.pieces, className: 'pieces' }));
  const ghostsEl = q(DOM.ids.ghosts) || root.appendChild(Object.assign(document.createElement('div'), { id: DOM.ids.ghosts, className: 'ghosts' }));
  // the '-N' float sits outside the board (overflow: hidden) in its wrapper, so it never crosses a square
  const lossEl = (root.ownerDocument || document).getElementById(DOM.ids.loss)
    || (root.parentElement || root).appendChild(Object.assign(document.createElement('div'), { id: DOM.ids.loss, className: 'loss', hidden: true }));

  // ---- squares -------------------------------------------------------------------------------
  const squares = new Map();
  squaresEl.textContent = '';
  for (let r = 8; r >= 1; r--) {
    for (let f = 0; f < 8; f++) {
      const sq = FILES[f] + r;
      const light = (f + r) % 2 === 0;   // a1 (f 0, r 1) is dark; h1 light: 'light on the right'
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${DOM.sq.base} ${light ? DOM.sq.light : DOM.sq.dark}`;
      b.dataset.square = sq;
      b.tabIndex = -1;
      b.setAttribute('aria-label', sq);
      if (f === 0) {
        const c = document.createElement('span');
        c.className = `${DOM.sq.coord} rank`;
        c.textContent = String(r);
        b.appendChild(c);
      }
      if (r === 1) {
        const c = document.createElement('span');
        c.className = `${DOM.sq.coord} file`;
        c.textContent = FILES[f];
        b.appendChild(c);
      }
      squaresEl.appendChild(b);
      squares.set(sq, b);
    }
  }

  // ---- pieces --------------------------------------------------------------------------------
  let nextId = 1;
  piecesEl.textContent = '';
  ghostsEl.textContent = '';

  function livePieces() {
    return Array.from(piecesEl.querySelectorAll(`.${DOM.pc.base}:not(.${DOM.pc.captured})`));
  }
  function pieceAt(square) {
    return livePieces().find((el) => el.dataset.square === square) || null;
  }
  function makePiece(code, square) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = DOM.pc.base;
    b.dataset.id = String(nextId++);
    b.appendChild(pieceSvg(code));
    placeEl(b, square);
    setPieceCode(b, code);
    return b;
  }
  function removePieceLater(el, ms) {
    el.classList.add(DOM.pc.captured);
    el.dataset.square = '';
    el.tabIndex = -1;
    return wait(ms).then(() => { if (el.parentNode) el.remove(); });
  }

  function setPosition(chess, { animate = false } = {}) {
    const wanted = new Map();
    const grid = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = grid[r][f];
        if (cell) wanted.set(cell.square || FILES[f] + (8 - r), cell.color + cell.type.toUpperCase());
      }
    }
    // Drop anything mid-capture, keep pieces that stay, collect the rest.
    for (const el of piecesEl.querySelectorAll(`.${DOM.pc.captured}`)) el.remove();
    const spare = [];
    for (const el of livePieces()) {
      const sq = el.dataset.square;
      if (wanted.get(sq) === el.dataset.piece) wanted.delete(sq);
      else spare.push(el);
    }
    for (const [sq, code] of wanted) {
      let el = null;
      if (animate) {
        const i = spare.findIndex((s) => s.dataset.piece === code);
        if (i >= 0) el = spare.splice(i, 1)[0];
      }
      if (el) {
        placeEl(el, sq);
        setPieceCode(el, code);
      } else {
        piecesEl.appendChild(makePiece(code, sq));
      }
    }
    for (const el of spare) el.remove();
  }

  async function move(mv) {
    if (!mv || !isSquare(mv.from) || !isSquare(mv.to)) return;
    const ms = motionMs('MOVE_MS');
    const el = pieceAt(mv.from);
    const capSq = capturedSquare(mv);
    const pending = [];
    if (capSq) {
      const cap = pieceAt(capSq);
      if (cap && cap !== el) pending.push(removePieceLater(cap, ms));
    }
    if (el) {
      placeEl(el, mv.to);
      el.setAttribute('aria-label', pieceLabel(el.dataset.piece, mv.to));
    }
    const rook = castleRook(mv);
    if (rook) {
      const r = pieceAt(rook.from);
      if (r) { placeEl(r, rook.to); r.setAttribute('aria-label', pieceLabel(r.dataset.piece, rook.to)); }
    }
    await wait(ms);
    if (el && mv.promotion) setPieceCode(el, mv.color + String(mv.promotion).toUpperCase());
    await Promise.all(pending);
  }

  async function unmove(mv) {
    if (!mv || !isSquare(mv.from) || !isSquare(mv.to)) return;
    const ms = motionMs('MOVE_MS');
    const el = pieceAt(mv.to);
    if (el) {
      if (mv.promotion) setPieceCode(el, mv.color + 'P');
      placeEl(el, mv.from);
      el.setAttribute('aria-label', pieceLabel(el.dataset.piece, mv.from));
    }
    const rook = castleRook(mv);
    if (rook) {
      const r = pieceAt(rook.to);
      if (r) { placeEl(r, rook.from); r.setAttribute('aria-label', pieceLabel(r.dataset.piece, rook.from)); }
    }
    const capSq = capturedSquare(mv);
    if (capSq && !pieceAt(capSq)) {
      const code = (mv.color === 'w' ? 'b' : 'w') + String(mv.captured).toUpperCase();
      const back = makePiece(code, capSq);
      back.style.opacity = '0';
      piecesEl.appendChild(back);
      // next frame: fade in
      requestAnimationFrame(() => { back.style.opacity = ''; });
    }
    await wait(ms);
  }

  // ---- marks, state, classes -----------------------------------------------------------------
  function setMarks(marks = {}) {
    const tint = new Set(marks.tint || []);
    const dots = new Set(marks.dots || []);
    const rings = new Set(marks.rings || []);
    const ok = new Set(marks.ok || []);
    const lit = new Set(marks.lit || []);
    const amber = marks.amber || null;
    const glow = marks.glow || null;
    for (const [sq, el] of squares) {
      el.classList.toggle(DOM.sq.tint, tint.has(sq));
      el.classList.toggle(DOM.sq.dot, dots.has(sq));
      el.classList.toggle(DOM.sq.ring, rings.has(sq));
      el.classList.toggle(DOM.sq.amber, amber === sq);
      el.classList.toggle(DOM.sq.ok, ok.has(sq));
      el.classList.toggle(DOM.sq.glow, glow === sq);
      el.classList.toggle(DOM.sq.lit, lit.has(sq));
    }
  }
  function setState(state, hold) {
    root.dataset.state = state;
    root.dataset.hold = hold || '';
  }
  function setInput(mode) {
    root.dataset.input = mode;
  }
  function single(cls, square) {
    for (const el of piecesEl.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
    if (square) {
      const el = pieceAt(square);
      if (el) el.classList.add(cls);
    }
  }
  const pick = (sq) => single(DOM.pc.picked, sq);
  const lift = (sq) => single(DOM.pc.lifted, sq);
  const pending = (sq) => single(DOM.pc.pending, sq);
  const squareEl = (sq) => squares.get(sq) || null;

  // ---- ghosts --------------------------------------------------------------------------------
  const ghosts = {
    add(piece, square) {
      const g = document.createElement('div');
      g.className = DOM.pc.ghost;
      g.dataset.piece = piece;
      g.appendChild(pieceSvg(piece));
      placeEl(g, square);
      ghostsEl.appendChild(g);
      return g;
    },
    async move(el, square, duration) {
      if (!el) return;
      const ms = duration == null ? motionMs('MOVE_MS') : (fastMode() || reducedMotion() ? 0 : duration);
      el.style.transitionDuration = duration == null ? '' : `${ms}ms`;
      placeEl(el, square);
      await wait(ms);
    },
    remove(el) {
      if (el && el.parentNode === ghostsEl) el.remove();
    },
    clear() {
      ghostsEl.textContent = '';
    },
    setDim(on) {
      if (on) root.dataset.ghost = '1';
      else delete root.dataset.ghost;
    },
    // the real piece a ghost capture lands on is hidden (class taken) so the ghost replaces it
    take(square, on = true) {
      const el = square ? pieceAt(square) : null;
      if (el) el.classList.toggle(DOM.pc.taken, !!on);
    },
    untakeAll() {
      for (const el of piecesEl.querySelectorAll(`.${DOM.pc.taken}`)) el.classList.remove(DOM.pc.taken);
    },
  };

  // ---- the -N float --------------------------------------------------------------------------
  let floatToken = 0;
  async function float(text, { reduced = reducedMotion(), fast = fastMode() } = {}) {
    const token = ++floatToken;
    lossEl.classList.remove('rising', 'static');
    lossEl.textContent = text;
    lossEl.hidden = false;
    let ms;
    if (reduced) {
      lossEl.classList.add('static');
      ms = timing('REDUCED_STATIC_MS', fast);
    } else {
      void lossEl.offsetWidth; // restart the animation
      lossEl.classList.add('rising');
      ms = timing('FLOAT_MS', fast);
    }
    await wait(ms);
    if (token === floatToken) {
      lossEl.hidden = true;
      lossEl.classList.remove('rising', 'static');
    }
  }

  // ---- input ---------------------------------------------------------------------------------
  function targetOf(ev) {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t) return null;
    const el = t.closest(`.${DOM.pc.base}, .${DOM.sq.base}`);
    if (!el || !root.contains(el)) return null;
    if (el.classList.contains(DOM.pc.captured)) return null;
    return el;
  }
  function fire(el) {
    if (!el || typeof onTap !== 'function') return;
    const sq = el.dataset.square;
    if (!isSquare(sq)) return;
    if (el.classList.contains(DOM.pc.base)) onTap(sq, { piece: el.dataset.piece || null, kind: 'piece' });
    else {
      const pc = pieceAt(sq);
      onTap(sq, { piece: pc ? pc.dataset.piece : null, kind: 'square' });
    }
  }

  let down = null;
  function onPointerDown(ev) {
    if (ev.button != null && ev.button !== 0) { down = null; return; }
    const el = targetOf(ev);
    down = el ? { el, x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId } : null;
  }
  function onPointerUp(ev) {
    const d = down;
    down = null;
    if (!d || d.id !== ev.pointerId) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (Math.hypot(dx, dy) > TIMING.TAP_MAX_PX) return;
    if (performance.now() - d.t > TIMING.TAP_MAX_MS) return;
    fire(d.el);
  }
  function onPointerCancel() { down = null; }
  function onClick(ev) {
    // A pointer tap was handled on pointerup; keyboard activation arrives as a click with detail 0.
    if (ev.detail !== 0) return;
    const el = targetOf(ev);
    if (el) { ev.preventDefault(); fire(el); }
  }
  function onKeyDown(ev) {
    const el = targetOf(ev);
    if (!el) return;
    const sq = el.dataset.square;
    if (!isSquare(sq)) return;
    let df = 0, dr = 0;
    switch (ev.key) {
      case 'ArrowLeft': df = -1; break;
      case 'ArrowRight': df = 1; break;
      case 'ArrowUp': dr = 1; break;
      case 'ArrowDown': dr = -1; break;
      case 'Enter': case ' ':
        ev.preventDefault();
        fire(el);
        return;
      default: return;
    }
    ev.preventDefault();
    const f = fileOf(sq) + df;
    const r = rankOf(sq) + dr;
    if (f < 0 || f > 7 || r < 1 || r > 8) return;
    const next = FILES[f] + r;
    (pieceAt(next) || squares.get(next)).focus();
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);

  function destroy() {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
    piecesEl.textContent = '';
    ghostsEl.textContent = '';
    squaresEl.textContent = '';
    squares.clear();
    lossEl.hidden = true;
  }

  return {
    setPosition, move, unmove, setMarks, setState, setInput,
    pick, lift, pending, pieceAt, squareEl, ghosts, float,
    flip: false,
    destroy,
  };
}

