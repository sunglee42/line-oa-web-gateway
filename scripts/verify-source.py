"""Verify the original LXC source and unchanged LINE image/multipart module checksums."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
upstream = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / "line-oa-lxc"
records = json.loads((root / "docs/upstream-sha256.json").read_text())
for name, digest in records.items():
    assert hashlib.sha256((upstream / name).read_bytes()).hexdigest() == digest, name
for name in ("multipart.ts", "images.ts"):
    assert hashlib.sha256((root / "line_oa/app/src" / name).read_bytes()).hexdigest() == records["src/" + name], name
print("Original LXC unchanged; image/multipart modules match upstream; client/QR/session/sender are documented Add-on extensions")
