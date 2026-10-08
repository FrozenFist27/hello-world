// Feasibility probe: run the vendored Stockfish WASM worker in headless Chromium at the spec's
// exact depths on the spec's exact positions and report timings and the gate's cpLoss numbers.
const { spawn } = require('child_process');
const PORT = 8791;
const DIR = '/tmp/claude-0/-home-user-hello-world/272d20b6-49d9-50c7-82a4-431be1d3a0e1/scratchpad/serve';

const CASES = [
  { name: 'P1 Italian 6...d6', fen: 'r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7',
    moves: { 'Nxe5': 'held hanging', 'Bxf7+': 'held', 'h3': 'clean' } },
  { name: 'P2 Italian 3...Nf6 (tutorial)', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    moves: { 'Bxf7+': 'held', 'Nxe5': 'held', 'd3': 'clean' } },
  { name: 'P3 Ruy 3...a6', fen: 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
    moves: { 'O-O': 'held ignored_attack', 'Ba4': 'clean' } },
  { name: 'P4 Italian 4.d3 Nxe4', fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5',
    moves: { 'Nc3': 'held free_piece_ignored', 'dxe4': 'clean + You looked' } },
  { name: 'P5 Placement 7...O-O', fen: 'r2q1rk1/ppp2ppp/2np1n2/2b1p3/2B1P1b1/2PP1N1P/PP3PP1/RNBQ1RK1 w - - 1 8',
    moves: { 'Nbd2': 'held free_piece_ignored', 'hxg4': 'clean + You looked' } },
  { name: 'P6 After 5...Ng4', fen: 'r1bqk2r/pppp1ppp/2n5/2b1p3/2B1P1n1/3P1N1P/PPP2PP1/RNBQK2R w KQkq - 1 6',
    moves: { 'O-O': 'held', 'hxg4': 'clean' } },
  { name: 'P7 1.f3 e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2',
    moves: { 'g4': 'held allowed_mate' } },
  { name: 'P8 Scholar White', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    moves: { 'Qh3': 'held missed_mate', 'Qxf7#': 'over' } },
];

const PAGE_CODE = `
async (CASES) => {
  const { Chess } = await import('/vendor/chess.js');
  const t0 = performance.now();
  const w = new Worker('/vendor/stockfish-18-lite-single.js');
  let waiters = [];
  w.onmessage = e => { const s = typeof e.data === 'string' ? e.data : String(e.data); for (const f of [...waiters]) f(s); };
  const send = s => w.postMessage(s);
  const collect = (donePred) => new Promise(res => { const got = []; const f = s => { got.push(s); if (donePred(s)) { waiters = waiters.filter(x => x !== f); res(got); } }; waiters.push(f); });
  const out = { timings: {}, cases: [] };
  let p = collect(s => s === 'uciok'); send('uci'); await p;
  p = collect(s => s === 'readyok'); send('isready'); await p;
  out.timings.warmupMs = Math.round(performance.now() - t0);

  function parse(lines) {
    const pv = {}; let bestmove = null;
    for (const s of lines) {
      if (s.startsWith('bestmove')) bestmove = s.split(' ')[1];
      if (!s.startsWith('info') || !s.includes(' score ')) continue;
      const m = s.match(/depth (\\d+).*?multipv (\\d+).*?score (cp|mate) (-?\\d+).*? pv (.+)$/);
      if (!m) continue;
      pv[m[2]] = { depth: +m[1], kind: m[3], val: +m[4], pv: m[5].split(' ').slice(0, 4).join(' ') };
    }
    return { pv, bestmove };
  }
  async function search(fen, depth, multipv, stopAfterMs) {
    send('setoption name MultiPV value ' + multipv);
    send('position fen ' + fen);
    const t = performance.now();
    const pr = collect(s => s.startsWith('bestmove'));
    send('go depth ' + depth);
    if (stopAfterMs) setTimeout(() => send('stop'), stopAfterMs);
    const lines = await pr;
    const r = parse(lines); r.ms = Math.round(performance.now() - t); return r;
  }
  const toPlayer = (r, playerToMove) => { const l = r.pv['1']; if (!l) return null; let v = l.kind === 'mate' ? Math.sign(l.val) * (10000 - Math.abs(l.val)) : l.val; return playerToMove ? v : -v; };

  // stop test: how deep is a depth-12 multipv-2 pre-search after 50 ms and after 300 ms?
  out.stopTest = [];
  for (const ms of [50, 300]) { const r = await search(CASES[0].fen, 12, 2, ms); out.stopTest.push({ stopAfterMs: ms, depthReached: r.pv['1']?.depth, bestmove: r.bestmove, ms: r.ms }); }

  for (const c of CASES) {
    const rec = { name: c.name, moves: [] };
    const pre = await search(c.fen, 12, 2);
    rec.pre = { ms: pre.ms, best: pre.bestmove, evalBefore: toPlayer(pre, true), line1: pre.pv['1'], line2: pre.pv['2'] };
    for (const [san, expect] of Object.entries(c.moves)) {
      const ch = new Chess(c.fen); const mv = ch.move(san); if (!mv) { rec.moves.push({ san, error: 'illegal' }); continue; }
      const fen2 = ch.fen();
      if (ch.isCheckmate()) { rec.moves.push({ san, expect, result: 'checkmate (no search)' }); continue; }
      const post = await search(fen2, 10, 1);
      const evalAfter = toPlayer(post, false);
      const replyUci = post.bestmove; const ch2 = new Chess(fen2); const replyMv = ch2.move(replyUci.slice(0,2) + '-' + replyUci.slice(2,4)) || ch2.move({ from: replyUci.slice(0,2), to: replyUci.slice(2,4), promotion: replyUci[4] });
      const bot = await search(fen2, 8, 6);
      rec.moves.push({ san, expect, verdictMs: post.ms, evalBefore: rec.pre.evalBefore, evalAfter, cpLoss: rec.pre.evalBefore - evalAfter, replyUci, replySan: replyMv?.san, replyIsCapture: !!replyMv?.captured, replyMate: post.pv['1']?.kind === 'mate' ? post.pv['1'].val : null, botSearchMs: bot.ms, botTop: bot.bestmove, botLines: Object.values(bot.pv).map(l => l.pv.split(' ')[0] + ':' + (l.kind==='mate'?'M'+l.val:l.val)) });
    }
    out.cases.push(rec);
  }
  // bot-as-White forced capture test on P4: depth 8 multipv 6 from White's side
  const b = await search(CASES[3].fen, 8, 6);
  out.botP4 = { ms: b.ms, top: b.bestmove, lines: Object.values(b.pv).map(l => l.pv.split(' ')[0] + ':' + l.val) };
  return out;
}`;

async function main() {
  const { chromium } = require('playwright');
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIR], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/probe.html`);
  const t = Date.now();
  const out = await page.evaluate('(' + PAGE_CODE + ')(' + JSON.stringify(CASES) + ')');
  out.totalMs = Date.now() - t; out.errors = errs;
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.kill();
}
main().catch(e => { console.error('probe failed', e); process.exit(2); });
