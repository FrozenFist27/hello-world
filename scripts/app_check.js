#!/usr/bin/env node
// Headless check for the chess app: serves a directory over HTTP, opens a page in Chromium with
// a stub of the claude.ai capabilities (sample, db, user, permissions), screenshots desktop + phone
// in light + dark, and reports console errors, page errors and failed requests as JSON.
//
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/app_check.js \
//     [--dir app] [--page index.html] [--out /tmp/shots] [--port 8787] [--no-stub] \
//     [--wait "#selector"] [--scenarios a.js,b.js] [--script path/to/scenario.js] [--settle 800]
//     [--pages desktop/light,phone/dark]   (a development aid: only those pages run)
//
// Scenario files (optional) each export `async (page, ctx) => {...}`; they run in the order given
// (--scenarios takes a comma list and may be repeated; --script is an alias for one file and may be
// repeated too) on every page, after load and before the screenshot; use them to click through a
// flow. ctx = { vp, scheme, report, out, url, stub, scenario, db, newDevice }.
//
// The sample stub records every sample() call on window.__sampleCalls and streams canned text; set
// window.__stubReplies = ["..."] from the scenario to control what "Claude" says.
//
// The db / user / permissions stub (ARCHITECTURE.md 8.8) reads sessionStorage['holdon.test.caps']
// (JSON) when the page initialises:
//   { db: 'granted'|'prompt'|'denied'|'unavailable'|'none', user: 'u_test'|null, permissions: boolean,
//     errors: [{ op: 'get'|'set', code }] }
// Missing or unreadable, it is { db: 'none', user: null, permissions: false, errors: [] }: use('db'),
// use('permissions') resolve null and user.id() resolves null, so the page runs local only, as it did
// before the mirror existed. `db.doc(path).get()/set(body)` go through window.__stubDbCall(op, path,
// body), exposed from node over ONE Map shared by every page of the run (the four harness pages and
// every ctx.newDevice() page), so two "devices" see one store. `get` answers exists:false until a
// `set`; a set replaces the whole body. caps.errors are consumed one per call, in order, by the
// first entry whose op matches the call (the remainder is written back to sessionStorage, so a
// reload does not replay a consumed error); the call rejects { code, message }. Every call is
// recorded on window.__dbCalls as { op, path, outcome } (outcome 'pending', then 'resolved' or the
// error code) and node-side on ctx.db.calls as { op, path, outcome, page }.
//
// ctx.db = { get(path), set(path, body), reset(), calls }    node-side view of the shared store
// ctx.newDevice({ caps, flags, goto = true }) -> { page, close() }: a page in a fresh browser context
//   (its own localStorage and sessionStorage) with the same stub, viewport and colour scheme; caps
//   and the localStorage flags are written before its first load; the scenario closes it.
//
// The report gains `seconds` (the whole run), `timings: [{ scenario, viewport, scheme, ms }]`,
// `dbCalls` (db calls of the run) and `sampleCallsRun` (every settled sample call of the run, across
// reloads and devices; `sampleCalls` stays the calls on each page's final load, as before).
// Exit code: 0 when report.ok, 1 otherwise, 2 when the harness itself (or a scenario) threw.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
function args(name) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === name && i + 1 < process.argv.length) out.push(process.argv[i + 1]); });
  return out;
}
const DIR = path.resolve(arg('--dir', 'app'));
const PAGE = arg('--page', 'index.html');
const OUT = path.resolve(arg('--out', '/tmp/app-check'));
const PORT = Number(arg('--port', '8787'));
const WAIT = arg('--wait', null);
const SCENARIOS = [...args('--scenarios'), ...args('--script')]
  .flatMap((s) => String(s).split(','))
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => path.resolve(s));
const SETTLE = Number(arg('--settle', '800'));
const STUB = !process.argv.includes('--no-stub');
// --pages desktop/light,phone/dark limits the run to those pages (a development aid; test_all runs all four)
const PAGES = args('--pages').flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);

// Every sample call is recorded on window.__sampleCalls as {input, opts, outcome}; outcome is
// 'pending' while the call runs, then 'resolved', 'cancelled' (opts.signal aborted during the wait),
// 'invalid_json' (sample.json could not parse the text) or the code injected through
// window.__stubErrors = [{code: 'not_granted'}, ...], which is consumed one entry per call: that
// call rejects with {code, message} after the wait. No test variable lives in page code.
const STUB_SCRIPT = `
(() => {
  const calls = []; window.__sampleCalls = calls; window.__stubReplies = window.__stubReplies || []; window.__stubErrors = window.__stubErrors || [];
  const reply = () => (window.__stubReplies.length ? window.__stubReplies.shift() : 'Stub coach: this is canned text standing in for Claude. The real page asks Claude through the sample capability.');
  // every settled call is also logged node-side (fire and forget), so the report counts the calls of
  // the whole run, across reloads and devices, beside the final page's window.__sampleCalls
  const logCall = (rec) => { try { if (typeof window.__stubSampleLog === 'function') Promise.resolve(window.__stubSampleLog({ modelTier: rec.opts.modelTier, tools: rec.opts.tools, cache: rec.opts.cache, outcome: rec.outcome, bytes: String(rec.input).length })).catch(() => {}); } catch { /* node side gone */ } };
  const sample = async (input, opts = {}) => {
    const rec = { input, opts: { modelTier: opts.modelTier, tools: (opts.tools || []).map(t => t.name), cache: opts.cache }, outcome: 'pending' };
    calls.push(rec);
    try { return await sampleRun(rec, input, opts); } finally { setTimeout(() => logCall(rec), 0); }   // after sample.json may have marked it invalid_json
  };
  const sampleRun = async (rec, input, opts) => {
    const text = reply();
    const err = window.__stubErrors.length ? window.__stubErrors.shift() : null;
    // the 150 ms wait ends early when the signal aborts during it
    await new Promise(r => {
      const t = setTimeout(r, 150);
      if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
    });
    if (opts.signal && opts.signal.aborted) { rec.outcome = 'cancelled'; throw { code: 'cancelled', message: 'aborted' }; }
    if (err && err.code) { rec.outcome = err.code; throw { code: err.code, message: 'injected by window.__stubErrors' }; }
    if (opts.onText) { const half = Math.ceil(text.length / 2); opts.onText({ text: text.slice(0, half), delta: text.slice(0, half) }); await new Promise(r => setTimeout(r, 100)); opts.onText({ text, delta: text.slice(half) }); }
    rec.outcome = 'resolved';
    return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  };
  sample.json = async (input, opts = {}) => { const r = await sample(input, opts); try { return JSON.parse(r.text); } catch { const rec = calls[calls.length - 1]; if (rec) rec.outcome = 'invalid_json'; throw { code: 'invalid_json', message: 'stub reply was not JSON', text: r.text }; } };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });

  // ---- db, user, permissions: driven by sessionStorage['holdon.test.caps'] ----
  const CAPS_KEY = 'holdon.test.caps';
  const DEFAULT_CAPS = { db: 'none', user: null, permissions: false, errors: [] };
  let caps = null;
  try { caps = JSON.parse(sessionStorage.getItem(CAPS_KEY) || 'null'); } catch { caps = null; }
  if (!caps || typeof caps !== 'object') caps = {};
  caps = { ...DEFAULT_CAPS, ...caps };
  if (!Array.isArray(caps.errors)) caps.errors = [];
  window.__stubCaps = caps;
  const dbCalls = []; window.__dbCalls = dbCalls;
  const takeError = (op) => {
    const i = caps.errors.findIndex((e) => e && (!e.op || e.op === op));
    if (i < 0) return null;
    const [e] = caps.errors.splice(i, 1);
    try { const stored = JSON.parse(sessionStorage.getItem(CAPS_KEY) || 'null'); if (stored && typeof stored === 'object') { stored.errors = caps.errors.slice(); sessionStorage.setItem(CAPS_KEY, JSON.stringify(stored)); } } catch { /* storage blocked */ }
    return e;
  };
  const freeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };
  const SEG = /^[A-Za-z0-9_\\-.~:@+]+$/;
  const checkDocPath = (p) => {
    if (typeof p !== 'string' || !p) throw new TypeError('db.doc: the path must be a non-empty string');
    const segs = p.split('/');
    if (segs.length % 2 !== 0) throw new TypeError('db.doc: a document path has an even number of segments (got ' + segs.length + ')');
    if (segs.length > 16) throw new TypeError('db.doc: at most 16 segments');
    for (const s of segs) if (!SEG.test(s) || s === '.' || s === '..') throw new TypeError('db.doc: bad segment ' + JSON.stringify(s));
  };
  const call = async (op, docPath, body) => {
    const rec = { op, path: docPath, outcome: 'pending' };
    dbCalls.push(rec);
    const err = takeError(op);
    await new Promise((r) => setTimeout(r, 5));
    if (err && err.code) {
      rec.outcome = err.code;
      try { await window.__stubDbCall('fail', docPath, { op, code: err.code }); } catch { /* node side gone */ }
      throw { code: err.code, message: 'injected by holdon.test.caps' };
    }
    if (op === 'set') {
      let json = null;
      try { json = JSON.stringify(body); } catch { json = null; }
      if (!body || typeof body !== 'object' || Array.isArray(body) || json === null || json.length > 262144) {
        rec.outcome = 'invalid_argument';
        try { await window.__stubDbCall('fail', docPath, { op, code: 'invalid_argument' }); } catch { /* node side gone */ }
        throw { code: 'invalid_argument', message: 'the body must be a plain JSON object under 256 KiB' };
      }
      await window.__stubDbCall('set', docPath, JSON.parse(json));
      rec.outcome = 'resolved';
      return undefined;
    }
    const r = await window.__stubDbCall('get', docPath, null);
    rec.outcome = 'resolved';
    return r;
  };
  const doc = (docPath) => {
    checkDocPath(docPath);
    const id = docPath.split('/').pop();
    return {
      id, path: docPath,
      get: async () => {
        const r = await call('get', docPath);
        const data = r && r.exists ? freeze(r.data) : undefined;
        return { id, exists: !!(r && r.exists), data: () => data, metadata: { fromCache: false, hasPendingWrites: false } };
      },
      set: async (body) => { await call('set', docPath, body); },
    };
  };
  const db = { doc };
  const user = {
    id: async () => (caps.user == null ? null : String(caps.user)),
    me: async () => ({ id: caps.user == null ? null : String(caps.user), name: '', avatarUrl: '', color: '', email: null, isOwner: true, canEdit: true }),
    isOwner: async () => true,
    canEdit: async () => true,
    can: async () => null,
  };
  const permissions = {
    state: async (name) => (name === 'db' ? caps.db : 'unavailable'),
    request: async () => ({ db: caps.db }),
    manage: async () => {},
  };
  window.claude = {
    use: async (name) => {
      if (name === 'sample') return sample;
      if (name === 'db') return caps.db === 'none' ? null : db;
      if (name === 'user') return user;
      if (name === 'permissions') return caps.permissions ? permissions : null;
      return null;
    },
  };
})();`;

// The one store every page of the run shares (node side).
const docs = new Map();
const dbCalls = [];
const sampleLog = [];   // every settled sample call of the run: { page, modelTier, tools, cache, outcome, bytes }
function stubDbCall(label) {
  return (op, docPath, body) => {
    if (op === 'fail') { dbCalls.push({ op: body && body.op, path: docPath, outcome: body && body.code, page: label }); return null; }
    if (op === 'get') {
      dbCalls.push({ op, path: docPath, outcome: 'resolved', page: label });
      return docs.has(docPath) ? { exists: true, data: JSON.parse(JSON.stringify(docs.get(docPath))) } : { exists: false, data: undefined };
    }
    if (op === 'set') {
      dbCalls.push({ op, path: docPath, outcome: 'resolved', page: label });
      docs.set(docPath, JSON.parse(JSON.stringify(body)));
      return null;
    }
    return null;
  };
}
const ctxDb = {
  get: (p) => (docs.has(p) ? JSON.parse(JSON.stringify(docs.get(p))) : undefined),
  set: (p, b) => { docs.set(p, JSON.parse(JSON.stringify(b))); },
  reset: () => { docs.clear(); dbCalls.length = 0; },
  calls: dbCalls,
};

async function main() {
  const t0 = Date.now();
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const scenarioFns = SCENARIOS.map((file) => ({ file, name: path.basename(file), fn: require(file) }));
  for (const s of scenarioFns) if (typeof s.fn !== 'function') throw new Error(`scenario ${s.file} does not export a function`);
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIR], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const url = `http://localhost:${PORT}/${PAGE}`;
  const browser = await chromium.launch();
  const report = { url, dir: DIR, stub: STUB, scenarios: scenarioFns.map((s) => s.name), shots: [], consoleErrors: [], pageErrors: [], failedRequests: [], sampleCalls: [], dbCalls: 0, timings: [], seconds: 0 };
  const contexts = [];
  const watch = (page, label) => {
    page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(`[${label}] ${m.text()}`); });
    page.on('pageerror', e => report.pageErrors.push(`[${label}] ${e.message}`));
    page.on('requestfailed', r => report.failedRequests.push(`[${label}] ${r.url()} ${r.failure()?.errorText}`));
  };
  try {
    for (const [vp, w, h] of [['desktop', 1280, 900], ['phone', 400, 800]]) {
      for (const scheme of ['light', 'dark']) {
        const label = `${vp}/${scheme}`;
        if (PAGES.length && !PAGES.includes(label)) continue;
        const options = { viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: vp === 'phone' };
        const page = await browser.newPage(options);
        if (STUB) {
          await page.addInitScript(STUB_SCRIPT);
          await page.exposeFunction('__stubDbCall', stubDbCall(label));
          await page.exposeFunction('__stubSampleLog', (c) => { sampleLog.push({ page: label, ...c }); return null; });
        }
        watch(page, label);
        let devices = 0;
        const newDevice = async ({ caps = null, flags = null, goto = true } = {}) => {
          devices += 1;
          const dlabel = `${label} device ${devices}`;
          const context = await browser.newContext(options);
          contexts.push(context);
          if (caps || flags) {
            // written once, before the device's first load (the marker keeps a reload from rewriting them)
            await context.addInitScript(([c, f]) => {
              try {
                if (sessionStorage.getItem('holdon.test.seeded') === '1') return;
                sessionStorage.setItem('holdon.test.seeded', '1');
                if (c) sessionStorage.setItem('holdon.test.caps', JSON.stringify(c));
                if (f) for (const [k, v] of Object.entries(f)) localStorage.setItem(k, v);
              } catch { /* storage blocked */ }
            }, [caps, flags]);
          }
          if (STUB) {
            await context.addInitScript(STUB_SCRIPT);
            await context.exposeFunction('__stubDbCall', stubDbCall(dlabel));
            await context.exposeFunction('__stubSampleLog', (c) => { sampleLog.push({ page: dlabel, ...c }); return null; });
          }
          const p = await context.newPage();
          watch(p, dlabel);
          if (goto) await p.goto(url, { waitUntil: 'networkidle' });
          let closed = false;
          return { page: p, label: dlabel, close: async () => { if (closed) return; closed = true; await context.close().catch(() => {}); } };
        };
        await page.goto(url, { waitUntil: 'networkidle' });
        if (WAIT) await page.waitForSelector(WAIT, { timeout: 60000 });
        for (const s of scenarioFns) {
          const ts = Date.now();
          await s.fn(page, { vp, scheme, report, out: OUT, url, stub: STUB, scenario: s.name, db: ctxDb, newDevice });
          report.timings.push({ scenario: s.name, viewport: vp, scheme, ms: Date.now() - ts });
        }
        await page.waitForTimeout(SETTLE);
        const file = path.join(OUT, `${vp}-${scheme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        report.shots.push({ file, viewport: vp, scheme, scrollWidth: sw, horizontalOverflow: sw > w });
        if (STUB) report.sampleCalls.push(...(await page.evaluate(() => window.__sampleCalls || [])).map(c => ({ ...c, viewport: vp, scheme })));
        await page.close();
      }
    }
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close();
    server.kill();
  }
  report.dbCalls = dbCalls.length;
  report.sampleCallsRun = sampleLog.length;
  report.seconds = Math.round((Date.now() - t0) / 100) / 10;
  report.ok = report.consoleErrors.length === 0 && report.pageErrors.length === 0 && report.failedRequests.length === 0 && !report.shots.some(s => s.horizontalOverflow);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
main().catch(e => { console.error('app_check failed:', e); process.exit(2); });
