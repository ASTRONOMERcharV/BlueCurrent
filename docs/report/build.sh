#!/usr/bin/env bash
# Blue Current 实验报告一键导出脚本
# 用法：bash docs/report/build.sh   （在仓库任意位置执行均可）
# 产物：docs/report/BlueCurrent-实验报告.pdf
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # docs/report
ROOT="$(cd "$HERE/../.." && pwd)"                       # Project/BlueCurrent
SRC="$HERE/FINAL_REPORT.md"
OUT="$HERE/BlueCurrent-实验报告.pdf"
TPL="$HERE/template/eisvogel-cover.latex"
# 构建目录放在仓库内 .tmp/（已 gitignore）：Windows 原生 pandoc 在 MSYS 的
# /tmp 映射目录下会把 PWD 拼成 C:\c\... 而失败；图片已复制进 assets/，
# 文档不再依赖 ../screenshots 相对路径
BUILD="$ROOT/.tmp/bluecurrent-report-build-$$"

command -v pandoc >/dev/null || { echo "缺少 pandoc"; exit 1; }
command -v xelatex >/dev/null || { echo "缺少 xelatex（TeX Live）"; exit 1; }

# Windows（MSYS bash）下 pandoc 是原生 exe，不接受 /c/... 路径；
# 用 cygpath 转成原生路径，Linux 沙箱无 cygpath 时原样使用。
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }
OUT_ARG="$(winpath "$OUT")"
TPL_ARG="$(winpath "$TPL")"
HEADER_ARG="$(winpath "$HERE/template/header.tex")"
FILTER_ARG="$(winpath "$HERE/template/codebreak.lua")"
# 混合式路径（C:/...）：bash 内可直接 cd，pandoc 也不会再把 PWD 拼成 C:\c\...
winpathm() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi; }
BUILD_ARG="$(winpathm "$BUILD")"

rm -rf "$BUILD"
mkdir -p "$BUILD/assets"

# 1) 生成 pandoc 输入：加 YAML 头、去原 H1 标题与元信息块、降一级标题
python - "$SRC" "$BUILD/build.md" "$ROOT/screenshots" <<'PY'
import sys, shutil
from pathlib import Path
src, dst, shots = map(Path, sys.argv[1:])
text = src.read_text(encoding='utf-8')
lines = text.splitlines()

# 去掉首个 H1（标题进 YAML）
if lines and lines[0].startswith('# '):
    title = lines[0][2:].strip()
    lines = lines[1:]
else:
    title = 'Blue Current：三维群体生态模拟实验报告'

# 去掉 H1 下方的紧凑元信息块
while lines and (not lines[0].strip() or lines[0].startswith(('项目：', '版本：', '完成日期：', '代码目录：', '原始数据：', '验证记录：'))):
    lines.pop(0)

body = '\n'.join(lines)

# Windows pandoc 2.12 lacks tex_math_single_backslash here; normalize the
# report's LaTeX delimiters to the default dollar-math extension.
normalized = []
for ln in body.splitlines():
    stripped = ln.strip()
    if stripped == '\[' or stripped == '\]':
        normalized.append('$$')
    else:
        normalized.append(ln.replace('\(', '$').replace('\)', '$'))
body = '\n'.join(normalized)

# ## → #，### → ##（article 类以 # 为节）
out_lines = []
for ln in body.splitlines():
    if ln.startswith('### '):
        ln = '## ' + ln[4:]
    elif ln.startswith('## '):
        ln = '# ' + ln[3:]
    out_lines.append(ln)
body = '\n'.join(out_lines)

# 第 5 章前强制换页：避免上一章尾部浮动图把「5.」标题挤到页底、
# 导致其后的表格在下一页重复表头
body = body.replace('# 5. 实验与结果', '\\clearpage\n\n# 5. 实验与结果', 1)

# 截图转 RGB（RGBA 存成带 SMask 的 16bit 图，部分阅读器显示偏色）并改写链接
for name in ['fig-performance.png', 'fig-ablation.png', 'fig-predator.png', 'fig-final-visual.png']:
    from PIL import Image
    Image.open(shots / name).convert('RGB').save(
        dst.parent / 'assets' / name, dpi=(220, 220), optimize=True)
body = body.replace('../screenshots/', 'assets/')

yaml = '''---
title: "Blue Current"
subtitle: "三维群体生态模拟实验报告"
author: ["孙嘉泽"]
studentid: "3230104713"
course: "计算机动画"
date: "2026 年 11 月 15 日"
title-meta: "%s"
subject: "计算机动画课程实验报告"
keywords: ["Boids", "群体模拟", "Three.js", "性能实验"]
titlepage: true
toc-own-page: true
toc-title: "目录"
fontsize: 11pt
linestretch: 1.25
header-left: "Blue Current 实验报告"
header-right: "2026-11-15"
footer-left: "Blue Current"
footer-right: '第\\hspace{0.3em}\\thepage\\hspace{0.3em}页'
...
''' % title

dst.write_text(yaml + '\n' + body + '\n', encoding='utf-8')
print('build.md 生成完毕：', len((yaml + body).splitlines()), '行')
PY

# 2) 字体：优先 Noto CJK（Linux 沙箱），否则回退 Windows 自带字体
# 注意：不要写成 fc-list | grep -q，pipefail 下 grep 提前退出会让管道判失败
FCLIST="$(fc-list 2>/dev/null || true)"
if grep -q "Noto Serif CJK SC" <<< "$FCLIST"; then
  FONTS=(-V mainfont="Noto Serif CJK SC" -V sansfont="Noto Sans CJK SC"
         -V monofont="Noto Sans Mono CJK SC" -V mainfontoptions="AutoFakeSlant=0.2")
else
  FONTS=(-V mainfont="SimSun" -V sansfont="Microsoft YaHei"
         -V monofont="SimSun")
fi

# 3) 编译
# 分两步：pandoc 只生成 .tex。pandoc 的 --pdf-engine 路径在 Windows/MSYS 下
# 会在构建目录里建出 C:\c\... 形式的临时目录而失败，交给 xelatex 本地编译即可。
cd "$BUILD"
pandoc build.md -o report.tex --from markdown+tex_math_dollars --template="$TPL_ARG" --toc --toc-depth=2 --resource-path=. -H "$HEADER_ARG" --lua-filter "$FILTER_ARG" "${FONTS[@]}"

for pass in 1 2 3; do
  xelatex -interaction=nonstopmode -halt-on-error report.tex </dev/null > "xelatex-$pass.log" 2>&1 || {
    echo "xelatex 第 $pass 遍失败，日志末尾："; tail -40 "xelatex-$pass.log"; exit 1;
  }
done
cp report.pdf "$OUT"

echo "[OK] $OUT"
if command -v pdfinfo >/dev/null; then
  pdfinfo "$OUT" | grep -E "Pages|Title|Author" || true
fi
