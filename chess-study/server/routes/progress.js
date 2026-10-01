const router = require('express').Router();

const { getStore } = require('../db');
const { sm2 } = require('../sm2');
const { groupMisconceptions } = require('../misconceptions');
const { languageLocale } = require('../workspace');

router.post('/', (req, res) => {
  const {
    lesson_id,
    final_score,
    concepts_demonstrated = [],
    concepts_missed = [],
    kind = 'lesson'
  } = req.body;

  if (!lesson_id || final_score === undefined) {
    return res.status(400).json({ error: 'lesson_id and final_score are required' });
  }

  const isProject = kind === 'project';
  const missed    = new Set(concepts_missed);
  const source    = isProject ? 'project' : 'ai_validation';

  try {
    const store = getStore();

    const updates = store.transaction(() => {
      store.saveLesson({ lesson_id, kind, final_score });

      const out = [];
      for (const concept_id of concepts_demonstrated) {
        const existing = store.concept(concept_id);

        // A weak project only demotes the concepts it names as missed: it cannot say
        // which one broke, so the rest keep their schedule and only log the score.
        if (isProject && final_score < 75 && !missed.has(concept_id)) {
          if (existing) store.addHistory(concept_id, { score: final_score, source });
          continue;
        }

        const { interval_days, ease_factor, next_review } =
          sm2(final_score, existing, { project: isProject });

        store.saveConcept({
          concept_id,
          lesson_id,
          first_seen:     existing?.first_seen,
          last_reviewed:  new Date(),
          next_review,
          interval_days,
          ease_factor,
          mastered:       final_score >= 75,
          mastery_source: source
        });
        store.addHistory(concept_id, { score: final_score, source });

        out.push({ concept_id, next_review, interval_days });
      }
      return out;
    });

    const earliest = updates.reduce(
      (min, c) => (c.next_review < min ? c.next_review : min),
      updates[0]?.next_review ?? new Date()
    );

    const next_review_label = updates.length
      ? earliest.toLocaleDateString(languageLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
      : null;

    res.json({
      ok: true,
      concepts_updated: updates.length,
      next_review: next_review_label
    });

  } catch (err) {
    console.error('progress POST error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  try {
    const store = getStore();
    const now = new Date();
    const concepts = store.concepts();

    res.json({
      concepts,
      lessons:         store.lessons(20),
      conversations:   store.conversations(),
      pending_reviews: concepts.filter(c => c.next_review && new Date(c.next_review) <= now),
      misconceptions:  groupMisconceptions(store.sections())
    });

  } catch (err) {
    console.error('progress GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
