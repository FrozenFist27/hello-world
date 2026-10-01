#!/usr/bin/env python3
"""Stockfish verification helper for lesson authoring.

Every position, tactic or line that goes into a lesson is checked here first, so the
lesson never teaches a move the engine refutes.

Usage (from the repo root):
  python3 scripts/engine_check.py eval  "<FEN>" [--depth 20] [--multipv 3]
  python3 scripts/engine_check.py move  "<FEN>" <move> [--depth 20]      # judge a candidate (SAN or UCI)
  python3 scripts/engine_check.py line  "<FEN>" "<SAN moves…>" [--depth 20]   # verify a whole line, ply by ply
  python3 scripts/engine_check.py mate  "<FEN>" [--depth 24]            # is there a forced mate? how long?
  python3 scripts/engine_check.py pgn   "<moves…>" [--depth 18]         # eval after each move from the start position

Output is JSON. Scores are from White's point of view in centipawns; "mate": N means mate in N.
Stockfish is found on PATH or in tintins' managed engine folder; set STOCKFISH_PATH to override.
"""
import argparse, json, os, shutil, sys

try:
    import chess, chess.engine, chess.pgn
except ImportError:
    sys.exit("python-chess missing: run `bash setup-chess.sh` first")


def find_stockfish() -> str:
    env = os.environ.get("STOCKFISH_PATH")
    if env and os.path.exists(env):
        return env
    on_path = shutil.which("stockfish")
    if on_path:
        return on_path
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, ".local", "share", "tintin-ai-chess-analysis", "data", "engine", "stockfish"),
        os.path.join(home, "Library", "Application Support", "Tintin AI Chess Analysis", "data", "engine", "stockfish"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tintin AI Chess Analysis", "data", "engine", "stockfish.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    sys.exit("Stockfish not found: run `bash setup-chess.sh` or set STOCKFISH_PATH")


def win_pct(cp, mate):
    """White's winning chances in percent (Lichess' logistic on centipawns)."""
    import math
    if mate is not None:
        return 100.0 if mate > 0 else 0.0
    if cp is None:
        return None
    return round(50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1), 1)


def first_move(pv_san: str):
    """First move of a SAN variation string, skipping move numbers like '12.' or '12...'."""
    for tok in pv_san.split():
        if tok.rstrip(".").isdigit() or tok.endswith("..."):
            continue
        return tok
    return None


def score_dict(score: chess.engine.PovScore) -> dict:
    s = score.white()
    return {"cp": s.score(), "mate": s.mate(), "white_win_pct": win_pct(s.score(), s.mate())}


def analyse(engine, board, depth, multipv=1):
    infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
    out = []
    for info in infos:
        pv = info.get("pv", [])
        out.append({**score_dict(info["score"]), "pv_san": board.variation_san(pv), "depth": info.get("depth")})
    return out


def parse_move(board, text):
    try:
        return board.parse_san(text)
    except ValueError:
        return board.parse_uci(text)


def cmd_eval(engine, a):
    board = chess.Board(a.fen)
    return {"fen": a.fen, "turn": "white" if board.turn else "black", "lines": analyse(engine, board, a.depth, a.multipv)}


def cmd_move(engine, a):
    board = chess.Board(a.fen)
    best = analyse(engine, board, a.depth, 1)[0]
    mv = parse_move(board, a.move)
    san = board.san(mv)
    board.push(mv)
    after = analyse(engine, board, a.depth, 1)[0]
    loss = None
    if best["cp"] is not None and after["cp"] is not None:
        loss = (best["cp"] - after["cp"]) * (1 if chess.Board(a.fen).turn else -1)
    return {"fen": a.fen, "move": san, "best": best, "after_move": after, "cp_loss_for_mover": loss,
            "reply_pv_san": after["pv_san"]}


def cmd_line(engine, a):
    board = chess.Board(a.fen)
    steps = []
    for tok in a.moves.replace(",", " ").split():
        if tok.endswith(".") or tok[:-1].replace(".", "").isdigit() and tok.endswith("..."):
            continue
        tok = tok.split(".")[-1] if "." in tok and not tok.startswith("O") else tok
        if not tok:
            continue
        best = analyse(engine, board, a.depth, 1)[0]
        mv = parse_move(board, tok)
        san = board.san(mv)
        board.push(mv)
        after = analyse(engine, board, a.depth, 1)[0]
        steps.append({"move": san, "engine_best_pv": best["pv_san"], "eval_after": {k: after[k] for k in ("cp", "mate")},
                      "is_engine_best": (first_move(best["pv_san"]) or "").rstrip("#+") == san.rstrip("#+")})
    return {"fen": a.fen, "steps": steps, "final_fen": board.fen(), "game_over": board.is_game_over(),
            "result": board.result() if board.is_game_over() else None}


def cmd_mate(engine, a):
    board = chess.Board(a.fen)
    info = engine.analyse(board, chess.engine.Limit(depth=a.depth))
    s = info["score"].pov(board.turn)
    return {"fen": a.fen, "forced_mate_for_side_to_move": s.mate() if (s.mate() or 0) > 0 else None,
            "pv_san": board.variation_san(info.get("pv", []))}


def cmd_pgn(engine, a):
    board = chess.Board()
    rows = []
    for tok in a.moves.replace(",", " ").split():
        if tok.endswith("."):
            continue
        tok = tok.split(".")[-1] if "." in tok and not tok.startswith("O") else tok
        if not tok or tok in ("1-0", "0-1", "1/2-1/2", "*"):
            continue
        best = analyse(engine, board, a.depth, 1)[0]
        mv = parse_move(board, tok)
        san = board.san(mv)
        mover_white = board.turn
        board.push(mv)
        after = analyse(engine, board, a.depth, 1)[0]
        loss = None
        if best["cp"] is not None and after["cp"] is not None:
            loss = (best["cp"] - after["cp"]) * (1 if mover_white else -1)
        rows.append({"ply": board.ply(), "move": san, "eval_after_cp": after["cp"], "mate": after["mate"],
                     "cp_loss": loss, "engine_preferred": first_move(best["pv_san"])})
    return {"moves": rows, "final_fen": board.fen()}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("eval", "move", "line", "mate", "pgn"):
        s = sub.add_parser(name)
        if name != "pgn":
            s.add_argument("fen")
        if name == "move":
            s.add_argument("move")
        if name in ("line", "pgn"):
            s.add_argument("moves")
        s.add_argument("--depth", type=int, default={"mate": 24, "pgn": 18}.get(name, 20))
        s.add_argument("--multipv", type=int, default=1)
    a = p.parse_args()
    engine = chess.engine.SimpleEngine.popen_uci(find_stockfish())
    try:
        result = {"eval": cmd_eval, "move": cmd_move, "line": cmd_line, "mate": cmd_mate, "pgn": cmd_pgn}[a.cmd](engine, a)
    finally:
        engine.quit()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
