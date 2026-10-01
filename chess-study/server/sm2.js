// Passing a project is stronger evidence than a lesson at the same score, so the
// interval goes further. Failing says less — see recordResult in progress.js.
const PROJECT_BOOST = 1.5;

function sm2(score, current, { project = false } = {}) {
  let interval_days = current?.interval_days ?? 1;
  let ease_factor   = current?.ease_factor   ?? 2.5;
  const boost = project ? PROJECT_BOOST : 1;

  if (score >= 90) {
    interval_days = Math.round(interval_days * ease_factor * boost);
    ease_factor   = Math.min(ease_factor + (project ? 0.15 : 0.1), 4.0);
  } else if (score >= 75) {
    interval_days = Math.round(interval_days * ease_factor * boost);
  } else if (score >= 41) {
    interval_days = 1;
    ease_factor   = Math.max(ease_factor - 0.15, 1.3);
  } else {
    interval_days = 0;
    ease_factor   = Math.max(ease_factor - 0.2, 1.3);
  }

  const next_review = new Date();
  next_review.setDate(next_review.getDate() + interval_days);

  return { interval_days, ease_factor, next_review };
}

module.exports = { sm2 };
