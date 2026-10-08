"""Opponent recipes for Hold On, measured against Stockfish at UCI_Elo 1320 (depth 8).
Each recipe: forced capture rule (always), guards (never hang a rook/queen, never allow mate in 1),
a gift rule that ENUMERATES legal moves with python-chess (stand-in for chess.js) and verifies with depth 10,
and a sampler for everything else: either Skill Level N or a multipv window.
"""
import chess, chess.engine, os, random, sys, time, json
SF = os.path.expanduser("~/.local/share/tintin-ai-chess-analysis/data/engine/stockfish")
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
MAXPLY = 160

def cpv(score, color): return score.pov(color).score(mate_score=10000)

def hanging(board, color, minors_only=False):
    out = []
    for sq, pc in board.piece_map().items():
        if pc.color != color or pc.piece_type in (chess.KING, chess.PAWN): continue
        if minors_only and pc.piece_type not in (chess.KNIGHT, chess.BISHOP): continue
        att = board.attackers(not color, sq)
        if not att: continue
        undefended = not board.attackers(color, sq)
        cheapest = min(VAL[board.piece_type_at(a)] for a in att)
        if undefended or cheapest < VAL[pc.piece_type]: out.append((sq, pc.piece_type))
    return out

def allows_mate_in_one(board):
    for mv in board.legal_moves:
        board.push(mv); m = board.is_checkmate(); board.pop()
        if m: return True
    return False

def guard_ok(board_after, me):
    if any(VAL[pt] >= 5 for _, pt in hanging(board_after, me)): return False
    if allows_mate_in_one(board_after): return False
    return True

def bot_move(eng, board, recipe, botmove_no, stats):
    me = board.turn
    eng.configure({"Skill Level": 20})
    infos = eng.analyse(board, chess.engine.Limit(depth=8), multipv=8)
    lines = sorted([(cpv(i["score"], me), i["pv"][0]) for i in infos if "pv" in i], key=lambda t: -t[0])
    top_s, top_m = lines[0]
    runner = lines[1][0] if len(lines) > 1 else -9999
    # forced: capture that leads by >=150, or mate
    if (board.is_capture(top_m) and top_s - runner >= 150) or top_s >= 9000:
        return top_m, "forced"
    # gift by enumeration
    if botmove_no >= recipe.get("gift_from", 3) and random.random() < recipe["gift_rate"]:
        stats["gift_rolls"] += 1
        cands = []
        for mv in board.legal_moves:
            board.push(mv)
            hm = hanging(board, me, minors_only=True)
            ok = bool(hm) and guard_ok(board, me) and not board.is_check()
            board.pop()
            if ok: cands.append(mv)
        random.shuffle(cands)
        for mv in cands[:6]:
            board.push(mv)
            inf = eng.analyse(board, chess.engine.Limit(depth=10))
            reply = inf["pv"][0]; ps = cpv(inf["score"], not me)
            hm = [s for s, _ in hanging(board, me, minors_only=True)]
            good = board.is_capture(reply) and reply.to_square in hm and ps - (-top_s) >= 200 and ps < 900
            board.pop()
            if good:
                stats["gifts"] += 1
                return mv, "gift"
        stats["gift_none"] += 1
    # sampler
    if recipe["mode"] == "skill":
        eng.configure({"Skill Level": recipe["skill"]})
        for _ in range(3):
            r = eng.play(board, chess.engine.Limit(depth=8))
            board.push(r.move); ok = guard_ok(board, me); board.pop()
            if ok: return r.move, "sampled"
        return top_m, "guarded"
    else:
        cands = [(s, m) for s, m in lines if top_s - s <= recipe["window"]]
        w = list(recipe.get("weights") or [1] * len(cands))
        w = (w + [w[-1]] * len(cands))[:len(cands)]
        for _ in range(5):
            m = random.choices(cands, weights=w, k=1)[0][1]
            board.push(m); ok = guard_ok(board, me); board.pop()
            if ok: return m, "sampled"
        return top_m, "guarded"

RESIGN = -900
def run(recipe, games, seed):
    random.seed(seed)
    bot = chess.engine.SimpleEngine.popen_uci(SF); bot.configure({"Hash": 16})
    opp = chess.engine.SimpleEngine.popen_uci(SF); opp.configure({"UCI_LimitStrength": True, "UCI_Elo": 1320})
    tot = {"score": 0.0, "plies": 0, "gifts": 0, "gift_rolls": 0, "gift_none": 0, "self_hangs": 0, "opp_took_bot_piece": 0, "bot_took_free": 0, "kinds": {}}
    t0 = time.time(); results = []
    for g in range(games):
        board = chess.Board(); bot_color = chess.BLACK if g % 2 == 0 else chess.WHITE
        n = 0; stats = {"gifts": 0, "gift_rolls": 0, "gift_none": 0}; self_hangs = 0; took = 0; lost = 0; bad = 0; resigned = None
        while not board.is_game_over(claim_draw=True) and board.ply() < MAXPLY:
            if board.turn == bot_color:
                n += 1
                free_before = [s for s, _ in hanging(board, not bot_color)]
                bot.configure({"Skill Level": 20})
                ev = cpv(bot.analyse(board, chess.engine.Limit(depth=8))["score"], bot_color)
                bad = bad + 1 if ev <= RESIGN else 0
                if bad >= 3 and n > 6: resigned = "bot"; break
                if ev >= -RESIGN:
                    stats["mercy"] = stats.get("mercy", 0) + 1
                    if stats["mercy"] >= 3: resigned = "player"; break
                else: stats["mercy"] = 0
                mv, how = bot_move(bot, board, recipe, n, stats)
                tot["kinds"][how] = tot["kinds"].get(how, 0) + 1
                if board.is_capture(mv) and mv.to_square in free_before: took += 1
                board.push(mv)
                if how == "sampled" and hanging(board, bot_color): self_hangs += 1
            else:
                bot_hanging = [s for s, _ in hanging(board, bot_color)]
                r = opp.play(board, chess.engine.Limit(depth=8))
                if board.is_capture(r.move) and r.move.to_square in bot_hanging: lost += 1
                board.push(r.move)
        res = board.result(claim_draw=True) if resigned is None else ("resign:" + resigned)
        if resigned == "bot": sc = 0.0
        elif resigned == "player": sc = 1.0
        else: sc = {"1-0": 1.0 if bot_color == chess.WHITE else 0.0, "0-1": 1.0 if bot_color == chess.BLACK else 0.0}.get(res, 0.5)
        if resigned is None and board.ply() >= MAXPLY and not board.is_game_over(claim_draw=True):
            mat = sum(VAL[p.piece_type] * (1 if p.color == bot_color else -1) for p in board.piece_map().values())
            sc = 1.0 if mat >= 3 else 0.0 if mat <= -3 else 0.5; res = f"adj({mat:+d})"
        results.append(sc)
        for k in ("gifts", "gift_rolls", "gift_none"): tot[k] += stats[k]
        tot.setdefault("ends", {}); tot["ends"][res.split("(")[0]] = tot["ends"].get(res.split("(")[0], 0) + 1
        tot["score"] += sc; tot["plies"] += board.ply(); tot["self_hangs"] += self_hangs; tot["opp_took_bot_piece"] += lost; tot["bot_took_free"] += took
        print(f"  {recipe['name']} g{g+1} bot={'W' if bot_color else 'B'} {res} plies={board.ply()} gifts={stats['gifts']} rolls={stats['gift_rolls']} none={stats['gift_none']} self_hangs={self_hangs} lost_to_opp={lost} took_free={took}", flush=True)
    bot.quit(); opp.quit()
    tot["games"] = games; tot["secs"] = round(time.time() - t0)
    return tot

RECIPES = {
  "s0g10":  {"name": "s0g10", "mode": "skill", "skill": 0, "gift_rate": 0.10},
  "s0g15":  {"name": "s0g15", "mode": "skill", "skill": 0, "gift_rate": 0.15},
  "s1g12":  {"name": "s1g12", "mode": "skill", "skill": 1, "gift_rate": 0.12},
  "s2g12":  {"name": "s2g12", "mode": "skill", "skill": 2, "gift_rate": 0.12},
  "w150g15": {"name": "w150g15", "mode": "window", "window": 150, "weights": [40, 25, 15, 10, 5, 5], "gift_rate": 0.15},
  "spec80":   {"name": "spec80", "mode": "window", "window": 80, "weights": [50, 25, 12, 8, 5], "gift_rate": 0.0},
  "skill0":   {"name": "skill0", "mode": "skill", "skill": 0, "gift_rate": 0.15},
  "skill3":   {"name": "skill3", "mode": "skill", "skill": 3, "gift_rate": 0.15},
  "win250":   {"name": "win250", "mode": "window", "window": 250, "weights": None, "gift_rate": 0.15},
  "win150g":  {"name": "win150g", "mode": "window", "window": 150, "weights": [40, 25, 15, 10, 5, 5], "gift_rate": 0.2},
}
if __name__ == "__main__":
    names = sys.argv[1].split(",") if len(sys.argv) > 1 else list(RECIPES)
    games = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    out = {}
    for nm in names:
        print("==", nm, flush=True)
        out[nm] = run(RECIPES[nm], games, seed=11)
        print("TOTAL", nm, json.dumps(out[nm]), flush=True)
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "bot_sim3-out.json"), "w"), indent=1)
