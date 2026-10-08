#!/usr/bin/env python3
"""Embed the larger fictional case for a file:// friendly preview."""

import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
PACKAGE_ROOT = HERE.parent.parent
CASE = PACKAGE_ROOT / "examples"
bundle = json.loads((CASE / "模拟数据_bundle.json").read_text(encoding="utf-8"))
transcripts = {}
for session in bundle["sessions"]:
    filename = session["source_file"]
    transcripts[filename] = (CASE / filename).read_text(encoding="utf-8").splitlines()

payload = {
    "bundle": bundle,
    "transcripts": transcripts,
    "sourceDocs": {},
    "baseUrl": "",
}
(HERE.parent / "demo-data.js").write_text(
    "window.WORKBENCH_DEMO = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
    encoding="utf-8",
)
print("demo-data.js 已更新")
