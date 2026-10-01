// Model-written text: "janela deslizante" and "Janela Deslizante." must collapse.
// SQLite has no accent folding, so this stays in JS.
const normalise = s => String(s)
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function groupMisconceptions(sections) {
  const byKey = new Map();

  for (const s of sections) {
    for (const text of s.misconceptions || []) {
      const key = normalise(text);
      if (!key) continue;

      const at  = s.recorded_at ? new Date(s.recorded_at) : null;
      const hit = byKey.get(key) || { key, text, count: 0, concepts: [], lessons: [], last_seen: null };

      hit.count += 1;
      // Latest phrasing wins: it is the one the user last read.
      if (!hit.last_seen || (at && at > hit.last_seen)) { hit.last_seen = at; hit.text = text; }
      if (s.concept_id && !hit.concepts.includes(s.concept_id)) hit.concepts.push(s.concept_id);
      if (s.lesson_id  && !hit.lessons.includes(s.lesson_id))   hit.lessons.push(s.lesson_id);

      byKey.set(key, hit);
    }
  }

  return [...byKey.values()].sort((a, b) =>
    b.count - a.count || new Date(b.last_seen ?? 0) - new Date(a.last_seen ?? 0));
}

module.exports = { groupMisconceptions };
