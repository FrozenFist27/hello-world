# Notes on Sambudh

## Facts (what he told us)

- Writes in English; lessons are in English (`learno.json` is `{"lang": "en"}`).
- Has played before and once had a rating, under 1000; does not remember the number or where
  it came from.
- Has studied nothing: no book, no course, no puzzle set.
- Has no games to share and no online username, so there is no weakness profile yet.
- First session: wants to see where he stands (the placement, `lessons/0000-placement`) and
  then take on the first milestone.

## Assumptions (flagged, to confirm with him)

- **Hours per week:** assumed three sessions of about thirty minutes (one lesson or review plus
  one slow game). He has not said.
- **Session length:** assumed thirty minutes; lessons are sized to finish in one sitting of
  that length, three phases as the norm.
- **Daily context for analogies:** unknown. No job, hobby or routine was mentioned. Until he
  tells us, analogies come from universal everyday life (crossing a road, locking a door,
  checking pockets at the front door, cooking), never from his work and never from computing.
- **Platform:** none. The chess-coach bot's ELO estimate and tintins' rated puzzles are the
  only numbers we have; if he opens a Lichess or Chess.com account, record it here and offer
  to move the verdict.
- **Pace:** unknown whether he wants to be pushed or eased in. Start steady; ask at the first
  close-out.

## Teaching stance for this band (under 1000)

- One idea per lesson. If a lesson needs two, split it.
- The blunder check before anything else. Pattern 1 closes when the check runs by itself in
  his games (tintins review shows it), not when the lesson scores well.
- No opening theory. Three principles and one setup; a variation is never the answer.
- Every lesson position is from a beginner's 1.e4 e5 game and verified with Stockfish
  (`scripts/engine_check.py`, depth 20 or more; mates with the `mate` command). Once he has
  played, his own mistakes replace textbook positions.
- Practice is a position with a question, graded by the model; projects are games and puzzles,
  never essays.
- Reviews follow learno's rules: no analogy, no flashcards, questions before corrections,
  harder at each interval.
- Give the numbers (engine evaluations, piece values), but the reason is what he will remember
  at the board, so the reason comes first and the number backs it.

## Things to avoid

- Teaching tactics by name (fork, pin, skewer) before pattern 1 closes. Naming motifs feels
  like progress and does not stop the hung pieces.
- Long lessons. Five phases is the ceiling; three is the norm.
- Assuming he knows a rule corner (stalemate, castling conditions, en passant). Check inside
  pattern 2, where beginners' rule gaps show.

## Things that worked and did not

- Nothing recorded yet; the first lesson has not been taken. Update at the first close-out.
