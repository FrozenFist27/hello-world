(function () {
  'use strict';

  // The fixed localhost is only the file:// fallback, where origin is "null".
  var SERVER = location.protocol.indexOf('http') === 0
    ? location.origin
    : 'http://localhost:9990';

  var cfg = (function () {
    var el = document.getElementById('lx-config');
    try { return el ? JSON.parse(el.textContent) : {}; }
    catch (e) { return {}; }
  })();

  var LESSON   = cfg.lesson || document.body.getAttribute('data-lesson') || '';
  var CONCEPTS = cfg.concepts || [];
  var PHASES   = cfg.phases || [];

  // The fallbacks serve pages built before cfg.strings existed.
  var S = cfg.strings || {};
  function t(key, dflt) { return S[key] || dflt; }

  var PASS = 50;

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var online = false;

  function setOffline(isOffline) {
    online = !isOffline;
    document.body.classList.toggle('lx-offline', isOffline);
    var banner = $('#lx-banner');
    if (banner) banner.hidden = !isOffline;
  }

  function detectServer() {
    // Starts optimistic and only degrades; the reverse flashes the fallback on load.
    return fetch(SERVER + '/api/health', { signal: AbortSignal.timeout(1500) })
      .then(function (r) { setOffline(!r.ok); })
      .catch(function () { setOffline(true); });
  }

  var KEY = 'lx-state:' + LESSON;
  var restoring = false;

  function readState() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }

  function remember(kind, key, value) {
    if (restoring) return;
    try {
      var s = readState();
      (s[kind] = s[kind] || {})[key] = value;
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {}
  }

  // Derived rather than authored, so no attribute is needed: a recall by its
  // concept, a quiz by its position, and there is only ever one teach-back.
  function blockKey(el) {
    if (el.classList.contains('lx-teachback')) return 'teachback';
    var recall = el.closest ? el.closest('.lx-recall') : null;
    if (recall) return (el === recall ? 'recall:' : 'fallback:') + recall.dataset.conceptId;
    return 'quiz:' + $$('.lx-quiz').indexOf(el.closest('.lx-quiz') || el);
  }

  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  }

  function markPhaseDone(id) {
    var phase = $('.lx-phase[data-phase="' + id + '"]');
    if (phase) phase.classList.add('lx-phase--done');
    var i = PHASES.indexOf(String(id));
    var seg = $('.lx-progress-seg[data-seg="' + id + '"]');
    if (seg) seg.classList.add('is-done');
    return i;
  }

  // Both halves matter: the class un-blurs it, removing aria-hidden exposes it to screen readers.
  function openGate(name, scroll) {
    var el = $('.lx-gate[data-gate="' + name + '"]');
    if (!el) return null;
    el.classList.remove('lx-gate--locked');
    var body = $('.lx-gate-body', el);
    if (body) body.removeAttribute('aria-hidden');
    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return el;
  }

  // Any answer opens the next section; a weak one just skips the scroll so the
  // reader stays on the feedback.
  function unlockNext(fromId, scroll) {
    markPhaseDone(fromId);
    var i = PHASES.indexOf(String(fromId));
    if (i < 0) return;

    // Not the flash cards: they carry the answers and stay shut until the teach-back is submitted.
    if (i + 1 >= PHASES.length) {
      openGate('teachback', scroll !== false);
      return;
    }

    var next = $('.lx-phase[data-phase="' + PHASES[i + 1] + '"]');
    if (next) next.classList.remove('lx-phase--locked');
    openGate('phase-' + PHASES[i + 1], scroll !== false);
  }

  function band(score) {
    if (score >= 90) return { cls: 'lx-score--top',  word: t('score.top', 'mastered') };
    if (score >= 75) return { cls: 'lx-score--good', word: t('score.good', 'solid') };
    if (score >= 41) return { cls: 'lx-score--mid',  word: t('score.mid', 'partial') };
    return { cls: 'lx-score--bad', word: t('score.bad', 'not understood') };
  }

  // `code` and **bold** in feedback, whether authored or written by the grader.
  // Built from text nodes, never innerHTML, so model output cannot inject markup.
  function setRich(el, text) {
    el.textContent = '';
    String(text || '').split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach(function (part) {
      if (!part) return;
      var code = part.charAt(0) === '`' && part.length > 2;
      var bold = part.slice(0, 2) === '**' && part.length > 4;
      if (!code && !bold) { el.appendChild(document.createTextNode(part)); return; }
      var node = document.createElement(code ? 'code' : 'strong');
      if (code) node.className = 'lx-code';
      node.textContent = code ? part.slice(1, -1) : part.slice(2, -2);
      el.appendChild(node);
    });
  }

  function showVerdict(block, data) {
    var box = $('.lx-verdict', block);
    var b   = band(data.score);

    $('.lx-score', box).className = 'lx-score ' + b.cls;
    $('.lx-score-num', box).textContent  = data.score;
    $('.lx-score-word', box).textContent = b.word;
    $('.lx-bar-fill', box).style.width   = Math.max(0, Math.min(100, data.score)) + '%';
    setRich($('.lx-feedback', box), data.feedback);

    var misses = $('.lx-misses', box);
    misses.innerHTML = '';
    (data.misconceptions || []).forEach(function (m) {
      var li = document.createElement('li');
      setRich(li, m);
      misses.appendChild(li);
    });

    var tags = $('.lx-concepts', box);
    if (tags) {
      tags.innerHTML = '';
      (data.concepts_demonstrated || []).forEach(function (c) {
        var el = document.createElement('span');
        el.className = 'lx-badge';
        el.textContent = c;
        tags.appendChild(el);
      });
    }

    box.classList.add('is-shown');
  }

  function fail(block, message) {
    var box = $('.lx-verdict', block);
    $('.lx-score', box).className = 'lx-score lx-score--bad';
    $('.lx-score-num', box).textContent  = '—';
    $('.lx-score-word', box).textContent = t('score.error', 'error');
    $('.lx-bar-fill', box).style.width   = '0';
    $('.lx-feedback', box).textContent   = message;
    $('.lx-misses', box).innerHTML = '';
    box.classList.add('is-shown');
  }

  // Surface the server's own sentence; a bare status code is not actionable.
  function readVerdict(r) {
    if (r.ok) return r.json();
    return r.json().catch(function () { return {}; }).then(function (body) {
      throw new Error(body.error || (t('run.serverSaid', 'the server replied') + ' ' + r.status));
    });
  }

  function busy(btn, isBusy, label) {
    btn.disabled = isBusy;
    if (isBusy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || t('run.validating', 'Checking…');
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
  }

  function validate(block, btn) {
    var answer = $('.lx-answer', block).value.trim();
    if (!answer) { fail(block, t('run.needAnswer', 'Write an answer before checking.')); return; }

    busy(btn, true);
    fetch(SERVER + '/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concept_id:        block.dataset.conceptId,
        section_summary:   block.dataset.summary,
        user_answer:       answer,
        valid_concept_ids: CONCEPTS,
        lesson_id:         LESSON
      })
    })
      .then(readVerdict)
      .then(function (data) {
        showVerdict(block, data);
        remember('verdicts', blockKey(block), data);
        // Never gated on the score: locking the reader out cannot teach what they got wrong.
        if (block.dataset.phase) unlockNext(block.dataset.phase, data.score >= PASS);
      })
      .catch(function (err) {
        // Never render an error as a score: 0 would say they were wrong when nothing evaluated it.
        fail(block, t('run.validateFailed', 'Could not check that just now. Your answer is still here.') + ' (' + err.message + ')');
      })
      .finally(function () { busy(btn, false); });
  }

  // A miss keeps the choices live and the correct one unmarked, so a retry is not a formality.
  function answerChoice(scope, input, phaseId, okText, badText) {
    var correct = input.dataset.correct === '1';
    $$('input[type="radio"]', scope).forEach(function (i) {
      var label = i.closest('.lx-choice');
      label.classList.toggle('is-correct', correct && i.dataset.correct === '1');
      label.classList.toggle('is-wrong', !correct && i === input);
      i.disabled = correct;
    });
    var fb = $('.lx-inline-fb', scope);
    if (fb) {
      setRich(fb, correct ? okText : badText);
      fb.className = 'lx-inline-fb is-shown ' + (correct ? 'is-ok' : 'is-bad');
    }
    remember('choices', blockKey(scope), $$('input[type="radio"]', scope).indexOf(input));
    if (phaseId) unlockNext(phaseId, correct && !restoring);
  }

  function teachback(block, btn) {
    var answer = $('.lx-answer', block).value.trim();
    if (!answer) { fail(block, t('run.needExplain', 'Write your explanation before finishing.')); return; }

    var concepts = (block.dataset.concepts || '').split(',').filter(Boolean);

    busy(btn, true, t('run.grading', 'Grading…'));
    fetch(SERVER + '/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concept_id:        concepts[0] || '',
        section_summary:   t('run.teachbackOf', 'Final teach-back for lesson') + ' ' + LESSON,
        user_answer:       answer,
        valid_concept_ids: CONCEPTS,
        is_teachback:      true,
        lesson_id:         LESSON
      })
    })
      .then(readVerdict)
      .then(function (data) {
        showVerdict(block, data);
        remember('verdicts', blockKey(block), data);
        return fetch(SERVER + '/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lesson_id:             LESSON,
            final_score:           data.score,
            concepts_demonstrated: data.concepts_demonstrated || []
          })
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (saved) { remember('done', 'done', saved || {}); showDone(data, saved); });
      })
      .catch(function (err) {
        fail(block, t('run.finishFailed', 'Could not finish just now. Your explanation is still here.') + ' (' + err.message + ')');
      })
      .finally(function () { busy(btn, false); });
  }

  function showDone(verdict, saved) {
    var done = $('.lx-done');
    if (!done) return;
    var date = $('.lx-next-review-date', done);
    var note = $('.lx-next-review-note', done);

    if (saved && saved.next_review) {
      date.textContent = saved.next_review;
      note.textContent = saved.concepts_updated + ' ' + t('run.scheduled', 'concept(s) scheduled by SM-2.');
    } else {
      // Scored but not recorded — do not show a date that was never written.
      date.textContent = t('run.notScheduled', 'not scheduled');
      note.textContent = t('run.notSaved', 'The lesson was graded, but the progress could not be saved.');
    }
    PHASES.forEach(markPhaseDone);
    openGate('flashcards');
    done.classList.add('is-shown');
    done.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function setupMic(block) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = $('.lx-mic', block);
    if (!btn) return;
    if (!SR || !navigator.mediaDevices) return;   // stays hidden

    var lang = $('[data-role="lang"]', block);
    var hint = $('.lx-mic-hint', block);
    var area = $('.lx-answer', block);
    btn.hidden = false;
    if (lang) lang.hidden = false;

    var rec = null, active = false;

    btn.addEventListener('click', function () {
      if (active) { if (rec) rec.stop(); return; }

      rec = new SR();
      rec.lang = lang ? lang.value : 'pt-BR';
      rec.continuous = true;
      rec.interimResults = false;

      rec.onstart = function () {
        active = true;
        btn.classList.add('is-recording');
        btn.textContent = '⏹ ' + t('mic.stop', 'Stop');
        hint.textContent = t('mic.listening', 'listening…');
      };
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            area.value = (area.value ? area.value + ' ' : '') + e.results[i][0].transcript.trim();
            // Setting .value fires no input event, and that event is what saves the draft.
            area.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      };
      rec.onerror = function (e) {
        // Recognition can fail without ever prompting, so the failure has to be said on screen.
        hint.textContent = t('mic.failed', 'Could not transcribe just now. You can type your answer.');
      };
      rec.onend = function () {
        active = false;
        btn.classList.remove('is-recording');
        btn.textContent = '🎙 ' + t('mic.dictate', 'Dictate');
        if (hint.textContent === t('mic.listening', 'listening…')) hint.textContent = '';
      };
      rec.start();
    });
  }

  // The default is the absence of the attribute; the stylesheet already encodes it.
  function applyPref(kind, choice, dflt) {
    var attr = 'data-' + kind, root = document.documentElement;
    if (choice === dflt) root.removeAttribute(attr);
    else root.setAttribute(attr, choice);

    $$('[data-' + kind + '-set]').forEach(function (b) {
      var on = b.dataset[kind + 'Set'] === choice;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });

    try { localStorage.setItem('lx-' + kind, choice); } catch (e) { /* private mode */ }
  }

  function setupPrefs() {
    [['theme', 'auto'], ['accent', 'azul']].forEach(function (pair) {
      var kind = pair[0], dflt = pair[1], stored = dflt;
      try { stored = localStorage.getItem('lx-' + kind) || dflt; } catch (e) { /* private mode */ }
      applyPref(kind, stored, dflt);

      $$('[data-' + kind + '-set]').forEach(function (btn) {
        btn.addEventListener('click', function () { applyPref(kind, btn.dataset[kind + 'Set'], dflt); });
      });
    });
  }

  // Replays through the same code that answered, with `restoring` suppressing
  // the state write-back and the scroll: the reader chose where they were.
  function restore() {
    var s = readState();
    if (!s.choices && !s.answers && !s.verdicts) return;

    restoring = true;

    Object.keys(s.answers || {}).forEach(function (key) {
      $$('.lx-recall, .lx-teachback').forEach(function (block) {
        var box = $('.lx-answer', block);
        if (box && blockKey(block) === key) box.value = s.answers[key];
      });
    });

    Object.keys(s.verdicts || {}).forEach(function (key) {
      $$('.lx-recall, .lx-teachback').forEach(function (block) {
        if (blockKey(block) !== key) return;
        showVerdict(block, s.verdicts[key]);
        if (block.dataset.phase) unlockNext(block.dataset.phase, false);
      });
    });

    Object.keys(s.choices || {}).forEach(function (key) {
      $$('.lx-quiz, .lx-fallback').forEach(function (scope) {
        if (blockKey(scope) !== key) return;
        var input = $$('input[type="radio"]', scope)[s.choices[key]];
        if (!input) return;
        input.checked = true;
        var owner = scope.closest('.lx-recall') || scope;
        answerChoice(scope, input, owner.dataset.phase,
          owner.dataset.ok || t('recall.ok', 'Correct.'), owner.dataset.bad || t('recall.bad', 'Not that one.'));
      });
    });

    if (s.done) {
      var tb = $('.lx-teachback');
      var verdict = tb && s.verdicts && s.verdicts.teachback;
      if (verdict) showDone(verdict, s.done.done);
    }

    restoring = false;
  }

  function init() {
    $$('.lx-recall').forEach(function (block) {
      var btn = $('[data-action="validate"]', block);
      if (btn) btn.addEventListener('click', function () { validate(block, btn); });
      setupMic(block);

      $$('.lx-fallback input[type="radio"]', block).forEach(function (input) {
        input.addEventListener('change', function () {
          var fb = block.querySelector('.lx-fallback');
          answerChoice(fb, input, block.dataset.phase,
            block.dataset.ok || t('recall.ok', 'Correct.'), block.dataset.bad || t('recall.bad', 'Not that one.'));
        });
      });
    });

    $$('.lx-quiz').forEach(function (block) {
      $$('input[type="radio"]', block).forEach(function (input) {
        input.addEventListener('change', function () {
          answerChoice(block, input, block.dataset.phase, block.dataset.ok, block.dataset.bad);
        });
      });
    });

    $$('.lx-teachback').forEach(function (block) {
      var btn = $('[data-action="teachback"]', block);
      if (btn) btn.addEventListener('click', function () { teachback(block, btn); });
      setupMic(block);
    });

    // Every draft is kept, not just submitted ones: the answer half-written when
    // the tab closed is the one worth not losing.
    $$('.lx-recall, .lx-teachback').forEach(function (block) {
      var box = $('.lx-answer', block);
      if (box) box.addEventListener('input', function () { remember('answers', blockKey(block), box.value); });
    });

    $$('[data-action="restart"]').forEach(function (btn) {
      btn.addEventListener('click', forget);
    });

    setupPrefs();

    // No phases means nothing to gate behind; otherwise the component gallery stays locked.
    if (!PHASES.length) $$('.lx-gate').forEach(function (g) { openGate(g.dataset.gate); });

    restore();

    detectServer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
