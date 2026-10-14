#!/usr/bin/env node
// test_sync.mjs — node test for the store group: app/js/sync.js and the iteration-two parts of
// app/js/store.js.
//   node /home/user/hello-world/scripts/test_sync.mjs      (exit 0 on success, 1 on the first failure)
//
// (a) normaliseDoc on null, {}, junk and a partial document; (b) trimGames and trimDigest;
// (c) merge: commutative and idempotent over fixtures with overlapping ids, again games and
// differing updatedAt; the tie rules; the trim; flags OR; said union; the digest cap; k3 by the
// game's date; shown by updatedAt; (d) store.js over a fake localStorage: append's trim rule,
// giftRateFallback, localDoc / applyDoc; (e) store.mirror over a fake db: the boot states, get
// before set on every path, the deferred read, the error map, the retry, one chain per document.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', 'app');
const imp = (p) => import(path.join(APP, p));

const C = await imp('js/contract.js');
const S = await imp('js/sync.js');

let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
}
const ids = (list) => list.map((x) => x.id);

// Fixtures: game i is dated i days after a fixed epoch.
const EPOCH = Date.parse('2026-09-01T10:00:00.000Z');
const DAY = 86400000;
const iso = (i) => new Date(EPOCH + i * DAY).toISOString();
function game(i, extra = {}) {
  return { v: 2, id: `g${String(i).padStart(3, '0')}`, date: iso(i), result: 'giveup', plies: 30, holds: [], observed: 15, again: false, ...extra };
}
function line(i, extra = {}) {
  return { id: `g${String(i).padStart(4, '0')}`, date: iso(i), result: 'giveup', observed: 22, again: false, captures: 1, escapes: 0, gifts: { offered: 0, taken: 0 }, looks: {}, ...extra };
}
function doc({ games = [], digest = [], flags = {}, said = [], k3 = null, shown = null, updatedAt = '' } = {}) {
  return {
    v: 2, updatedAt, games,
    flags: { tutorialSeen: false, firstHoldSeen: false, firstFloatSeen: false, ...flags },
    path: { k3, said, digest, shown },
  };
}
const EMPTY = {
  v: 2, updatedAt: '', games: [],
  flags: { tutorialSeen: false, firstHoldSeen: false, firstFloatSeen: false },
  path: { k3: null, said: [], digest: [], shown: null },
};

// ------------------------------------------------------------------------------------------
// (a) normaliseDoc
// ------------------------------------------------------------------------------------------
{
  eq(S.normaliseDoc(null), EMPTY, 'normaliseDoc(null)');
  eq(S.normaliseDoc(undefined), EMPTY, 'normaliseDoc(undefined)');
  eq(S.normaliseDoc({}), EMPTY, 'normaliseDoc({})');
  for (const junk of [42, 'doc', [], [1, 2], true, () => 1]) eq(S.normaliseDoc(junk), EMPTY, `normaliseDoc(${typeof junk} junk)`);
  const partial = S.normaliseDoc({
    updatedAt: 7,
    games: [game(1), null, 3, 'x', [], { date: iso(2) }, { id: '' }, { id: 5, date: iso(3) }],
    flags: { tutorialSeen: true, firstHoldSeen: '1', firstFloatSeen: 1 },
    path: { k3: [], said: ['off:pawns', 3, null, 'off:pawns', 'nc:x'], digest: [line(1), { id: null }, 'z'], shown: [] },
  });
  eq(ids(partial.games), ['g001', 5], 'games keep only objects with an id');
  ok(partial.updatedAt === '', 'a non-string updatedAt becomes empty');
  eq(partial.flags, { tutorialSeen: true, firstHoldSeen: false, firstFloatSeen: false }, 'flags are true only when true');
  ok(partial.path.k3 === null && partial.path.shown === null, 'k3 and shown must be objects');
  eq(partial.path.said, ['off:pawns', 'nc:x'], 'said keeps distinct strings');
  eq(ids(partial.path.digest), ['g0001'], 'digest keeps only objects with an id');
  const src = doc({ games: [game(1)] });
  const n = S.normaliseDoc(src);
  n.games[0].plies = 99;
  ok(src.games[0].plies === 30, 'normaliseDoc copies: the input is never shared');
  const frozen = Object.freeze({ games: Object.freeze([Object.freeze(game(2))]) });
  ok(S.normaliseDoc(frozen).games[0].id === 'g002', 'a frozen snapshot normalises');
  console.log('normaliseDoc: ok');
}

// ------------------------------------------------------------------------------------------
// (b) trimGames, trimDigest
// ------------------------------------------------------------------------------------------
{
  const real = Array.from({ length: 16 }, (_, i) => game(i * 2));
  const again = Array.from({ length: 5 }, (_, i) => game(i * 2 + 21, { again: true }));
  const shuffled = [...real, ...again].sort((a, b) => (a.id.charCodeAt(3) * 7 % 11) - (b.id.charCodeAt(3) * 7 % 11));
  const kept = S.trimGames(shuffled);
  ok(kept.length === C.KEEP.GAMES + C.KEEP.AGAIN_GAMES, `trim keeps ${C.KEEP.GAMES} + ${C.KEEP.AGAIN_GAMES}`);
  eq(ids(kept.filter((g) => !g.again)), ids(real.slice(-C.KEEP.GAMES)), 'the newest real games are kept');
  eq(ids(kept.filter((g) => g.again)), ids(again.slice(-C.KEEP.AGAIN_GAMES)), 'the three newest again games are kept');
  ok(kept.every((g, i) => i === 0 || Date.parse(kept[i - 1].date) <= Date.parse(g.date)), 'trimGames returns date order');
  eq(ids(S.trimGames([game(3), game(1), game(2)])), ['g001', 'g002', 'g003'], 'a short list is sorted, nothing dropped');
  eq(S.trimGames(null), [], 'trimGames(null) is []');
  eq(ids(S.trimGames([game(1), 7, null, game(0)])), ['g000', 'g001'], 'non-objects are dropped');
  const sameDate = [game(1, { id: 'b' }), game(1, { id: 'a' })];
  eq(ids(S.trimGames(sameDate)), ['a', 'b'], 'equal dates sort by id');
  const onlyAgain = Array.from({ length: 6 }, (_, i) => game(i, { again: true }));
  eq(ids(S.trimGames(onlyAgain)), ids(onlyAgain.slice(-3)), 'more than three again games: the three newest');
  const lines = Array.from({ length: 250 }, (_, i) => line(i)).reverse();
  const d = S.trimDigest(lines);
  ok(d.length === C.PATH.DIGEST_MAX, 'trimDigest caps at PATH.DIGEST_MAX');
  ok(d[0].id === 'g0050' && d[d.length - 1].id === 'g0249', 'trimDigest keeps the newest, in date order');
  eq(S.trimDigest(undefined), [], 'trimDigest(undefined) is []');
  console.log('trim: ok');
}

// ------------------------------------------------------------------------------------------
// (c) merge
// ------------------------------------------------------------------------------------------
{
  const A = doc({
    updatedAt: '2026-10-01T09:00:00.000Z',
    games: [game(1), game(2), game(3, { plies: 40 }), game(5, { again: true }), game(6)],
    digest: [line(1), line(2), line(3)],
    flags: { tutorialSeen: true },
    said: ['off:pawns', 'nc:g002'],
    k3: { gameId: 'g006', nodeId: 'takers', next: 'from a' },
    shown: { pawns: 'off', takers: 'asking' },
  });
  const B = doc({
    updatedAt: '2026-10-02T09:00:00.000Z',
    games: [game(2), game(3, { plies: 50 }), game(4), game(6, { date: iso(7), result: 'resign' }), game(8, { again: true })],
    digest: [line(3), line(4), line(5)],
    flags: { firstFloatSeen: true },
    said: ['off:takers', 'nc:g002'],
    k3: { gameId: 'g004', nodeId: 'pawns', next: 'from b' },
    shown: { pawns: 'quiet', takers: 'asking' },
  });
  const ab = S.merge(A, B);
  const ba = S.merge(B, A);
  eq(ab, ba, 'merge is commutative');
  eq(S.merge(A, ab), ab, 'merge(a, merge(a, b)) is merge(a, b)');
  eq(S.merge(B, ab), ab, 'merge(b, merge(a, b)) is merge(a, b)');
  eq(S.merge(ab, ab), ab, 'merge of a merged doc with itself is itself');
  eq(S.merge(A, A), S.normaliseDoc({ ...A, games: S.trimGames(A.games), path: { ...A.path, said: [...A.path.said].sort() } }), 'merge(a, a) is a, sorted');
  eq(ids(ab.games), ['g001', 'g002', 'g003', 'g004', 'g005', 'g006', 'g008'], 'games: the union by id, by date');
  const g6 = ab.games.find((g) => g.id === 'g006');
  ok(g6.result === 'resign' && g6.date === iso(7), 'equal ids keep the later date');
  ok(ab.games.find((g) => g.id === 'g003').plies === 50, 'equal ids and dates keep the larger plies');
  const x1 = game(9, { result: 'draw' });
  const x2 = game(9, { result: 'resign' });
  const t1 = S.merge(doc({ games: [x1] }), doc({ games: [x2] }));
  const t2 = S.merge(doc({ games: [x2] }), doc({ games: [x1] }));
  eq(t1, t2, 'the JSON tie-break is commutative');
  ok(t1.games[0].result === (JSON.stringify(x1) > JSON.stringify(x2) ? 'draw' : 'resign'), 'equal date and plies keep the larger JSON');
  ok(t1.games.length === 1, 'one copy per id');
  eq(ids(ab.path.digest), ['g0001', 'g0002', 'g0003', 'g0004', 'g0005'], 'digest: the union by id, by date');
  eq(ab.flags, { tutorialSeen: true, firstHoldSeen: false, firstFloatSeen: true }, 'flags OR');
  eq(ab.path.said, ['nc:g002', 'off:pawns', 'off:takers'], 'said: the union, sorted');
  ok(ab.path.k3.gameId === 'g006' && ab.path.k3.next === 'from a', 'k3: the entry of the newer game (g006 is dated later than g004)');
  eq(ab.path.shown, B.path.shown, 'shown: from the newer updatedAt');
  ok(ab.updatedAt === B.updatedAt, 'updatedAt: the later');
  ok(ab.v === 2, 'v 2');

  // k3: a known game beats an unknown one; both unknown: the larger JSON, either way round
  const kA = doc({ games: [game(1)], k3: { gameId: 'gone', next: 'z' } });
  const kB = doc({ games: [game(1)], k3: { gameId: 'g001', next: 'a' } });
  ok(S.merge(kA, kB).path.k3.gameId === 'g001' && S.merge(kB, kA).path.k3.gameId === 'g001', 'k3: an entry whose game is unknown loses');
  const u1 = { gameId: 'x1', next: 'one' };
  const u2 = { gameId: 'x2', next: 'two' };
  const uu = S.merge(doc({ k3: u1 }), doc({ k3: u2 }));
  eq(uu, S.merge(doc({ k3: u2 }), doc({ k3: u1 })), 'k3 with both games unknown is commutative');
  eq(uu.path.k3, JSON.stringify(u1) > JSON.stringify(u2) ? u1 : u2, 'k3 with both unknown: the larger JSON');
  ok(S.merge(doc({ k3: u1 }), doc()).path.k3.gameId === 'x1', 'k3: one side null keeps the other');
  ok(S.merge(doc(), doc()).path.k3 === null, 'k3: both null is null');

  // shown: equal updatedAt -> the larger JSON; one side without shown never wins
  const s1 = { pawns: 'off' };
  const s2 = { pawns: 'quiet' };
  const at = '2026-10-03T00:00:00.000Z';
  const ss = S.merge(doc({ updatedAt: at, shown: s1 }), doc({ updatedAt: at, shown: s2 }));
  eq(ss.path.shown, JSON.stringify(s1) > JSON.stringify(s2) ? s1 : s2, 'shown with equal updatedAt: the larger JSON');
  eq(ss, S.merge(doc({ updatedAt: at, shown: s2 }), doc({ updatedAt: at, shown: s1 })), 'shown tie is commutative');
  eq(S.merge(doc({ updatedAt: '2026-10-09T00:00:00.000Z' }), doc({ updatedAt: at, shown: s1 })).path.shown, s1, 'a newer side without shown keeps the other side\'s');
  ok(S.merge(doc({ updatedAt: '' }), doc({ updatedAt: at })).updatedAt === at, 'an empty updatedAt is the older');

  // the trim over a union: twelve real plus three again
  const L = doc({ games: [...Array.from({ length: 10 }, (_, i) => game(i)), ...[20, 21].map((i) => game(i, { again: true }))] });
  const R = doc({ games: [...Array.from({ length: 10 }, (_, i) => game(i + 5)), ...[22, 23].map((i) => game(i, { again: true }))] });
  const lr = S.merge(L, R);
  ok(lr.games.filter((g) => !g.again).length === 12 && lr.games.filter((g) => g.again).length === 3, 'the union is trimmed to 12 real plus 3 again');
  eq(ids(lr.games.filter((g) => !g.again)), ids(Array.from({ length: 12 }, (_, i) => game(i + 3))), 'the newest 12 real games survive');
  eq(ids(lr.games.filter((g) => g.again)), ['g021', 'g022', 'g023'], 'the newest 3 again games survive');
  eq(lr, S.merge(R, L), 'the trimmed union is commutative');
  eq(S.merge(L, lr), lr, 'the trimmed union is idempotent');

  // a 250-line digest union caps at 200 newest
  const D1 = doc({ digest: Array.from({ length: 150 }, (_, i) => line(i)) });
  const D2 = doc({ digest: Array.from({ length: 150 }, (_, i) => line(i + 100)) });
  const dd = S.merge(D1, D2);
  ok(dd.path.digest.length === 200, 'a 250-line digest union caps at 200');
  ok(dd.path.digest[0].id === 'g0050' && dd.path.digest[199].id === 'g0249', 'the 200 newest lines, in date order');
  eq(dd, S.merge(D2, D1), 'the digest cap is commutative');
  eq(S.merge(D1, dd), dd, 'the digest cap is idempotent');
  const dl1 = line(3, { observed: 10 });
  const dl2 = line(3, { observed: 30, date: iso(4) });
  ok(S.merge(doc({ digest: [dl1] }), doc({ digest: [dl2] })).path.digest[0].observed === 30, 'digest: equal ids keep the later date');

  // merge with junk on either side is the other side normalised
  eq(S.merge(A, null), S.merge(A, {}), 'a null remote is an empty one');
  eq(S.merge(null, null), EMPTY, 'merge(null, null) is the empty document');
  eq(S.merge('junk', B), S.merge(B, undefined), 'junk on either side');

  // a seeded random sweep: commutative and idempotent over many overlapping fixtures
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let t = 0; t < 200; t++) {
    const mk = () => doc({
      updatedAt: rnd(3) ? iso(rnd(30)) : '',
      // a game id is an again game or not for good (a summary is written once, by one device)
      games: Array.from({ length: rnd(18) }, () => { const i = rnd(25); return game(i, { again: i % 5 === 0, plies: rnd(3) * 10, result: ['giveup', 'draw', 'resign'][rnd(3)], ...(rnd(4) ? {} : { date: iso(i + 1) }) }); }),
      digest: Array.from({ length: rnd(30) }, () => line(rnd(40), { observed: rnd(3) })),
      flags: { tutorialSeen: rnd(2) === 0, firstHoldSeen: rnd(2) === 0, firstFloatSeen: rnd(2) === 0 },
      said: Array.from({ length: rnd(4) }, () => `nc:g${rnd(9)}`),
      k3: rnd(3) ? { gameId: `g${String(rnd(25)).padStart(3, '0')}`, next: `n${rnd(4)}` } : null,
      shown: rnd(3) ? { pawns: ['asking', 'quiet', 'off'][rnd(3)] } : null,
    });
    const a = mk();
    const b = mk();
    const m = S.merge(a, b);
    if (JSON.stringify(m) !== JSON.stringify(S.merge(b, a))) eq(m, S.merge(b, a), `sweep ${t}: commutative`);
    if (JSON.stringify(S.merge(a, m)) !== JSON.stringify(m)) eq(S.merge(a, m), m, `sweep ${t}: idempotent`);
    if (JSON.stringify(S.merge(m, m)) !== JSON.stringify(m)) eq(S.merge(m, m), m, `sweep ${t}: self`);
    checks += 3;
  }
  console.log('merge: ok');
}

// ------------------------------------------------------------------------------------------
// (d) store.js over a fake localStorage
// ------------------------------------------------------------------------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
const { store } = await imp('js/store.js');
const K = C.KEYS;
{
  // append(KEYS.GAMES) without max: the trim rule; with an explicit max: the plain cap
  for (let i = 0; i < 15; i++) store.append(K.GAMES, game(i));
  for (let i = 0; i < 5; i++) store.append(K.GAMES, game(20 + i, { again: true }));
  const list = store.list(K.GAMES);
  ok(list.length === 15, 'append(GAMES) keeps 12 real plus 3 again');
  eq(ids(list.filter((g) => !g.again)), ids(Array.from({ length: 12 }, (_, i) => game(i + 3))), 'the newest real games stay');
  eq(ids(list.filter((g) => g.again)), ['g022', 'g023', 'g024'], 'the newest again games stay');
  store.remove(K.GAMES);
  for (let i = 0; i < 7; i++) store.append(K.GAMES, { id: String(i) }, 5);
  eq(ids(store.list(K.GAMES)), ['2', '3', '4', '5', '6'], 'an explicit max keeps the plain cap');
  store.remove(K.GAMES);
  for (let i = 0; i < 35; i++) store.append(K.HOLDS, { ply: i });
  ok(store.list(K.HOLDS).length === C.KEEP.HOLDS && store.list(K.HOLDS)[0].ply === 5, 'HOLDS unchanged at KEEP.HOLDS');
  store.remove(K.HOLDS);
  const returned = store.append(K.GAMES, game(1));
  eq(ids(returned), ['g001'], 'append returns the kept array');
  store.remove(K.GAMES);

  // giftRateFallback: read once, never written
  mem.set(K.GIFT_RATE, '0.08');
  ok(store.giftRateFallback() === 0.08, 'giftRateFallback reads the stored notch');
  mem.set(K.GIFT_RATE, '0.5');
  ok(store.giftRateFallback() === 0.08, 'giftRateFallback is read once');
  ok(mem.get(K.GIFT_RATE) === '0.5', 'giftRateFallback never writes');
  mem.delete(K.GIFT_RATE);
  ok(store.giftRateFallback() === 0.08 && !mem.has(K.GIFT_RATE), 'still memoised; nothing written');

  // localDoc
  mem.clear();
  eq(store.localDoc(), EMPTY, 'localDoc over empty storage is the empty document');
  store.set(K.TUTORIAL_SEEN, '1');
  store.set(K.FIRST_FLOAT_SEEN, '1');
  store.set(K.GAMES, [game(1), game(2)]);
  store.set(K.PATH, { v: 1, k3: { gameId: 'g002', nodeId: 'pawns' }, said: ['off:pawns'], digest: [line(1)], shown: { pawns: 'off' } });
  store.set(K.SYNC, { uid: 'u_x', at: '2026-10-05T00:00:00.000Z' });
  const ld = store.localDoc();
  eq(ld, {
    v: 2, updatedAt: '2026-10-05T00:00:00.000Z', games: [game(1), game(2)],
    flags: { tutorialSeen: true, firstHoldSeen: false, firstFloatSeen: true },
    path: { k3: { gameId: 'g002', nodeId: 'pawns' }, said: ['off:pawns'], digest: [line(1)], shown: { pawns: 'off' } },
  }, 'localDoc maps the keys');

  // applyDoc: writes what differs, never clears a flag
  ok(store.applyDoc(ld) === false, 'applyDoc of the local document changes nothing');
  const other = doc({ games: [game(1), game(2), game(3)], flags: { firstHoldSeen: true, tutorialSeen: false }, said: ['off:pawns'], digest: [line(1), line(3)], k3: { gameId: 'g003' }, shown: { pawns: 'quiet' } });
  ok(store.applyDoc(other) === true, 'applyDoc reports a change');
  eq(ids(store.list(K.GAMES)), ['g001', 'g002', 'g003'], 'applyDoc writes the games');
  ok(mem.get(K.FIRST_HOLD_SEEN) === '1', "a true flag writes '1'");
  ok(mem.get(K.TUTORIAL_SEEN) === '1' && mem.get(K.FIRST_FLOAT_SEEN) === '1', 'a false flag never clears one');
  eq(store.get(K.PATH), { v: 1, k3: { gameId: 'g003' }, said: ['off:pawns'], digest: [line(1), line(3)], shown: { pawns: 'quiet' } }, 'applyDoc writes KEYS.PATH');
  ok(store.applyDoc(other) === false, 'applyDoc twice: the second changes nothing');
  // the order of said, the games or the digest alone is no change (a merge sorts them)
  store.set(K.PATH, { v: 1, k3: null, said: ['off:pawns', 'nc:g003'], digest: [line(3), line(1)], shown: { pawns: 'quiet' } });
  store.set(K.GAMES, [game(3), game(1), game(2)]);
  const pathRaw = mem.get(K.PATH);
  const sorted = doc({ games: [game(1), game(2), game(3)], said: ['nc:g003', 'off:pawns'], digest: [line(1), line(3)], shown: { pawns: 'quiet' }, flags: { tutorialSeen: true, firstHoldSeen: true, firstFloatSeen: true } });
  ok(store.applyDoc(sorted) === false && mem.get(K.PATH) === pathRaw, 'a reordered said, digest or games is no change and no write');
  ok(store.applyDoc(S.merge(store.localDoc(), null)) === false, 'applyDoc of the local document merged with nothing changes nothing');
  mem.clear();
  ok(store.applyDoc(null) === false && mem.size === 0, 'applyDoc of an empty document over empty storage writes nothing');
  console.log('store: ok');
}

// ------------------------------------------------------------------------------------------
// (e) store.mirror over a fake db
// ------------------------------------------------------------------------------------------
function fakeDb({ docs = new Map(), errors = [] } = {}) {
  const calls = [];
  const db = {
    calls, docs, errors,
    doc(p) {
      if (typeof p !== 'string' || p.split('/').length % 2) throw new TypeError('bad path');
      return {
        id: p.split('/').pop(), path: p,
        async get() {
          const i = errors.findIndex((e) => e.op === 'get');
          if (i >= 0) { const [e] = errors.splice(i, 1); calls.push({ op: 'get', path: p, outcome: e.code }); throw { code: e.code, message: e.code }; }
          calls.push({ op: 'get', path: p, outcome: 'ok' });
          const has = docs.has(p);
          const body = has ? Object.freeze(JSON.parse(JSON.stringify(docs.get(p)))) : undefined;
          return { id: this.id, exists: has, data: () => body, metadata: { fromCache: false, hasPendingWrites: false } };
        },
        async set(body) {
          const i = errors.findIndex((e) => e.op === 'set');
          if (i >= 0) { const [e] = errors.splice(i, 1); calls.push({ op: 'set', path: p, outcome: e.code }); throw { code: e.code, message: e.code }; }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw { code: 'invalid_argument', message: 'body' };
          calls.push({ op: 'set', path: p, outcome: 'ok' });
          docs.set(p, JSON.parse(JSON.stringify(body)));
        },
      };
    },
  };
  return db;
}
const who = (id) => ({ id: async () => id });
const perms = (state) => ({ state: async (n) => (n === 'db' ? state : 'unavailable') });
const DOC = 'data/users/u_test/holdon';
const opsOf = (db) => db.calls.map((c) => c.op).join(',');
function getBeforeSet(db) {
  let read = false;
  for (const c of db.calls) {
    if (c.op === 'get' && c.outcome === 'ok') read = true;
    if (c.op === 'set' && !read) return false;
  }
  return true;
}
{
  // no namespaces, no id, denied, unavailable: local only, no call
  for (const [label, opts] of [
    ['no db', { db: null, user: who('u_test'), permissions: perms('granted') }],
    ['no identity', { db: fakeDb(), user: null, permissions: perms('granted') }],
    ['a null id', { db: fakeDb(), user: who(null), permissions: perms('granted') }],
    ['denied', { db: fakeDb(), user: who('u_test'), permissions: perms('denied') }],
    ['unavailable', { db: fakeDb(), user: who('u_test'), permissions: perms('unavailable') }],
    ['nothing at all', {}],
  ]) {
    mem.clear();
    store.set(K.GAMES, [game(1)]);
    const m = store.mirror(opts);
    await m.boot();
    ok(m.status().stopped === true, `${label}: the mirror stops`);
    ok((await m.sync()) === 'stopped', `${label}: sync is 'stopped'`);
    if (opts.db) ok(opts.db.calls.length === 0, `${label}: no db call`);
    eq(ids(store.list(K.GAMES)), ['g001'], `${label}: the local log is untouched`);
  }
  const threw = store.mirror({ db: fakeDb(), user: { id: async () => { throw new Error('x'); } }, permissions: perms('granted') });
  await threw.boot();
  ok(threw.status().stopped, 'an id() that throws: local only');
  const badPerm = fakeDb();
  const bp = store.mirror({ db: badPerm, user: who('u_test'), permissions: { state: async () => { throw new Error('x'); } } });
  await bp.boot();
  ok(bp.status().stopped && badPerm.calls.length === 0, 'a permissions.state that throws: local only');

  // granted: the read at boot merges a seeded remote into the local log, writes back what the
  // remote lacks, stamps KEYS.SYNC, calls onMerged
  mem.clear();
  const remote = doc({ updatedAt: '2026-10-01T00:00:00.000Z', games: Array.from({ length: 11 }, (_, i) => game(i)), digest: Array.from({ length: 11 }, (_, i) => line(i)), flags: { tutorialSeen: true } });
  const db1 = fakeDb({ docs: new Map([[DOC, remote]]) });
  store.set(K.GAMES, [game(30)]);
  store.set(K.PATH, { v: 1, k3: null, said: [], digest: [line(30)], shown: { pawns: 'asking' } });
  const merged = [];
  const m1 = store.mirror({ db: db1, user: who('u_test'), permissions: perms('granted'), onMerged: (x) => merged.push(x) });
  await m1.boot();
  ok(db1.calls[0].op === 'get' && db1.calls[0].path === DOC, "granted: the first call is a get of data/users/<id>/holdon");
  ok(opsOf(db1) === 'get,set', `granted: get then set at boot (got ${opsOf(db1)})`);
  ok(store.list(K.GAMES).length === 12 && db1.docs.get(DOC).games.length === 12, 'granted: both hold the twelve games');
  ok(store.get(K.PATH).digest.length === 12 && db1.docs.get(DOC).path.digest.length === 12, 'granted: both hold the twelve digest lines');
  ok(mem.get(K.TUTORIAL_SEEN) === '1', 'granted: the remote flag reached the local keys');
  ok(merged.length === 1 && merged[0].changed === true, 'granted: onMerged({ changed: true }) once');
  // the local document as it was before the merge rides along (game.js silences only the looks the merge changed)
  eq(merged[0].before && merged[0].before.path.digest.map((l) => l.id), [line(30).id], 'granted: onMerged carries the pre-merge local digest');
  const sy = store.get(K.SYNC);
  ok(sy && sy.uid === 'u_test' && typeof sy.at === 'string' && sy.at === db1.docs.get(DOC).updatedAt, 'KEYS.SYNC holds the id and the last stamp');
  eq(store.get(K.PATH).shown, { pawns: 'asking' }, "this device's shown stays local");
  const st1 = m1.status();
  ok(st1.uid === 'u_test' && st1.state === 'granted' && st1.readDone && !st1.readOnly && !st1.stopped && st1.pending === 0, 'status after a granted boot');
  // a second boot is the same promise; a sync with nothing new reads and does not write
  await m1.boot();
  ok(db1.calls.length === 2, 'boot runs once');
  ok((await m1.sync()) === 'written' && opsOf(db1) === 'get,set,get', 'nothing new: a get and no set');
  ok(merged.length === 1, 'nothing new: no onMerged');
  // a new local game: get then set
  store.append(K.GAMES, game(31));
  const res = await m1.sync();
  ok(res === 'written' && opsOf(db1) === 'get,set,get,get,set', `a new game: get then set (got ${res}, ${opsOf(db1)})`);
  ok(db1.docs.get(DOC).games.some((g) => g.id === 'g031'), 'the new game reached the remote');
  ok(getBeforeSet(db1), 'granted: never a set before a get');
  // a sync with only local news (an unsorted said, a new digest line) never calls onMerged
  const p1 = store.get(K.PATH);
  store.set(K.PATH, { ...p1, said: ['off:pawns', 'nc:g031'], digest: [...p1.digest, line(31)] });
  const nMerged = merged.length;
  ok((await m1.sync()) === 'written' && merged.length === nMerged, 'local news alone: written, no onMerged');
  eq(store.get(K.PATH).said, ['off:pawns', 'nc:g031'], 'the local said is left as it was');
  eq(db1.docs.get(DOC).path.said, ['nc:g031', 'off:pawns'], 'the remote said is the sorted union');
  // a k3 the page dropped comes back from the document, but is no news: no onMerged
  db1.docs.get(DOC).path.k3 = { gameId: 'g031', nodeId: 'pawns', next: 'old' };
  store.set(K.PATH, { ...store.get(K.PATH), k3: null });
  ok((await m1.sync()) === 'written' && merged.length === nMerged, 'a k3 alone: no onMerged');
  ok(store.get(K.PATH).k3 && store.get(K.PATH).k3.next === 'old', 'the k3 is kept locally all the same');
  // a remote game this device lacks is news
  const d1 = db1.docs.get(DOC);
  d1.games.push(game(32));
  d1.path.digest.push(line(32));
  ok((await m1.sync()) === 'merged' && merged.length === nMerged + 1, "a game from elsewhere: 'merged' and onMerged");
  ok(store.list(K.GAMES).some((g) => g.id === 'g032'), 'the game from elsewhere is local now');

  // granted over a remote that already holds everything: no write at boot, no onMerged
  const db1b = fakeDb({ docs: new Map([[DOC, JSON.parse(JSON.stringify(db1.docs.get(DOC)))]]) });
  const merged1b = [];
  const m1b = store.mirror({ db: db1b, user: who('u_test'), permissions: perms('granted'), onMerged: (x) => merged1b.push(x) });
  await m1b.boot();
  ok(opsOf(db1b) === 'get' && merged1b.length === 0, 'granted over an equal remote: one get, no set, no onMerged');

  // prompt (and no permissions namespace): nothing at boot; the first sync reads then writes
  for (const [label, permissions] of [['prompt', perms('prompt')], ['no permissions namespace', null], ['an unknown state', perms('later')]]) {
    mem.clear();
    const db2 = fakeDb();
    store.set(K.GAMES, [game(1)]);
    const m2 = store.mirror({ db: db2, user: who('u_test'), permissions });
    await m2.boot();
    ok(db2.calls.length === 0 && !m2.status().stopped && !m2.status().readDone, `${label}: no db call at boot`);
    const r2 = await m2.sync();
    ok(r2 === 'written' && opsOf(db2) === 'get,set', `${label}: the first sync is get then set (got ${r2}, ${opsOf(db2)})`);
    ok(db2.docs.get(DOC).games[0].id === 'g001' && m2.status().readDone, `${label}: the remote holds the local game`);
    ok(getBeforeSet(db2), `${label}: never a set before a get`);
  }

  // sync() without boot() boots first
  mem.clear();
  const db3 = fakeDb();
  const m3 = store.mirror({ db: db3, user: who('u_test'), permissions: perms('prompt') });
  ok((await m3.sync()) === 'written' && opsOf(db3) === 'get,set', 'sync without boot: boots, then get then set');

  // one chain per document: two syncs at once run get,set,get,(set)
  mem.clear();
  const db4 = fakeDb();
  store.set(K.GAMES, [game(1)]);
  const m4 = store.mirror({ db: db4, user: who('u_test'), permissions: perms('prompt') });
  const [ra, rb] = await Promise.all([m4.sync(), m4.sync()]);
  ok(opsOf(db4) === 'get,set,get' && ra === 'written' && rb === 'written', `two syncs at once run on one chain (got ${opsOf(db4)})`);

  // a fresh device with one local game over a remote of twelve: the remote's newest twelve real
  // games plus nothing lost from the digest
  mem.clear();
  const twelve = doc({ updatedAt: iso(20), games: Array.from({ length: 12 }, (_, i) => game(i)), digest: Array.from({ length: 12 }, (_, i) => line(i)) });
  const db5 = fakeDb({ docs: new Map([[DOC, twelve]]) });
  store.set(K.GAMES, [game(40)]);
  store.set(K.PATH, { v: 1, k3: null, said: [], digest: [line(40)], shown: null });
  const m5 = store.mirror({ db: db5, user: who('u_test'), permissions: perms('prompt') });
  await m5.boot();
  ok(db5.calls.length === 0, 'prompt with a remote: nothing read before the close card');
  ok((await m5.sync()) === 'merged', "the deferred read merges: 'merged'");
  ok(store.get(K.PATH).digest.length === 13 && db5.docs.get(DOC).path.digest.length === 13, 'thirteen digest lines in both');
  eq(ids(store.list(K.GAMES)), ids(db5.docs.get(DOC).games), 'the same games in both');
  ok(store.list(K.GAMES).length === 12 && store.list(K.GAMES).slice(-1)[0].id === 'g040', 'the trim keeps the twelve newest, the local game among them');

  // invalid_argument on get: read-only, never a write, the page goes on
  mem.clear();
  const db6 = fakeDb({ errors: [{ op: 'get', code: 'invalid_argument' }] });
  store.set(K.GAMES, [game(1)]);
  const m6 = store.mirror({ db: db6, user: who('u_test'), permissions: perms('granted') });
  await m6.boot();
  ok(opsOf(db6) === 'get' && m6.status().readOnly && !m6.status().stopped, 'invalid_argument on get: read-only, one get');
  ok((await m6.sync()) === 'readonly' && !db6.calls.some((c) => c.op === 'set'), 'read-only: a later sync reads and never writes');
  ok(opsOf(db6) === 'get,get', 'reads continue in a read-only view');
  eq(ids(store.list(K.GAMES)), ['g001'], 'the local log is untouched');

  // invalid_argument on set: read-only from then on
  mem.clear();
  const db7 = fakeDb({ errors: [{ op: 'set', code: 'invalid_argument' }] });
  store.set(K.GAMES, [game(1)]);
  const m7 = store.mirror({ db: db7, user: who('u_test'), permissions: perms('prompt') });
  ok((await m7.sync()) === 'readonly' && opsOf(db7) === 'get,set', 'invalid_argument on set: readonly, no retry');
  store.append(K.GAMES, game(2));
  ok((await m7.sync()) === 'readonly' && opsOf(db7) === 'get,set,get', 'then reads only');

  // the stop codes, on get and on set
  for (const code of ['quota_exceeded', 'resource_exhausted', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed']) {
    for (const op of ['get', 'set']) {
      mem.clear();
      const db8 = fakeDb({ errors: [{ op, code }] });
      store.set(K.GAMES, [game(1)]);
      const m8 = store.mirror({ db: db8, user: who('u_test'), permissions: perms('prompt') });
      const r8 = await m8.sync();
      ok(r8 === 'stopped' && m8.status().stopped, `${code} on ${op}: stopped`);
      const n = db8.calls.length;
      ok((await m8.sync()) === 'stopped' && db8.calls.length === n, `${code} on ${op}: no call afterwards`);
      ok(getBeforeSet(db8), `${code} on ${op}: never a set before a get`);
    }
  }
  console.log('mirror (no retries): ok');

  // unavailable retries once after 1000-2000 ms; an unknown code is unavailable
  mem.clear();
  const db9 = fakeDb({ errors: [{ op: 'get', code: 'unavailable' }] });
  store.set(K.GAMES, [game(1)]);
  const m9 = store.mirror({ db: db9, user: who('u_test'), permissions: perms('granted') });
  const t0 = Date.now();
  await m9.boot();
  const dt = Date.now() - t0;
  ok(opsOf(db9) === 'get,get,set', `unavailable: two gets, then the set (got ${opsOf(db9)})`);
  ok(dt >= 990 && dt < 2600, `the retry waits 1000-2000 ms (waited ${dt} ms)`);
  const db10 = fakeDb({ errors: [{ op: 'get', code: 'unavailable' }, { op: 'get', code: 'mystery' }] });
  const m10 = store.mirror({ db: db10, user: who('u_test'), permissions: perms('prompt') });
  ok((await m10.sync()) === 'skipped' && opsOf(db10) === 'get,get', "two failed gets (an unknown code as unavailable): 'skipped', no set");
  ok(!m10.status().stopped && !m10.status().readOnly, 'a failed read neither stops nor marks read-only');
  ok((await m10.sync()) === 'written' && opsOf(db10) === 'get,get,get,set', 'the next sync reads and writes');
  const db11 = fakeDb({ errors: [{ op: 'set', code: 'unavailable' }] });
  const m11 = store.mirror({ db: db11, user: who('u_test'), permissions: perms('prompt') });
  ok((await m11.sync()) === 'written' && opsOf(db11) === 'get,set,set', 'unavailable on set: one retry');
  const db12 = fakeDb();
  db12.doc = () => { throw new TypeError('bad path'); };
  const m12 = store.mirror({ db: db12, user: who('u/x'), permissions: perms('granted') });
  await m12.boot();
  ok(m12.status().stopped, 'a doc() that throws: local only');

  // two devices over one shared store converge after each boots again
  const shared = new Map();
  const local = { A: new Map(), B: new Map() };
  const use = (dev) => { mem.clear(); for (const [k, v] of local[dev]) mem.set(k, v); };
  const keep = (dev) => { local[dev] = new Map(mem); };
  const dbA = fakeDb({ docs: shared });
  const dbB = fakeDb({ docs: shared });
  use('A');
  store.set(K.GAMES, [game(1), game(2)]);
  store.set(K.PATH, { v: 1, k3: null, said: [], digest: [line(1), line(2)], shown: null });
  await store.mirror({ db: dbA, user: who('u_test'), permissions: perms('granted') }).boot();
  keep('A');
  use('B');
  store.set(K.GAMES, [game(3)]);
  store.set(K.PATH, { v: 1, k3: null, said: [], digest: [line(3)], shown: null });
  await store.mirror({ db: dbB, user: who('u_test'), permissions: perms('granted') }).boot();
  store.append(K.GAMES, game(4));
  await store.mirror({ db: dbB, user: who('u_test'), permissions: perms('granted') }).sync();
  keep('B');
  use('A');
  await store.mirror({ db: dbA, user: who('u_test'), permissions: perms('granted') }).boot();
  const aGames = ids(store.list(K.GAMES));
  keep('A');
  use('B');
  await store.mirror({ db: dbB, user: who('u_test'), permissions: perms('granted') }).boot();
  const bGames = ids(store.list(K.GAMES));
  eq(aGames, ['g001', 'g002', 'g003', 'g004'], 'device A holds every game');
  eq(bGames, aGames, 'the two devices converge');
  ok(getBeforeSet(dbA) && getBeforeSet(dbB), 'two devices: never a set before a get');
  console.log('mirror: ok');
}

console.log(`test_sync: ok (${checks} checks)`);
process.exit(0);
