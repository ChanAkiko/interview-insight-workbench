#!/usr/bin/env python3
"""Copy the buildless prototype into the private Site's static directory."""

from pathlib import Path
from shutil import copy2


root = Path(__file__).resolve().parent.parent
dist = root / "dist"
dist.mkdir(exist_ok=True)
for name in ("index.html", "styles.css", "app.js", "demo-data.js"):
    copy2(root / name, dist / name)
print(f"静态站点已构建：{dist}")
