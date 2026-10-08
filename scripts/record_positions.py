#!/usr/bin/env python3
"""Records app/data/positions.json: every test position the spec cites, searched with the native
Stockfish exactly the way the page searches (ucinewgame before each pre-search, Hash 16, Skill
Level 20; pre at depth 14 multipv 2; post per move at depth 12 multipv 2), converted into the
`pre` and `post` shapes gate.js consumes (ARCHITECTURE.md section 5), plus the expected verdict
per move from the spec's acceptance criteria. scripts/test_gate.mjs replays the file in node.

  python3 scripts/record_positions.py            # writes app/data/positions.json, prints cpLoss per move

Scores are converted to the player's side (White): cp as is; mate N -> +/-(10000 - N).
"""
import datetime
import json
import os
import sys

import chess
import chess.engine

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from engine_check import find_stockfish  # noqa: E402

OUT = os.path.join(ROOT, "app", "data", "positions.json")
MATE_SCORE = 10000
PRE_DEPTH, POST_DEPTH, MULTIPV, HASH_MB = 14, 12, 2, 16
HOLD_CP, MARGIN_CP = 200, 70
DATE = "2026-10-08"

# id, name, fen, moves: san -> expectation (expect, category?, sub?, variant?, answer?, reward?, note?)
POSITIONS = [
    {
        "id": "italian_d6",
        "name": "Italian after 6...d6 (the spec's hold position)",
        "fen": "r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7",
        "moves": {
            "Nxe5": {"expect": "held", "category": "hanging_after_move", "variant": "takes_back",
                     "answer": {"squares": ["d6", "c6"], "best": "d6", "partial": ["c6"]}, "netLoss": 2},
            "Bxf7+": {"expect": "held", "category": "hanging_after_move", "variant": "takes_back",
                      "answer": {"squares": ["f8", "g8"], "best": "f8", "partial": ["g8"]}, "netLoss": 2},
            "h3": {"expect": "committed", "reward": None},
        },
    },
    {
        "id": "tutorial",
        "name": "Italian after 3...Nf6 (the tutorial position, here with the engine warm)",
        "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
        "moves": {
            "Bxf7+": {"expect": "held", "category": "hanging_after_move", "variant": "takes_back",
                      "answer": {"squares": ["e8"], "best": "e8", "partial": []}, "netLoss": 2},
            "Nxe5": {"expect": "held", "category": "hanging_after_move", "variant": "takes_back",
                     "answer": {"squares": ["c6"], "best": "c6", "partial": []}, "netLoss": 2},
            "d3": {"expect": "committed", "reward": None},
        },
    },
    {
        "id": "ruy_a6",
        "name": "Ruy Lopez after 3...a6 (the b5 bishop is attacked)",
        "fen": "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4",
        "moves": {
            "O-O": {"expect": "held", "category": "ignored_attack", "sub": "already",
                    "answer": {"squares": ["b5"], "best": "b5", "partial": ["a6"]}, "netLoss": 3},
            "Ba4": {"expect": "committed", "reward": "escaped"},
        },
    },
    {
        "id": "italian_nxe4",
        "name": "Italian after 4.d3 Nxe4 (the e4 knight is free)",
        "fen": "r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5",
        "moves": {
            "Nc3": {"expect": "held", "category": "free_piece_ignored",
                    "answer": {"squares": ["e4"], "best": "e4", "partial": []}, "netLoss": 3},
            "dxe4": {"expect": "committed", "reward": "free_taken"},
        },
    },
    {
        "id": "placement_oo",
        "name": "Placement after 7...O-O (the g4 bishop is attacked by the h3 pawn)",
        "fen": "r2q1rk1/ppp2ppp/2np1n2/2b1p3/2B1P1b1/2PP1N1P/PP3PP1/RNBQ1RK1 w - - 1 8",
        "moves": {
            "Nbd2": {"expect": "held", "category": "free_piece_ignored",
                     "answer": {"squares": ["g4"], "best": "g4", "partial": []}, "netLoss": 2},
            "hxg4": {"expect": "committed", "reward": "free_taken"},
        },
    },
    {
        "id": "italian_ng4",
        "name": "Italian after 5...Ng4 (the g4 knight is attacked by the h3 pawn)",
        "fen": "r1bqk2r/pppp1ppp/2n5/2b1p3/2B1P1n1/3P1N1P/PPP2PP1/RNBQK2R w KQkq - 1 6",
        "moves": {
            "O-O": {"expect": "held", "category": "free_piece_ignored",
                    "answer": {"squares": ["g4"], "best": "g4", "partial": []}, "netLoss": 3},
            "hxg4": {"expect": "committed", "reward": "free_taken"},
        },
    },
    {
        "id": "f3_e5",
        "name": "After 1.f3 e5 (g4 allows the fool's mate)",
        "fen": "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2",
        "moves": {
            "g4": {"expect": "held", "category": "allowed_mate",
                   "answer": {"squares": ["h4"], "best": "h4", "partial": []}},
            "e4": {"expect": "committed", "reward": None},
        },
    },
    {
        "id": "scholars_white",
        "name": "Scholar's mate from White's side (Qxf7 is mate)",
        "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        "moves": {
            "Qh3": {"expect": "held", "category": "missed_mate",
                    "answer": {"squares": ["f7"], "best": "f7", "partial": []}},
            "Qxf7#": {"expect": "over"},
        },
    },
    {
        "id": "start",
        "name": "The start position",
        "fen": chess.STARTING_FEN,
        "moves": {
            "e4": {"expect": "committed", "reward": None},
            "Nf3": {"expect": "committed", "reward": None},
        },
    },
    {
        "id": "queen_hang",
        "name": "After 1.e4 e5 2.Qh5 Nc6 (a queen capture that is taken back; netLoss 8 beats the quiet rule)",
        "fen": "r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3",
        "moves": {
            "Qxe5+": {"expect": "held", "category": "hanging_after_move", "variant": "takes_back",
                      "answer": {"squares": ["c6"], "best": "c6", "partial": []}, "netLoss": 8},
            "Qxf7+": {"expect": "held", "category": "hanging_after_move", "variant": "takes_back",
                      "answer": {"squares": ["e8"], "best": "e8", "partial": []}, "netLoss": 8},
            "Bc4": {"expect": "committed", "reward": None},
        },
    },
    {
        "id": "kq_stalemate",
        "name": "King and queen against king (Qf7 stalemates)",
        "fen": "7k/8/8/8/8/8/8/K4Q2 w - - 0 1",
        "moves": {
            "Qf7": {"expect": "held", "category": "allowed_stalemate",
                    "answer": {"squares": ["h8"], "best": "h8", "partial": []}},
            "Kb2": {"expect": "committed", "reward": None},
        },
    },
]


def white_score(info):
    return info["score"].white().score(mate_score=MATE_SCORE)


def move_dict(board, mv):
    piece = board.piece_at(mv.from_square)
    captured = None
    if board.is_capture(mv):
        captured = "p" if board.is_en_passant(mv) else board.piece_at(mv.to_square).symbol().lower()
    san = board.san(mv)
    board.push(mv)
    is_mate = board.is_checkmate()
    board.pop()
    return {
        "uci": mv.uci(), "san": san,
        "from": chess.square_name(mv.from_square), "to": chess.square_name(mv.to_square),
        "piece": piece.symbol().lower(), "captured": captured, "isMate": is_mate,
    }


def pre_shape(engine, board, game):
    infos = engine.analyse(board, chess.engine.Limit(depth=PRE_DEPTH), multipv=MULTIPV, game=game)
    top = infos[0]
    best = move_dict(board, top["pv"][0])
    line2 = None
    if len(infos) > 1 and infos[1].get("pv"):
        line2 = move_dict(board, infos[1]["pv"][0])
        line2.pop("isMate", None)
    return {
        "fen": board.fen(),
        "evalBefore": white_score(top),
        "best": best,
        "mateIn": top["score"].white().mate(),
        "line2": line2,
        "depth": top.get("depth", PRE_DEPTH),
        "stopped": False,
    }


def post_shape(engine, board, game):
    if board.is_game_over():
        # terminal: no reply lines; the player's side score is what chess.js can tell
        return {
            "fen": board.fen(),
            "evalAfter": MATE_SCORE if board.is_checkmate() else 0,
            "lines": [],
            "replyMateIn": None,
            "depth": 0,
            "terminal": "checkmate" if board.is_checkmate() else "draw",
        }
    infos = engine.analyse(board, chess.engine.Limit(depth=POST_DEPTH), multipv=MULTIPV, game=game)
    lines = []
    for info in infos:
        pv = info.get("pv") or []
        if not pv:
            continue
        r = move_dict(board, pv[0])
        r["isCapture"] = r["captured"] is not None
        r["isCheck"] = board.gives_check(pv[0])
        lines.append({"reply": r, "score": white_score(info), "pv": [m.uci() for m in pv]})
    top = infos[0]
    return {
        "fen": board.fen(),
        "evalAfter": white_score(top),
        "lines": lines,
        "replyMateIn": top["score"].pov(chess.BLACK).mate(),
        "depth": top.get("depth", POST_DEPTH),
    }


def main():
    sf = find_stockfish()
    engine = chess.engine.SimpleEngine.popen_uci(sf)
    engine.configure({"Hash": HASH_MB})
    out = []
    worst_margin = None
    try:
        for p in POSITIONS:
            board = chess.Board(p["fen"])
            assert board.is_valid(), p["fen"]
            game = object()  # a new game key: python-chess sends ucinewgame before the pre-search
            pre = pre_shape(engine, board, game)
            moves = {}
            print(f"== {p['id']}: evalBefore {pre['evalBefore']} best {pre['best']['san']} mateIn {pre['mateIn']}")
            for san, exp in p["moves"].items():
                mv = board.parse_san(san)
                board.push(mv)
                post = post_shape(engine, board, game)
                board.pop()
                cp_loss = pre["evalBefore"] - post["evalAfter"]
                reply = post["lines"][0]["reply"]["san"] if post["lines"] else "-"
                margin = ""
                if exp.get("category") in ("ignored_attack", "hanging_after_move", "free_piece_ignored"):
                    m = cp_loss - HOLD_CP
                    worst_margin = m if worst_margin is None else min(worst_margin, m)
                    margin = f"  margin over {HOLD_CP}: {m}{'  LOW' if m < MARGIN_CP else ''}"
                print(f"   {san:7s} {exp['expect']:9s} evalAfter {post['evalAfter']:6d} cpLoss {cp_loss:6d} reply {reply}{margin}")
                moves[san] = {**exp, "post": post}
            out.append({
                "id": p["id"], "name": p["name"], "fen": p["fen"],
                "verified": {
                    "depth": PRE_DEPTH, "postDepth": POST_DEPTH, "multipv": MULTIPV, "hash": HASH_MB, "date": DATE,
                    "engine": "Stockfish 18 (native)",
                    "command": "python3 scripts/record_positions.py",
                    "check": f'python3 scripts/engine_check.py eval "{p["fen"]}" --depth {PRE_DEPTH} --multipv {MULTIPV}',
                },
                "pre": pre,
                "moves": moves,
            })
    finally:
        engine.quit()
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(out)} positions, {sum(len(p['moves']) for p in out)} moves; "
          f"worst margin over {HOLD_CP} on a material hold: {worst_margin} cp (need >= {MARGIN_CP})")
    return 0 if worst_margin is None or worst_margin >= MARGIN_CP else 1


if __name__ == "__main__":
    sys.exit(main())
