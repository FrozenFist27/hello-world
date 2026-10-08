// engine.js — Stockfish 18 lite in one Web Worker behind a serialized UCI queue.
//
// createEngine({ workerUrl, Worker }) -> Engine
//   ready        Promise<void>  resolves after the warm-up (uci -> uciok -> options -> isready -> readyok -> ucinewgame);
//                               never resolves and never rejects when the Worker never answers
//   isReady()    boolean
//   setOptions({ 'Skill Level', MultiPV, UCI_LimitStrength, UCI_Elo, ... })   setoption lines, sent between searches
//   newGame()    queues a ucinewgame before the next go (or sends it now when idle)
//   search(fen, { depth, multipv = 1, skill = 20, newGame = false }) -> Promise<SearchResult>
//   stop()       sends 'stop' for the running search; resolves when its bestmove has arrived (no-op when idle)
//   current()    { id, fen } | null
//   terminate()  kills the Worker; pending searches resolve as stopped
//
// SearchResult = { id, fen, depth, lines: [{ multipv, depth, score: {cp}|{mate}, pv: [uci] }],
//                  bestmove: uci|null, ponder: uci|null, ms, stopped }
// Scores are side-to-move, exactly as Stockfish reports them (gate.toPlayer converts).
//
// A go is sent only after the previous bestmove has arrived; each search carries an integer id and a
// bestmove that does not belong to the running id is discarded. Nothing in here throws: a missing or
// silent Worker leaves isReady() false for ever, and a broken message is ignored.

import { ENGINE } from './contract.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// Parse one 'info ...' line into { depth, multipv, score, pv } or null when it is not a scored pv line.
export function parseInfo(line) {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  let depth = null, multipv = 1, score = null, pv = null, bound = false;
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') depth = Number(t[++i]);
    else if (k === 'multipv') multipv = Number(t[++i]);
    else if (k === 'score') {
      const kind = t[++i];
      const v = Number(t[++i]);
      if (kind === 'cp') score = { cp: v };
      else if (kind === 'mate') score = { mate: v };
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { bound = true; i++; }
    } else if (k === 'lowerbound' || k === 'upperbound') bound = true;
    else if (k === 'pv') { pv = t.slice(i + 1).filter(Boolean); break; }
    else if (k === 'string') return null;
  }
  if (bound || depth == null || !score || !pv || !pv.length || !Number.isFinite(multipv)) return null;
  return { depth, multipv, score, pv };
}

export function createEngine({ workerUrl = ENGINE.WORKER_URL, Worker = globalThis.Worker } = {}) {
  let worker = null;
  let readyFlag = false;
  let terminated = false;
  let phase = 'boot';            // 'boot' | 'uci' | 'isready' | 'ready'
  let nextId = 1;
  let running = null;            // the search whose go has been sent and whose bestmove is awaited
  const queue = [];              // searches waiting for the engine to be idle
  const pendingOptions = {};     // setoption lines to send before the next go
  let pendingNewGame = false;
  const sentOptions = {};        // last value sent per option name
  let readyResolve = null;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  function send(s) {
    if (!worker || terminated) return;
    try { worker.postMessage(s); } catch { /* a dead worker is a cold engine */ }
  }

  function setOption(name, value) {
    const v = typeof value === 'boolean' ? String(value) : value;
    if (sentOptions[name] === v) return;
    sentOptions[name] = v;
    send(`setoption name ${name} value ${v}`);
  }

  function flushOptions() {
    for (const name of Object.keys(pendingOptions)) {
      setOption(name, pendingOptions[name]);
      delete pendingOptions[name];
    }
    if (pendingNewGame) { pendingNewGame = false; send('ucinewgame'); }
  }

  function emptyResult(req, stopped) {
    return { id: req.id, fen: req.fen, depth: 0, lines: [], bestmove: null, ponder: null, ms: 0, stopped };
  }

  function startNext() {
    if (running || !readyFlag || terminated) return;
    const req = queue.shift();
    if (!req) { flushOptions(); return; }
    running = req;
    req.lines = new Map();
    req.stopped = false;
    req.stopWaiters = [];
    if (req.newGame) pendingNewGame = true;
    pendingOptions.MultiPV = req.multipv;
    pendingOptions['Skill Level'] = req.skill;
    flushOptions();
    send(`position fen ${req.fen}`);
    req.t0 = now();
    send(`go depth ${req.depth}`);
  }

  function finish(req, bestmove, ponder) {
    const lines = [...req.lines.values()].sort((a, b) => a.multipv - b.multipv);
    const result = {
      id: req.id,
      fen: req.fen,
      depth: lines.length ? lines[0].depth : 0,
      lines,
      bestmove: bestmove && bestmove !== '(none)' ? bestmove : null,
      ponder: ponder && ponder !== '(none)' ? ponder : null,
      ms: Math.round(now() - (req.t0 || now())),
      stopped: !!req.stopped,
    };
    req.resolve(result);
    for (const w of req.stopWaiters) w();
  }

  function onLine(line) {
    if (phase === 'uci') {
      if (line === 'uciok') {
        phase = 'isready';
        setOption('Hash', ENGINE.HASH_MB);
        setOption('MultiPV', ENGINE.MULTIPV);
        send('isready');
      }
      return;
    }
    if (phase === 'isready') {
      if (line === 'readyok') {
        phase = 'ready';
        send('ucinewgame');
        readyFlag = true;
        readyResolve();
        startNext();
      }
      return;
    }
    if (phase !== 'ready') return;
    if (line.startsWith('bestmove')) {
      const t = line.split(/\s+/);
      const req = running;
      if (!req) return;                       // a bestmove with no running search: discarded
      running = null;
      finish(req, t[1] || null, t[2] === 'ponder' ? t[3] || null : null);
      startNext();
      return;
    }
    if (line.startsWith('info ') && running) {
      const info = parseInfo(line);
      if (!info) return;
      const prev = running.lines.get(info.multipv);
      if (prev && prev.depth > info.depth) return;    // keep the deepest per multipv
      running.lines.set(info.multipv, { multipv: info.multipv, depth: info.depth, score: info.score, pv: info.pv });
    }
  }

  function onMessage(e) {
    const data = e && typeof e === 'object' && 'data' in e ? e.data : e;
    if (data == null) return;
    const text = typeof data === 'string' ? data : String(data);
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line) { try { onLine(line); } catch { /* never throw from a message handler */ } }
    }
  }

  function boot() {
    if (typeof Worker !== 'function') return;     // no Worker at all: the engine stays cold
    try {
      worker = new Worker(workerUrl);
    } catch { worker = null; return; }
    try {
      if (typeof worker.addEventListener === 'function') {
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', () => { /* a broken worker is a cold engine */ });
      } else {
        worker.onmessage = onMessage;
      }
    } catch { /* ignore */ }
    phase = 'uci';
    send('uci');
  }

  const engine = {
    ready,
    isReady: () => readyFlag && !terminated,
    setOptions(opts = {}) {
      for (const [k, v] of Object.entries(opts || {})) pendingOptions[k] = v;
      if (!running) startNext();
    },
    newGame() {
      pendingNewGame = true;
      if (!running) startNext();
    },
    search(fen, { depth = 10, multipv = 1, skill = 20, newGame = false } = {}) {
      return new Promise((resolve) => {
        const req = { id: nextId++, fen, depth, multipv, skill, newGame, resolve };
        if (terminated) { resolve(emptyResult(req, true)); return; }
        queue.push(req);
        startNext();
      });
    },
    stop() {
      return new Promise((resolve) => {
        const req = running;
        if (!req) { resolve(); return; }
        req.stopWaiters.push(resolve);
        if (!req.stopped) { req.stopped = true; send('stop'); }
      });
    },
    current: () => (running ? { id: running.id, fen: running.fen } : null),
    terminate() {
      if (terminated) return;
      terminated = true;
      readyFlag = false;
      try { if (worker && typeof worker.terminate === 'function') worker.terminate(); } catch { /* ignore */ }
      worker = null;
      const req = running;
      running = null;
      if (req) { req.stopped = true; finish(req, null, null); }
      while (queue.length) { const q = queue.shift(); q.resolve(emptyResult(q, true)); }
    },
  };

  boot();
  return engine;
}
