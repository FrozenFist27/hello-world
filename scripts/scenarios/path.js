// scenarios/path.js - the pathway's acceptance scenarios (product/PATHWAY.md 'Felt in the game',
// 'The shown state', 'Claude moments', 'Persistence'), in one exported function, driven through
// window.__app with fast mode on. scripts/app_check.js runs it after scenarios/holdon.js on every
// harness page:
//
//   module.exports = async (page, ctx) => { ... }
//   ctx = { vp, scheme, report, out, url, stub, scenario, db, newDevice }   (ARCHITECTURE.md 8.8)
//
// Tiers (ARCHITECTURE.md 8.8): everything but the path view runs on desktop/light only, in the
// order of the architect's list (the opening line, the remembering question, thinning, off, slip and
// wake, the notch, rewards, the close card, the drill, fourteen days, log honesty, K3, the mirror),
// with the logs seeded through window.__app.seed() (no reload, no engine restart) and every opponent
// reply that matters forced with botMove(). The path view runs on all four pages and LAST, so each
// page ends in the path view: app_check's final full-page screenshot is the path state and its
// overflow check covers it. A MutationObserver installed on every load records any moment the
// board is held while #path shows; the run fails at the end if one was seen. The Claude stub parts
// (Hear me out, K3, the mirror) run only when ctx.stub is true.
//
// The function throws an Error naming the page and the step on the first failure.

const fs = require('fs');
const path = require('path');

const FEN = {
  start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  d6: 'r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7',
  ruy: 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
  nxe4: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5',
  f3e5: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2',
  scholars: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  queenHang: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3',
};
const KEYS = {
  tutorialSeen: 'holdon.v1.tutorialSeen', games: 'holdon.v1.games', path: 'holdon.v1.path',
  giftRate: 'holdon.v1.giftRate', sync: 'holdon.v1.sync',
};
const CAPS_KEY = 'holdon.test.caps';
const DOC = 'data/users/u_test/holdon';
const GRANTED = { db: 'granted', user: 'u_test', permissions: true, errors: [] };
// Six quiet moves of the Giuoco Pianissimo (scenarios/holdon.js), Black's replies forced.
const SIX = [['e4', 'e5'], ['Nf3', 'Nc6'], ['Bc4', 'Bc5'], ['c3', 'Nf6'], ['d3', 'd6'], ['O-O', 'O-O']];
const K2_GOOD = '{"say":"You are, and the bishop on c4 already points at the pawn in front of their king. But it is their move first, and the pawn on d6 takes the knight.","ask":"safe_square","squares":["d6","c4"]}';
// The K3 example of PATHWAY.md 'Claude moments' (passes validateK3 whole for the pawns look).
const K3 = { where: 'You said you were taking on that square; three times a pawn was waiting, and twice you took it back.', next: 'Before the piece lands, find the pawn that reaches that square.', again: 'You played this one and the pawn took. Look first this time.', question: 'Hold on. The pawn again. Which one reaches that square? Tap it.', ask_first: null, focus: null };
const K3_GOOD = JSON.stringify(K3);
const K3_BAD_WHERE = JSON.stringify({ ...K3, where: 'You left the knight where the pawn on d6 takes it.' });
// The longest captions the view can write (styles.css: one line at 368 px).
const LONG_CAPTIONS = ['This is where we are. Three times in the last three games.', 'This is where we are. Twelve times in the last three games.'];
const SQUARE_TOKEN = /\b[a-h][1-8]\b/;
const FEN_SHAPE = /[1-8pnbrqkPNBRQK]{1,8}(\/[1-8pnbrqkPNBRQK]{1,8}){7}/;

// ---- log fixtures (GameSummary v2, ARCHITECTURE.md 8.3), built in node --------------------------
const DAY = 24 * 60 * 60 * 1000;
// One recorded move per look, from the recorded positions (app/data/positions.json).
const REC = {
  pawns: { fen: FEN.d6, san: 'Nxe5', category: 'hanging_after_move', sub: null, variant: 'takes_back', pawnAmongTakers: true, netLoss: 2, piece: 'n', to: 'e5', best: 'd6', answer: { squares: ['d6', 'c6'], best: 'd6', partial: ['c6'] }, refutation: ['d6e5'], refutationFrom: 'post' },
  takes_back: { fen: FEN.d6, san: 'Bxf7+', category: 'hanging_after_move', sub: null, variant: 'takes_back', pawnAmongTakers: false, netLoss: 2, piece: 'b', to: 'f7', best: 'f8', answer: { squares: ['f8', 'g8'], best: 'f8', partial: ['g8'] }, refutation: ['f8f7'], refutationFrom: 'post' },
  their_last_move: { fen: FEN.ruy, san: 'O-O', category: 'ignored_attack', sub: 'already', variant: null, pawnAmongTakers: true, netLoss: 3, piece: 'k', to: 'g1', best: 'b5', answer: { squares: ['b5'], best: 'b5', partial: ['a6'] }, refutation: ['a6b5'], refutationFrom: 'post' },
  free: { fen: FEN.nxe4, san: 'Nc3', category: 'free_piece_ignored', sub: null, variant: null, pawnAmongTakers: false, netLoss: 3, piece: 'n', to: 'c3', best: 'e4', answer: { squares: ['e4'], best: 'e4', partial: [] }, refutation: ['d3e4'], refutationFrom: 'pre' },
};
function record(look, outcome, ply, gameId) {
  const base = REC[look];
  return {
    ...base, answer: { ...base.answer, squares: base.answer.squares.slice(), partial: base.answer.partial.slice() }, refutation: base.refutation.slice(),
    taps: outcome === 'back' ? [{ square: base.answer.best, grade: 'right', ask: null }] : [],
    outcome, why: outcome === 'landed' ? 'hand' : null, answered: outcome === 'back', coachShown: false, said: null, ply, gameId,
  };
}
// A log of v2 summaries, oldest first, one hour apart, the newest `endDaysAgo` days before now.
// Each spec: { holds: [[look, outcome], ...], observed (24), result ('giveup'), captures (0), gifts, escapes, again }.
function log(specs, { tag = 'x', endDaysAgo = 0 } = {}) {
  const end = Date.now() - endDaysAgo * DAY - 60 * 1000;
  return specs.map((s, i) => {
    const id = `seed${tag}${String(i).padStart(2, '0')}`;
    const holds = (s.holds || []).map(([look, outcome], k) => record(look, outcome, 11 + 2 * k, id));
    const rewards = [];
    for (let k = 0; k < (s.escapes || 0); k++) rewards.push({ kind: 'escaped', ply: 5 + 2 * k, piece: 'b', said: k === 0 });
    const observed = s.observed == null ? 24 : s.observed;
    return {
      v: 2, id, date: new Date(end - (specs.length - 1 - i) * 3600 * 1000).toISOString(),
      result: s.result || 'giveup', givenAway: holds.filter((h) => h.outcome !== 'back').length, holds,
      freeTaken: 0, playedAnyway: holds.filter((h) => h.outcome === 'anyway').length,
      plies: s.plies == null ? observed * 2 : s.plies, backs: holds.filter((h) => h.outcome === 'back').length,
      observed, captures: s.captures == null ? 0 : s.captures, rewards,
      gifts: s.gifts || { offered: 0, taken: 0 }, again: !!s.again, hand: null, review: false,
    };
  });
}
const clean = (n, extra = {}) => Array.from({ length: n }, () => ({ ...extra }));
// pawns fired once, then five clean counted games: pawns off at the sixth (PATHWAY 'The next rule')
const OFF_LOG = (opts = {}) => log([{ holds: [['pawns', 'anyway']] }, ...clean(5)], { tag: 'off', ...opts });

function luminance(page, buf) {
  return page.evaluate(async (src) => {
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
}

module.exports = async function pathScenarios(page, ctx = {}) {
  const tag = `${ctx.vp || '?'}/${ctx.scheme || '?'}`;
  const stub = !!(ctx.stub || (ctx.report && ctx.report.stub));
  const full = ctx.vp === 'desktop' && ctx.scheme === 'light';
  const out = ctx.out || '/tmp/app-check';
  let step = 'start';
  const started = Date.now();
  const times = [];
  const heldWhilePath = [];
  function mark(name) { times.push(`${step} ${Date.now() - started}ms`); step = name; }
  function expect(cond, msg) {
    if (!cond) throw new Error(`path [${tag}] step ${step}: ${msg}`);
  }

  // ---- helpers over one page (the harness page, or a ctx.newDevice() page) ----------------------
  function on(p, label) {
    const h = {};
    h.app = (fn, arg) => p.evaluate(fn, arg);
    h.diag = () => h.app(() => {
      const b = document.getElementById('board');
      return JSON.stringify({
        state: b.dataset.state, view: document.getElementById('stage') && document.getElementById('stage').dataset.view,
        fen: window.__app.fen(), coach: document.getElementById('coach').textContent,
        bar: Array.from(document.querySelectorAll('#actions [data-action]')).map((x) => x.dataset.action),
        db: (window.__dbCalls || []).map((c) => `${c.op}:${c.outcome}`).join(' '),
      });
    }).catch(() => 'no diagnostics');
    h.waitFor = async (fn, arg, timeout, msg) => {
      try {
        await p.waitForFunction(fn, arg, { timeout, polling: 'raf' });
      } catch (e) {
        throw new Error(`path [${tag}${label ? ' ' + label : ''}] step ${step}: timed out after ${timeout} ms waiting for ${msg}; page: ${await h.diag()}`);
      }
    };
    h.coach = () => h.app(() => document.getElementById('coach').textContent);
    h.boardState = () => h.app(() => document.getElementById('board').dataset.state);
    h.fen = () => h.app(() => window.__app.fen());
    h.load = (f) => h.app((x) => window.__app.load(x), f);
    h.play = (san) => h.app((s) => window.__app.play(s), san);
    h.botMove = (san) => h.app((s) => window.__app.botMove(s), san);
    h.tap = (sq) => h.app((s) => window.__app.tap(s), sq);
    h.action = (name) => h.app((n) => window.__app.action(n), name);
    h.newGame = () => h.app(() => window.__app.newGame());
    h.holds = () => h.app(() => window.__app.holds());
    h.stats = () => h.app(() => window.__app.stats());
    h.visible = (sel) => h.app((s) => { const el = document.querySelector(s); return !!el && !el.hidden && el.offsetParent !== null; }, sel);
    h.present = (sel) => h.app((s) => !!document.querySelector(s), sel);
    h.hold = () => h.app(() => { const x = window.__app.state().hold; return x ? { question: x.question, template: x.copy && x.copy.question, answerSquares: x.answerSquares, san: x.san, to: x.to, category: x.category, netLoss: x.netLoss } : null; });
    h.games = () => h.app((k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } }, KEYS.games);
    h.pathKey = () => h.app((k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, KEYS.path);
    h.dbCalls = () => h.app(() => (window.__dbCalls || []).map((c) => ({ op: c.op, path: c.path, outcome: c.outcome })));
    h.waitEngine = async () => { expect(await h.app(() => window.__app.waitEngine()) === true, `the engine never became ready${label ? ' on ' + label : ''}`); };
    h.seed = (games, pathExtra = null, giftRate) => h.app(([g, px, gr]) => window.__app.seed({
      games: g, ...(px ? { path: { v: 1, k3: null, said: [], shown: null, ...px } } : {}), ...(gr === undefined ? {} : { giftRate: gr }),
    }), [games, pathExtra, giftRate]);
    h.giveup = async () => {
      await h.action('giveup');
      await h.action('giveup-yes');
      expect(await h.boardState() === 'over', `Give up did not end the game${label ? ' on ' + label : ''}: ${await h.diag()}`);
    };
    // the coach lines said while fn runs (a reward line can be gone by the time play() resolves)
    h.lines = async (fn) => {
      await h.app(() => {
        const el = document.getElementById('coach');
        const seen = [];
        let last = el.textContent;
        const o = new MutationObserver(() => { const t = el.textContent; if (t !== last) { last = t; seen.push(t); } });
        o.observe(el, { childList: true, characterData: true, subtree: true });
        window.__pathLines = { o, seen };
      });
      const r = await fn();
      const seen = await h.app(() => { const L = window.__pathLines; L.o.disconnect(); return L.seen; });
      return { r, seen };
    };
    // fast mode, and the observer for '#path showing while the board is held'
    h.install = () => h.app(() => {
      window.__app.fast = true;
      const board = document.getElementById('board');
      const pathEl = document.getElementById('path');
      const stage = document.getElementById('stage');
      window.__heldWhilePath = window.__heldWhilePath || [];
      const check = () => {
        const held = board.dataset.state === 'held';
        const showing = (pathEl && !pathEl.hidden) || (stage && stage.dataset.view === 'path');
        if (held && showing) window.__heldWhilePath.push({ fen: window.__app.fen(), t: Math.round(performance.now()) });
      };
      const o = new MutationObserver(check);
      o.observe(board, { attributes: true, attributeFilter: ['data-state'] });
      if (pathEl) o.observe(pathEl, { attributes: true, attributeFilter: ['hidden'] });
      if (stage) o.observe(stage, { attributes: true, attributeFilter: ['data-view'] });
      check();
    });
    h.harvest = async () => {
      const v = await h.app(() => (window.__heldWhilePath || []).splice(0)).catch(() => []);
      heldWhilePath.push(...v.map((x) => ({ ...x, page: label || tag, step })));
      // no doc.set before a successful doc.get in this view
      const calls = await h.dbCalls().catch(() => []);
      let read = false;
      for (const c of calls) {
        if (c.op === 'get' && c.outcome === 'resolved') read = true;
        if (c.op === 'set') expect(read, `a doc.set came before a successful doc.get${label ? ' on ' + label : ''}: ${calls.map((x) => `${x.op}:${x.outcome}`).join(' ')}`);
      }
      return calls;
    };
    // Reload with the storage prepared: clear empties localStorage, flags are written (a value of
    // null removes the key), caps set the stubbed capabilities (null: the default, local only).
    h.reload = async ({ clear = false, flags = null, caps = null } = {}) => {
      await h.harvest();
      await h.app(([cl, fl, cp, key]) => {
        try {
          sessionStorage.setItem('holdon.test.cold', '0');
          sessionStorage.setItem('holdon.test.crash', '');
          if (cp) sessionStorage.setItem(key, JSON.stringify(cp)); else sessionStorage.removeItem(key);
          if (cl) localStorage.clear();
          if (fl) for (const [k, v] of Object.entries(fl)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
        } catch { /* storage blocked: the page copes */ }
      }, [clear, flags, caps, CAPS_KEY]);
      await p.reload({ waitUntil: 'load' });
      await p.waitForFunction(() => !!(window.__app && window.__app.state), null, { timeout: 15000 });
      await h.install();
    };
    return h;
  }
  const P = on(page, '');
  const { app, waitFor, coach, boardState, fen, load, play, botMove, tap, action, newGame, holds, stats, visible, present, hold, games, pathKey, seed, giveup, reload } = P;
  const COPYS = async () => app(async () => {
    const { COPY, CLAUDE } = await import('./js/contract.js');
    return { bare: COPY.QUESTION.bare, again: COPY.PATH.AGAIN, answered: COPY.PATH.ANSWERED, closeAgain: COPY.PATH.CLOSE.AGAIN, questionPawns: COPY.PATH.QUESTION.pawns, tier: CLAUDE.TIER };
  });

  await page.waitForFunction(() => !!(window.__app && window.__app.state), null, { timeout: 15000 });
  await P.install();
  const C = await COPYS();

  if (full) {
    // ============================================================================================
    // 1. The opening line
    // ============================================================================================
    mark('1 opening line');
    await reload({ clear: true, flags: { [KEYS.tutorialSeen]: '1' } });
    await P.waitEngine();
    const opening = log([{ holds: [['pawns', 'anyway'], ['pawns', 'back']], observed: 22 }], { tag: 'open' });
    await seed(opening);
    {
      const c = await coach();
      const planned = await app(() => window.__app.plan().line);
      expect(c.includes('pawns') && !/\d/.test(c), `the opening line is '${c}'`);
      expect(c === planned, `the line '${c}' is not the plan's '${planned}'`);
    }
    const k3For = (nodeId) => ({ gameId: opening[0].id, nodeId, promptVersion: 'v3', where: 'Here is what I will be watching.', next: 'Find the pawn first.', again: null, question: null, askFirst: 'what_takes_it', focus: null });
    await seed(opening, { k3: k3For('pawns') });
    expect(await coach() === 'Find the pawn first.', `with Claude's stored next line the opening line is '${await coach()}'`);
    await seed(opening, { k3: k3For('free') });
    {
      const c = await coach();
      expect(c.includes('pawns') && c !== 'Find the pawn first.', `a stored next line for another look was used: '${c}'`);
      expect(!(await pathKey()).k3, 'a stored k3 for another look was not dropped');
    }
    // a give-up at observed six does not count, and the next game says so once
    for (const [w, b] of SIX) {
      await botMove(b);
      const r = await play(w);
      expect(r === 'committed', `${w} -> ${r} (line '${await coach()}')`);
    }
    expect((await stats()).observed === 6, `observed after six moves is ${(await stats()).observed}`);
    await giveup();
    await action('again');
    expect((await coach()).includes('do not count'), `after a give-up at six moves the line is '${await coach()}'`);

    // ============================================================================================
    // 2. The question that remembers
    // ============================================================================================
    mark('2 remembering question');
    await seed(opening);
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held under the seeded pawns log');
    {
      const h = await hold();
      const c = await coach();
      expect(c.startsWith('Hold on.') && c.includes('again'), `the remembering question is '${c}'`);
      for (const sq of h.answerSquares) expect(!c.includes(sq), `the remembering question names the answer square ${sq}: '${c}'`);
      expect(await tap('d6') === 'right' && (await coach()).startsWith('Yes'), `tap d6 under the remembering question: '${await coach()}'`);
      await action('takeback');
    }
    await seed([]);
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held with an empty log');
    {
      const h = await hold();
      expect(h.question === h.template && (await coach()) === h.template, `with an empty log the question is '${await coach()}', not the template '${h.template}'`);
      await action('takeback');
    }

    // ============================================================================================
    // 3. The hand thins: a pawns record, then two clean counted games
    // ============================================================================================
    mark('3 thinning');
    await seed(log([{ holds: [['pawns', 'anyway']] }, ...clean(2)], { tag: 'thin' }));
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held at the bare hand');
    expect(await coach() === C.bare, `the bare question is '${await coach()}'`);
    expect(await tap('c6') === 'partial' && (await coach()).includes('cheaper'), `tap c6 at the bare hand: '${await coach()}'`);
    expect(await tap('d6') === 'right', 'tap d6 at the bare hand is not right');
    expect(await visible('[data-action="showme"]'), 'Show me is not shown at the bare hand');
    await action('takeback');
    await load(FEN.d6);
    expect(await play('Bxf7+') === 'held', 'Bxf7+ was not held (takes_back still asking)');
    {
      const h = await hold();
      expect(h.question !== C.bare && (await coach()) === h.question && h.question === h.template, `Bxf7+ asked '${await coach()}' (template '${h.template}')`);
    }
    await action('takeback');

    // ============================================================================================
    // 4. The hand comes off: a pawns record, then five clean counted games
    // ============================================================================================
    mark('4 off');
    await seed(OFF_LOG());
    expect((await coach()).includes('They are yours'), `the first off game opens '${await coach()}'`);
    // mates and big losses always hold
    await load(FEN.f3e5);
    expect(await play('g4') === 'held', 'g4 after 1.f3 e5 was not held under the off hand');
    await action('takeback');
    await load(FEN.queenHang);
    expect(await play('Qxe5+') === 'held', 'Qxe5+ (the queen hang) was not held under the off hand');
    expect((await hold()).netLoss >= 5, `the queen hang's netLoss is ${(await hold()).netLoss}`);
    await action('takeback');
    await newGame();   // the two holds above were stops; the landed game below has none
    await load(FEN.d6);
    await botMove('dxe5');
    expect(await play('Nxe5') === 'committed', 'Nxe5 was held under the off hand');
    expect((await fen()).split(' ')[0].split('/')[3] === '4p3', `after the landed Nxe5 e5 does not hold a black pawn: ${await fen()}`);
    {
      const last = (await holds()).slice(-1)[0];
      expect(last && last.outcome === 'landed' && last.why === 'hand', `the last record is ${JSON.stringify(last && { outcome: last.outcome, why: last.why })}`);
      const s = await stats();
      expect(s.givenAway === 1 && s.holdsCount === 0, `givenAway ${s.givenAway}, holdsCount ${s.holdsCount} after the landed Nxe5`);
    }
    await giveup();
    {
      const close = await app(() => ({ sum: document.querySelector('#close .close-sum').textContent, items: Array.from(document.querySelectorAll('#close .close-holds li')).map((li) => li.textContent) }));
      expect(close.sum.includes('I never stopped your hand'), `the off game's card reads '${close.sum}'`);
      expect(close.items.some((t) => t.includes('it landed')), `no landed caption on the card: ${JSON.stringify(close.items)}`);
    }

    // ============================================================================================
    // 5. The hand comes back: one slip wakes it bare, two in a game send it to asking
    // ============================================================================================
    mark('5 slip and wake');
    await action('again');
    expect((await coach()).includes('said nothing'), `after the landed pawn the next line is '${await coach()}'`);
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held after the slip');
    expect(await coach() === C.bare, `after the slip the question is '${await coach()}'`);
    await action('takeback');
    await seed(OFF_LOG().concat(log([{ holds: [['pawns', 'landed'], ['pawns', 'landed']], observed: 3 }], { tag: 'wake' })));
    expect((await coach()).includes('once more'), `after two landed pawns the line is '${await coach()}'`);
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held after the wake');
    {
      const c = await coach();
      expect(c !== C.bare && c.startsWith('Hold on.') && c.includes('again'), `after the wake the question is '${c}'`);
    }
    await action('takeback');

    // ============================================================================================
    // 6. The notch follows the free look
    // ============================================================================================
    mark('6 notch');
    await seed(log([{ holds: [['free', 'anyway']], gifts: { offered: 1, taken: 0 } }, ...clean(5, { gifts: { offered: 1, taken: 1 } })], { tag: 'gift' }));
    expect((await app(() => window.__app.state().giftRate)) === 0.08, `with free off the gift rate is ${await app(() => window.__app.state().giftRate)}`);
    {
      const before = await app((k) => localStorage.getItem(k), KEYS.giftRate);
      expect(await play('e4') === 'committed', 'e4 did not commit (notch)');
      await giveup();
      const after = await app((k) => localStorage.getItem(k), KEYS.giftRate);
      expect(after === before, `the game end wrote the notch: ${before} -> ${after}`);
    }
    await seed([]);
    expect((await app(() => window.__app.state().giftRate)) === 0.12, `with an empty log the gift rate is ${await app(() => window.__app.state().giftRate)}`);

    // ============================================================================================
    // 7. Both rewards recorded; the one said follows the look
    // ============================================================================================
    mark('7 rewards');
    await seed(log([{ holds: [['pawns', 'anyway']], captures: 3 }, ...clean(2, { captures: 3 })], { tag: 'tlm' }));
    expect((await app(() => window.__app.path().current)) === 'their_last_move', `the seeded current look is ${await app(() => window.__app.path().current)}`);
    await load(FEN.ruy);
    {
      const { r, seen } = await P.lines(() => play('Ba4'));
      expect(r === 'committed', `Ba4 -> ${r}`);
      expect(seen.some((t) => t.includes('You looked')), `Ba4 said no 'You looked' (lines: ${seen.join(' | ') || 'none'})`);
    }
    await giveup();
    {
      const last = (await games()).slice(-1)[0];
      expect(last && Array.isArray(last.rewards) && last.rewards.some((x) => x.kind === 'escaped' && x.said === true), `the stored rewards are ${JSON.stringify(last && last.rewards)}`);
    }
    await action('again');
    await load(FEN.nxe4);
    {
      const { r, seen } = await P.lines(() => play('dxe4'));
      expect(r === 'committed', `dxe4 -> ${r}`);
      expect(seen.some((t) => t.includes('You looked')), `dxe4 said no 'You looked' (lines: ${seen.join(' | ') || 'none'})`);
    }
    await giveup();
    {
      const last = (await games()).slice(-1)[0];
      const free = (last && last.rewards || []).filter((x) => x.kind === 'free_taken');
      expect(free.length === 1 && free[0].said === true, `the stored rewards after dxe4 are ${JSON.stringify(last && last.rewards)}`);
    }

    // ============================================================================================
    // 8. The close card (and the path view over a record); 9. the drill
    // ============================================================================================
    mark('8 close card');
    await seed([]);
    await load(FEN.scholars);
    expect(await play('Qxf7#') === 'over', 'Qxf7# did not end the game');
    {
      const card = await app(() => {
        const el = document.getElementById('close');
        const p = el.querySelector('.close-path');
        return { text: el.textContent, path: p ? p.textContent : null };
      });
      expect(card.path && !/\d/.test(card.path), `the close card's path line is '${card.path}'`);
      expect(await visible('#close [data-action="path"]'), 'no Where you are link on the close card');
      expect(/Pieces given away: \d+/.test(card.text), `the counts line is gone: '${card.text.trim()}'`);
    }
    await action('again');
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held (close card)');
    await tap('d6');
    await action('anyway');
    await giveup();
    expect(await visible('#close [data-action="again-from"]'), 'Play it again from here is not shown after a played-anyway pawns hold');
    {
      // the view over a record: the still is the record's position after Nxe5, lifted and amber
      const finalFen = await fen();
      await page.click('#close [data-action="path"]');
      await waitFor(() => window.__app.view() === 'path', null, 2000, 'the path view');
      const still = () => app(() => ({
        lifted: Array.from(document.querySelectorAll('.pc.lifted')).map((x) => `${x.dataset.piece}@${x.dataset.square}`),
        amber: Array.from(document.querySelectorAll('.sq.amber')).map((x) => x.dataset.square),
        e5: (document.querySelector('.pc[data-square="e5"]') || {}).dataset,
      }));
      let s = await still();
      expect(JSON.stringify(s.lifted) === '["wN@e5"]' && JSON.stringify(s.amber) === '["e5"]', `the still is ${JSON.stringify(s)}`);
      await page.click('#path li.row[data-look] .sentence');
      s = await still();
      expect(JSON.stringify(s.lifted) === '["wN@e5"]' && JSON.stringify(s.amber) === '["e5"]', `after tapping the first row the still is ${JSON.stringify(s)}`);
      await page.click('#actions [data-action="back"]');
      const left = await app(() => ({ view: document.getElementById('stage').dataset.view, close: !document.getElementById('close').hidden, path: !document.getElementById('path').hidden }));
      expect(!left.view && left.close && !left.path && await fen() === finalFen, `Back left ${JSON.stringify(left)}`);
      await page.click('#close [data-action="path"]');
      await waitFor(() => window.__app.view() === 'path', null, 2000, 'the path view again');
      await page.keyboard.press('Escape');
      const esc = await app(() => ({ view: document.getElementById('stage').dataset.view || null, close: !document.getElementById('close').hidden, lifted: document.querySelectorAll('.pc.lifted').length }));
      expect(!esc.view && esc.close && esc.lifted === 0 && await fen() === finalFen, `Escape left ${JSON.stringify(esc)}`);
    }

    mark('9 drill');
    {
      const looksBefore = await app(() => JSON.stringify(window.__app.path().looks));
      const rec = (await games()).slice(-1)[0].holds.find((h) => h.san === 'Nxe5');
      expect(rec && rec.outcome === 'anyway', `the stored Nxe5 record is ${JSON.stringify(rec)}`);
      const ms = await app(() => new Promise((resolve) => {
        const t0 = performance.now();
        document.querySelector('#close [data-action="again-from"]').click();
        const tick = () => {
          if (document.getElementById('board').dataset.state === 'held') resolve(performance.now() - t0);
          else if (performance.now() - t0 > 3000) resolve(-1);
          else requestAnimationFrame(tick);
        };
        tick();
      }));
      expect(ms >= 0 && ms <= 100, `the drill's hold came after ${Math.round(ms)} ms (limit 100)`);
      const h = await hold();
      expect(await fen() === rec.fen && h.san === 'Nxe5', `the drill opened on ${await fen()} holding ${h.san}`);
      expect(await app(() => { const el = document.querySelector('.pc.lifted'); return !!el && el.dataset.square === 'e5'; }), 'the drill did not lift the knight on e5');
      {
        // the framing line, then the page's own question (ARCHITECTURE.md 8.4)
        const c = await coach();
        expect(c.startsWith(C.again) && c.includes('Hold on.'), `the drill's line is '${c}'`);
      }
      expect(await tap('d6') === 'right', 'tap d6 in the drill is not right');
      await action('takeback');
      expect((await coach()).includes(C.answered.replace(/\.$/, '')), `after the drill's take-back the line is '${await coach()}'`);
      expect((await holds()).slice(-1)[0].outcome === 'again', `the drill's record is ${(await holds()).slice(-1)[0].outcome}`);
      await botMove('h6');
      expect(await play('h3') === 'committed', 'h3 after the drill did not commit');
      await giveup();
      const last = (await games()).slice(-1)[0];
      const digest = (await pathKey()).digest;
      expect(last.again === true && digest[digest.length - 1].again === true, `the again game is stored with again ${last.again}, digest ${digest[digest.length - 1].again}`);
      expect(await app(() => JSON.stringify(window.__app.path().looks)) === looksBefore, 'an again game changed the looks');
      expect(!(await visible('#close [data-action="again-from"]')), 'Play it again from here is offered after an again game');
      expect(await app(() => document.querySelector('#close .close-path').textContent) === C.closeAgain, 'the again game card does not say it was practice');
    }
    mark('8 close card (clean)');
    await action('again');
    expect(await play('e4') === 'committed', 'e4 did not commit (clean give-up)');
    await giveup();
    expect(!(await visible('#close [data-action="again-from"]')), 'Play it again from here is shown after a clean give-up');
    expect(/Pieces given away: \d+/.test(await app(() => document.getElementById('close').textContent)), 'the counts line is gone after a clean give-up');
    await page.click('#close [data-action="path"]');
    await waitFor(() => window.__app.view() === 'path', null, 2000, 'the path view (Again from it)');
    await action('again');
    {
      const s = await app(() => ({ state: document.getElementById('board').dataset.state, view: document.getElementById('stage').dataset.view || null, path: !document.getElementById('path').hidden }));
      expect(s.state === 'idle' && !s.view && !s.path, `Again from the view left ${JSON.stringify(s)}`);
    }

    // ============================================================================================
    // 10. Fourteen days away
    // ============================================================================================
    mark('10 fourteen days');
    const away = OFF_LOG({ endDaysAgo: 15 });
    await seed(away);
    expect((await coach()).includes('a while'), `after fifteen days the line is '${await coach()}'`);
    expect(await app(() => window.__app.path().review) === true, 'review is not on after fifteen days');
    await load(FEN.d6);
    expect(await play('Nxe5') === 'held', 'Nxe5 was not held in the review game');
    expect(await coach() === C.bare, `the review question is '${await coach()}'`);
    await action('takeback');
    await seed(away.concat(log([{ again: true, observed: 4 }], { tag: 'yday', endDaysAgo: 1 })));
    expect(await app(() => window.__app.path().review) === false, 'an again game yesterday did not end the review');

    if (stub) {
      // ==========================================================================================
      // 11. Log honesty
      // ==========================================================================================
      mark('11 log honesty');
      await seed([]);
      await load(FEN.d6);
      expect(await play('Nxe5') === 'held', 'Nxe5 was not held (log honesty)');
      const answerSquares = (await hold()).answerSquares;
      expect(await tap('d6') === 'right', 'tap d6 (log honesty)');
      await waitFor(() => { const b = document.querySelector('[data-action="but"]'); return !!b && !b.hidden; }, null, 3000, 'the Hear me out link');
      await app((r) => { window.__stubReplies = [r]; }, K2_GOOD);
      await app((t) => window.__app.say(t), 'im attacking his king');
      await action('takeback');
      await load(FEN.d6);
      expect(await play('Bxf7+') === 'held', 'Bxf7+ was not held (log honesty)');
      await tap('f8');
      await action('takeback');
      await load(FEN.d6);
      expect(await play('h3') === 'committed', 'h3 did not commit (log honesty)');
      await giveup();
      {
        const last = (await games()).slice(-1)[0];
        expect(last.v === 2 && last.observed >= 1, `the stored summary has v ${last.v}, observed ${last.observed}`);
        const h0 = last.holds[0];
        expect(h0 && h0.taps[0] && h0.taps[0].ask === null, `holds[0].taps[0] is ${JSON.stringify(h0 && h0.taps[0])}`);
        expect(typeof h0.said === 'string' && h0.said.includes('im attacking his king'), `holds[0].said is ${JSON.stringify(h0.said)}`);
        expect(h0.answer && JSON.stringify(h0.answer.squares) === JSON.stringify(answerSquares), `holds[0].answer is ${JSON.stringify(h0.answer)} (hold ${JSON.stringify(answerSquares)})`);
        expect(last.holds.length === 2 && last.holds.every((x) => x.outcome === 'back'), `the stored holds are ${JSON.stringify(last.holds.map((x) => x.outcome))}`);
      }
      await action('again');
      await load(FEN.d6);
      await play('Nxe5');
      await tap('d6');
      await action('anyway');
      expect((await holds()).slice(-1)[0].outcome === 'anyway', `a played-anyway record is ${(await holds()).slice(-1)[0].outcome}`);
      {
        const ids = await app(async () => {
          const p1 = window.__app.newGame();
          const a = window.__app.stats().gameId;
          const p2 = window.__app.newGame();
          const b = window.__app.stats().gameId;
          await Promise.all([p1, p2]);
          return [a, b];
        });
        expect(ids[0] && ids[1] && ids[0] !== ids[1], `two newGame() calls in one breath share the id ${ids[0]}`);
      }

      // ==========================================================================================
      // 12. K3: once per game after consent, quick tier, no square in the prompt
      // ==========================================================================================
      mark('12 k3');
      const calls = () => app(() => (window.__sampleCalls || []).map((c) => ({ outcome: c.outcome, opts: c.opts, input: String(c.input) })));
      const settled = (n) => waitFor((k) => { const c = window.__sampleCalls || []; return c.length > k && c[c.length - 1].outcome !== 'pending'; }, n, 3000, 'the K3 call to settle');
      await seed([]);
      await load(FEN.d6);
      expect(await play('Nxe5') === 'held', 'Nxe5 was not held (K3)');
      await waitFor(() => { const c = window.__sampleCalls || []; return !c.length || c[c.length - 1].outcome !== 'pending'; }, null, 3000, 'the K1 call to settle');
      await tap('d6');
      await action('anyway');
      {
        const n0 = (await calls()).length;
        await app((r) => { window.__stubReplies = [r]; }, K3_GOOD);
        const endedId = (await stats()).gameId;
        await giveup();
        await settled(n0);
        await P.app(() => new Promise((r) => setTimeout(r, 50)));
        const c = await calls();
        expect(c.length === n0 + 1, `the game end made ${c.length - n0} sample calls, expected one`);
        const k3 = c[c.length - 1];
        expect(k3.opts.modelTier === C.tier && k3.opts.tools.length === 0, `K3 opts ${JSON.stringify(k3.opts)}`);
        expect(!SQUARE_TOKEN.test(k3.input) && !FEN_SHAPE.test(k3.input), `the K3 prompt carries a square or a FEN: ${(k3.input.match(SQUARE_TOKEN) || k3.input.match(FEN_SHAPE) || [''])[0]}`);
        expect(k3.outcome === 'resolved', `K3 outcome ${k3.outcome}`);
        await waitFor((id) => { try { const k = JSON.parse(localStorage.getItem('holdon.v1.path')).k3; return !!k && k.gameId === id; } catch { return false; } }, endedId, 2000, 'k3 to be stored');
        const stored = (await pathKey()).k3;
        expect(stored.nodeId === await app(() => window.__app.path().current), `k3 stored for ${stored.nodeId}`);
        await waitFor((w) => { const el = document.querySelector('#close .close-where'); return !!el && !el.hidden && el.textContent === w; }, K3.where, 2000, "Claude's where line on the card");
      }
      {
        // no K3 for an again game (and no K1 inside it)
        expect(await visible('#close [data-action="again-from"]'), 'no drill offered for the K3 checks');
        await app(() => window.__app.again());
        expect(await boardState() === 'held', 'the drill did not open (K3)');
        await action('takeback');
        const n0 = (await calls()).length;
        await giveup();
        await P.app(() => new Promise((r) => setTimeout(r, 400)));
        expect((await calls()).length === n0, `an again game made ${(await calls()).length - n0} sample calls`);
      }
      {
        // a rejected where keeps the other fields and the template where
        await action('again');
        await load(FEN.d6);
        expect(await play('h3') === 'committed', 'h3 did not commit (K3 reject)');
        const by0 = await app(() => (window.__coachRejectsBy && window.__coachRejectsBy.where) || 0);
        const n0 = (await calls()).length;
        await app((r) => { window.__stubReplies = [r]; }, K3_BAD_WHERE);
        await giveup();
        await settled(n0);
        await waitFor((b) => ((window.__coachRejectsBy && window.__coachRejectsBy.where) || 0) > b, by0, 2000, '__coachRejectsBy.where to count the rejected where');
        expect(await app(() => window.__coachRejectsBy.where) === by0 + 1, `__coachRejectsBy.where went ${by0} -> ${await app(() => window.__coachRejectsBy.where)}`);
        await waitFor(() => { const el = document.querySelector('#close .close-where'); return !!el && !el.hidden && !!el.textContent; }, null, 2000, 'the template where on the card');
        const where = await app(() => document.querySelector('#close .close-where').textContent);
        const stored = (await pathKey()).k3;
        expect(!SQUARE_TOKEN.test(where) && where !== JSON.parse(K3_BAD_WHERE).where && stored.where === where, `the where shown is '${where}' (stored '${stored.where}')`);
        expect(stored.next === K3.next, `the accepted next was not kept: '${stored.next}'`);
      }
      {
        // zero K3 calls without consent (a fresh view)
        await reload({});
        await P.waitEngine();
        await load(FEN.d6);
        expect(await play('h3') === 'committed', 'h3 did not commit (no consent)');
        await giveup();
        await P.app(() => new Promise((r) => setTimeout(r, 400)));
        expect((await calls()).length === 0, `a game end without consent made ${(await calls()).length} sample calls`);
      }

      // ==========================================================================================
      // 13. The mirror over the stubbed db, user and permissions
      // ==========================================================================================
      mark('13 mirror');
      expect(ctx.db && typeof ctx.db.set === 'function', 'the harness gave no ctx.db');
      // a remote document over `list`, its digest built by the page's own path.js
      const remoteDoc = (list) => app(async (g) => {
        const P = await import('./js/path.js');
        return { v: 2, updatedAt: new Date(Date.now() - 3600 * 1000).toISOString(), games: g, flags: { tutorialSeen: true, firstHoldSeen: false, firstFloatSeen: false }, path: { k3: null, said: [], digest: g.map((x) => P.digestOf(P.norm(x))), shown: null } };
      }, list);
      const ids = (list) => (list || []).map((g) => g.id).sort();
      {
        // 'granted': the remote merges into the local log at boot, read first, and the merge goes
        // back to the document; a remote of twelve (eleven real games and one again game, so the
        // KEEP trim keeps all of them) and a local log of one end with thirteen in both
        ctx.db.reset();
        const remote = log(clean(11), { tag: 'rem', endDaysAgo: 3 }).concat(log([{ again: true, observed: 3 }], { tag: 'rema', endDaysAgo: 2 }));
        const local = log(clean(1), { tag: 'loc', endDaysAgo: 1 });
        ctx.db.set(DOC, await remoteDoc(remote));
        await reload({ clear: true, flags: { [KEYS.tutorialSeen]: '1', [KEYS.games]: JSON.stringify(local) }, caps: GRANTED });
        await waitFor(() => { try { return JSON.parse(localStorage.getItem('holdon.v1.games') || '[]').length === 13; } catch { return false; } }, null, 5000, 'the boot merge (thirteen games)');
        const c = await P.dbCalls();
        expect(c.length && c[0].op === 'get' && c[0].path === DOC, `the first db call is ${JSON.stringify(c[0])}`);
        expect(JSON.stringify(ids(await games())) === JSON.stringify(ids(remote.concat(local))), `the merged log is ${JSON.stringify(ids(await games()))}`);
        await waitFor(() => (window.__dbCalls || []).every((x) => x.outcome !== 'pending'), null, 3000, 'the boot calls to settle');
        const remoteNow = ctx.db.get(DOC);
        expect(remoteNow && JSON.stringify(ids(remoteNow.games)) === JSON.stringify(ids(remote.concat(local))), `after the boot the remote holds ${remoteNow && remoteNow.games.length} games`);
        const sync = await app((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEYS.sync);
        expect(sync && sync.uid === 'u_test', `holdon.v1.sync is ${JSON.stringify(sync)}`);
      }
      {
        // 'prompt': nothing before the close card; then one get and one set; one game on a fresh
        // device never overwrites the remote
        ctx.db.reset();
        const remote = log(clean(3), { tag: 'pro', endDaysAgo: 2 });
        ctx.db.set(DOC, await remoteDoc(remote));
        await reload({ clear: true, flags: { [KEYS.tutorialSeen]: '1' }, caps: { ...GRANTED, db: 'prompt' } });
        await P.waitEngine();
        expect((await P.dbCalls()).length === 0, `under 'prompt' the boot touched the db: ${JSON.stringify(await P.dbCalls())}`);
        expect(await play('e4') === 'committed', 'e4 did not commit (prompt)');
        expect((await P.dbCalls()).length === 0, 'under prompt a db call came before the close card');
        const mine = (await stats()).gameId;
        await giveup();
        await waitFor(() => { const c = window.__dbCalls || []; return c.some((x) => x.op === 'set' && x.outcome === 'resolved'); }, null, 5000, 'the close-card read and write');
        const c = await P.dbCalls();
        expect(JSON.stringify(c.map((x) => `${x.op}:${x.outcome}`)) === '["get:resolved","set:resolved"]', `the close-card calls are ${c.map((x) => `${x.op}:${x.outcome}`).join(' ')}`);
        const remoteNow = ctx.db.get(DOC);
        expect(remoteNow && remoteNow.games.length === 4 && (await games()).length === 4, `after the first game the remote holds ${remoteNow && remoteNow.games.length} and the page ${(await games()).length}`);
        expect(remoteNow.games.some((g) => g.id === mine) && JSON.stringify(ids(remoteNow.games)) === JSON.stringify(ids(await games())), 'the remote and the page disagree after the write');
      }
      {
        // invalid_argument on the boot read: the page plays, and never writes
        await reload({ caps: { ...GRANTED, errors: [{ op: 'get', code: 'invalid_argument' }] } });
        await waitFor(() => (window.__dbCalls || []).some((x) => x.outcome === 'invalid_argument'), null, 5000, 'the failed read');
        await P.waitEngine();
        expect(await play('e4') === 'committed', 'e4 did not commit after invalid_argument');
        await giveup();
        await P.app(() => new Promise((r) => setTimeout(r, 600)));
        const c = await P.dbCalls();
        expect(!c.some((x) => x.op === 'set'), `after invalid_argument the page wrote: ${c.map((x) => `${x.op}:${x.outcome}`).join(' ')}`);
      }
      {
        // unavailable on the boot read: one retry
        await reload({ caps: { ...GRANTED, errors: [{ op: 'get', code: 'unavailable' }] } });
        await waitFor(() => (window.__dbCalls || []).filter((x) => x.op === 'get').length >= 2 && (window.__dbCalls || []).every((x) => x.outcome !== 'pending'), null, 6000, 'the retried read');
        const gets = (await P.dbCalls()).filter((x) => x.op === 'get');
        expect(gets.length === 2 && gets[0].outcome === 'unavailable' && gets[1].outcome === 'resolved', `the reads are ${gets.map((x) => x.outcome).join(' ')}`);
      }
      {
        // two devices over one store converge after each boots again
        ctx.db.reset();
        await reload({ clear: true, flags: { [KEYS.tutorialSeen]: '1' }, caps: GRANTED });
        await waitFor(() => (window.__dbCalls || []).some((x) => x.op === 'get' && x.outcome === 'resolved'), null, 5000, "this page's boot read");
        const dev = await ctx.newDevice({ caps: GRANTED, flags: { [KEYS.tutorialSeen]: '1' } });
        try {
          const D = on(dev.page, dev.label || 'device');
          await dev.page.waitForFunction(() => !!(window.__app && window.__app.state), null, { timeout: 15000 });
          await D.install();
          await D.waitFor(() => (window.__dbCalls || []).some((x) => x.op === 'get' && x.outcome === 'resolved'), null, 5000, "the device's boot read");
          await D.waitEngine();
          expect(await D.play('e4') === 'committed', 'e4 did not commit on the device');
          const devGame = (await D.stats()).gameId;
          await D.giveup();
          await D.waitFor(() => (window.__dbCalls || []).some((x) => x.op === 'set' && x.outcome === 'resolved'), null, 5000, "the device's write");
          await reload({ caps: GRANTED });
          await waitFor((id) => { try { return JSON.parse(localStorage.getItem('holdon.v1.games') || '[]').some((g) => g.id === id); } catch { return false; } }, devGame, 5000, "the device's game on this page");
          await P.waitEngine();
          expect(await play('e4') === 'committed', 'e4 did not commit on this page (two devices)');
          await giveup();
          await waitFor(() => (window.__dbCalls || []).some((x) => x.op === 'set' && x.outcome === 'resolved'), null, 5000, "this page's write");
          await D.reload({ caps: GRANTED });
          const mineNow = await games();
          await D.waitFor((n) => { try { return JSON.parse(localStorage.getItem('holdon.v1.games') || '[]').length === n; } catch { return false; } }, mineNow.length, 5000, 'the device to converge');
          expect(JSON.stringify(ids(await D.games())) === JSON.stringify(ids(mineNow)) && mineNow.length === 2, `the two devices hold ${JSON.stringify(ids(await D.games()))} and ${JSON.stringify(ids(mineNow))}`);
          await D.harvest();
        } finally {
          await dev.close();
        }
      }
    }
  }

  // ==============================================================================================
  // The path view, on every page; the page ends in it
  // ==============================================================================================
  mark('view');
  await reload({ clear: true, flags: { [KEYS.tutorialSeen]: '1' } });
  await P.waitEngine();
  let idleShot = null;
  if (ctx.scheme === 'dark') idleShot = await page.locator('#board').screenshot();
  await load(FEN.scholars);
  expect(await play('Qxf7#') === 'over', 'Qxf7# did not end the game (view)');
  expect(await visible('#close [data-action="path"]'), 'no Where you are link on the close card (view)');
  await page.click('#close [data-action="path"]');
  await waitFor(() => window.__app.view() === 'path', null, 2000, 'the path view');
  {
    const v = await app(() => {
      const pathEl = document.getElementById('path');
      const rows = Array.from(pathEl.querySelectorAll('li.row:not(.collapsed)'));
      const pieces = Array.from(document.querySelectorAll('#pieces .pc')).filter((x) => !x.classList.contains('taken')).map((x) => `${x.dataset.piece}@${x.dataset.square}`).sort();
      return {
        view: document.getElementById('stage').dataset.view, tag: document.getElementById('stage').tagName,
        close: document.getElementById('close').hidden, path: !pathEl.hidden && pathEl.offsetParent !== null,
        rows: rows.length, collapsed: pathEl.querySelectorAll('li.collapsed').length, text: pathEl.textContent,
        dots: pathEl.querySelectorAll('.dot').length, sqDots: document.querySelectorAll('.sq.dot').length,
        back: !!document.querySelector('#actions [data-action="back"]'), state: document.getElementById('board').dataset.state,
        pieces, lifted: document.querySelectorAll('.pc.lifted').length, amber: document.querySelectorAll('.sq.amber').length,
      };
    });
    expect(v.tag === 'MAIN' && v.view === 'path', `main#stage data-view is ${v.view}`);
    expect(v.close === true && v.path === true, `#close hidden ${v.close}, #path shown ${v.path}`);
    expect(v.rows >= 1 && v.rows <= 7 && v.collapsed <= 1, `the view lists ${v.rows} rows and ${v.collapsed} collapsed lines`);
    expect(!/\d/.test(v.text), `the view shows a digit: '${v.text}'`);
    expect(v.dots === 1 && v.sqDots === 0, `the view has ${v.dots} dots and the board ${v.sqDots}`);
    expect(v.back, 'no Back in the action bar');
    expect(v.state === 'over', `the board state in the view is ${v.state}`);
    const startPieces = [];
    FEN.start.split(' ')[0].split('/').forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        startPieces.push(`${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}@${'abcdefgh'[f]}${8 - r}`);
        f += 1;
      }
    });
    expect(JSON.stringify(v.pieces) === JSON.stringify(startPieces.sort()) && v.lifted === 0 && v.amber === 0, `with no record of the current look the still is not the start position: ${v.pieces.length} pieces, ${v.lifted} lifted, ${v.amber} amber`);
  }
  {
    // the longest caption stays on one line
    const fit = await app((texts) => {
      const el = document.querySelector('#path .caption');
      const was = el.textContent;
      el.textContent = 'Yours.';
      const one = el.clientHeight;
      const res = texts.map((t) => { el.textContent = t; return { t, h: el.clientHeight }; });
      el.textContent = was;
      return { one, res, width: el.clientWidth };
    }, LONG_CAPTIONS);
    for (const r of fit.res) expect(r.h === fit.one && r.h <= 24, `the caption '${r.t}' is ${r.h} px tall (one line ${fit.one} px, width ${fit.width} px)`);
  }
  if (ctx.scheme === 'dark') {
    const pathShot = await page.locator('#board').screenshot();
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `path-board-${ctx.vp}-dark.png`), pathShot);
    const li = await luminance(page, idleShot);
    const lp = await luminance(page, pathShot);
    expect(lp < li, `the dark path board is not darker than the idle dark board (idle ${li.toFixed(1)}, path ${lp.toFixed(1)})`);
  }
  await P.harvest();
  expect(heldWhilePath.length === 0, `#path showed while the board was held: ${JSON.stringify(heldWhilePath.slice(0, 3))}`);
  mark('done');
  if (process.env.HOLDON_TIMES) console.error(`path [${tag}] ${times.join(' | ')}`);
};
