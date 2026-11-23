#!/usr/bin/env python3
"""Rebuild the self-contained single-file scene from its source parts."""
from pathlib import Path
import re

base = Path(__file__).resolve().parent
tpl = (base / "template.html").read_text(encoding="utf-8")
three = (base / "three.min.js").read_text(encoding="utf-8")
app = (base / "app.js").read_text(encoding="utf-8")

# keep the MIT license comment, drop the r150 deprecation console warning and sourcemap pointer
three = three.replace("//# sourceMappingURL=three.min.js.map", "")
three = re.sub(r"^console\.warn\([^;]*\);\s*", "", three, count=1)

out = tpl.replace("/*__THREE_JS__*/", three).replace("/*__APP_JS__*/", app)
dest = base.parent / "PLC_SCADA_HMI_3D.html"
dest.write_text(out, encoding="utf-8")
print(f"wrote {dest} ({len(out):,} bytes)")
