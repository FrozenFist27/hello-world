const { chromium } = require('playwright');
const S = {
  firstScreen: "Your move. Most people take on f7 here. Go on.",
  k1q: "Hold on. If the knight lands there, what takes it? Tap it.",
  k1qLinks: "Hold on. If the knight lands there, what takes it? Tap it.  Show me   But...",
  k1q18w: "Hold on. Before the knight lands on that square, which of their pawns is already looking at it? Tap it.",
  k1q18wLinks: "Hold on. Before the knight lands on that square, which of their pawns is already looking at it? Tap it.  Show me   But...",
  k2example: "You are, and the bishop on c4 already points at f7. But it is their move first, and the pawn on d6 takes the knight before you get there. Is there a square that still looks at their king that no pawn can reach?",
  anyway: "There it goes. A knight for a pawn. You saw it coming; that counts.",
  tutorialEnd: "Good. That is all I do: I hold the move, I ask, you decide. Now a real game.",
  remembered: "Two holds last game, both a pawn you did not see. Watch the pawns.",
  resign: "Black gives up. You are a queen ahead and it knows it.",
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
