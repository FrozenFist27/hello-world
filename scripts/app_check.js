#!/usr/bin/env node
// Headless check for the chess app: serves a directory over HTTP, opens a page in Chromium with
// a stub of the claude.ai `sample` capability, screenshots desktop + phone in light + dark, and
// reports console errors, page errors and failed requests as JSON.
//
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/app_check.js \
//     [--dir app] [--page index.html] [--out /tmp/shots] [--port 8787] [--no-stub] \
//     [--wait "#selector"] [--script path/to/scenario.js] [--settle 800]
//
// The scenario file (optional) exports `async (page, ctx) => {...}` and runs after load, before the
// screenshots; use it to click through a flow. The stub records every sample() call on
// window.__sampleCalls and streams canned text; set window.__stubReplies = ["..."] from the scenario
// to control what "Claude" says.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const DIR = path.resolve(arg('--dir', 'app'));
const PAGE = arg('--page', 'index.html');
const OUT = path.resolve(arg('--out', '/tmp/app-check'));
const PORT = Number(arg('--port', '8787'));
const WAIT = arg('--wait', null);
const SCENARIO = arg('--script', null);
const SETTLE = Number(arg('--settle', '800'));
const STUB = !process.argv.includes('--no-stub');

const STUB_SCRIPT = `
(() => {
  const calls = []; window.__sampleCalls = calls; window.__stubReplies = window.__stubReplies || [];
  const reply = () => (window.__stubReplies.length ? window.__stubReplies.shift() : 'Stub coach: this is canned text standing in for Claude. The real page asks Claude through the sample capability.');
  const sample = async (input, opts = {}) => {
    calls.push({ input, opts: { modelTier: opts.modelTier, tools: (opts.tools || []).map(t => t.name), cache: opts.cache } });
    const text = reply();
    await new Promise(r => setTimeout(r, 150));
    if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'aborted' };
    if (opts.onText) { const half = Math.ceil(text.length / 2); opts.onText({ text: text.slice(0, half), delta: text.slice(0, half) }); await new Promise(r => setTimeout(r, 100)); opts.onText({ text, delta: text.slice(half) }); }
    return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
  };
  sample.json = async (input, opts = {}) => { const r = await sample(input, opts); try { return JSON.parse(r.text); } catch { throw { code: 'invalid_json', message: 'stub reply was not JSON', text: r.text }; } };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
  window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
})();`;

async function main() {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', DIR], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const url = `http://localhost:${PORT}/${PAGE}`;
  const browser = await chromium.launch();
  const report = { url, dir: DIR, stub: STUB, shots: [], consoleErrors: [], pageErrors: [], failedRequests: [], sampleCalls: [] };
  try {
    for (const [vp, w, h] of [['desktop', 1280, 900], ['phone', 400, 800]]) {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: vp === 'phone' });
        if (STUB) await page.addInitScript(STUB_SCRIPT);
        page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(`[${vp}/${scheme}] ${m.text()}`); });
        page.on('pageerror', e => report.pageErrors.push(`[${vp}/${scheme}] ${e.message}`));
        page.on('requestfailed', r => report.failedRequests.push(`[${vp}/${scheme}] ${r.url()} ${r.failure()?.errorText}`));
        await page.goto(url, { waitUntil: 'networkidle' });
        if (WAIT) await page.waitForSelector(WAIT, { timeout: 60000 });
        if (SCENARIO) { const fn = require(path.resolve(SCENARIO)); await fn(page, { vp, scheme, report }); }
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
    await browser.close();
    server.kill();
  }
  report.ok = report.consoleErrors.length === 0 && report.pageErrors.length === 0 && report.failedRequests.length === 0 && !report.shots.some(s => s.horizontalOverflow);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
main().catch(e => { console.error('app_check failed:', e); process.exit(2); });
