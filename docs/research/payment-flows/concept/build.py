"""Assemble the concept page: python3 build.py -> dist/send-receive-forms.html"""
import json
import re
import sys
from pathlib import Path

here = Path(__file__).parent
sys.path.insert(0, str(here.parent))
from flow import FLOW  # noqa: E402  the spec the page follows
icons = (here / "icons.js").read_text()
body = (here / "body.html").read_text()
paths = dict(re.findall(r"    (\w+): '(.*?)',\n", icons))
svg = lambda n, sz: (f'<svg class="ic" width="{sz}" height="{sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                     f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[n]}</svg>')
for ph, n, sz in [("%RECV%", "receive", 22), ("%SEND%", "send", 22), ("%PLANE%", "plane", 18), ("%SERVER%", "server", 18),
                  ("%PEOPLE%", "people", 18), ("%BACK%", "back", 18), ("%BOLT%", "bolt", 18), ("%ECASH%", "ecash", 18),
                  ("%PASTE%", "paste", 18), ("%IMAGE%", "image", 18), ("%WARN%", "warn", 16), ("%SCAN%", "scan", 16)]:
    body = body.replace(ph, svg(n, sz))
body = body.replace("%ICONS%", icons).replace("%FLOW%", json.dumps(FLOW))
out = here / "dist" / "send-receive-forms.html"
out.parent.mkdir(exist_ok=True)
out.write_text((here / "head.css.html").read_text() + body)
print(out)
