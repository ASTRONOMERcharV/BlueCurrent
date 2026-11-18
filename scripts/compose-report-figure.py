#!/usr/bin/env python3
"""合成报告 3.3 节的最终运行画面四联图。

读取 test-artifacts 下的 Phase E1/E3/E4 证据截图，等比缩放裁切为 2x2 面板，
输出 screenshots/fig-final-visual.png，并把四张源图复制为 screenshots/submission-visual-*.png
（test-artifacts 被 .gitignore 排除，复制后报告源图才跟随仓库分发）。

用法：python scripts/compose-report-figure.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"
TA = ROOT / "test-artifacts" / "phase-e"

PANEL = (960, 600)
GUTTER = 10
BG = (9, 26, 33)
LABEL_FONTS = [
    Path("C:/Windows/Fonts/arialbd.ttf"),
    Path("C:/Windows/Fonts/segoeuib.ttf"),
]

SOURCES = [
    # (角标, 源图, 源图副本名, 可选的预裁切框)
    ("a", TA / "2026-11-14t00-13-00z" / "hardware" / "e1-smooth" / "smooth-t17.000-school.png",
     "submission-visual-a-school.png", None),
    ("b", TA / "2026-11-14t00-13-00z" / "hardware" / "e3" / "event-022-capture.png",
     "submission-visual-b-predation.png", (0, 0, 1076, 672)),
    ("c", TA / "2026-11-14t08-31-46z" / "e4" / "capture-habitat-anemone" / "e4-habitat-anemone-t43.000.png",
     "submission-visual-c-clownfish.png", None),
    ("d", TA / "2026-11-14t00-13-00z" / "hardware" / "e1-smooth" / "smooth-t17.000-focus.png",
     "submission-visual-d-fish-detail.png", None),
]


def cover(img, size):
    """等比缩放铺满 size，再居中裁切。"""
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    nw, nh = round(img.width * scale), round(img.height * scale)
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def find_font(size):
    for path in LABEL_FONTS:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def main():
    canvas = Image.new("RGB", (PANEL[0] * 2 + GUTTER, PANEL[1] * 2 + GUTTER), BG)
    font = find_font(34)
    for idx, (label, src, out_name, pre_crop) in enumerate(SOURCES):
        if not src.exists():
            raise SystemExit(f"missing capture: {src}")
        img = Image.open(src).convert("RGB")
        if pre_crop:
            img = img.crop(pre_crop)
        img.save(SHOTS / out_name, optimize=True)
        panel = cover(img, PANEL)
        col, row = idx % 2, idx // 2
        x = col * (PANEL[0] + GUTTER)
        y = row * (PANEL[1] + GUTTER)
        canvas.paste(panel, (x, y))
        draw = ImageDraw.Draw(canvas, "RGBA")
        box = (x + 16, y + 16, x + 66, y + 66)
        draw.rounded_rectangle(box, radius=8, fill=(0, 0, 0, 150))
        draw.text((x + 30, y + 20), label, font=font, fill=(255, 255, 255, 235))
        print(f"({label}) {src.name} {img.width}x{img.height} -> panel {PANEL[0]}x{PANEL[1]}")

    out = SHOTS / "fig-final-visual.png"
    canvas.save(out, dpi=(220, 220), optimize=True)
    print("wrote", out, canvas.size)


if __name__ == "__main__":
    main()