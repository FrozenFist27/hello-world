import chess, chess.engine, os, json
SF = os.path.expanduser("~/.local/share/tintin-ai-chess-analysis/data/engine/stockfish")
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
eng = chess.engine.SimpleEngine.popen_uci(SF)
b = chess.Board(FEN)
best = eng.analyse(b, chess.engine.Limit(depth=20))
best_cp = best["score"].pov(chess.WHITE).score(mate_score=10000)
rows = []
for mv in b.legal_moves:
    san = b.san(mv); b.push(mv)
    info = eng.analyse(b, chess.engine.Limit(depth=20), multipv=2)
    after = info[0]["score"].pov(chess.WHITE).score(mate_score=10000)
    reply = info[0]["pv"][0]; reply_san = b.san(reply); cap = b.is_capture(reply)
    reply2 = info[1]["pv"][0] if len(info) > 1 else None
    reply2_san = b.san(reply2) if reply2 else None
    # mechanism per chess.js-style look: the piece on the reply's target square
    tgt = reply.to_square; pc = b.piece_at(tgt)
    mech = None
    if cap and pc and pc.color == chess.WHITE:
        att = b.attackers(chess.BLACK, tgt); dfd = b.attackers(chess.WHITE, tgt)
        cheapest = min(VAL[b.piece_type_at(a)] for a in att)
        undefended = len(dfd) == 0
        mech = {"target": chess.square_name(tgt), "piece": pc.symbol(), "undefended": undefended, "cheapest_attacker": cheapest,
                "takers": sorted(chess.square_name(a) for a in att), "moved_piece": tgt == mv.to_square}
    b.pop()
    rows.append({"san": san, "cp_after": after, "cp_loss": best_cp - after, "reply": reply_san, "reply_is_capture": cap, "reply2": reply2_san, "mech": mech})
rows.sort(key=lambda r: -r["cp_loss"])
out = {"fen": FEN, "best_cp": best_cp, "best_pv": b.variation_san(best["pv"][:4]), "rows": rows}
json.dump(out, open(os.path.join(os.path.dirname(__file__), "tutorial_table.json"), "w"), indent=1)
for r in rows: print(r["san"], r["cp_loss"], r["reply"], "cap" if r["reply_is_capture"] else "", r["mech"] or "")
eng.quit()
