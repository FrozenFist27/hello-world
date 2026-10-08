#!/usr/bin/env python3
"""Self-play check of the Hold On opponent recipe (app/js/bot.js) against Stockfish at UCI_Elo 1320.

Ported from product/research/bot_sim5.py to the shipped recipe. python-chess stands in for chess.js;
the native Stockfish stands in for the WASM Worker. Per bot move, in this order:
  (0) the book (app/data/book.json) when the bot is Black and the position is in it;
  (1) the full-strength look: Skill Level 20, depth LOOK_DEPTH, multipv 2. The top move is played when it
      is a capture leading line 2 by FORCED or more, or a mate, or when line 2 captures on the same
      square (the piece is taken either way);
  (2) from the bot's move GIFT_FROM, with probability GIFT_RATE, the gift: legal moves after which a bot
      minor piece is attacked-and-undefended or attacked by a pawn, giving no check, hanging nothing
      worth GUARD_VALUE or more, allowing no mate in one; up to GIFT_CHECKS verified at GIFT_DEPTH (the
      opponent's best reply is that capture, gains GIFT_MIN_GAIN or more from its side, stays under
      GIFT_CAP); the first that passes is played;
  (3) the sampler: Skill Level SKILL, depth SAMPLE_DEPTH, re-picked up to SAMPLE_RETRIES times when a
      bot rook or queen hangs or the opponent has a mate in one afterwards;
  (4) else the look's top move.
Resignation: the look's bot-side eval at or below RESIGN for RESIGN_STREAK consecutive bot moves after
move RESIGN_AFTER, unless the opponent has a queen or a rook and the bot has only king and pawns.

Determinism. Stockfish's Skill Level and UCI_Elo handicaps pick the move with Skill::pick_best (search.cpp),
a formula over the multipv-4 root scores plus a PRNG that Stockfish seeds from the clock, so two runs of
the same seed would differ. This script reproduces that exact formula in skill_pick() with a seeded PRNG
(the engine runs at full strength with MultiPV 4; the pick happens at the depth Stockfish picks at:
1 + level, or the last iteration), for the bot's sampler (Skill Level SKILL) and for the opponent
(UCI_Elo OPP_ELO, level 0, which Stockfish picks at depth 1). Fixed-depth single-threaded searches are
deterministic, so `--seed 11` gives the same twenty games every run.

  python3 scripts/bot_sim.py [games=10] [--seed 11] [--json out.json]

Plays `games` games plain (the 1320 engine as it is) and `games` games held (the same engine prevented
from leaving a piece worth two or more hanging), then prints gifts per game, mean plies, sampled moves
that hang a rook or queen or allow a mate in one (must be 0), the plain score and the held score, and
exits 1 when a target fails: gifts >= 2.0, plies <= 100, guards == 0, 5 <= plain score <= 9, held <= 2.
"""
import argparse
import json
import os
import random
import sys
import time

import chess
import chess.engine

# ---- the shipped recipe (mirror of contract.js BOT / ENGINE) --------------------------------------
GIFT_RATE = 0.12       # BOT.GIFT_RATE
SKILL = 3              # BOT.SKILL (the sampler's Skill Level)
SAMPLE_DEPTH = 2       # BOT.SAMPLE_DEPTH
GIFT_FROM = 3          # BOT.GIFT_FROM_MOVE
GIFT_CHECKS = 6        # BOT.GIFT_MAX_CHECKS
GIFT_DEPTH = 10        # BOT.GIFT_DEPTH
GIFT_MIN_GAIN = 200    # BOT.GIFT_MIN_GAIN_CP
GIFT_CAP = 900         # BOT.GIFT_CAP_CP
LOOK_DEPTH = 8         # BOT.LOOK_DEPTH
LOOK_MULTIPV = 2       # ENGINE.MULTIPV
FORCED = 150           # BOT.FORCED_LEAD_CP
SAMPLE_RETRIES = 2     # BOT.SAMPLE_RETRIES
GUARD_VALUE = 5        # BOT.GUARD_HANG_VALUE
RESIGN = -900          # BOT.RESIGN_CP
RESIGN_STREAK = 3      # BOT.RESIGN_STREAK
RESIGN_AFTER = 6       # BOT.RESIGN_AFTER_MOVE
MERCY = 900            # the opponent's stand-in for 'Start again': three bot-side evals at or above this
HASH_MB = 16
MATE_SCORE = 10000
MAXPLY = 160

# ---- the opponent ---------------------------------------------------------------------------------
OPP_ELO = 1320
OPP_DEPTH = 8

# ---- Stockfish's handicap internals (search.h / search.cpp / uci.cpp, sf_18) ------------------------
SF_LOWEST_ELO, SF_HIGHEST_ELO = 1320, 3190
SF_PAWN_VALUE = 208                     # types.h PawnValue, the cap on delta in pick_best
SF_VALUE_MATE = 32000
SF_WIN_RATE_AS = (-72.32565836, 185.93832038, -144.58862193, 416.44950446)   # uci.cpp win_rate_params

# ---- targets ---------------------------------------------------------------------------------------
TARGET_GIFTS = 2.0
TARGET_PLIES = 100
TARGET_SCORE = (5.0, 9.0)
TARGET_HELD = 2.0

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK_PATH = os.path.join(ROOT, "app", "data", "book.json")
SF_CANDIDATES = [
    os.environ.get("STOCKFISH_PATH") or "",
    os.path.expanduser("~/.local/share/tintin-ai-chess-analysis/data/engine/stockfish"),
    "/root/.local/share/tintin-ai-chess-analysis/data/engine/stockfish",
]
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def find_stockfish():
    for c in SF_CANDIDATES:
        if c and os.path.exists(c):
            return c
    import shutil
    on_path = shutil.which("stockfish")
    if on_path:
        return on_path
    sys.exit("Stockfish not found: set STOCKFISH_PATH")


def load_book():
    try:
        with open(BOOK_PATH) as f:
            return json.load(f).get("entries", {})
    except (OSError, ValueError):
        return {}


def fen4(board):
    return " ".join(board.fen().split(" ")[:4])


def side_score(score, color):
    """A python-chess PovScore as a number for `color`: cp, or mate N -> sign * (MATE_SCORE - |N|)."""
    s = score.pov(color)
    if s.is_mate():
        n = s.mate()
        return -MATE_SCORE if n == 0 else (1 if n > 0 else -1) * (MATE_SCORE - abs(n))
    return s.score()


# ---- chess.js stand-ins (the fact-sheet predicates) --------------------------------------------------
def is_hanging(board, sq):
    pc = board.piece_at(sq)
    if pc is None or pc.piece_type == chess.KING:
        return False
    att = board.attackers(not pc.color, sq)
    if not att:
        return False
    if not board.attackers(pc.color, sq):
        return True
    cheapest = min((VAL[board.piece_type_at(a)] for a in att if board.piece_type_at(a) != chess.KING), default=99)
    return cheapest < VAL[pc.piece_type]


def hanging(board, color, min_value=0):
    return [sq for sq, pc in board.piece_map().items()
            if pc.color == color and pc.piece_type != chess.KING and VAL[pc.piece_type] >= min_value and is_hanging(board, sq)]


def has_mate_in_one(board):
    for mv in board.legal_moves:
        board.push(mv)
        m = board.is_checkmate()
        board.pop()
        if m:
            return True
    return False


def guards_ok(board_after, bot):
    if hanging(board_after, bot, GUARD_VALUE):
        return False
    if has_mate_in_one(board_after):
        return False
    return True


def gift_candidates(board, bot):
    """Legal bot moves after which a bot minor is attacked-and-undefended or attacked by a pawn, giving no
    check, hanging nothing worth GUARD_VALUE or more, allowing no mate in one. [(move, [hung squares])]."""
    out = []
    for mv in list(board.legal_moves):
        board.push(mv)
        try:
            if board.is_check():
                continue
            hung = []
            for sq, pc in board.piece_map().items():
                if pc.color != bot or pc.piece_type not in (chess.KNIGHT, chess.BISHOP):
                    continue
                att = board.attackers(not bot, sq)
                if not att:
                    continue
                undefended = not board.attackers(bot, sq)
                by_pawn = any(board.piece_type_at(a) == chess.PAWN for a in att)
                if undefended or by_pawn:
                    hung.append(sq)
            if not hung:
                continue
            if hanging(board, bot, GUARD_VALUE):
                continue
            if has_mate_in_one(board):
                continue
            out.append((mv, hung))
        finally:
            board.pop()
    return out


# ---- Stockfish's Skill::pick_best with a seeded PRNG ---------------------------------------------------
def skill_level_for_elo(elo):
    e = (elo - SF_LOWEST_ELO) / (SF_HIGHEST_ELO - SF_LOWEST_ELO)
    return min(19.0, max(0.0, (((37.2473 * e - 40.8525) * e + 22.2943) * e - 0.311438)))


def win_rate_a(board):
    """uci.cpp win_rate_params: internal Value = cp * a / 100, a from the material count."""
    material = (len(board.pieces(chess.PAWN, True)) + len(board.pieces(chess.PAWN, False))
                + 3 * (len(board.pieces(chess.KNIGHT, True)) + len(board.pieces(chess.KNIGHT, False)))
                + 3 * (len(board.pieces(chess.BISHOP, True)) + len(board.pieces(chess.BISHOP, False)))
                + 5 * (len(board.pieces(chess.ROOK, True)) + len(board.pieces(chess.ROOK, False)))
                + 9 * (len(board.pieces(chess.QUEEN, True)) + len(board.pieces(chess.QUEEN, False))))
    m = min(78, max(17, material)) / 58.0
    a0, a1, a2, a3 = SF_WIN_RATE_AS
    return (((a0 * m + a1) * m + a2) * m) + a3


def internal_value(score, color, a):
    """A python-chess PovScore as Stockfish's internal Value for `color`."""
    s = score.pov(color)
    if s.is_mate():
        n = s.mate()
        if n == 0:
            return -SF_VALUE_MATE
        plies = 2 * abs(n) - 1 if n > 0 else 2 * abs(n)
        return SF_VALUE_MATE - plies if n > 0 else -SF_VALUE_MATE + plies
    return int(round(s.score() * a / 100))


def skill_pick(eng, board, level, depth, rng):
    """The move Stockfish would play at this Skill level: its own multipv-4 root scores at the depth it
    picks at (1 + int(level), or the final iteration when the search is shallower), pushed by
    pick_best's formula with a seeded PRNG in place of the clock-seeded one."""
    pick_depth = 1 + int(level) if 1 + int(level) <= depth else depth
    infos = eng.analyse(board, chess.engine.Limit(depth=pick_depth), multipv=4)
    a = win_rate_a(board)
    lines = [(internal_value(i["score"], board.turn, a), i["pv"][0]) for i in infos if "pv" in i]
    if not lines:
        return next(iter(board.legal_moves))
    lines.sort(key=lambda t: -t[0])
    top = lines[0][0]
    delta = min(top - lines[-1][0], SF_PAWN_VALUE)
    weakness = 120 - 2 * level
    best, max_score = lines[0][1], -10 ** 9
    for score, mv in lines:
        push = int(weakness * (top - score) + delta * (rng.getrandbits(32) % int(weakness))) // 128
        if score + push >= max_score:
            max_score = score + push
            best = mv
    return best


# ---- the ladder --------------------------------------------------------------------------------------
def bot_move(eng, board, book, botmove_no, gift_rate, stats, rng):
    """Returns (move, how, bot_eval). bot_eval is None for book moves."""
    bot = board.turn
    if bot == chess.BLACK:
        entry = book.get(fen4(board))
        if entry:
            try:
                mv = board.parse_san(entry["reply"])
                return mv, "book", None
            except ValueError:
                pass

    infos = eng.analyse(board, chess.engine.Limit(depth=LOOK_DEPTH), multipv=LOOK_MULTIPV)
    lines = [(side_score(i["score"], bot), i["pv"][0]) for i in infos if "pv" in i]
    if not lines:
        return next(iter(board.legal_moves)), "guarded", 0
    top_s, top_m = lines[0]
    bot_eval = top_s
    runner = lines[1][0] if len(lines) > 1 else -99999
    second = lines[1][1] if len(lines) > 1 else None
    same_square = second is not None and board.is_capture(second) and second.to_square == top_m.to_square
    if (board.is_capture(top_m) and (top_s - runner >= FORCED or same_square)) or top_s >= MATE_SCORE - 1000:
        return top_m, "forced", bot_eval

    if botmove_no >= GIFT_FROM and random.random() < gift_rate:
        stats["gift_rolls"] += 1
        cands = gift_candidates(board, bot)
        random.shuffle(cands)
        for mv, hung in cands[:GIFT_CHECKS]:
            board.push(mv)
            inf = eng.analyse(board, chess.engine.Limit(depth=GIFT_DEPTH))
            reply = inf["pv"][0] if inf.get("pv") else None
            ps = side_score(inf["score"], not bot)
            good = (reply is not None and board.is_capture(reply) and reply.to_square in hung
                    and ps - (-bot_eval) >= GIFT_MIN_GAIN and ps < GIFT_CAP)
            board.pop()
            if good:
                stats["gifts"] += 1
                return mv, "gift", bot_eval
        stats["gift_none"] += 1

    for _ in range(SAMPLE_RETRIES + 1):
        mv = skill_pick(eng, board, SKILL, SAMPLE_DEPTH, rng)
        board.push(mv)
        ok = guards_ok(board, bot)
        board.pop()
        if ok:
            return mv, "sampled", bot_eval
    return top_m, "guarded", bot_eval


def should_resign(evals, botmove_no, board, bot):
    if botmove_no <= RESIGN_AFTER:
        return False
    nums = [e for e in evals if e is not None]
    if len(nums) < RESIGN_STREAK or not all(e <= RESIGN for e in nums[-RESIGN_STREAK:]):
        return False
    opp = not bot
    player_heavy = bool(board.pieces(chess.QUEEN, opp) or board.pieces(chess.ROOK, opp))
    bot_only_kp = not any(board.pieces(pt, bot) for pt in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT))
    if player_heavy and bot_only_kp:
        return False
    return True


# ---- the opponent -------------------------------------------------------------------------------------
def opponent_move(opp, board, held, rng):
    if not held:
        return skill_pick(opp, board, skill_level_for_elo(OPP_ELO), OPP_DEPTH, rng)
    infos = opp.analyse(board, chess.engine.Limit(depth=OPP_DEPTH), multipv=6)
    me = board.turn
    for inf in infos:
        if "pv" not in inf:
            continue
        m = inf["pv"][0]
        board.push(m)
        hang = [sq for sq in hanging(board, me) if VAL[board.piece_type_at(sq)] >= 2]
        board.pop()
        if not hang:
            return m
    return infos[0]["pv"][0]


# ---- the games ------------------------------------------------------------------------------------------
def run(games, seed, held, sf_path, book, gift_rate=GIFT_RATE, verbose=True):
    random.seed(seed)
    rng = random.Random(seed)
    bot = chess.engine.SimpleEngine.popen_uci(sf_path)
    bot.configure({"Hash": HASH_MB, "Skill Level": 20})
    opp = chess.engine.SimpleEngine.popen_uci(sf_path)
    opp.configure({"Hash": HASH_MB, "Skill Level": 20})   # the handicap is applied by skill_pick()
    label = "held" if held else "plain"
    tot = {"label": label, "games": games, "score": 0.0, "plies": 0, "gifts": 0, "gift_rolls": 0, "gift_none": 0,
           "guard_violations": 0, "sampled_hangs": 0, "opp_took_bot_piece": 0, "bot_took_free": 0, "kinds": {}, "ends": {}, "per_game": []}
    t0 = time.time()
    for g in range(games):
        board = chess.Board()
        bot_color = chess.BLACK if g % 2 == 0 else chess.WHITE
        n = 0
        stats = {"gifts": 0, "gift_rolls": 0, "gift_none": 0}
        evals = []
        mercy = 0
        self_hangs = 0
        guard_violations = 0
        took = lost = 0
        resigned = None
        while not board.is_game_over(claim_draw=True) and board.ply() < MAXPLY:
            if board.turn == bot_color:
                n += 1
                free_before = set(hanging(board, not bot_color))
                mv, how, ev = bot_move(bot, board, book, n, gift_rate, stats, rng)
                evals.append(ev)
                tot["kinds"][how] = tot["kinds"].get(how, 0) + 1
                if should_resign(evals, n, board, bot_color):
                    resigned = "bot"
                    break
                if ev is not None and ev >= MERCY:
                    mercy += 1
                    if mercy >= 3:
                        resigned = "player"
                        break
                else:
                    mercy = 0
                if board.is_capture(mv) and mv.to_square in free_before:
                    took += 1
                board.push(mv)
                if how == "sampled":
                    if hanging(board, bot_color):
                        self_hangs += 1
                    if not guards_ok(board, bot_color):
                        guard_violations += 1
            else:
                bot_hanging = set(hanging(board, bot_color))
                mv = opponent_move(opp, board, held, rng)
                if board.is_capture(mv) and mv.to_square in bot_hanging:
                    lost += 1
                board.push(mv)
        if resigned == "bot":
            res, sc = "resign:bot", 0.0
        elif resigned == "player":
            res, sc = "resign:player", 1.0
        else:
            res = board.result(claim_draw=True)
            if board.ply() >= MAXPLY and not board.is_game_over(claim_draw=True):
                mat = sum(VAL[p.piece_type] * (1 if p.color == bot_color else -1) for p in board.piece_map().values())
                sc = 1.0 if mat >= 3 else 0.0 if mat <= -3 else 0.5
                res = "adj(%+d)" % mat
            else:
                sc = {"1-0": 1.0 if bot_color == chess.WHITE else 0.0, "0-1": 1.0 if bot_color == chess.BLACK else 0.0}.get(res, 0.5)
        for k in ("gifts", "gift_rolls", "gift_none"):
            tot[k] += stats[k]
        end = res.split("(")[0]
        tot["ends"][end] = tot["ends"].get(end, 0) + 1
        tot["score"] += sc
        tot["plies"] += board.ply()
        tot["sampled_hangs"] += self_hangs
        tot["guard_violations"] += guard_violations
        tot["opp_took_bot_piece"] += lost
        tot["bot_took_free"] += took
        tot["per_game"].append({"game": g + 1, "bot": "W" if bot_color else "B", "result": res, "plies": board.ply(), "gifts": stats["gifts"], "score": sc})
        if verbose:
            print("  %s g%d bot=%s %s plies=%d gifts=%d rolls=%d none=%d sampled_hangs=%d guard_violations=%d lost_to_opp=%d took_free=%d"
                  % (label, g + 1, "W" if bot_color else "B", res, board.ply(), stats["gifts"], stats["gift_rolls"], stats["gift_none"],
                     self_hangs, guard_violations, lost, took), flush=True)
    bot.quit()
    opp.quit()
    tot["secs"] = round(time.time() - t0, 1)
    tot["gifts_per_game"] = round(tot["gifts"] / games, 2)
    tot["mean_plies"] = round(tot["plies"] / games, 1)
    return tot


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("games", nargs="?", type=int, default=10)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--json", default=None, help="write the full results here")
    ap.add_argument("--only", choices=["plain", "held"], default=None)
    a = ap.parse_args()
    sf = find_stockfish()
    book = load_book()
    print("recipe: GIFT_RATE=%.2f SKILL=%d SAMPLE_DEPTH=%d GIFT_FROM=%d LOOK_DEPTH=%d GIFT_DEPTH=%d FORCED=%d RESIGN=%d; book entries=%d; seed=%d; games=%d"
          % (GIFT_RATE, SKILL, SAMPLE_DEPTH, GIFT_FROM, LOOK_DEPTH, GIFT_DEPTH, FORCED, RESIGN, len(book), a.seed, a.games), flush=True)
    results = {}
    for held in (False, True):
        label = "held" if held else "plain"
        if a.only and a.only != label:
            continue
        print("== %s (UCI_Elo %d = Skill level %.2f, depth %d%s)" % (label, OPP_ELO, skill_level_for_elo(OPP_ELO), OPP_DEPTH, ", prevented from hanging a piece" if held else ""), flush=True)
        results[label] = run(a.games, a.seed, held, sf, book)
    if a.json:
        with open(a.json, "w") as f:
            json.dump(results, f, indent=1)
    plain = results.get("plain")
    held = results.get("held")
    checks = []
    # gifts and plies per game over every game played (plain and held): twenty games read steadier than ten
    all_games = sum(r["games"] for r in results.values())
    gifts_per_game = round(sum(r["gifts"] for r in results.values()) / max(1, all_games), 2)
    mean_plies = round(sum(r["plies"] for r in results.values()) / max(1, all_games), 1)
    checks.append(("gifts per game >= %.1f (over %d games)" % (TARGET_GIFTS, all_games), gifts_per_game, gifts_per_game >= TARGET_GIFTS))
    checks.append(("mean plies <= %d (over %d games)" % (TARGET_PLIES, all_games), mean_plies, mean_plies <= TARGET_PLIES))
    if plain:
        checks.append(("sampled guard violations == 0", plain["guard_violations"], plain["guard_violations"] == 0))
        checks.append(("score %.0f..%.0f of %d" % (TARGET_SCORE[0], TARGET_SCORE[1], plain["games"]), plain["score"], TARGET_SCORE[0] <= plain["score"] <= TARGET_SCORE[1]))
    if held:
        checks.append(("held guard violations == 0", held["guard_violations"], held["guard_violations"] == 0))
        checks.append(("held score <= %.0f of %d" % (TARGET_HELD, held["games"]), held["score"], held["score"] <= TARGET_HELD))
    print("== summary")
    for label, r in results.items():
        print("  %s: score=%.1f/%d gifts/game=%.2f mean_plies=%.1f sampled_hangs=%d guard_violations=%d kinds=%s ends=%s secs=%s"
              % (label, r["score"], r["games"], r["gifts_per_game"], r["mean_plies"], r["sampled_hangs"], r["guard_violations"],
                 json.dumps(r["kinds"]), json.dumps(r["ends"]), r["secs"]))
    ok = True
    for name, value, passed in checks:
        ok = ok and passed
        print("  %s %s (%s)" % ("PASS" if passed else "FAIL", name, value))
    print("BOT SIM", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
