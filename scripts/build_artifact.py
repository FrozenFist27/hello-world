#!/usr/bin/env python3
"""Build the publish variant of the page for the claude.ai Artifact runtime.

The Artifact tool wraps a page in its own <!doctype html><html><head>…</head><body> skeleton,
so the published file must carry no document wrapper of its own and must put <title> and
<style> first. This script takes app/index.html, drops the wrapper, inlines styles.css, drops
the favicon link, and writes app/artifact.html (gitignored). Supporting files (js/, data/,
assets/, vendor/) are published alongside it unchanged.

  python3 scripts/build_artifact.py            # writes app/artifact.html, prints the file list
  python3 scripts/build_artifact.py --check    # prints the capability declaration only; builds nothing

Capabilities. The republish declares exactly these three, in full and with no rules:

  {"sample": {}, "db": {}, "user": {}}

sample is the coach (Hear me out, the follow-ups, the close lines); db and user are the mirror:
one document per viewer at data/users/<id>/holdon, the viewer's own private subtree under the
default rules. permissions is never declared: the page only reads permissions.state('db') when
the viewer's runtime offers the namespace, and plays the same without it. Outside the viewer
every claude.use() resolves null and the page plays fully on localStorage alone. test_all.sh runs
--check and asserts the three names.
"""
import re, sys, os, json

# The declaration the republish must carry (see the docstring): exactly sample, db and user.
CAPABILITIES = {"sample": {}, "db": {}, "user": {}}

if "--check" in sys.argv[1:]:
    print(json.dumps({"capabilities": CAPABILITIES}))
    sys.exit(0)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app")
src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
css = open(os.path.join(ROOT, "styles.css"), encoding="utf-8").read()

head = re.search(r"<head>(.*?)</head>", src, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", src, re.S).group(1)

title = re.search(r"<title>.*?</title>", head, re.S).group(0)
desc = re.search(r'<meta name="description"[^>]*>', head)
boot = re.search(r"<script>(.*?)</script>", head, re.S)
preloads = re.findall(r'<link rel="preload"[^>]*>', head)

out = [title]
if desc: out.append(desc.group(0))
out.append("<style>\n" + css.strip() + "\n</style>")
out.extend(preloads)
if boot: out.append("<script>" + boot.group(1) + "</script>")
out.append(body.strip())
page = "\n".join(out) + "\n"
open(os.path.join(ROOT, "artifact.html"), "w", encoding="utf-8").write(page)

files = {}
for d in ("js", "data", "assets", "vendor"):
    for dirpath, _, names in os.walk(os.path.join(ROOT, d)):
        for n in names:
            if n.endswith((".md", ".txt", ".LICENSE", ".mjs")) and d != "assets":
                continue
            full = os.path.join(dirpath, n)
            rel = os.path.relpath(full, ROOT)
            files[rel] = rel
print(json.dumps({"page": "app/artifact.html", "bytes": len(page.encode()), "files": sorted(files)}, indent=1))
