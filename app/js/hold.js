// hold.js - the hold's presentation and tap grading. It lifts the piece, breathes the destination
// amber, asks the template question at 0 ms, keeps the action bar empty until he has answered
// (right, partial or two wrongs) or the timer runs out, grades every tap with gate.grade against
// chess.js's answer set (the hold's own, or the K2 ask's once Claude chose a look), and renders
// the Hear me out input, the Looking echo, the validated say with its lit squares and the link
// states. game.js owns the state machine and calls in; this file only draws and grades.

import { COPY, DOM, KEYS, PIECE_WORDS, fill, timing } from './contract.js';
import { grade as gradeTap } from './gate.js';

const SQUARE_RE = /^[a-h][1-8]$/;

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v);
  }
  if (text) node.textContent = text;
  return node;
}

export function createHold({ board, coachLine, actions, links, store, fast = () => false, reduced = () => false } = {}) {
  let hold = null;          // the open Hold (game.js's object) or null
  let timer = null;         // the buttons timer
  let wrongs = 0;           // wrong taps against the current answer set
  let inputOpen = false;
  let inputEl = null;
  let k1 = null;            // validated K1 lines or null
  let marks = { ok: [], glow: null, lit: [] };
  let linkState = { but: 'hidden' };

  const linkEl = (name) => (links ? links.querySelector(`[data-action="${name}"]`) : null);

  // ---- marks ---------------------------------------------------------------------------------
  function paint() {
    if (!hold) return;
    board.setMarks({
      tint: hold.tint || [],
      amber: hold.to,
      ok: marks.ok,
      glow: marks.glow,
      lit: marks.lit,
    });
  }

  // ---- the action bar ------------------------------------------------------------------------
  function clearBar() {
    if (actions) actions.textContent = '';
  }
  function renderBar() {
    if (!actions || !hold) return;
    actions.textContent = '';
    if (inputOpen) {
      const box = el('div', { class: 'say', role: 'group', 'aria-label': COPY.LINKS.HEAR_ME_OUT });
      inputEl = el('input', {
        id: DOM.ids.sayInput, class: 'say-input', type: 'text', enterkeyhint: 'done',
        autocomplete: 'off', autocapitalize: 'sentences', maxlength: '120', placeholder: COPY.SAY_PLACEHOLDER,
      });
      const send = el('button', { class: DOM.buttonClasses.primary, 'data-action': 'send', type: 'button' }, COPY.BUTTONS.SEND);
      box.appendChild(inputEl);
      box.appendChild(send);
      actions.appendChild(box);
      actions.appendChild(el('p', { class: 'note' }, COPY.SAY_NOTE));
      return;
    }
    if (hold.buttonsShown) {
      const back = el('button', { class: DOM.buttonClasses.primary, 'data-action': 'takeback', type: 'button' }, COPY.BUTTONS.TAKE_BACK);
      const anyway = el('button', { class: DOM.buttonClasses.quiet, 'data-action': 'anyway', type: 'button' }, COPY.BUTTONS.PLAY_ANYWAY);
      actions.appendChild(back);
      actions.appendChild(anyway);
      try { back.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    }
  }

  function stopTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // ---- links ---------------------------------------------------------------------------------
  function applyLinks() {
    const showme = linkEl('showme');
    if (showme) showme.hidden = !hold;
    const but = linkEl('but');
    if (but) {
      const state = hold && !inputOpen ? linkState.but : 'hidden';
      but.hidden = state === 'hidden';
      but.textContent = state === 'retry' ? COPY.LINKS.TRY_AGAIN : COPY.LINKS.HEAR_ME_OUT;
    }
  }
  function setLink(name, state) {
    if (name !== 'but') return;
    linkState.but = state === 'hear' || state === 'retry' ? state : 'hidden';
    applyLinks();
  }

  // ---- grading -------------------------------------------------------------------------------
  function activeAsk() {
    if (!hold || !hold.ask || !Array.isArray(hold.asks)) return null;
    return hold.asks.find((a) => a && a.kind === hold.ask) || null;
  }
  function activeAnswer() {
    if (!hold) return null;
    const ask = activeAsk();
    if (ask) return { squares: ask.squares || [], best: ask.best || null, partial: ask.partial || [] };
    return hold.answer || { squares: [], best: null, partial: [] };
  }
  // The lines for the tap: the K2 look's own copy when Claude chose a look that is not the
  // hold's (its {piece} is the piece on the square, {square} the square named), else the hold's
  // own lines (K1's when they arrived, and only for the hold's own best square).
  function pieceWordOn(square) {
    const f = hold && (hold.factsAfter || hold.factsBefore);
    const p = f && f.bySquare && f.bySquare[square];
    return p && p.type in PIECE_WORDS ? PIECE_WORDS[p.type] : 'piece';
  }
  function askCopy() {
    const ask = activeAsk();
    return ask && !ask.own && ask.copy ? ask.copy : null;
  }

  function firstHoldSentence(text) {
    if (!store || String(store.get(KEYS.FIRST_HOLD_SEEN, '')) === '1') return text;
    store.set(KEYS.FIRST_HOLD_SEEN, '1');
    return `${text} ${COPY.FIRST_HOLD}`;
  }

  function sayCoach(text, fromClaude = false) {
    coachLine.say(text);
    if (fromClaude && hold) hold.claude.coachShown = true;
  }

  function open(h, { hear = false } = {}) {
    close();
    hold = h;
    wrongs = 0;
    k1 = null;
    marks = { ok: [], glow: null, lit: [] };
    linkState = { but: hear ? 'hear' : 'hidden' };
    hold.taps = hold.taps || [];
    hold.answered = false;
    hold.buttonsShown = false;
    hold.ask = hold.ask || null;
    hold.claude = hold.claude || { k2: 'none', k1: 'none', k1Lines: null, coachShown: false };
    board.setState('held', hold.category);
    board.setInput('answer');
    board.pick(null);
    board.pending(null);
    board.lift(hold.to);
    paint();
    coachLine.say(hold.question);
    clearBar();
    applyLinks();
    stopTimer();
    timer = setTimeout(() => { timer = null; showButtons(); }, timing('BUTTONS_MS', fast()));
  }

  function showButtons() {
    if (!hold) return;
    stopTimer();
    hold.buttonsShown = true;
    // the open Hear me out input keeps the bar (closeInput() draws the buttons when it closes), as
    // does a Give up confirm (Keep playing restores them); the bar is never rebuilt under either
    if (inputOpen) return;
    if (actions && actions.querySelector('[data-action="giveup-yes"]')) return;
    if (actions && actions.querySelector('[data-action="takeback"]')) return;
    renderBar();
  }

  function tap(square) {
    if (!hold || !SQUARE_RE.test(String(square))) return null;
    const answer = activeAnswer();
    const ac = askCopy();
    const g = gradeTap(answer, square);
    // K1's lines are written for the hold's own look and its best square
    const useK1 = (key) => !ac && k1 && k1[key] && (g !== 'right' || answer.best === null || square === answer.best);
    let result = g;
    let line;
    if (g === 'right') {
      if (ac) line = fill(ac.if_right, { piece: pieceWordOn(square), square });
      else line = useK1('if_right') ? k1.if_right : hold.copy.if_right(square);
      if (useK1('if_right') && k1.and_then) line = `${line} ${k1.and_then}`;
      marks.ok = [square];
      marks.glow = null;
      hold.answered = true;
    } else if (g === 'partial') {
      if (ac) line = fill(ac.if_partial || ac.if_wrong, { piece: pieceWordOn(square), square });
      else line = useK1('if_partial') ? k1.if_partial : hold.copy.if_partial(square);
      hold.answered = true;
    } else {
      wrongs += 1;
      if (wrongs < 2) {
        if (ac) line = fill(ac.if_wrong, { piece: pieceWordOn(square), square });
        else line = useK1('if_wrong') ? k1.if_wrong : hold.copy.if_wrong;
      } else {
        result = 'named';
        const best = answer.best || (answer.squares && answer.squares[0]) || null;
        marks.glow = best;
        line = ac ? fill(ac.named, { piece: pieceWordOn(best), square: best }) : hold.copy.named;
        hold.answered = true;
      }
    }
    const fromClaude = !ac && !!(k1 && ((g === 'right' && (useK1('if_right') || k1.and_then)) || (g === 'partial' && useK1('if_partial')) || (g === 'wrong' && wrongs < 2 && useK1('if_wrong'))));
    hold.taps.push({ square, grade: result, ask: hold.ask || null });
    paint();
    if (result === 'right' || result === 'partial' || result === 'named') {
      line = firstHoldSentence(line);
      sayCoach(line, fromClaude);
      showButtons();
    } else {
      sayCoach(line, fromClaude);
    }
    return result;
  }

  // ---- Claude --------------------------------------------------------------------------------
  function setK1(lines) {
    k1 = lines && typeof lines === 'object' ? lines : null;
    if (hold) {
      hold.claude.k1Lines = k1;
      hold.claude.k1 = k1 ? 'ready' : hold.claude.k1;
    }
  }

  function showSay(reply, askQuestion) {
    if (!hold) return;
    unlooking();
    const say = reply && typeof reply.say === 'string' ? reply.say.trim() : '';
    const ask = reply && reply.ask ? reply.ask : null;
    hold.ask = ask;
    wrongs = 0;
    marks.lit = Array.isArray(reply && reply.squares) ? reply.squares.filter((s) => SQUARE_RE.test(String(s))).slice(0, 3) : [];
    marks.glow = null;
    paint();
    const q = ask && askQuestion ? ` ${askQuestion}` : '';
    hold.claude.k2 = 'shown';
    sayCoach(`${say}${q}`, true);
    setLink('but', 'hidden');
  }

  function showFallback() {
    if (!hold) return;
    unlooking();
    hold.claude.k2 = 'failed';
    coachLine.say(hold.copy.fallback);
    setLink('but', 'hidden');
  }

  function looking(text) {
    coachLine.say(COPY.LOOKING);
    coachLine.echo(text);
    coachLine.pulse(true);
  }
  function unlooking() {
    coachLine.pulse(false);
  }

  function openInput() {
    if (!hold || inputOpen) return;
    inputOpen = true;
    renderBar();
    applyLinks();   // the open input is the Hear me out affordance: the link steps aside
    try { document.body.classList.add('typing'); } catch { /* no body: nothing to mark */ }
    if (inputEl) { try { inputEl.focus({ preventScroll: true }); } catch { /* courtesy */ } }
  }
  function closeInput() {
    if (!inputOpen) return;
    inputOpen = false;
    inputEl = null;
    try { document.body.classList.remove('typing'); } catch { /* ignore */ }
    if (hold) renderBar();
    else clearBar();
    applyLinks();
  }
  function inputValue() {
    return inputEl ? inputEl.value : '';
  }

  // Re-render whatever the hold's bar should hold (after a give-up confirm was dismissed).
  function restore() {
    if (!hold) { clearBar(); return; }
    renderBar();
  }

  function close() {
    stopTimer();
    if (inputOpen) closeInput();
    if (hold) {
      hold.buttonsShown = hold.buttonsShown || false;
      board.lift(null);
      board.setMarks({ tint: hold.tint || [] });
    }
    hold = null;
    k1 = null;
    wrongs = 0;
    marks = { ok: [], glow: null, lit: [] };
    linkState = { but: 'hidden' };
    coachLine.pulse(false);
    clearBar();
    applyLinks();
  }

  return {
    open, tap, showButtons, setK1, showSay, showFallback, looking, unlooking,
    openInput, closeInput, inputValue, setLink, restore, close,
    isOpen: () => !!hold,
    inputIsOpen: () => inputOpen,
    reduced,
  };
}
