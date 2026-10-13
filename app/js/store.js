// store.js — localStorage behind try/catch. A private window, blocked storage or a full quota
// never throws out of here: reads return the fallback, writes return false.
//
// Values: strings are stored as they are (flags are the literal string '1', the theme is 'light'
// or 'dark'); objects, arrays and numbers are JSON-encoded. On a read, a value that starts with
// '{' or '[' is JSON-decoded; otherwise the raw string comes back, except that a numeric fallback
// decodes the value as a number (so get(KEYS.GIFT_RATE, 0.12) is a number while
// get(KEYS.TUTORIAL_SEEN) is the string '1'). That is the one rule that keeps the flags literal
// and the gift-rate notch numeric without the store knowing the keys.
//
// Iteration two: append(KEYS.GAMES) without a max keeps sync.trimGames (KEEP.GAMES newest
// non-again games plus KEEP.AGAIN_GAMES newest again games); giftRateFallback() reads the v1 notch
// once and never writes it; localDoc() / applyDoc() map the keys to the mirror document of
// ARCHITECTURE.md 8.3; mirror() keeps that document in the viewer's own db subtree.

import { KEYS, KEEP, BOT } from './contract.js';
import * as sync from './sync.js';

const DEFAULT_MAX = { [KEYS.HOLDS]: KEEP.HOLDS };

let giftRateMemo = null;

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function same(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
// A list of objects with ids as an order-free value: [[id, JSON]] sorted by id.
function byId(list) {
  return list.map((x) => [String(x.id), JSON.stringify(x)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

function storage() {
  // localStorage itself can throw on access (blocked site data); the caller wraps this.
  const s = globalThis.localStorage;
  return s && typeof s.getItem === 'function' ? s : null;
}

function decode(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  if (/^\s*[[{]/.test(raw)) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  if (typeof fallback === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n : fallback;
  }
  if (typeof fallback === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : fallback;
  return raw;
}

function encode(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export const store = {
  get(key, fallback = null) {
    try {
      const s = storage();
      if (!s) return fallback;
      const raw = s.getItem(String(key));
      if (raw == null) return fallback;
      return decode(raw, fallback);
    } catch {
      return fallback;
    }
  },

  // true when the value was written.
  set(key, value) {
    try {
      const s = storage();
      if (!s) return false;
      if (value === undefined || value === null) { s.removeItem(String(key)); return true; }
      const encoded = encode(value);
      if (typeof encoded !== 'string') return false;
      s.setItem(String(key), encoded);
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      const s = storage();
      if (s) s.removeItem(String(key));
      return true;
    } catch {
      return false;
    }
  },

  // The stored array, or [] when the key is absent, not an array, or unreadable.
  list(key) {
    const v = this.get(key, []);
    return Array.isArray(v) ? v : [];
  },

  // Appends and keeps the last `max` items. With max omitted: KEYS.GAMES keeps sync.trimGames
  // (date order), KEYS.HOLDS the last KEEP.HOLDS, any other key everything. Returns the array
  // that was kept, even when the write failed.
  append(key, item, max) {
    let arr = this.list(key);
    arr.push(item);
    const explicit = typeof max === 'number' && max > 0;
    if (!explicit && key === KEYS.GAMES) {
      arr = sync.trimGames(arr);
    } else {
      const cap = explicit ? max : DEFAULT_MAX[key] || 0;
      if (cap > 0) while (arr.length > cap) arr.shift();
    }
    this.set(key, arr);
    return arr;
  },

  // The v1 gift-rate notch, read once per page load: BOT.GIFT_RATE when absent or outside [0, 1].
  // Never written: the notch follows the path now (plan.giftRate).
  giftRateFallback() {
    if (giftRateMemo === null) {
      const v = Number(this.get(KEYS.GIFT_RATE, BOT.GIFT_RATE));
      giftRateMemo = Number.isFinite(v) && v >= 0 && v <= 1 ? v : BOT.GIFT_RATE;
    }
    return giftRateMemo;
  },

  // The local keys as the mirror document (normalised by sync.normaliseDoc).
  localDoc() {
    const flag = (k) => String(this.get(k, '')) === '1';
    const p = this.get(KEYS.PATH, null);
    const at = this.get(KEYS.SYNC, null);
    return sync.normaliseDoc({
      v: 2,
      updatedAt: isObj(at) && typeof at.at === 'string' ? at.at : '',
      games: this.list(KEYS.GAMES),
      flags: {
        tutorialSeen: flag(KEYS.TUTORIAL_SEEN),
        firstHoldSeen: flag(KEYS.FIRST_HOLD_SEEN),
        firstFloatSeen: flag(KEYS.FIRST_FLOAT_SEEN),
      },
      path: isObj(p) ? { k3: p.k3, said: p.said, digest: p.digest, shown: p.shown } : {},
    });
  },

  // Writes a mirror document into the local keys: KEYS.GAMES, the three flags (a true flag
  // writes '1'; a flag is never cleared), KEYS.PATH { v: 1, k3, said, digest, shown }. A key is
  // written only when its content differs (the order of the games, the digest lines or said
  // alone is no change). Returns whether anything changed.
  applyDoc(doc) {
    const d = sync.normaliseDoc(doc);
    const here = this.localDoc();
    let changed = false;
    if (!same(byId(here.games), byId(d.games))) {
      this.set(KEYS.GAMES, d.games);
      changed = true;
    }
    const flagKeys = { tutorialSeen: KEYS.TUTORIAL_SEEN, firstHoldSeen: KEYS.FIRST_HOLD_SEEN, firstFloatSeen: KEYS.FIRST_FLOAT_SEEN };
    for (const [name, key] of Object.entries(flagKeys)) {
      if (d.flags[name] && !here.flags[name]) {
        this.set(key, '1');
        changed = true;
      }
    }
    const pathKey = (x) => ({ k3: x.k3, said: [...x.said].sort(), digest: byId(x.digest), shown: x.shown });
    if (!same(pathKey(here.path), pathKey(d.path))) {
      this.set(KEYS.PATH, { v: 1, k3: d.path.k3, said: d.path.said, digest: d.path.digest, shown: d.path.shown });
      changed = true;
    }
    return changed;
  },

  mirror(opts) {
    return createMirror(this, opts);
  },
};

// ---------------------------------------------------------------------------------------------
// The mirror: one document per viewer in the db capability, merged with the local keys.
//
//   boot()   no db or no identity namespace, or a null id: local only. permissions.state('db'):
//            'granted' reads now (and writes back what the remote lacks); 'prompt', an unknown
//            state or no permissions namespace defers to the first sync(); 'denied' or
//            'unavailable': local only.
//   sync()   on one promise chain for the document: get (one retry after 1000-2000 ms on
//            'unavailable'), merge, applyDoc, onMerged when the read brought news (games,
//            digest lines, flags or said entries the local keys lacked),
//            then set unless the view is read-only. A set always follows a successful get on
//            the same task, so no view ever writes before it has read.
//   errors   invalid_argument and transform_error: read-only for the view (reads go on);
//            quota_exceeded, resource_exhausted, revoked, not_granted, capability_disabled,
//            capability_removed: the mirror stops for the view; any other code is 'unavailable'.
// No onSnapshot. Every call is in try/catch and nothing is ever said about any of it.
// ---------------------------------------------------------------------------------------------
const DOC_PREFIX = 'data/users/';
const DOC_NAME = '/holdon';
const DOC_MAX_BYTES = 250 * 1024;   // a body is at most 256 KiB serialized
const RETRY_MIN_MS = 1000;
const RETRY_SPAN_MS = 1000;
const READ_ONLY_CODES = ['invalid_argument', 'transform_error'];
const STOP_CODES = ['quota_exceeded', 'resource_exhausted', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed'];

function errorKind(e) {
  const code = e && typeof e.code === 'string' ? e.code : 'unavailable';
  if (READ_ONLY_CODES.includes(code)) return 'readonly';
  if (STOP_CODES.includes(code)) return 'stop';
  return 'unavailable';
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function retryDelay() {
  return RETRY_MIN_MS + Math.floor(Math.random() * RETRY_SPAN_MS);
}
// What a merge can bring that the page acts on: the games, the digest, the flags, said.
function news(doc) {
  return JSON.stringify({ games: byId(doc.games), digest: byId(doc.path.digest), flags: doc.flags, said: [...doc.path.said].sort() });
}
// The document without its stamp and its shown (neither alone is worth a write).
function content(doc) {
  return JSON.stringify({ games: doc.games, flags: doc.flags, k3: doc.path.k3, said: doc.path.said, digest: doc.path.digest });
}

function createMirror(local, { db = null, user = null, permissions = null, onMerged = null } = {}) {
  const st = { uid: null, state: null, readDone: false, readOnly: false, stopped: false, pending: 0 };
  let ref = null;
  let bootPromise = null;
  let chain = Promise.resolve();

  function enqueue(task) {
    st.pending += 1;
    const run = chain.then(task).catch(() => (st.stopped ? 'stopped' : 'skipped'));
    chain = run.then(() => {}, () => {});
    return run.finally(() => { st.pending -= 1; });
  }

  // { ok: true, data: body|null } after a successful read (a missing document is data null).
  async function read() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const snap = await ref.get();
        let data = null;
        if (snap && snap.exists && typeof snap.data === 'function') data = snap.data();
        return { ok: true, data: isObj(data) ? data : null };
      } catch (e) {
        const kind = errorKind(e);
        if (kind === 'readonly') { st.readOnly = true; return { ok: false }; }
        if (kind === 'stop') { st.stopped = true; return { ok: false }; }
        if (attempt === 0) await wait(retryDelay());
      }
    }
    return { ok: false };
  }

  async function write(body) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await ref.set(body);
        return true;
      } catch (e) {
        const kind = errorKind(e);
        if (kind === 'readonly') { st.readOnly = true; return false; }
        if (kind === 'stop') { st.stopped = true; return false; }
        if (attempt === 0) await wait(retryDelay());
      }
    }
    return false;
  }

  function stamp(at) {
    try { local.set(KEYS.SYNC, { uid: st.uid, at }); } catch { /* local only */ }
  }

  // One read-merge-write pass. The set is skipped when the remote already holds everything the
  // merge holds (its stamp and shown aside): a write only when the data changed.
  async function pass() {
    if (st.stopped || !ref) return 'stopped';
    const got = await read();
    if (!got.ok) return st.stopped ? 'stopped' : 'skipped';
    st.readDone = true;
    const remote = got.data ? sync.normaliseDoc(got.data) : null;
    const here = local.localDoc();
    const merged = sync.merge(here, remote);
    // shown is this device's: the stages its own opening lines were planned against. It stays
    // local while it has one; the document carries the latest writer's.
    if (here.path.shown) merged.path.shown = here.path.shown;
    // changed: the remote brought games, digest lines, flags or said entries the local keys
    // lacked. A k3 alone is no news: a local k3 the page dropped (its look is no longer current)
    // comes back from the document, harmless (plan() revalidates it) and not worth onMerged,
    // which resets shown and would cost the next opening line its announcement.
    let changed = false;
    try {
      const was = news(here);
      if (local.applyDoc(merged)) changed = news(local.localDoc()) !== was;
    } catch { changed = false; }
    stamp(new Date().toISOString());
    if (changed && typeof onMerged === 'function') {
      try { await onMerged({ changed }); } catch { /* the local plan stands */ }
      try {
        const after = local.localDoc().path.shown;
        if (after) merged.path.shown = after;
      } catch { /* keep the merged shown */ }
    }
    if (st.readOnly) return changed ? 'merged' : 'readonly';
    if (remote && content(remote) === content(merged)) return changed ? 'merged' : 'written';
    const body = { ...merged, updatedAt: new Date().toISOString() };
    let size = Infinity;
    try { size = new TextEncoder().encode(JSON.stringify(body)).length; } catch { size = Infinity; }
    if (size > DOC_MAX_BYTES) return changed ? 'merged' : 'skipped';
    const wrote = await write(body);
    if (wrote) stamp(body.updatedAt);
    if (st.stopped) return 'stopped';
    if (changed) return 'merged';
    if (wrote) return 'written';
    return st.readOnly ? 'readonly' : 'skipped';
  }

  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      try {
        if (!db || typeof db.doc !== 'function' || !user || typeof user.id !== 'function') { st.stopped = true; return; }
        let uid = null;
        try { uid = await user.id(); } catch { uid = null; }
        if (typeof uid !== 'string' || uid === '') { st.stopped = true; return; }
        try { ref = db.doc(DOC_PREFIX + uid + DOC_NAME); } catch { ref = null; }
        if (!ref || typeof ref.get !== 'function' || typeof ref.set !== 'function') { st.stopped = true; return; }
        st.uid = uid;
        let state = 'prompt';
        if (permissions && typeof permissions.state === 'function') {
          try { state = await permissions.state('db'); } catch { state = 'unavailable'; }
        }
        st.state = typeof state === 'string' ? state : 'prompt';
        if (st.state === 'denied' || st.state === 'unavailable') { st.stopped = true; return; }
        if (st.state === 'granted') await enqueue(() => pass());
      } catch {
        st.stopped = true;
      }
    })();
    return bootPromise;
  }

  async function syncNow() {
    try {
      await boot();
      if (st.stopped) return 'stopped';
      return await enqueue(() => pass());
    } catch {
      return st.stopped ? 'stopped' : 'skipped';
    }
  }

  return {
    boot,
    sync: syncNow,
    status: () => ({ ...st }),
  };
}

export default store;
