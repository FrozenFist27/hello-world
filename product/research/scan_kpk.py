import sys, chess, chess.engine
sys.path.insert(0, "scripts")
from engine_check import find_stockfish
eng = chess.engine.SimpleEngine.popen_uci(find_stockfish())
for fen in sys.argv[1:]:
    b = chess.Board(fen); print("==", fen, "valid:", b.is_valid())
    for mv in b.legal_moves:
        san = b.san(mv); b.push(mv)
        info = eng.analyse(b, chess.engine.Limit(depth=30))
        s = info["score"].white(); b.pop()
        print(f"   {san:6s} cp={s.score()} mate={s.mate()}")
eng.quit()
