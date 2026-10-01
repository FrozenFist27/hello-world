# learno — `make start` serves your workspace (:9990), `make sandbox` the engine's
# fixtures (:9991) with an in-memory store and stubbed validator. See `make help`.

PORT      ?= 9990
SBX_PORT  ?= 9991
ROOT      := $(CURDIR)
SANDBOX   := $(CURDIR)/sandbox
SERVER    := $(CURDIR)/server
SBX_RUN    = LEARNO_MODE=sandbox LEARNO_WORKSPACE=$(SANDBOX) PORT=$(SBX_PORT)

.PHONY: help start local sandbox sandbox-local stop check deps build lesson catalog check-errors compare

# Checked here, before any target prints a URL: under `node --watch` a server that
# refuses the version stays alive, and the page looks up when nothing is serving it.
deps:
	@node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error("learno needs Node 22.13 or newer; this is " + process.version + "."); process.exit(1) }'
	@test -d $(SERVER)/node_modules || (cd $(SERVER) && npm install --silent)
	@test -d $(ROOT)/node_modules   || npm install --silent

help:
	@echo "learno"
	@echo
	@echo "  study"
	@echo "    make start            serve your workspace + a public Cloudflare URL  (:$(PORT))"
	@echo "    make local            same, localhost only"
	@echo
	@echo "  authoring"
	@echo "    make build            render every lesson from its .json + .yml"
	@echo "    make lesson SRC=...   render one (SRC=lessons/0011-name)"
	@echo "    make catalog          regenerate COMPONENTS.md and the component gallery"
	@echo "    make compare HAND=... SRC=...   measure authored size against hand-written lessons"
	@echo
	@echo "  engine development"
	@echo "    make sandbox          serve the fixtures + a public URL  (:$(SBX_PORT))"
	@echo "    make sandbox-local    same, localhost only"
	@echo "    make check            syntax-check the server, the build and the seed"
	@echo "    make check-errors     show the build refusing broken lessons"
	@echo
	@echo "    make stop             kill whatever holds :$(PORT) and :$(SBX_PORT)"

# study

# The tunnel URL is UNAUTHENTICATED: anyone holding it can hit /api and spend your
# Claude plan or Gemini key. Use `make local` at the desk.
start: deps
	@command -v cloudflared >/dev/null || { echo "cloudflared not installed: brew install cloudflared (or use: make local)"; exit 1; }
	@set -m; \
	PORT=$(PORT) node --watch $(SERVER)/index.js & srv=$$!; \
	trap 'kill $$srv 2>/dev/null; exit 0' INT TERM EXIT; \
	until curl -sf http://localhost:$(PORT)/api/health >/dev/null 2>&1; do sleep 0.3; done; \
	echo "workspace up on :$(PORT) — opening Cloudflare tunnel…"; \
	cloudflared tunnel --no-autoupdate --url http://localhost:$(PORT)

local: deps
	@echo "workspace → http://localhost:$(PORT)/"
	@PORT=$(PORT) node --watch $(SERVER)/index.js

# authoring

# Catalog first, so the registry and gallery match the components the build used.
build: deps catalog
	@node build/render.js --all

catalog: deps
	@node build/catalog.js

lesson: deps
	@test -n "$(SRC)" || { echo "usage: make lesson SRC=lessons/0011-name"; exit 1; }
	@node build/render.js $(SRC)

compare: deps
	@test -n "$(HAND)" || { echo "usage: make compare HAND='../study/lessons/*.html' SRC=lessons/0011-name"; exit 1; }
	@test -n "$(SRC)"  || { echo "usage: make compare HAND='../study/lessons/*.html' SRC=lessons/0011-name"; exit 1; }
	@node build/compare.js $(HAND) --against $(SRC)

# engine development

sandbox: deps
	@command -v cloudflared >/dev/null || { echo "cloudflared not installed: brew install cloudflared (or use: make sandbox-local)"; exit 1; }
	@set -m; \
	$(SBX_RUN) node --watch $(SERVER)/index.js & srv=$$!; \
	trap 'kill $$srv 2>/dev/null; exit 0' INT TERM EXIT; \
	until curl -sf http://localhost:$(SBX_PORT)/api/health >/dev/null 2>&1; do sleep 0.3; done; \
	echo "sandbox up on :$(SBX_PORT) — opening Cloudflare tunnel…"; \
	cloudflared tunnel --no-autoupdate --url http://localhost:$(SBX_PORT)

sandbox-local: deps
	@echo "sandbox → http://localhost:$(SBX_PORT)/components.html"
	@$(SBX_RUN) node --watch $(SERVER)/index.js

check: deps
	@for f in $(SERVER)/*.js $(SERVER)/routes/*.js $(ROOT)/build/*.js $(ROOT)/bin/*.js; do \
	  node --check $$f || exit 1; \
	done
	@node -e "JSON.parse(require('fs').readFileSync('$(SANDBOX)/fixtures/seed.json','utf8'))" \
	  && echo "ok — server and build parse, seed.json is valid"

# Each of these must be refused, so success is the failure here.
check-errors: deps
	@for f in unknown-component dangling-ref coloured-svg overflow-svg missing-prop bad-lang bad-icon wrong-shape; do \
	  echo "──────── $$f ────────"; \
	  out=$$(node build/render.js sandbox/broken/$$f 2>&1); rc=$$?; \
	  echo "$$out" | grep -v 'assets/components.css'; \
	  if [ $$rc -eq 0 ]; then \
	    echo "  ✗ FAILED: this lesson should have been refused"; exit 1; \
	  fi; \
	  if [ -f sandbox/broken/$$f.html ]; then \
	    echo "  ✗ FAILED: wrote HTML despite the error"; exit 1; \
	  fi; \
	done; \
	echo; echo "ok — every broken lesson was refused, no HTML written"

stop:
	@for p in $(PORT) $(SBX_PORT); do \
	  lsof -ti :$$p 2>/dev/null | while read pid; do kill $$pid; done; \
	  pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:$$p" 2>/dev/null; \
	done; \
	echo "stopped"
