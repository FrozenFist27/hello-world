const { strings } = require('./workspace');

const BANDS = {
  '!0':  { score: 22, feedback: 'sandbox.fb0',  misconceptions: ['sandbox.mis0'] },
  '!p':  { score: 61, feedback: 'sandbox.fbP',  misconceptions: ['sandbox.misP'] },
  '!ok': { score: 82, feedback: 'sandbox.fbOk', misconceptions: [] },
  '!m':  { score: 95, feedback: 'sandbox.fbM',  misconceptions: [] }
};

function bandFromLength(text) {
  const n = text.trim().length;
  if (n < 40)  return BANDS['!0'];
  if (n < 120) return BANDS['!p'];
  if (n < 320) return BANDS['!ok'];
  return BANDS['!m'];
}

function stubVerdict({ user_answer = '', concept_id, valid_concept_ids = [], is_teachback = false }) {
  const trimmed = user_answer.trim();

  // Longest token first, so "!ok" is not shadowed by a shorter prefix.
  const token = Object.keys(BANDS)
    .sort((a, b) => b.length - a.length)
    .find(t => trimmed.toLowerCase().startsWith(t));

  const band = token ? BANDS[token] : bandFromLength(trimmed);

  // Mirrors the real route: only canonical IDs, and a failing answer demonstrates nothing.
  const vocabulary = valid_concept_ids.length ? valid_concept_ids : [concept_id].filter(Boolean);
  const demonstrated = band.score >= 75 ? vocabulary : [];

  const S = strings();
  return {
    score:                 band.score,
    feedback:              is_teachback ? `${S[band.feedback]} (teach-back)` : S[band.feedback],
    concepts_demonstrated: demonstrated,
    misconceptions:        band.misconceptions.map(key => S[key])
  };
}

module.exports = { stubVerdict, BANDS };
