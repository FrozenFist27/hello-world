# Mission: Reach an estimated 1000 against the chess-coach bot by 1 February 2027

## The verdict

On or before **1 February 2027**: five consecutive games against the chess-coach bot at
**Intermediate**, played inside one week, no takebacks and no engine, with at least **three
wins**, and the bot's smoothed ELO estimate (its five-game average) reading **1000 or more**
after the fifth game. Puzzles are the thermometer on the way, not the verdict: by the end of
pattern 4, **15 of 20** tintins rated puzzles in the 800 to 1000 band, solved cold.

The coach chose this verdict as the default because Sambudh has no platform, no rating and no
games to anchor one; he can replace it in any session (a Lichess rapid rating of 1000, for
instance, if he opens an account).

## Why it matters

He played once, had a number under 1000, and has forgotten it. He asked for two things: to see
where he stands, and a first milestone to take on. Passing this verdict gives him the first
rating that is his own work rather than a memory, and it moves the study up a band, to tactics.
The deeper "why this, why now" is still his to tell: the coach asks it at the first close-out
and rewrites this paragraph with his answer.

## Where I am today

- Knows the rules and has finished rated games at some point; the rating was under 1000 and he
  does not remember the number or where it came from.
- Has studied nothing: no book, no course, no puzzle set.
- Has no games to review and no online account, so there is no weakness profile yet. The first
  evidence will be his three placement answers (`lessons/0000-placement`) and his first games
  against the bot.
- Working assumption until the placement says otherwise: his games are lost to hung pieces and
  one-move threats, like every game under 1000.

## Constraints

- Time: **assumed** three sessions a week of about thirty minutes each (one lesson or review,
  plus one slow game). He has not confirmed this.
- Games: two a week against the chess-coach bot from week one, slow, the blunder check said
  aloud before every move, each reviewed with tintins afterwards. These reps are in scope here
  because the bot and tintins supply them.
- No external deadline. The date is set four months out so that each pattern gets about a month.
- Nothing has failed before, because nothing was tried; what lapsed was playing itself. The risk
  to watch is the opposite one: reading about chess instead of playing it.

## Out of scope

- Opening theory. No memorised lines: three principles and one setup, nothing more, until 1000.
- Everything above the band: named tactical motifs (fork, pin, skewer, discovered attack),
  king-and-pawn theory (opposition, the square rule), positional ideas, calculation method. Each
  is the next band's work and is deliberately not taught here, even where the placement touches
  it.
- Human opponents, over the board or online. The playing reps that learno itself cannot supply
  are in scope here through the chess-coach bot (play with coaching, an ELO estimate after
  every game) and tintins (Stockfish review of each game, rated puzzles, a weakness profile):
  two games a week minimum. Games against people are recommended, not required; if he opens a
  Lichess or Chess.com account, say so and the verdict can move there.

## Curriculum

Four patterns, ordered by what loses games under 1000. Each pattern is three lessons and closes
with a project that is games to play or puzzles to solve, never an essay. Concept ids are
kebab-case.

### Pattern 1: I stop hanging pieces

The blunder check as a habit: three questions before every move, then the same three from the
opponent's chair once the move is chosen in the head.

1. `0001-blunder-check`: Look both ways, the check before every move
   (`hanging-piece`, `last-move-threat`, `blunder-check`)
2. Is it free? Counting attackers and defenders on one square, and what to take with
   (`capture-count`, `piece-values`)
3. Forcing moves first: checks and captures, theirs and mine, before any plan
   (`forcing-moves`)

Project: five slow games against the bot at Beginner, the check said aloud before every move,
each reviewed with tintins. **Three of the five with zero pieces hung** (no move losing 200 cp
or more that a one-move look would have caught), and **8 of 10** tintins puzzles on hanging
pieces and free captures.

### Pattern 2: I can mate with a queen or a rook

4. How a game ends: check, checkmate, stalemate; why a stalemate is a thrown-away win
   (`checkmate-vs-stalemate`)
5. Queen and king against king: the box, shrink it, bring the king, mate on the edge
   (`queen-king-mate`)
6. Rook and king against king: the ladder with two rooks, then one rook: cut off, step
   opposite, check (`two-rook-ladder`, `rook-king-mate`)

Project: from three set positions (king and queen, king and rook, king and two rooks, each
against a bare king) deliver mate against the bot, or against the coach in chat if the bot
cannot start from a position, **within 20 moves each, three times in a row, zero stalemates**.

### Pattern 3: I get out of the opening alive

7. Three principles: a pawn in the centre, knights and bishops out, king castled by move ten
   (`opening-principles`)
8. The early queen: Scholar's mate, how to stop it, why not to play it yourself
   (`early-queen`)
9. One setup after 1.e4 e5, as White and as Black: where each piece goes and why, no
   variations (`italian-setup`)

Project: ten games against the bot (Beginner, then Intermediate). **8 of 10 castled by move 10
with both knights and both bishops developed**, and **no piece hung in the first 15 moves in 7
of 10** (tintins review).

### Pattern 4: I see one-move threats before they land

10. Their next capture: the piece that just moved, what it now attacks, and whether that is
    defended (`threat-to-piece`)
11. Their next mate: f7, h7 with the queen, the back rank; the mates in one you must see coming
    (`mate-in-one-threat`)
12. One move, two targets: when their move attacks two things at once, and what to do about it
    (`double-attack-defence`)

Project: **15 of 20** tintins rated puzzles in the 800 to 1000 band, cold; then the verdict
itself: five games at Intermediate, three wins, estimated ELO 1000 or more.

Reviews run between lessons on the SM-2 schedule: R1 the next day with the board, R2 a week
later without the board's hint, R3 a month later with the same idea in a position he has not
seen.
