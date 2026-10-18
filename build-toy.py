"""把根目录的服务器版打包成单文件 HTML，供 B 站 Toy 上传。"""

import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "toy")


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


html = read(os.path.join(ROOT, "index.html"))

css = read(os.path.join(ROOT, "css", "style.css"))
html = html.replace(
    '<link rel="stylesheet" href="css/style.css">',
    "<style>\n" + css + "\n</style>",
    1,
)


def inline_script(match):
    src = match.group(1)
    code = read(os.path.join(ROOT, src.replace("/", os.sep)))
    return "<script>\n" + code + "\n</script>"


html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)

os.makedirs(OUT_DIR, exist_ok=True)
out = os.path.join(OUT_DIR, "index.html")
with open(out, "w", encoding="utf-8") as handle:
    handle.write(html)

print("wrote %s (%d bytes)" % (out, len(html.encode("utf-8"))))
