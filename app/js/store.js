// store.js — localStorage behind try/catch. A private window, blocked storage or a full quota
// never throws out of here: reads return the fallback, writes return false.
//
// Values: strings are stored as they are (flags are the literal string '1', the theme is 'light'
// or 'dark'); objects, arrays and numbers are JSON-encoded. On a read, a value that starts with
// '{' or '[' is JSON-decoded; otherwise the raw string comes back, except that a numeric fallback
// decodes the value as a number (so get(KEYS.GIFT_RATE, 0.12) is a number while
// get(KEYS.TUTORIAL_SEEN) is the string '1'). That is the one rule that keeps the flags literal
// and the gift-rate notch numeric without the store knowing the keys.

import { KEYS, KEEP } from './contract.js';

const DEFAULT_MAX = { [KEYS.GAMES]: KEEP.GAMES, [KEYS.HOLDS]: KEEP.HOLDS };

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

  // Appends and keeps the last `max` items (KEEP.GAMES / KEEP.HOLDS for the two log keys when
  // max is omitted). Returns the array that was kept, even when the write failed.
  append(key, item, max) {
    const arr = this.list(key);
    arr.push(item);
    const cap = typeof max === 'number' && max > 0 ? max : DEFAULT_MAX[key] || 0;
    if (cap > 0) while (arr.length > cap) arr.shift();
    this.set(key, arr);
    return arr;
  },
};

export default store;
