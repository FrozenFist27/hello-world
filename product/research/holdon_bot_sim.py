"""Measure the spec's opponent recipe: depth 8 multipv 6, candidates within 80 cp of best,
weighted 50/25/12/8/5, forced top move when it is a capture gaining >=200 cp or a mate,
gift rule on bot moves 5..25 at 1/8, verified by a depth-10 search.
Plays it against Stockfish limited to UCI_Elo 1320 (the engine's floor).
Reports: results, how many pieces the Hold On bot hung by itself, how often a gift qualified.
"""
import chess, chess.engine, os, random, sys, time

SF = os.environ["STOCKFISH_PATH"]
GAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 4
MAXPLY = 160
random.seed(7)
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
W = [50, 25, 12, 8, 5]


def cp(score, color):
    return score.pov(color).score(mate_score=10000)


def hanging_minor_of(board, color):
    """Squares of `color` minor pieces attacked by the other side and (undefended or attacked by a pawn)."""
    out = []
    for sq in chess.SquareSet(board.pieces(chess.KNIGHT, color) | board.pieces(chess.BISHOP, color)):
        att = board.attackers(not color, sq)
        if not att:
            continue
        undefended = not board.attackers(color, sq)
        by_pawn = any(board.piece_type_at(a) == chess.PAWN for a in att)
        if undefended or by_pawn:
            out.append(sq)
    return out


def hanging_any(board, color):
    out = []
    for sq, pc in board.piece_map().items():
        if pc.color != color or pc.piece_type in (chess.KING, chess.PAWN):
            continue
        att = board.attackers(not color, sq)
        if not att:
            continue
        undefended = not board.attackers(color, sq)
        cheapest = min(VAL[board.piece_type_at(a)] for a in att)
        if undefended or cheapest < VAL[pc.piece_type]:
            out.append((chess.square_name(sq), pc.symbol()))
    return out


def holdon_move(eng, board, botmove_no, stats):
    infos = eng.analyse(board, chess.engine.Limit(depth=8), multipv=6)
    me = board.turn
    lines = [(cp(i["score"], me), i["pv"][0]) for i in infos if "pv" in i]
    lines.sort(key=lambda t: -t[0])
    top_s, top_m = lines[0]
    # forced top move: capture gaining >=200 over the runner-up, or a mate
    if (board.is_capture(top_m) and len(lines) > 1 and top_s - lines[1][0] >= 200) or top_s >= 9000:
        return top_m, "forced"
    # gift rule
    if 5 <= botmove_no <= 25:
        stats["gift_windows"] += 1
        cands = [(s, m) for s, m in lines if top_s - s <= 400]
        qualifying = []
        for s, m in cands:
            board.push(m)
            hm = hanging_minor_of(board, me)
            if hm:
                # verify: player's best reply is a capture of that minor and gains >=200 from the player's side
                inf = eng.analyse(board, chess.engine.Limit(depth=10))
                reply = inf["pv"][0]
                ps = cp(inf["score"], not me)
                if reply.to_square in hm and board.is_capture(reply) and ps - (-top_s) >= 200:
                    qualifying.append(m)
            board.pop()
        if qualifying:
            stats["gift_qualifies"] += 1
            if random.random() < 1 / 8:
                stats["gifts_given"] += 1
                return random.choice(qualifying), "gift"
    cands = [(s, m) for s, m in lines if top_s - s <= 80][:5]
    weights = W[:len(cands)]
    pick = random.choices(cands, weights=weights, k=1)[0][1]
    return pick, "sampled"


def main():
    bot = chess.engine.SimpleEngine.popen_uci(SF)
    opp = chess.engine.SimpleEngine.popen_uci(SF)
    opp.configure({"UCI_LimitStrength": True, "UCI_Elo": 1320})
    results = []
    totals = {"gift_windows": 0, "gift_qualifies": 0, "gifts_given": 0, "bot_self_hangs": 0, "opp_hangs": 0, "bot_took_free": 0}
    t0 = time.time()
    for g in range(GAMES):
        board = chess.Board()
        bot_color = chess.BLACK if g % 2 == 0 else chess.WHITE
        botmove_no = 0
        stats = {"gift_windows": 0, "gift_qualifies": 0, "gifts_given": 0}
        self_hangs = 0; opp_hangs = 0; took_free = 0
        while not board.is_game_over() and board.ply() < MAXPLY:
            if board.turn == bot_color:
                botmove_no += 1
                before_hanging_opp = hanging_any(board, not bot_color)
                mv, how = holdon_move(bot, board, botmove_no, stats)
                if board.is_capture(mv) and chess.square_name(mv.to_square) in [s for s, _ in before_hanging_opp]:
                    took_free += 1
                board.push(mv)
                if how == "sampled" and hanging_any(board, bot_color):
                    # a piece the bot left en prise without meaning to
                    self_hangs += 1
            else:
                r = opp.play(board, chess.engine.Limit(depth=8))
                board.push(r.move)
                if hanging_any(board, not bot_color):
                    opp_hangs += 1
        res = board.result(claim_draw=True)
        score_bot = {"1-0": 1.0 if bot_color == chess.WHITE else 0.0, "0-1": 1.0 if bot_color == chess.BLACK else 0.0}.get(res, 0.5)
        if board.ply() >= MAXPLY and not board.is_game_over():
            # adjudicate by material
            mat = sum(VAL[p.piece_type] * (1 if p.color == bot_color else -1) for p in board.piece_map().values())
            score_bot = 1.0 if mat >= 3 else 0.0 if mat <= -3 else 0.5
            res = f"adj({mat:+d})"
        results.append(score_bot)
        for k in stats: totals[k] += stats[k]
        totals["bot_self_hangs"] += self_hangs; totals["opp_hangs"] += opp_hangs; totals["bot_took_free"] += took_free
        print(f"game {g+1}: bot={'W' if bot_color else 'B'} result={res} plies={board.ply()} bot_score={score_bot} "
              f"gift_windows={stats['gift_windows']} qualifying={stats['gift_qualifies']} gifts={stats['gifts_given']} "
              f"bot_self_hangs(sampled)={self_hangs} opp1320_hangs={opp_hangs} bot_took_free={took_free}", flush=True)
    print("TOTAL bot score vs SF UCI_Elo 1320:", sum(results), "/", GAMES, totals, f"{time.time()-t0:.0f}s")
    bot.quit(); opp.quit()


main()
