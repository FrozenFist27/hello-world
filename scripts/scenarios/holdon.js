// scenarios/holdon.js - every acceptance scenario in product/PRODUCT.md, in one exported function,
// driven through window.__app with fast mode on. scripts/app_check.js requires this file and calls
// it once per harness page (desktop and phone, light and dark) after the first load:
//
//   module.exports = async (page, ctx) => { ... }   ctx = { vp, scheme, report, out }
//
// The function throws an Error with a clear message on the first failure. Stub-only scenarios
// (Hear me out, the K1 follow-ups) run when ctx.report.stub is true; with --no-stub they are
// skipped and the scenario asserts the link is absent on a hold instead. The cold engine of the
// tutorial checks is simulated by overriding window.Worker from an init script that reads the
// sessionStorage key 'holdon.test.cold' (toggled here, never by the page).
//
// Heavy repetitions (the 10/10 opponent replies) run in full on the desktop/light page and twice
// on the other three so the whole four-page run stays well inside three minutes.

const fs = require('fs');
const path = require('path');

const FEN = {
  start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  tutorial: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  d6: 'r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7',
  ruy: 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
  nxe4: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5',
  placement: 'r2q1rk1/ppp2ppp/2np1n2/2b1p3/2B1P1b1/2PP1N1P/PP3PP1/RNBQ1RK1 w - - 1 8',
  ng4: 'r1bqk2r/pppp1ppp/2n5/2b1p3/2B1P1n1/3P1N1P/PPP2PP1/RNBQK2R w KQkq - 1 6',
  f3e5: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2',
  scholars: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  // Two Knights 4.Ng5 d5 5.exd5 Nxd5: 6.Bxd5 loses to the even trade Qxd5, a loss no one-move look
  // explains (line 2's Qxg5 costs under 200 on its own), so it commits
  twoKnights: 'r1bqkb1r/ppp2ppp/2n5/3np1N1/2B5/8/PPPP1PPP/RNBQK2R w KQkq - 0 6',
  // Black without its queen and rooks (a queen alone is about 640 cp at depth 8 for this engine,
  // under the -900 resignation rule); three quiet White moves make the bot give up.
  resign: '1n2kbn1/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQ - 0 10',
  // White without its queen and rooks: three pre-searches at -900 or worse offer Start again.
  mercy: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/1N2KBN1 w kq - 0 10',
};
const KEYS = {
  tutorialSeen: 'holdon.v1.tutorialSeen', firstHoldSeen: 'holdon.v1.firstHoldSeen',
  firstFloatSeen: 'holdon.v1.firstFloatSeen', games: 'holdon.v1.games',
};
const QUIET = ['Nf3', 'Nc3', 'Bc4', 'd3', 'Be2', 'Be3', 'a3', 'h3', 'Qe2', 'O-O', 'Kf1', 'Ke2', 'Kd1'];
// A quiet Giuoco Pianissimo: 20 White moves, each with Black's reply forced through botMove().
const CLEAN_GAME = [
  ['e4', 'e5'], ['Nf3', 'Nc6'], ['Bc4', 'Bc5'], ['c3', 'Nf6'], ['d3', 'd6'], ['O-O', 'O-O'], ['Bb3', 'a6'],
  ['Nbd2', 'Ba7'], ['h3', 'h6'], ['Re1', 'Re8'], ['Nf1', 'Be6'], ['Ng3', 'Bxb3'], ['axb3', 'd5'], ['Qe2', 'Qd7'],
  ['Be3', 'Bxe3'], ['Qxe3', 'Rad8'], ['Rad1', 'b5'], ['b4', 'Ne7'], ['exd5', 'Nfxd5'], ['Qd2', 'c6'],
];
// The spec's example outputs (K2 and K1) as the stub returns them.
const K2_GOOD = '{"say":"You are, and the bishop on c4 already points at the pawn in front of their king. But it is their move first, and the pawn on d6 takes the knight.","ask":"safe_square","squares":["d6","c4"]}';
const K1_GOOD = '{"if_right":"Yes, the pawn. A knight for a pawn.","if_partial":"The knight on c6 could too. Look at the pawns.","if_wrong":"Not that one. Look at the pawns next to the square.","and_then":"And the knight on c6 watches that square too.","anyway":"There it goes. A knight for a pawn."}';
const K1_BAD_WRONG = '{"if_right":"Yes, the pawn. A knight for a pawn.","if_partial":"The knight on c6 could too. Look at the pawns.","if_wrong":"Not that one. The pawn on d6 is the one.","and_then":"","anyway":"There it goes. A knight for a pawn."}';
// The first banned label, assembled so the word never appears in this file either.
const LABEL = String.fromCharCode(98, 108, 117, 110, 100, 101, 114);
const K2_BAD = [
  ['an off-list square', '{"say":"You are, and the bishop on c4 points at their king. But the pawn on d6 takes the knight.","ask":"safe_square","squares":["h8"]}'],
  ['notation in say', '{"say":"You are, and the bishop points at their king. But dxe5 takes the knight.","ask":"safe_square","squares":["d6"]}'],
  ['a number in say', '{"say":"You are, and the bishop points at their king. But the knight is worth 3 points and the pawn takes it.","ask":"safe_square","squares":["d6"]}'],
  ['the banned word', `{"say":"You are, and the bishop points at their king. But the knight landing there is a ${LABEL}.","ask":"safe_square","squares":["d6"]}`],
  ['an unoffered ask', '{"say":"You are, and the bishop on c4 points at their king. But the pawn on d6 takes the knight.","ask":"their_check","squares":["d6"]}'],
  ['a wrong piece on a square', '{"say":"You are, and the rook on c4 points at their king. But the pawn on d6 takes the knight.","ask":"safe_square","squares":["d6"]}'],
];
// A validator-accepted K2 say at the cap (32 words: 15 + 17) and one word over it (16 + 17).
const K2_32 = '{"say":"You are, and the bishop on c4 points right at the pawn before their king. But it is their move first, and the pawn on d6 simply takes the knight away now.","ask":"safe_square","squares":["d6","c4"]}';
const K2_33 = '{"say":"You are, and the bishop on c4 points at the pawn in front of their king. But it is their move first, and the pawn on d6 simply takes the knight away now.","ask":"safe_square","squares":["d6","c4"]}';
const LONG_LINE = 'Hold on. If the knight lands there, what takes it? Tap it. The knight on the other side could too, and the pawn beside it reaches that square.';
const PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

// The piece letter on a square of a FEN ('p', 'P', ...) or null.
function pieceAtFen(fen, square) {
  const rows = fen.split(' ')[0].split('/');
  const row = rows[8 - Number(square[1])];
  let file = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) { file += Number(ch); continue; }
    if ('abcdefgh'[file] === square[0]) return ch;
    file += 1;
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function holdon(page, ctx = {}) {
  const tag = `${ctx.vp || '?'}/${ctx.scheme || '?'}`;
  const stub = !!(ctx.report && ctx.report.stub);
  // Tiers: desktop/light runs everything with the 10/10 opponent loops; phone/light everything
  // with two iterations; the two dark pages a quick tier (tutorial, board, the dark luminance,
  // the core gate, hold, tap, Show me and decision checks, K2 and not_granted, the close) so the
  // four pages stay inside three minutes on a machine slower than the spec's probe.
  const full = ctx.vp === 'desktop' && ctx.scheme === 'light';
  const quick = ctx.scheme === 'dark';
  const out = ctx.out || '/tmp/app-check';
  let step = 'start';
  const started = Date.now();
  const times = [];
  function mark(name) { times.push(`${step} ${Date.now() - started}ms`); step = name; }

  function expect(cond, msg) {
    if (!cond) throw new Error(`holdon [${tag}] step ${step}: ${msg}`);
  }
  const app = (fn, arg) => page.evaluate(fn, arg);
  const diag = () => app(() => {
    const b = document.getElementById('board');
    const s = window.__app.state();
    return JSON.stringify({
      state: b.dataset.state, hold: b.dataset.hold, input: b.dataset.input, fen: window.__app.fen(),
      coach: document.getElementById('coach').textContent, picked: !!document.querySelector('.pc.picked'),
      lifted: !!document.querySelector('.pc.lifted'), engineReady: s.engineReady, tutorial: s.tutorial, plies: s.plies,
      bar: Array.from(document.querySelectorAll('#actions [data-action]')).map((x) => x.dataset.action),
      active: document.activeElement && (document.activeElement.className + ' ' + JSON.stringify(document.activeElement.dataset || {})),
    });
  }).catch(() => 'no diagnostics');
  async function waitFor(fn, arg, timeout, msg) {
    try {
      await page.waitForFunction(fn, arg, { timeout, polling: 'raf' });
    } catch (e) {
      throw new Error(`holdon [${tag}] step ${step}: timed out after ${timeout} ms waiting for ${msg}; page: ${await diag()}`);
    }
  }
  const coach = () => app(() => document.getElementById('coach').textContent);
  const boardState = () => app(() => document.getElementById('board').dataset.state);
  const boardHold = () => app(() => document.getElementById('board').dataset.hold);
  const fen = () => app(() => window.__app.fen());
  const visible = (sel) => app((s) => { const el = document.querySelector(s); return !!el && !el.hidden && el.offsetParent !== null; }, sel);
  const present = (sel) => app((s) => !!document.querySelector(s), sel);
  const cls = (sq, c) => app(([s, k]) => document.querySelector(`.sq[data-square="${s}"]`).classList.contains(k), [sq, c]);
  const calls = () => app(() => (window.__sampleCalls || []).map((c) => ({ outcome: c.outcome, opts: c.opts, input: String(c.input).slice(0, 4000) })));
  const rejects = () => app(() => window.__coachRejects || 0);
  const load = async (f) => { await app((x) => window.__app.load(x), f); return fen(); };
  const play = (san) => app((s) => window.__app.play(s), san);
  const timedPlay = (san) => app((s) => { const t0 = performance.now(); return window.__app.play(s).then((r) => ({ r, ms: performance.now() - t0 })); }, san);
  const tap = (sq) => app((s) => window.__app.tap(s), sq);
  const action = (name) => app((n) => window.__app.action(n), name);
  const newGame = () => app(() => window.__app.newGame());
  const bar = () => app(() => Array.from(document.querySelectorAll('#actions [data-action]')).map((x) => x.dataset.action));
  const holdState = () => app(() => { const h = window.__app.state().hold; return h ? { answerSquares: h.answerSquares, best: h.answer && h.answer.best, partial: h.answer && h.answer.partial, question: h.question, category: h.category, ask: h.ask } : null; });

  // ---- page setup after every goto/reload ------------------------------------------------------
  async function install() {
    await app(() => {
      window.__app.fast = true;
      const T = { entries: [], obs: [], t0: 0 };
      T.start = () => {
        T.stop();
        T.entries = [];
        T.t0 = performance.now();
        const board = document.getElementById('board');
        const push = (e) => T.entries.push({ t: Math.round(performance.now() - T.t0), state: board.dataset.state, plies: window.__app.state().plies, ...e });
        const coachEl = document.getElementById('coach');
        let last = coachEl.textContent;
        const o1 = new MutationObserver(() => { const t = coachEl.textContent; if (t !== last) { last = t; push({ kind: 'coach', text: t }); } });
        o1.observe(coachEl, { childList: true, characterData: true, subtree: true });
        const o2 = new MutationObserver((ms) => { for (const m of ms) if (m.type === 'attributes' && m.target.dataset) push({ kind: 'sq', square: m.target.dataset.square, classes: m.target.className }); });
        o2.observe(document.getElementById('squares'), { attributes: true, attributeFilter: ['class'], subtree: true });
        const o3 = new MutationObserver((ms) => {
          for (const m of ms) {
            if (m.type === 'childList') for (const n of m.addedNodes) if (n.dataset) push({ kind: 'ghost', square: n.dataset.square, piece: n.dataset.piece });
            if (m.type === 'attributes' && m.target.dataset) push({ kind: 'ghost', square: m.target.dataset.square, piece: m.target.dataset.piece });
          }
        });
        o3.observe(document.getElementById('ghosts'), { childList: true, attributes: true, attributeFilter: ['data-square', 'data-piece'], subtree: true });
        const loss = document.getElementById('loss');
        const o4 = new MutationObserver(() => push({ kind: 'loss', text: loss.textContent, hidden: loss.hidden, fontSize: getComputedStyle(loss).fontSize }));
        o4.observe(loss, { childList: true, characterData: true, attributes: true, subtree: true });
        const bar = document.getElementById('actions');
        const o5 = new MutationObserver(() => push({ kind: 'bar', actions: Array.from(bar.querySelectorAll('[data-action]')).map((b) => b.dataset.action) }));
        o5.observe(bar, { childList: true, subtree: true });
        // the board's state with the position at that instant (read in the observer's microtask,
        // before the controller moves on)
        const o6 = new MutationObserver(() => push({ kind: 'state', fen: window.__app.fen() }));
        o6.observe(board, { attributes: true, attributeFilter: ['data-state'] });
        T.obs = [o1, o2, o3, o4, o5, o6];
      };
      T.stop = () => { for (const o of T.obs) o.disconnect(); T.obs = []; return T.entries; };
      window.__t = T;
    });
  }
  const record = () => app(() => { window.__t.start(); });
  const recorded = () => app(() => window.__t.stop());

  // Reload with the storage prepared: cold silences the Worker (sessionStorage flag read by the
  // init script), clear empties localStorage, flags are written before the load.
  // crash: 'error' | 'silent' kills the real Worker on its first search after readyok (with an error
  // event, or in silence), the shape of a wasm abort or an OS kill on a phone.
  async function reload({ cold = false, clear = false, flags = null, crash = null } = {}) {
    await app(([c, cl, fl, cr]) => {
      try {
        sessionStorage.setItem('holdon.test.cold', c ? '1' : '0');
        sessionStorage.setItem('holdon.test.crash', cr || '');
        if (cl) localStorage.clear();
        if (fl) for (const [k, v] of Object.entries(fl)) localStorage.setItem(k, v);
      } catch { /* storage blocked: the page copes */ }
    }, [cold, clear, flags, crash]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.__app && window.__app.state), null, { timeout: 15000 });
    await install();
  }
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('holdon.test.cold') === '1') {
        window.Worker = class {
          constructor() { this._on = null; }
          postMessage() {}
          terminate() {}
          addEventListener() {}
          removeEventListener() {}
          dispatchEvent() { return false; }
          set onmessage(f) { this._on = f; }
          get onmessage() { return this._on; }
          set onerror(f) {}
          set onmessageerror(f) {}
        };
      } else {
        const crash = sessionStorage.getItem('holdon.test.crash');
        if (crash === 'error' || crash === 'silent') {
          const Real = window.Worker;
          window.Worker = class extends Real {
            postMessage(msg) {
              if (typeof msg === 'string' && msg.startsWith('go ') && !this._dead) {
                this._dead = true;
                super.terminate();
                if (crash === 'error') { try { this.dispatchEvent(new ErrorEvent('error', { message: 'simulated engine abort' })); } catch { /* no ErrorEvent */ } }
                return;
              }
              super.postMessage(msg);
            }
          };
        }
      }
    } catch { /* no sessionStorage: the real Worker stands */ }
  });
  await page.waitForFunction(() => !!(window.__app && window.__app.state), null, { timeout: 15000 });
  await install();

  // A White move that is not held: tries QUIET in order; a hold is taken back and the engine's
  // best move played instead. Returns the play() result of the move that landed.
  async function quietMove() {
    for (const san of QUIET) {
      const r = await play(san);
      if (r === 'illegal') continue;
      if (r !== 'held') return r;
      await action('takeback');
      const best = await app(() => (window.__app.state().pre && window.__app.state().pre.best ? window.__app.state().pre.best.san : null));
      expect(best, `a quiet move was held and no engine best move is known`);
      const r2 = await play(best);
      if (r2 === 'held') { await action('takeback'); continue; }
      return r2;
    }
    throw new Error(`holdon [${tag}] step ${step}: no quiet move could be played`);
  }

  // ==============================================================================================
  // 1. The first screen: tutorial, cold engine, localStorage cleared
  // ==============================================================================================
  mark('1 tutorial');
  await reload({ cold: true, clear: true });
  expect(await fen() === FEN.tutorial, `first screen fen is ${await fen()}`);
  expect((await coach()).includes('Go on'), `first line is '${await coach()}'`);
  expect(await app(() => window.__app.state().engineReady) === false, 'the silenced Worker still made the engine ready');
  {
    const r = await timedPlay('Nd4');
    expect(r.r === 'held', `Nd4 in the tutorial -> ${r.r}`);
    expect(r.ms < 100, `the tutorial hold took ${Math.round(r.ms)} ms (limit 100)`);
    const h = await holdState();
    expect(JSON.stringify(h.answerSquares) === JSON.stringify(['e5', 'c6']), `Nd4 answer squares ${JSON.stringify(h.answerSquares)}`);
    if (stub) expect((await calls()).length === 0, 'the tutorial hold made a sample call');
  }
  await reload({ cold: true, clear: true });
  {
    const r = await play('d3');
    expect(r === 'committed', `d3 in the tutorial -> ${r}`);
    const f = await fen();
    expect(f.startsWith('r1bqk2r/ppppbppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w'), `after 4.d3 the book reply was not ...Be7: ${f}`);
    expect((await coach()).includes('Safe'), `after a safe tutorial move the line is '${await coach()}'`);
    expect(await app((k) => localStorage.getItem(k), KEYS.tutorialSeen) === '1', 'tutorialSeen flag not set');
  }
  await reload({ cold: true, clear: true });
  {
    expect(await play('Bxf7+') === 'held', 'Bxf7+ in the tutorial was not held');
    expect(!(await visible('[data-action="but"]')), 'Hear me out is shown on the tutorial hold');
    const g = await tap('e8');
    expect(g === 'right', `tap e8 -> ${g}`);
    const c = await coach();
    expect(c.includes('Yes') && c.includes('costs nothing'), `after the right tap the line is '${c}'`);
    await action('takeback');
    expect((await coach()).includes('That is all I do'), `after the tutorial take-back the line is '${await coach()}'`);
    expect(await fen() === FEN.tutorial, `after the take-back fen is ${await fen()}`);
    expect(await boardState() === 'idle', `after the take-back state is ${await boardState()}`);
    // the promise is made once: after the tutorial has already stopped his hand, a safe move reads 'Your move.'
    expect(await play('d3') === 'committed', 'd3 after the tutorial hold was not committed');
    expect(await coach() === 'Your move.', `after a safe move following the tutorial hold the line is '${await coach()}'`);
  }
  await reload({ cold: true, clear: true });
  {
    expect(await play('Bxf7+') === 'held', 'Bxf7+ in the tutorial was not held (anyway path)');
    await tap('e8');
    await record();
    await action('anyway');
    const rec = await recorded();
    expect(await fen() === FEN.start, `after the tutorial play-anyway fen is ${await fen()}`);
    expect((await coach()).includes('fresh game'), `after the tutorial play-anyway the line is '${await coach()}'`);
    // the first float this browser sees is named once, on this path too
    expect(rec.some((e) => e.kind === 'coach' && e.text.startsWith('Minus two')), `the first float was not named on the anyway path (lines: ${rec.filter((e) => e.kind === 'coach').map((e) => e.text).join(' | ')})`);
    expect(await app((k) => localStorage.getItem(k), KEYS.firstFloatSeen) === '1', 'firstFloatSeen not set by the tutorial play-anyway');
  }
  // the real Worker again, the tutorial flag set, nothing else remembered
  await reload({ cold: false, clear: true, flags: { [KEYS.tutorialSeen]: '1' } });
  expect(await fen() === FEN.start, `with the flag set the page opened on ${await fen()}`);
  expect(await coach() === 'Your move.', `with the flag set the line is '${await coach()}'`);

  // ==============================================================================================
  // 2. The board
  // ==============================================================================================
  mark('2 board');
  expect(await app(() => document.querySelectorAll('.pc').length) === 32, 'not 32 pieces on the start position');
  // a tournament board: a1 dark, h1 light ('light on the right'), a8 light, h8 dark
  expect(await cls('a1', 'dark') && await cls('h1', 'light') && await cls('a8', 'light') && await cls('h8', 'dark') && await cls('e4', 'light') && await cls('d4', 'dark'), 'the square colours are inverted (a1 must be dark, h1 light)');
  expect(await app(() => Array.from(document.querySelectorAll('.pc')).every((el) => el.tagName === 'BUTTON')), 'a piece is not a button');
  {
    // a focus ring on a piece reached by the keyboard
    let focused = false;
    for (let i = 0; i < 60 && !focused; i++) {
      await page.keyboard.press('Tab');
      focused = await app(() => document.activeElement && document.activeElement.classList.contains('pc'));
    }
    expect(focused, 'Tab never reached a piece');
    const ring = await app(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth }; });
    expect(ring.style !== 'none' && parseFloat(ring.width) > 0, `focused piece outline is ${ring.style} ${ring.width}`);
    await app(() => document.activeElement.blur());
  }
  {
    // real taps; the 'e4 played, Black to move' position exists only between the commit and the
    // book reply (microseconds), so the recorder reads it the instant the state turns to reply
    const before = await app(() => { const el = document.querySelector('.pc[data-square="e2"]'); return { id: el.dataset.id, transform: getComputedStyle(el).transform }; });
    await page.click('.pc[data-square="e2"]');
    expect(await app(() => !!document.querySelector('.pc.picked[data-square="e2"]')), 'tapping the e2 pawn did not pick it up');
    await record();
    const t0 = Date.now();
    await page.click('.sq[data-square="e4"]');
    await waitFor(() => /^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP\/RNBQKBNR w/.test(window.__app.fen()) && document.getElementById('board').dataset.state === 'idle', null, 3000, 'the book reply ...e5');
    expect(Date.now() - t0 < 2000, 'the book reply took longer than 2 s');
    const rec = await recorded();
    // (the spec writes this prefix as 'rnbqkbnr/pppp1ppp/8/8/4P3/8/PPPP1PPP', which is not a legal
    // position: Black's e-pawn is on neither rank; the position after 1.e4 is asserted instead)
    expect(rec.some((e) => e.kind === 'state' && e.state === 'reply' && e.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b')), `the position after e4 was never the one after 1.e4 (states: ${JSON.stringify(rec.filter((e) => e.kind === 'state'))})`);
    const after = await app((id) => { const el = document.querySelector(`.pc[data-id="${id}"]`); return { square: el && el.dataset.square, transform: el && getComputedStyle(el).transform }; }, before.id);
    expect(after.square === 'e4' && after.transform !== before.transform, `the e2 piece transform did not change (${before.transform} -> ${after.transform})`);
    const c = await coach();
    expect(c === 'Your move.' || c.includes('last game'), `after the reply the line is '${c}'`);
  }
  {
    // reduced motion zeroes the piece transition (checked with fast mode off, which otherwise zeroes it too)
    await app(() => { window.__app.fast = false; });
    const normal = await app(() => getComputedStyle(document.querySelector('.pc')).transitionDuration);
    expect(normal.split(',').some((d) => parseFloat(d) > 0), `without reduced motion the piece transition is ${normal}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await app(() => getComputedStyle(document.querySelector('.pc')).transitionDuration);
    expect(reduced.split(',').every((d) => d.trim() === '0s'), `under reduced motion the piece transition is ${reduced}`);
    await page.emulateMedia({ reducedMotion: null });
    await app(() => { window.__app.fast = true; });
  }
  if (ctx.vp === 'phone') {
    fs.mkdirSync(out, { recursive: true });
    for (const code of PIECES) {
      const el = await page.$(`.pc[data-piece="${code}"]`);
      expect(el, `no piece ${code} on the board`);
      await el.screenshot({ path: path.join(out, `piece-${code}-${ctx.scheme}.png`) });
    }
  }

  // ==============================================================================================
  // 3. The engine
  // ==============================================================================================
  mark('3 engine');
  expect(await app(() => window.__app.waitEngine()) === true, 'the engine never became ready');
  if (!quick) {
    // a Worker that dies after readyok (an error event on its first search): the engine goes cold at
    // once, the move commits with no verdict, the reply still comes, and newGame() resolves
    await reload({ crash: 'error', flags: { [KEYS.tutorialSeen]: '1' } });
    expect(await app(() => window.__app.waitEngine()) === true, 'the engine never became ready before the simulated crash');
    const r = await timedPlay('e4');
    expect(r.r === 'committed', `e4 with a dead Worker -> ${r.r}`);
    expect(r.ms < 3000, `e4 with a dead Worker took ${Math.round(r.ms)} ms`);
    expect(await app(() => window.__app.state().engineReady) === false, 'a dead Worker still reads engineReady');
    expect(await boardState() === 'idle' && (await fen()).split(' ')[1] === 'w', `after the dead-Worker move the state is ${await boardState()}, fen ${await fen()}`);
    expect(await play('Nc3') === 'committed', 'a second move with a dead Worker did not commit');
    await newGame();
    expect(await fen() === FEN.start && await boardState() === 'idle', 'newGame() with a dead Worker did not open the start position');
    if (full) {
      // the same Worker gone silent with no event at all: the watchdog ends the search and the engine goes cold
      await reload({ crash: 'silent', flags: { [KEYS.tutorialSeen]: '1' } });
      expect(await app(() => window.__app.waitEngine()) === true, 'the engine never became ready before the silent death');
      const r2 = await timedPlay('e4');
      expect(r2.r === 'committed', `e4 with a silent Worker -> ${r2.r}`);
      expect(r2.ms < 7000, `e4 with a silent Worker took ${Math.round(r2.ms)} ms (watchdog 4 s)`);
      expect(await app(() => window.__app.state().engineReady) === false, 'a silent Worker still reads engineReady');
      await newGame();
      expect(await fen() === FEN.start, 'newGame() after the silent death did not resolve to the start position');
    }
    await reload({ cold: false, flags: { [KEYS.tutorialSeen]: '1' } });
    expect(await app(() => window.__app.waitEngine()) === true, 'the engine never became ready after the crash checks');
  }

  // ==============================================================================================
  // 4. The gate
  // ==============================================================================================
  mark('4 gate');
  // The spec's engine-bound budgets (verdict 300 ms, reward line 300 ms, ok ring 200 ms) were
  // measured on a probe whose depth-14 pre-search took at most 243 ms. A slower machine scales
  // them by its own pre-search time (the slowest spec position, best of two), never below 1.
  let scale = 1;
  {
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      await load(FEN.ruy);
      best = Math.min(best, Date.now() - t0);
    }
    scale = Math.max(1, best / 250);
    times.push(`pre-search ${best}ms scale ${scale.toFixed(2)}`);
  }
  const limit = (ms) => Math.round(ms * scale);
  async function holdCase(f, san, want) {
    await load(f);
    const r = await timedPlay(san);
    expect(r.r === 'held', `${san} from ${f.split(' ')[0]} -> ${r.r} (expected held)`);
    expect(r.ms < limit(300), `${san} verdict took ${Math.round(r.ms)} ms (limit ${limit(300)})`);
    expect(await boardState() === 'held', `${san}: data-state is ${await boardState()}`);
    expect(await boardHold() === want.category, `${san}: data-hold is '${await boardHold()}', expected ${want.category}`);
    const h = await holdState();
    if (want.answer) expect(JSON.stringify(h.answerSquares) === JSON.stringify(want.answer), `${san}: answer squares ${JSON.stringify(h.answerSquares)}, expected ${JSON.stringify(want.answer)}`);
    if (want.best) expect(h.best === want.best, `${san}: best is ${h.best}, expected ${want.best}`);
    if (want.partial) expect(JSON.stringify(h.partial) === JSON.stringify(want.partial), `${san}: partial ${JSON.stringify(h.partial)}, expected ${JSON.stringify(want.partial)}`);
    return h;
  }
  async function committedCase(f, san) {
    await load(f);
    const r = await play(san);
    expect(r === 'committed', `${san} from ${f.split(' ')[0]} -> ${r} (expected committed)`);
    expect(await boardState() === 'idle', `${san}: after the reply data-state is ${await boardState()}`);
    expect((await fen()).split(' ')[1] === 'w', `${san}: no reply landed`);
  }
  // 'You looked' rewards are timed from the start of play() with the recorder, since play()
  // resolves after the reply and the reward line may already be gone by then.
  async function rewardCase(f, san, { words, within, okSquare, okWithin, backWithin }) {
    await load(f);
    await record();
    const r = await play(san);
    const rec = await recorded();
    expect(r === 'committed', `${san} -> ${r} (expected committed)`);
    const line = rec.find((e) => e.kind === 'coach' && e.text.includes('You looked'));
    expect(line, `${san}: no 'You looked' line (lines: ${rec.filter((e) => e.kind === 'coach').map((e) => `'${e.text}'@${e.t}`).join(', ') || 'none'})`);
    expect(line.t <= limit(within), `${san}: the reward line came at ${line.t} ms (limit ${limit(within)})`);
    for (const w of words || []) expect(line.text.includes(w), `${san}: the reward line '${line.text}' lacks '${w}'`);
    if (okSquare) {
      const ok = rec.find((e) => e.kind === 'sq' && e.square === okSquare && /\bok\b/.test(e.classes));
      expect(ok, `${san}: the ${okSquare} cell never got class ok`);
      expect(ok.t <= limit(okWithin), `${san}: the ok ring came at ${ok.t} ms (limit ${limit(okWithin)})`);
    }
    if (backWithin) {
      await waitFor(() => document.getElementById('coach').textContent === 'Your move.', null, backWithin, `'Your move.' after the reward`);
    }
  }
  await holdCase(FEN.d6, 'Nxe5', { category: 'hanging_after_move' });
  await holdCase(FEN.d6, 'Bxf7+', { category: 'hanging_after_move', answer: ['f8', 'g8'], best: 'f8' });
  {
    const before = stub ? (await calls()).length : 0;
    await committedCase(FEN.d6, 'h3');
    if (stub) expect((await calls()).length === before, 'h3 made a sample call');
  }
  if (!quick) {
    await holdCase(FEN.tutorial, 'Bxf7+', { category: 'hanging_after_move' });
    await holdCase(FEN.tutorial, 'Nxe5', { category: 'hanging_after_move' });
    await committedCase(FEN.tutorial, 'd3');
  }
  await holdCase(FEN.ruy, 'O-O', { category: 'ignored_attack', answer: ['b5'], partial: ['a6'] });
  if (!quick) {
    // two pieces hang after Ng5: the bishop (already attacked) stays best, the knight he moved is right too
    await holdCase(FEN.ruy, 'Ng5', { category: 'ignored_attack', answer: ['b5', 'g5'], best: 'b5', partial: ['a6'] });
    // a loss that no one-move look explains (the even trade Qxd5; line 2's Qxg5 is cheap) commits
    await committedCase(FEN.twoKnights, 'Bxd5');
  }
  await newGame();   // load() keeps the game's reward budget; the three reward cases start fresh
  await rewardCase(FEN.ruy, 'Ba4', { words: ['You looked', 'bishop'], within: 300, backWithin: 3000 });
  await holdCase(FEN.nxe4, 'Nc3', { category: 'free_piece_ignored' });
  await rewardCase(FEN.nxe4, 'dxe4', { words: ['You looked'], within: 300, okSquare: 'e4', okWithin: 200 });
  if (!quick) {
    await holdCase(FEN.placement, 'Nbd2', { category: 'free_piece_ignored' });
    await rewardCase(FEN.placement, 'hxg4', { words: ['You looked'], within: 300 });
    await holdCase(FEN.ng4, 'O-O', { category: 'free_piece_ignored' });
    await committedCase(FEN.ng4, 'hxg4');
  }
  await holdCase(FEN.f3e5, 'g4', { category: 'allowed_mate' });
  await holdCase(FEN.scholars, 'Qh3', { category: 'missed_mate' });
  {
    await load(FEN.scholars);
    const r = await play('Qxf7#');
    expect(r === 'over', `Qxf7# -> ${r} (expected over)`);
    expect(await boardState() === 'over', `after mate data-state is ${await boardState()}`);
    expect((await coach()).includes('Checkmate'), `after mate the line is '${await coach()}'`);
    const close = await app(() => { const el = document.getElementById('close'); return { hidden: el.hidden, text: el.textContent, again: !!el.querySelector('[data-action="again"]') }; });
    expect(!close.hidden && /Pieces given away: \d+/.test(close.text), `the close card reads '${close.text.trim()}'`);
    expect(close.again, 'no Again button on the close card');
    await page.click('#close [data-action="again"]');
    await waitFor(() => document.getElementById('board').dataset.state === 'idle' && window.__app.fen().startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'), null, 5000, 'Again to open the start position');
  }

  // ==============================================================================================
  // 5. The hold's presentation
  // ==============================================================================================
  mark('5 hold');
  {
    const loaded = await load(FEN.d6);
    let idleShot = null;
    if (ctx.scheme === 'dark') idleShot = await page.locator('#board').screenshot();
    const n0 = stub ? (await calls()).length : 0;
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held');
    expect(await boardState() === 'held', 'data-state is not held');
    expect(await cls('e5', 'amber'), 'the e5 cell is not amber');
    expect(await app(() => { const el = document.querySelector('.pc.lifted'); return !!el && el.dataset.square === 'e5' && el.dataset.piece === 'wN'; }), 'the moved knight is not lifted at e5');
    const h = await holdState();
    expect(h.question.startsWith('Hold on.'), `the question is '${h.question}'`);
    expect((await coach()).startsWith('Hold on.'), `the line is '${await coach()}'`);
    for (const sq of h.answerSquares) expect(!h.question.includes(sq), `the question names the answer square ${sq}`);
    expect(!(await present('[data-action="takeback"]')) && !(await present('[data-action="anyway"]')), 'the buttons are present before any tap');
    expect(await visible('[data-action="showme"]'), 'Show me is not shown');
    if (stub) expect((await calls()).length === n0, 'a hold before any consent made a sample call');
    else expect(!(await visible('[data-action="but"]')), 'Hear me out is shown without the sample capability');
    await tap('f2');
    expect(await fen() === loaded, 'tapping an own piece changed the position');
    expect(await boardState() === 'held', 'tapping an own piece closed the hold');
    if (ctx.scheme === 'dark') {
      const heldShot = await page.locator('#board').screenshot();
      const lum = async (buf) => app(async (src) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return s / (d.length / 4);
      }, buf.toString('base64'));
      const li = await lum(idleShot);
      const lh = await lum(heldShot);
      expect(lh < li, `the held dark board is not darker (idle ${li.toFixed(1)}, held ${lh.toFixed(1)})`);
    }
    {
      // the longest allowed line never moves the board or overflows its box
      const words = LONG_LINE.split(/\s+/).length;
      expect(words === 28, `LONG_LINE has ${words} words`);
      const r = await app((text) => {
        const board = document.getElementById('board').getBoundingClientRect();
        const c = document.getElementById('coach');
        const was = c.textContent;
        c.textContent = text;
        const after = document.getElementById('board').getBoundingClientRect();
        const res = { same: board.top === after.top && board.height === after.height && board.width === after.width, overflow: c.scrollHeight > c.clientHeight + 1, box: c.clientHeight };
        c.textContent = was;
        return res;
      }, LONG_LINE);
      expect(r.same, 'the board moved under the longest line');
      expect(!r.overflow, `the longest line overflows the ${r.box} px box`);
    }
    const g = await tap('d6');
    expect(g === 'right', `tap d6 -> ${g}`);
    expect(await present('[data-action="takeback"]') && await present('[data-action="anyway"]'), 'the buttons did not appear after the right tap');
    expect(await app(() => document.activeElement && document.activeElement.dataset.action === 'takeback'), 'Take it back is not focused');
  }
  {
    // no tap: the buttons after the (fast) timer
    await load(FEN.d6);
    const t0 = Date.now();
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held (timer path)');
    expect(!(await present('[data-action="takeback"]')), 'the buttons appeared at once');
    await waitFor(() => !!document.querySelector('[data-action="takeback"]') && !!document.querySelector('[data-action="anyway"]'), null, 1500, 'the buttons after the timer');
    const ms = Date.now() - t0;
    expect(ms >= 250 && ms <= 1200, `the buttons came after ${ms} ms (fast timer is 300)`);
  }
  {
    // the Give up confirm owns the bar: the buttons timer never overwrites it; Keep playing restores the buttons
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held (give-up confirm)');
    await action('giveup');
    expect(JSON.stringify(await bar()) === '["giveup-yes","keep"]', `after Give up the bar is ${JSON.stringify(await bar())}`);
    await sleep(500);
    expect(JSON.stringify(await bar()) === '["giveup-yes","keep"]', `after the buttons timer the confirm is gone: ${JSON.stringify(await bar())}`);
    expect(await boardState() === 'held', `the hold ended under the confirm: ${await boardState()}`);
    await action('keep');
    expect(JSON.stringify(await bar()) === '["takeback","anyway"]', `after Keep playing the bar is ${JSON.stringify(await bar())}`);
    await action('takeback');
    expect(await boardState() === 'idle', 'the take-back after Keep playing did not work');
  }

  // ==============================================================================================
  // 6. Tap-to-answer
  // ==============================================================================================
  mark('6 taps');
  await load(FEN.d6);
  await play('Nxe5');
  expect(await tap('d6') === 'right', 'd6 is not right after Nxe5');
  expect((await coach()).includes('Yes') && (await coach()).includes('pawn'), `after d6 the line is '${await coach()}'`);
  expect(await cls('d6', 'ok'), 'd6 has no ok ring');
  await load(FEN.d6);
  await play('Nxe5');
  expect(await tap('c6') === 'partial', 'c6 is not partial after Nxe5');
  expect((await coach()).includes('cheaper'), `after c6 the line is '${await coach()}'`);
  expect(!(await app(() => !!document.querySelector('.sq.ok'))), 'a partial tap drew an ok ring');
  expect(await tap('a1') === 'wrong', 'a1 is not wrong');
  expect((await coach()).includes('Not that one'), `after a1 the line is '${await coach()}'`);
  expect(await tap('a2') === 'named', 'the second wrong tap did not name the answer');
  expect(await cls('d6', 'ok') || await cls('d6', 'glow'), 'd6 is not marked after the second wrong tap');
  expect((await coach()).includes('pawn on d6'), `after the second wrong tap the line is '${await coach()}'`);
  await load(FEN.ruy);
  await play('O-O');
  expect(await tap('a6') === 'partial', 'a6 is not partial in the Ruy');
  expect((await coach()).includes('Now tap the piece it reaches'), `after a6 the line is '${await coach()}'`);
  expect(await tap('b5') === 'right', 'b5 is not right in the Ruy');
  expect((await coach()).includes('Yes') && await cls('b5', 'ok'), `after b5 the line is '${await coach()}' and ok=${await cls('b5', 'ok')}`);
  if (!quick) {
    // Ng5 hangs the knight too: tapping it is right, in its own words; the bishop keeps its line
    await load(FEN.ruy);
    expect(await play('Ng5') === 'held', 'Ng5 was not held');
    expect(await tap('g5') === 'right', 'g5 is not right after Ng5');
    expect((await coach()).startsWith('Yes, the knight. The queen takes it next move.'), `after g5 the line is '${await coach()}'`);
    await load(FEN.ruy);
    await play('Ng5');
    expect(await tap('b5') === 'right' && (await coach()).startsWith('Yes, the bishop. The pawn takes it next move.'), `after b5 (Ng5) the line is '${await coach()}'`);
  }
  if (!quick) {
    await load(FEN.f3e5);
    await play('g4');
    expect(await tap('h4') === 'right', 'h4 is not right after 1.f3 e5 2.g4');
    await load(FEN.scholars);
    await play('Qh3');
    expect(await tap('f7') === 'right', 'f7 is not right after Qh3');
    await load(FEN.d6);
    await play('Bxf7+');
    expect(await tap('f8') === 'right', 'f8 is not right after Bxf7+');
    await load(FEN.d6);
    await play('Bxf7+');
    expect(await tap('g8') === 'partial', 'g8 is not partial after Bxf7+');
  }

  // ==============================================================================================
  // 7. Show me
  // ==============================================================================================
  mark('7 showme');
  {
    await app((k) => localStorage.removeItem(k), KEYS.firstFloatSeen);
    const loaded = await load(FEN.d6);
    await play('Nxe5');
    await record();
    await action('showme');
    const rec = await recorded();
    const ghost = rec.find((e) => e.kind === 'ghost' && e.square === 'e5' && String(e.piece || '').startsWith('b'));
    expect(ghost, `no black ghost reached e5 (ghost events: ${JSON.stringify(rec.filter((e) => e.kind === 'ghost'))})`);
    expect(ghost.t <= 300, `the ghost reached e5 at ${ghost.t} ms (limit 300)`);
    const loss = rec.find((e) => e.kind === 'loss' && e.text === '-2' && !e.hidden);
    expect(loss, `no '-2' float (loss events: ${JSON.stringify(rec.filter((e) => e.kind === 'loss'))})`);
    expect(loss.t <= 1500, `the float came at ${loss.t} ms (limit 1500)`);
    expect(loss.fontSize === '28px', `the float is ${loss.fontSize}`);
    expect(rec.some((e) => e.kind === 'coach' && e.text.includes('counts three')), `the first float was not named (lines: ${rec.filter((e) => e.kind === 'coach').map((e) => e.text).join(' | ')})`);
    expect(await boardState() === 'held', `after Show me data-state is ${await boardState()}`);
    expect(await app(() => document.querySelectorAll('.ghost').length) === 0, 'ghosts remain after Show me');
    expect(await fen() === loaded, 'Show me changed the position');
    expect(await app((k) => localStorage.getItem(k), KEYS.firstFloatSeen) === '1', 'firstFloatSeen flag not set');
    // with the flag present the line is unchanged
    await record();
    await action('showme');
    const rec2 = await recorded();
    expect(!rec2.some((e) => e.kind === 'coach'), `a second float changed the line: ${rec2.filter((e) => e.kind === 'coach').map((e) => e.text).join(' | ')}`);
    expect(rec2.some((e) => e.kind === 'loss' && e.text === '-2'), 'the second Show me had no float');
    // take back during the animation rewinds at once
    expect(await tap('d6') === 'right', 'd6 not right before the interrupted Show me');
    await app(async () => {
      document.querySelector('[data-action="showme"]').click();
      await new Promise((r) => setTimeout(r, 25));
      document.querySelector('[data-action="takeback"]').click();
    });
    await waitFor(() => document.getElementById('board').dataset.state === 'idle', null, 3000, 'idle after the interrupted Show me');
    expect(await fen() === loaded, `after the interrupted Show me fen is ${await fen()}`);
    expect(await app(() => document.querySelectorAll('.ghost').length === 0 && !document.getElementById('board').dataset.ghost), 'ghosts remain after the interrupted Show me');
  }
  {
    // free_piece_ignored: Show me plays the capture he walked past (his own pawn, d3 to e4), floats
    // no loss and says nothing; the board shows the same position after it
    const loaded = await load(FEN.nxe4);
    expect(await play('Nc3') === 'held', 'Nc3 was not held (Show me)');
    await record();
    await action('showme');
    const rec = await recorded();
    expect(rec.some((e) => e.kind === 'ghost' && e.square === 'e4' && e.piece === 'wP'), `no white pawn ghost reached e4 (ghost events: ${JSON.stringify(rec.filter((e) => e.kind === 'ghost'))})`);
    expect(!rec.some((e) => e.kind === 'ghost' && String(e.piece || '').startsWith('b')), 'a black ghost moved during the free-piece Show me');
    expect(!rec.some((e) => e.kind === 'loss' && !e.hidden && /^-/.test(e.text)), `a loss floated on the free-piece Show me: ${JSON.stringify(rec.filter((e) => e.kind === 'loss'))}`);
    expect(!rec.some((e) => e.kind === 'coach'), `the line changed during the free-piece Show me: ${rec.filter((e) => e.kind === 'coach').map((e) => e.text).join(' | ')}`);
    expect(await boardState() === 'held' && await fen() === loaded && await app(() => document.querySelectorAll('.ghost').length) === 0, 'the free-piece Show me did not rewind cleanly');
  }
  if (!quick) {
    // a tap during Show me only rewinds it: it is not graded and not recorded
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held (tap during Show me)');
    const h = await holdState();
    await app(() => { window.__app.fast = false; window.__app.action('showme'); });
    await sleep(250);
    expect(await app(() => !!document.getElementById('board').dataset.ghost), 'Show me did not start');
    const g = await tap('a1');
    expect(g === null, `a tap during Show me was graded '${g}'`);
    expect(await app(() => window.__app.state().hold.taps.length) === 0, 'a tap during Show me was recorded as an answer');
    expect(await coach() === h.question, `after the aborting tap the line is '${await coach()}'`);
    await waitFor(() => document.querySelectorAll('.ghost').length === 0 && !document.getElementById('board').dataset.ghost, null, 3000, 'the rewind after the aborting tap');
    await app(() => { window.__app.fast = true; });
    expect(await tap('d6') === 'right', 'd6 is not right after the aborted Show me');
    await action('takeback');
  }
  if (!quick) {
    // the '-N' label never crosses a square: it rises outside the board at real speed, and under
    // reduced motion it is the same 28 px label, static, beside the board, with no ghost transition
    const sampleLoss = () => app(async () => {
      const loss = document.getElementById('loss');
      const sqs = Array.from(document.querySelectorAll('.sq')).map((q) => q.getBoundingClientRect());
      const crosses = (r) => sqs.some((q) => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top);
      const samples = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 2600) {
        if (!loss.hidden && loss.textContent) {
          const gh = document.querySelector('.ghost');
          samples.push({ cls: loss.className, text: loss.textContent, crosses: crosses(loss.getBoundingClientRect()), font: getComputedStyle(loss).fontSize, ghostT: gh ? getComputedStyle(gh).transitionDuration : null });
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      return samples;
    });
    await app(() => { window.__app.fast = false; });
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held (float placement)');
    let pending = app(() => window.__app.action('showme'));
    let samples = await sampleLoss();
    await pending;
    expect(samples.length > 0 && samples.some((x) => /rising/.test(x.cls)), `no rising '-N' float was seen (${samples.length} samples)`);
    expect(samples.every((x) => x.text === '-2' && x.font === '28px' && !x.crosses), `the float crossed a square or changed: ${JSON.stringify(samples.slice(0, 3))}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held (reduced motion)');
    pending = app(() => window.__app.action('showme'));
    samples = await sampleLoss();
    await pending;
    expect(samples.length > 0 && samples.every((x) => /static/.test(x.cls)), `under reduced motion the label is not static: ${JSON.stringify(samples.slice(0, 2))}`);
    expect(samples.every((x) => x.text === '-2' && x.font === '28px' && !x.crosses), `the static label crossed a square: ${JSON.stringify(samples.slice(0, 3))}`);
    expect(samples.every((x) => x.ghostT === null || x.ghostT.split(',').every((d) => d.trim() === '0s')), `a ghost had a transition under reduced motion: ${samples.map((x) => x.ghostT).join(' ')}`);
    await page.emulateMedia({ reducedMotion: null });
    await app(() => { window.__app.fast = true; });
    await action('takeback');
  }

  // ==============================================================================================
  // 8. Take it back and Play it anyway
  // ==============================================================================================
  mark('8 decide');
  {
    const loaded = await load(FEN.d6);
    await play('Nxe5');
    await tap('d6');
    await action('takeback');
    expect(await fen() === loaded, `after take-back fen is ${await fen()}`);
    expect(await boardState() === 'idle', `after take-back data-state is ${await boardState()}`);
    expect(await coach() === 'Your move.', `after take-back the line is '${await coach()}'`);
    const holds = await app(() => window.__app.holds());
    expect(holds.length && holds[holds.length - 1].outcome === 'back', `the hold log ends with ${JSON.stringify(holds.slice(-1))}`);
    if (stub) { const c = await calls(); if (c.length) expect(c[c.length - 1].outcome === 'cancelled', `the stub's last call outcome is ${c[c.length - 1].outcome}`); }
  }
  await newGame();
  {
    await load(FEN.d6);
    await play('Nxe5');
    await tap('d6');
    const t0 = Date.now();
    await action('anyway');
    expect(Date.now() - t0 < 2000, 'the play-anyway reply took longer than 2 s');
    const f = await fen();
    expect(pieceAtFen(f, 'e5') === 'p' && pieceAtFen(f, 'd6') === null, `after play-anyway the reply was not dxe5: ${f}`);
    const c = await coach();
    expect(c.includes('knight for a pawn') && c.includes('that counts'), `after play-anyway the line is '${c}'`);
    const holds = await app(() => window.__app.holds());
    expect(holds[holds.length - 1].outcome === 'anyway', `the hold log ends with ${holds[holds.length - 1].outcome}`);
  }
  if (!quick) {
    await newGame();
    await load(FEN.d6);
    await play('Nxe5');
    await tap('a1');
    await tap('a2');
    await action('anyway');
    expect((await coach()).includes('pawns first'), `after two wrong taps and play-anyway the line is '${await coach()}'`);
  }
  // the quiet rule: after two play-anyways only mates, stalemate and big losses hold
  if (!quick) {
    await newGame();
    await load(FEN.d6); await play('Nxe5'); await tap('d6'); await action('anyway');
    await load(FEN.d6); await play('Bxf7+'); await tap('f8'); await action('anyway');
    expect(await app(() => window.__app.state().anyways) === 2, 'anyways is not 2');
    await load(FEN.d6);
    const r = await play('Bxf7+');
    expect(r === 'committed', `after two play-anyways Bxf7+ -> ${r} (expected committed)`);
    await load(FEN.f3e5);
    const r2 = await play('g4');
    expect(r2 === 'held', `after two play-anyways g4 -> ${r2} (expected held)`);
    await action('takeback');
  }
  await newGame();

  // ==============================================================================================
  // 9. The opponent
  // ==============================================================================================
  mark('9 opponent');
  {
    const n = full ? 10 : quick ? 1 : 2;
    for (let i = 0; i < n; i++) {
      await newGame();
      await load(FEN.d6);
      expect(await play('Nxe5') === 'held', `iteration ${i}: Nxe5 not held`);
      await tap('d6');
      await action('anyway');
      const f = await fen();
      expect(pieceAtFen(f, 'e5') === 'p' && pieceAtFen(f, 'd6') === null, `iteration ${i}: the reply to Nxe5 was not dxe5 (${f})`);
    }
    for (let i = 0; i < n; i++) {
      await newGame();
      await load(FEN.ruy);
      expect(await play('O-O') === 'held', `iteration ${i}: O-O not held`);
      await tap('b5');
      await action('anyway');
      const f = await fen();
      expect(pieceAtFen(f, 'b5') === 'p' && pieceAtFen(f, 'a6') === null, `iteration ${i}: the reply to O-O was not axb5 (${f})`);
    }
  }
  if (!quick) {
    // a forced gift roll: either no gift, or a verified minor piece left hanging per chess.js
    await newGame();
    await load(FEN.d6);
    await app(() => { window.__app.state().giftDue = true; });
    const r = await play('h3');
    expect(r === 'committed', `h3 with giftDue -> ${r}`);
    const gift = await app(() => window.__app.state().lastGift);
    if (gift) {
      expect(gift.verified === true, `lastGift is not verified: ${JSON.stringify(gift)}`);
      const check = await app(async (g) => {
        const { Chess } = await import('./vendor/chess.js');
        const c = new Chess(window.__app.fen());
        const p = c.get(g.square);
        if (!p || p.color !== 'b' || (p.type !== 'n' && p.type !== 'b')) return { ok: false, why: `no black minor piece on ${g.square}` };
        const attackers = c.attackers(g.square, 'w');
        if (!attackers.length) return { ok: false, why: 'not attacked' };
        const undefended = c.attackers(g.square, 'b').length === 0;
        const byPawn = attackers.some((s) => { const q = c.get(s); return q && q.type === 'p'; });
        return { ok: undefended || byPawn, why: `undefended=${undefended} byPawn=${byPawn}` };
      }, gift);
      expect(check.ok, `the gift ${JSON.stringify(gift)} is not a hanging minor piece: ${check.why}`);
      // taking the gift is the designed moment: the ring, 'You looked' and the count, whatever capture
      // the pre-search's first line preferred (a pawn capturer first, else the cheapest)
      const capture = await app(async (g) => {
        const { Chess } = await import('./vendor/chess.js');
        const v = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
        const ms = new Chess(window.__app.fen()).moves({ verbose: true }).filter((m) => m.to === g.square);
        ms.sort((a, b) => v[a.piece] - v[b.piece]);
        return ms[0] ? ms[0].san : null;
      }, gift);
      expect(capture, `no capture of the gift on ${gift.square}`);
      const before = await app(() => window.__app.stats().freeTaken);
      await record();
      const r2 = await play(capture);
      const rec = await recorded();
      expect(r2 === 'committed', `taking the gift (${capture}) -> ${r2} (hold ${await boardHold()})`);
      expect(rec.some((e) => e.kind === 'sq' && e.square === gift.square && /\bok\b/.test(e.classes)), `no ok ring on the gift square ${gift.square}`);
      expect(rec.some((e) => e.kind === 'coach' && e.text.includes('You looked')), `no 'You looked' for the gift taken (lines: ${rec.filter((e) => e.kind === 'coach').map((e) => e.text).join(' | ') || 'none'})`);
      expect(await app(() => window.__app.stats().freeTaken) === before + 1, 'the gift taken was not counted as a free piece');
    }
  }
  if (!quick) {
    // resignation: Black far behind, three quiet moves
    await newGame();
    await load(FEN.resign);
    let r = null;
    for (let i = 0; i < 6 && r !== 'over'; i++) r = await quietMove();
    expect(r === 'over', `the bot did not give up (last result ${r})`);
    expect(await boardState() === 'over', `after the resignation data-state is ${await boardState()}`);
    expect((await coach()).includes('gives up'), `after the resignation the line is '${await coach()}'`);
  }

  // ==============================================================================================
  // 10. Rewards and the quiet budget: a scripted clean game
  // ==============================================================================================
  mark('10 quiet');
  if (!quick) {
    await newGame();
    await record();
    for (let i = 0; i < CLEAN_GAME.length; i++) {
      const [w, b] = CLEAN_GAME[i];
      await app((s) => window.__app.botMove(s), b);
      const r = await play(w);
      expect(r === 'committed', `move ${i + 1}. ${w} -> ${r} (hold ${await boardHold()}, line '${await coach()}')`);
    }
    const rec = await recorded();
    const speaks = rec.filter((e) => e.kind === 'coach' && e.state !== 'held' && e.text !== 'Your move.' && e.text.trim() !== '');
    expect(speaks.length <= 4, `the line spoke ${speaks.length} times in a clean game: ${speaks.map((e) => `'${e.text}'@ply${e.plies}`).join(', ')}`);
    const moves = speaks.map((e) => Math.ceil(e.plies / 2));
    for (let i = 1; i < moves.length; i++) expect(moves[i] - moves[i - 1] !== 1, `the line spoke on consecutive moves ${moves[i - 1]} and ${moves[i]}`);
  }

  if (stub) {
    // ============================================================================================
    // 11a. Hear me out with the spec's example reply
    // ============================================================================================
    mark('11a hearmeout');
    await newGame();
    await load(FEN.d6);
    await play('Nxe5');
    await waitFor(() => { const b = document.querySelector('[data-action="but"]'); return !!b && !b.hidden; }, null, 3000, 'the Hear me out link');
    await action('but');
    expect(await present('#say'), 'the input did not open');
    expect(await app(() => document.getElementById('say').placeholder) === 'Say what you were going for', 'wrong placeholder');
    expect((await app(() => ((document.querySelector('#actions .note') || {}).textContent || ''))).includes('browser will ask'), 'the consent note is missing');
    expect(!(await visible('[data-action="but"]')), 'the Hear me out link is still shown while its input is open');
    // what he types survives the buttons timer and a tap that answers the hold: the element, its text and its focus
    await page.type('#say', 'im attacking');
    await app(() => { document.getElementById('say').dataset.mark = 'x'; });
    await sleep(500);
    const keptEl = () => app(() => { const i = document.getElementById('say'); return { exists: !!i, same: !!i && i.dataset.mark === 'x', value: i ? i.value : null, focused: !!i && document.activeElement === i, takeback: !!document.querySelector('[data-action="takeback"]') }; });
    let kept = await keptEl();
    expect(kept.exists && kept.same && kept.value === 'im attacking' && kept.focused && !kept.takeback, `the open input did not survive the buttons timer: ${JSON.stringify(kept)}`);
    expect(await tap('d6') === 'right', 'd6 is not right while the input is open');
    kept = await keptEl();
    expect(kept.exists && kept.same && kept.value === 'im attacking' && kept.focused && !kept.takeback, `the open input did not survive a right tap: ${JSON.stringify(kept)}`);
    await app((r) => { window.__stubReplies = [r]; }, K2_GOOD);
    const t0 = Date.now();
    await app((t) => window.__app.say(t), 'im attacking his king');
    const said = Date.now() - t0;
    const c = await calls();
    const last = c[c.length - 1];
    expect(last && last.opts.modelTier === 'quick', `K2 modelTier is ${last && last.opts.modelTier}`);
    expect(last.opts.cache === false, `K2 cache is ${last.opts.cache}`);
    expect(last.opts.tools.length === 0, 'K2 passed tools');
    expect(last.input.includes('im attacking his king') && last.input.includes('safe_square'), 'the K2 prompt lacks his words or the offered ask');
    expect(last.outcome === 'resolved', `K2 outcome is ${last.outcome}`);
    const say = JSON.parse(K2_GOOD).say;
    const line = await coach();
    expect(line.startsWith(say), `the line does not start with the say: '${line}'`);
    expect(line.endsWith('Tap a square where the knight is safe.'), `the line does not end with the page's question: '${line}'`);
    expect(said <= 1500, `the reply took ${said} ms (limit 1500)`);
    expect(await cls('d6', 'lit') && await cls('c4', 'lit'), 'd6 and c4 are not lit');
    expect(!(await visible('[data-action="but"]')), 'Hear me out is still shown after the reply');
    expect(!(await present('#say')), 'the input is still open after the reply');
    expect(await boardState() === 'held', `after the reply data-state is ${await boardState()}`);
    expect(await app(() => window.__app.state().hold.ask) === 'safe_square', 'the ask was not set on the hold');
    // the look's own words, never the hold's ('Yes, the pawn' would be false for a safe square)
    expect(await tap('f3') === 'right', 'f3 is not right for safe_square');
    expect((await coach()).startsWith('Yes, the knight is safe there.'), `after f3 the line is '${await coach()}'`);
    expect(await cls('f3', 'ok'), 'f3 has no ok ring');
    expect(await tap('g5') === 'wrong', 'g5 is not wrong for safe_square');
    expect(await coach() === 'Not that one. Something of theirs reaches that square.', `after g5 the line is '${await coach()}'`);
    expect(await tap('h8') === 'named', 'the second wrong tap under the ask did not name a safe square');
    const named = await app(() => ({ line: document.getElementById('coach').textContent, glow: Array.from(document.querySelectorAll('.sq.glow')).map((x) => x.dataset.square) }));
    expect(named.glow.length === 1 && named.line === `The knight is safe on ${named.glow[0]}.`, `the named line and the glowing square disagree: ${JSON.stringify(named)}`);
    expect(await app(() => window.__app.state().consented) === true, 'the view is not marked consented after K2');
    // Play it anyway: he tapped the taker (d6) before the reply, so 'You saw it coming' is true here
    await action('anyway');
    const al = await coach();
    expect(al.startsWith('There it goes. A knight for a pawn.') && al.includes('that counts'), `after play-anyway with the taker tapped the line is '${al}'`);
    await newGame();   // the played pair (knight, e5) is not held again in the same game
    // after consent, clean moves still make no sample call (K1 fires on holds only)
    {
      const n0 = (await calls()).length;
      for (const san of ['h3', 'a3', 'Kh1']) { await load(FEN.d6); expect(await play(san) === 'committed', `${san} after consent -> not committed`); }
      expect((await calls()).length === n0, `clean moves after consent made ${(await calls()).length - n0} sample calls`);
    }

    // ============================================================================================
    // 12. K1 follow-ups after consent
    // ============================================================================================
    mark('12 k1');
    if (!quick) {
      await load(FEN.d6);
      await app((r) => { window.__stubReplies = [r]; }, K1_GOOD);
      const n0 = (await calls()).length;
      expect(await play('Nxe5') === 'held', 'Nxe5 not held (K1)');
      const c1 = await calls();
      expect(c1.length === n0 + 1, `the hold made ${c1.length - n0} calls, expected 1`);
      const k1 = c1[c1.length - 1];
      expect(k1.opts.modelTier === 'quick' && k1.opts.tools.length === 0, `K1 opts ${JSON.stringify(k1.opts)}`);
      const h = await holdState();
      expect(await coach() === h.question, `the question changed under the K1 call: '${await coach()}'`);
      await waitFor(() => { const c = window.__sampleCalls; return c.length && c[c.length - 1].outcome !== 'pending'; }, null, 3000, 'the K1 call to settle');
      expect(await coach() === h.question, `the question changed after the K1 reply: '${await coach()}'`);
      expect(await tap('d6') === 'right', 'd6 not right (K1)');
      expect((await coach()).includes('watches that square'), `after the tap the line is '${await coach()}'`);
      await action('takeback');
    }
    if (!quick) {
      await load(FEN.d6);
      await app((r) => { window.__stubReplies = [r]; }, K1_BAD_WRONG);
      const r0 = await rejects();
      expect(await play('Nxe5') === 'held', 'Nxe5 not held (bad K1)');
      await waitFor(() => { const c = window.__sampleCalls; return c.length && c[c.length - 1].outcome !== 'pending'; }, null, 3000, 'the bad K1 call to settle');
      await waitFor((r) => (window.__coachRejects || 0) > r, r0, 1000, '__coachRejects to increment for an if_wrong naming the answer square');
      expect(await tap('a1') === 'wrong', 'a1 not wrong (bad K1)');
      expect((await coach()).includes('Not that one'), `the template hint did not show: '${await coach()}'`);
      expect(!(await coach()).includes('d6'), `the hint names the answer: '${await coach()}'`);
      expect(await tap('d6') === 'right', 'd6 not right (bad K1)');
      await action('takeback');
    }
    if (!quick) {
      await load(FEN.d6);
      const n0 = (await calls()).length;
      expect(await play('Nxe5') === 'held', 'Nxe5 not held (cancel)');
      await action('takeback');
      await waitFor((n) => { const c = window.__sampleCalls; return c.length > n && c[c.length - 1].outcome === 'cancelled'; }, n0, 2000, "the K1 call's outcome to be 'cancelled' after an immediate take-back");
    }

    // ============================================================================================
    // 11b. Every bad K2 reply falls back to the template and counts a rejection
    // ============================================================================================
    mark('11b rejects');
    for (const [why, reply] of (quick ? K2_BAD.slice(0, 1) : K2_BAD)) {
      await load(FEN.d6);
      await play('Nxe5');
      const r0 = await rejects();
      await app((r) => { window.__stubReplies = [r]; }, reply);
      await app((t) => window.__app.say(t), 'im attacking his king');
      expect((await coach()).includes('Still want to?'), `${why}: the line is '${await coach()}'`);
      expect(await rejects() === r0 + 1, `${why}: __coachRejects went ${r0} -> ${await rejects()}`);
      expect(await boardState() === 'held', `${why}: data-state is ${await boardState()}`);
      await action('takeback');
    }

    // ============================================================================================
    // 11d. The longest accepted K2 line fits the box; one word more is refused
    // ============================================================================================
    mark('11d long say');
    if (!quick) {
      expect(JSON.parse(K2_32).say.split(/\s+/).length === 32 && JSON.parse(K2_33).say.split(/\s+/).length === 33, 'fixture word counts');
      await load(FEN.d6);
      await play('Nxe5');
      const r0 = await rejects();
      const boardBefore = await app(() => JSON.stringify(document.getElementById('board').getBoundingClientRect()));
      await app((r) => { window.__stubReplies = [r]; }, K2_32);
      await app((t) => window.__app.say(t), 'im attacking his king');
      expect(await rejects() === r0, 'the 32-word say was rejected');
      const fit = await app(() => { const c = document.getElementById('coach'); return { words: c.textContent.trim().split(/\s+/).length, overflow: c.scrollHeight > c.clientHeight + 1, box: c.clientHeight, board: JSON.stringify(document.getElementById('board').getBoundingClientRect()) }; });
      expect(fit.words === 40, `the longest K2 line has ${fit.words} words, expected 40`);
      expect(!fit.overflow, `the longest K2 line (40 words) overflows the ${fit.box} px box`);
      expect(fit.board === boardBefore, 'the board moved under the longest K2 line');
      // only the safe-square look was answered: Play it anyway tells the truth about his look (he found
      // a safe square, not the taker, so no 'You saw it coming')
      expect(await tap('f3') === 'right', 'f3 is not right for safe_square (long say)');
      await action('anyway');
      const al = await coach();
      expect(al.startsWith('There it goes. A knight for a pawn.') && al.includes('Next time, the pawns first.') && !al.includes('that counts'), `after play-anyway with only a safe-square tap the line is '${al}'`);
      await newGame();   // the played pair is not held again in the same game
      await load(FEN.d6);
      await play('Nxe5');
      await app((r) => { window.__stubReplies = [r]; }, K2_33);
      await app((t) => window.__app.say(t), 'im attacking his king');
      expect(await rejects() === r0 + 1 && (await coach()).includes('Still want to?'), `a 33-word say was accepted: '${await coach()}'`);
      await action('takeback');
    }

    // ============================================================================================
    // 11e. invalid_json turns the link into 'Try again' once (before not_granted, which hides the coach for the view)
    // ============================================================================================
    mark('11e errors');
    if (!quick) {
      await load(FEN.d6);
      await play('Nxe5');
      await app(() => { window.__stubReplies = ['not json at all']; });
      await app((t) => window.__app.say(t), 'im attacking his king');
      await waitFor(() => { const b = document.querySelector('[data-action="but"]'); return !!b && !b.hidden && b.textContent === 'Try again'; }, null, 2000, "the link to read 'Try again' after invalid_json");
      expect(await boardState() === 'held', `after invalid_json the state is ${await boardState()}`);
      await action('takeback');
    }
    // ============================================================================================
    // 11c. not_granted hides the link for the view
    // ============================================================================================
    mark('11c not_granted');
    {
      const loaded = await load(FEN.d6);
      await play('Nxe5');
      const h = await holdState();
      await app(() => { window.__stubErrors = [{ code: 'not_granted' }]; });
      await app((t) => window.__app.say(t), 'im attacking his king');
      const c = await calls();
      expect(c[c.length - 1].outcome === 'not_granted', `the injected error did not reach the stub: ${c[c.length - 1].outcome}`);
      expect(await coach() === h.question, `after not_granted the line is '${await coach()}'`);
      expect(!(await visible('[data-action="but"]')), 'Hear me out is shown after not_granted');
      expect(await boardState() === 'held' && await fen() === loaded, 'the hold changed after not_granted');
      await action('takeback');
      await load(FEN.d6);
      await play('Nxe5');
      await sleep(50);
      expect(!(await visible('[data-action="but"]')), 'Hear me out came back on a later hold after not_granted');
      await action('takeback');
    }


    // ============================================================================================
    // 11f. rate_limited rests the coach for a moment and the open question comes back under him
    // (a fresh view: not_granted hid the coach for the last one; resting then aborts later calls)
    // ============================================================================================
    mark('11f resting');
    await reload({ cold: false, clear: false });
    expect(await app(() => window.__app.waitEngine()) === true, 'the engine never became ready for the resting check');
    {
      await load(FEN.d6);
      await play('Nxe5');
      const h = await holdState();
      await app(() => { window.__stubErrors = [{ code: 'rate_limited' }]; });
      await app((t) => window.__app.say(t), 'im attacking his king');
      expect(await coach() === 'Coach is resting.', `after rate_limited the line is '${await coach()}'`);
      expect(!(await visible('[data-action="but"]')), 'Hear me out is shown while the coach rests');
      await waitFor((q) => document.getElementById('coach').textContent === q, h.question, 1500, "the hold question to come back after 'Coach is resting.'");
      expect(await boardState() === 'held' && await tap('d6') === 'right', 'the hold is not gradable after rate_limited');
      await action('takeback');
    }
  } else {
    mark('11 no-stub');
    await load(FEN.d6);
    await play('Nxe5');
    expect(!(await visible('[data-action="but"]')), 'Hear me out is shown with --no-stub');
    expect(!(await present('#say')), 'the input exists with --no-stub');
    expect(await app(() => typeof window.claude === 'undefined'), 'window.claude exists with --no-stub');
    await action('takeback');
  }

  // ==============================================================================================
  // 13. Give up, mercy, the close card, the next game's line
  // ==============================================================================================
  mark('13 close');
  {
    await newGame();
    await action('giveup');
    expect(await present('[data-action="giveup-yes"]'), 'no Yes after Give up');
    await page.click('[data-action="giveup-yes"]');
    await waitFor(() => document.getElementById('board').dataset.state === 'over', null, 3000, 'the game to end on Give up');
    expect((await coach()).includes('gave up'), `after Give up the line is '${await coach()}'`);
    expect(await visible('#close'), 'the close card is not shown after Give up');
  }
  if (!quick) {
    await newGame();
    await load(FEN.mercy);
    let offers = 0;
    for (let i = 0; i < 5; i++) {
      const r = await quietMove();
      if (r === 'over') break;
      await waitFor(() => !!document.querySelector('[data-action="startagain"]') || !!window.__app.state().pre, null, 4000, 'the pre-search after the reply');
      if (await present('[data-action="startagain"]')) {
        offers += 1;
        expect((await coach()).includes('Start again'), `with the offer the line is '${await coach()}'`);
        await action('keep');
        expect(!(await present('[data-action="startagain"]')), 'Keep playing left the offer in the bar');
      }
    }
    expect(offers === 1, `Start again was offered ${offers} times`);
  }
  {
    // a game with holds and no take-backs reads in the voice, not 'took it back never'
    await newGame();
    await load(FEN.d6); await play('Nxe5'); await tap('d6'); await action('anyway');
    await action('giveup');
    await action('giveup-yes');
    const close = await app(() => document.getElementById('close').textContent);
    expect(close.includes('I stopped your hand once; you played every one.'), `the zero-backs card reads '${close.trim()}'`);
  }
  {
    await newGame();
    await load(FEN.d6); await play('Nxe5'); await tap('d6'); await action('takeback');
    await load(FEN.d6); await play('Bxf7+'); await tap('f8'); await action('takeback');
    await action('giveup');
    await action('giveup-yes');
    expect(await boardState() === 'over', `after the second Give up data-state is ${await boardState()}`);
    const close = await app(() => document.getElementById('close').textContent);
    expect(/Pieces given away: \d+/.test(close) && /Free pieces you took: \d+/.test(close), `the close card reads '${close.trim()}'`);
    expect(close.includes('stopped your hand twice') && close.includes('took it back twice'), `the close card does not count two holds: '${close.trim()}'`);
    expect(await app(() => document.querySelectorAll('#close .close-holds li').length) === 2, 'the close card does not list two holds');
    if (ctx.vp === 'phone') {
      // the card and its only button sit above the fold at 400 x 800
      const again = await app(() => { const b = document.querySelector('#close [data-action="again"]').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, inner: window.innerHeight }; });
      expect(again.top >= 0 && again.bottom <= again.inner + 0.5, `Again sits at ${again.top}-${again.bottom} in a ${again.inner} px viewport`);
    }
    await reload({ cold: false, clear: false });
    expect((await coach()).includes('last game'), `after a game with holds the next game's line is '${await coach()}'`);
    const games = await app((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEYS.games);
    expect(Array.isArray(games) && games.length, 'holdon.v1.games is not an array');
    const lastGame = games[games.length - 1];
    expect(Array.isArray(lastGame.holds) && lastGame.holds.length === 2, `the last stored game has ${lastGame.holds && lastGame.holds.length} holds`);
    expect(lastGame.holds.every((h) => h.outcome === 'back'), 'the stored holds are not both taken back');
  }

  // leave a hold on screen for the harness screenshot; with the stub, the Hear me out moment
  // (the say, its lit squares and the page's question), so the report carries a sample call too
  mark('end');
  await app(() => window.__app.waitEngine());
  await load(FEN.d6);
  expect(await play('Nxe5') === 'held', 'the closing Nxe5 was not held');
  if (stub) {
    await waitFor(() => { const b = document.querySelector('[data-action="but"]'); return !!b && !b.hidden; }, null, 3000, 'the Hear me out link on the closing hold');
    await app((r) => { window.__stubReplies = [r]; }, K2_GOOD);
    await app((t) => window.__app.say(t), 'im attacking his king');
    expect((await coach()).endsWith('Tap a square where the knight is safe.'), `the closing reply is '${await coach()}'`);
  }
  mark('done');
  if (process.env.HOLDON_TIMES) console.error(`holdon [${tag}] ${times.join(' | ')}`);
};
