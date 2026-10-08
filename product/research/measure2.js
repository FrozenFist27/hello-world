const { chromium } = require('playwright');
const S = {
  k1_16w: "Hold on. Before the knight lands on that square, which of their pawns already looks at it? Tap it.",
  k1_template: "Hold on. If the knight lands there, what takes it? Tap it.",
  ignored: "Hold on. One of yours is already under attack. Tap it.",
  k2_20_plus_8: "You are, and the bishop on c4 already points at f7. But the pawn on d6 takes the knight first. Tap a square where the knight is safe.",
  k2_26w: "Your bishop on c4 does point at the pawn in front of their king, but it is their move first and the pawn on d6 takes the knight. Tap a square where the knight is safe.",
  anyway_wrong: "There it goes. A knight for a pawn. Next time, the pawns first.",
  firstframe: "Try one. Most people take the pawn in front of the king here. Go on.",
  minus: "Minus two: a knight counts three, a pawn one.",
  close: "I stopped your hand 3 times; you took it back twice. Pieces given away: 1 (last game 4). Free pieces you took: 2.",
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const out = {};
  for (const [w, fs] of [[368, 19], [558, 21]]) {
    out[`${w}px/${fs}px`] = {};
    for (const [k, t] of Object.entries(S)) {
      const h = await p.evaluate(([w, fs, t]) => {
        document.body.innerHTML = '';
        const d = document.createElement('div');
        d.style.cssText = `width:${w}px;font:${fs}px/1.35 "Liberation Serif","Times New Roman",serif;`;
        d.textContent = t; document.body.appendChild(d);
        return d.getBoundingClientRect().height;
      }, [w, fs, t]);
      out[`${w}px/${fs}px`][k] = { words: t.split(/\s+/).length, lines: Math.round(h / (fs * 1.35)) };
    }
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
