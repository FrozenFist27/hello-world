// sync.js — the mirror document and its merge. Pure: imports contract.js only; no storage, no
// network, no DOM, no timers.
//
// The document one viewer keeps at db.doc('data/users/' + uid + '/holdon'):
//   { v: 2, updatedAt: ISO|'', games: [GameSummary], flags: { tutorialSeen, firstHoldSeen,
//     firstFloatSeen } (booleans), path: { k3, said: [string], digest: [DigestLine], shown } }
//
// merge(local, remote) is commutative and idempotent: every tie is broken by the values alone,
// never by which side a value came from (ARCHITECTURE.md 8.9, merge ties):
//   games    union by id; equal ids keep the later date, then the larger plies, then the larger
//            JSON string; sorted by date then id; trimGames
//   digest   union by id with the same tie rule; sorted; trimDigest
//   flags    OR (a flag is never cleared)
//   said     union, sorted
//   k3       the entry whose game (by gameId, in the merged games) has the later date; an entry
//            whose game is unknown loses to a known one; both unknown or equal dates: the larger
//            JSON string
//   shown    from the side with the newer updatedAt; equal: the larger JSON string; a side
//            without shown never beats one with it
//   updatedAt the later of the two
// Idempotence assumes what the page guarantees: an id is an again game or a real one for good
// (a summary is written once), so two copies of one id always fall in the same trim class.

import { KEEP, PATH } from './contract.js';

const FLAG_NAMES = ['tutorialSeen', 'firstHoldSeen', 'firstFloatSeen'];

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function hasId(x) {
  return isObj(x) && ((typeof x.id === 'string' && x.id !== '') || Number.isFinite(x.id));
}
// A deep copy through JSON: the store hands out frozen snapshots and a body must be plain JSON.
// A value JSON cannot carry comes back as null.
function plain(x) {
  try {
    const s = JSON.stringify(x);
    return s === undefined ? null : JSON.parse(s);
  } catch {
    return null;
  }
}
function json(x) {
  try {
    const s = JSON.stringify(x);
    return s === undefined ? '' : s;
  } catch {
    return '';
  }
}
function timeOf(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function finiteOr(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
// Date ascending, then id (as a string) ascending.
function byDateThenId(a, b) {
  return cmp(timeOf(a.date), timeOf(b.date)) || cmp(String(a.id), String(b.id));
}
// The copy kept when one id appears twice: the later date, then the larger plies, then the
// larger JSON string. Symmetric: better(a, b) and better(b, a) pick the same value.
function better(a, b) {
  const byDate = cmp(timeOf(a.date), timeOf(b.date));
  if (byDate) return byDate > 0 ? a : b;
  const byPlies = cmp(finiteOr(a.plies, -Infinity), finiteOr(b.plies, -Infinity));
  if (byPlies) return byPlies > 0 ? a : b;
  return json(a) >= json(b) ? a : b;
}
function unionById(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const item of list) {
      const key = String(item.id);
      const had = byId.get(key);
      byId.set(key, had ? better(had, item) : item);
    }
  }
  return [...byId.values()].sort(byDateThenId);
}

function emptyDoc() {
  return {
    v: 2,
    updatedAt: '',
    games: [],
    flags: { tutorialSeen: false, firstHoldSeen: false, firstFloatSeen: false },
    path: { k3: null, said: [], digest: [], shown: null },
  };
}

// A missing, partial or junk document becomes a whole one; arrays keep only objects with an id
// (said keeps only strings); every value is a fresh plain copy.
export function normaliseDoc(doc) {
  const out = emptyDoc();
  const d = isObj(doc) ? plain(doc) : null;
  if (!isObj(d)) return out;
  if (typeof d.updatedAt === 'string') out.updatedAt = d.updatedAt;
  if (Array.isArray(d.games)) out.games = d.games.filter(hasId);
  const flags = isObj(d.flags) ? d.flags : {};
  for (const name of FLAG_NAMES) out.flags[name] = flags[name] === true;
  const p = isObj(d.path) ? d.path : {};
  out.path.k3 = isObj(p.k3) ? p.k3 : null;
  out.path.said = Array.isArray(p.said) ? [...new Set(p.said.filter((s) => typeof s === 'string'))] : [];
  out.path.digest = Array.isArray(p.digest) ? p.digest.filter(hasId) : [];
  out.path.shown = isObj(p.shown) ? p.shown : null;
  return out;
}

// Sort by date ascending then id; keep the newest KEEP.GAMES games with again falsy and the
// newest KEEP.AGAIN_GAMES with again true; return them in date order.
export function trimGames(games) {
  const list = (Array.isArray(games) ? games : []).filter(isObj).slice().sort(byDateThenId);
  const real = list.filter((g) => !g.again);
  const again = list.filter((g) => g.again);
  const keep = new Set([
    ...real.slice(Math.max(0, real.length - KEEP.GAMES)),
    ...again.slice(Math.max(0, again.length - KEEP.AGAIN_GAMES)),
  ]);
  return list.filter((g) => keep.has(g));
}

// The newest PATH.DIGEST_MAX lines by date then id, in date order.
export function trimDigest(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter(isObj).slice().sort(byDateThenId);
  return list.slice(Math.max(0, list.length - PATH.DIGEST_MAX));
}

function pickK3(a, b, games) {
  if (!a) return b;
  if (!b) return a;
  const dates = new Map(games.map((g) => [String(g.id), timeOf(g.date)]));
  const da = dates.has(String(a.gameId)) ? dates.get(String(a.gameId)) : null;
  const db = dates.has(String(b.gameId)) ? dates.get(String(b.gameId)) : null;
  if (da !== null && db !== null && da !== db) return da > db ? a : b;
  if (da !== null && db === null) return a;
  if (db !== null && da === null) return b;
  return json(a) >= json(b) ? a : b;
}

function pickShown(a, b) {
  if (!a.shown) return b.shown;
  if (!b.shown) return a.shown;
  const byTime = cmp(timeOf(a.updatedAt), timeOf(b.updatedAt)) || cmp(a.updatedAt, b.updatedAt);
  if (byTime) return byTime > 0 ? a.shown : b.shown;
  return json(a.shown) >= json(b.shown) ? a.shown : b.shown;
}

function laterStamp(a, b) {
  const byTime = cmp(timeOf(a), timeOf(b)) || cmp(a, b);
  return byTime >= 0 ? a : b;
}

export function merge(local, remote) {
  const a = normaliseDoc(local);
  const b = normaliseDoc(remote);
  const games = trimGames(unionById(a.games, b.games));
  const digest = trimDigest(unionById(a.path.digest, b.path.digest));
  const flags = {};
  for (const name of FLAG_NAMES) flags[name] = a.flags[name] || b.flags[name];
  const said = [...new Set([...a.path.said, ...b.path.said])].sort();
  const k3 = pickK3(a.path.k3, b.path.k3, games);
  const shown = pickShown({ updatedAt: a.updatedAt, shown: a.path.shown }, { updatedAt: b.updatedAt, shown: b.path.shown });
  return plain({
    v: 2,
    updatedAt: laterStamp(a.updatedAt, b.updatedAt),
    games,
    flags,
    path: { k3, said, digest, shown },
  });
}
