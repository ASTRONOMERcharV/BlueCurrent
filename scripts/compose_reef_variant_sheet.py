#!/usr/bin/env python3
"""Compose the reef-variant comparison sheets from the studio gallery.

    python3 scripts/compose_reef_variant_sheet.py

Inputs:  test-artifacts/reef-variants/gallery-front.png
         test-artifacts/reef-variants/gallery-silhouette.png
Outputs: variant-sheet.png
         variant-thumbnails-320.png
         gallery-front-labeled.png
         gallery-silhouette-labeled.png

The studio gallery renders the five reefs at authored scale with near LOD and
no fish/kelp, so these sheets compare the enlarged set without foreground
occlusion. Triangle and epibiont counts come from the in-game bare captures.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "test-artifacts" / "reef-sample"
OUT = ROOT / "test-artifacts" / "reef-variants"
OUT.mkdir(parents=True, exist_ok=True)

ORDER = ["hero", "b", "c", "d", "e"]
LABELS = {
    "hero": "HERO · 8.20 × 6.80 m",
    "b": "SPIRE · 9.00 × 6.40 m",
    "c": "PLATFORM · 7.50 × 7.20 m",
    "d": "TWIN · 8.00 × 6.20 m",
    "e": "TERRACES · 8.60 × 6.80 m",
}
SHORT_NAMES = {"hero": "HERO", "b": "SPIRE", "c": "PLATFORM", "d": "TWIN", "e": "TERRACES"}
DIMENSIONS = {key: value.split("·", 1)[1].strip() for key, value in LABELS.items()}

BACKGROUND = (10, 27, 31)
PANEL = (17, 43, 47)
TEXT = (224, 236, 232)
MUTED = (150, 181, 176)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def column_groups(image: Image.Image, minimum_width: int = 40) -> list[tuple[int, int]]:
    """Find the horizontal spans of the five silhouettes for crop placement."""
    array = np.asarray(image.convert("L"), dtype=np.uint8) < 100
    columns = array.any(axis=0)
    groups: list[tuple[int, int]] = []
    start: int | None = None
    for index, filled in enumerate(columns):
        if filled and start is None:
            start = index
        elif not filled and start is not None:
            groups.append((start, index))
            start = None
    if start is not None:
        groups.append((start, len(columns)))
    return [group for group in groups if group[1] - group[0] >= minimum_width]


def gallery_groups() -> list[tuple[int, int]]:
    groups = column_groups(Image.open(OUT / "gallery-silhouette.png"))
    if len(groups) == len(ORDER):
        return groups
    width = Image.open(OUT / "gallery-front.png").width
    return [
        (int(width * index / len(ORDER)), int(width * (index + 1) / len(ORDER)))
        for index in range(len(ORDER))
    ]


def gallery_tile(index: int, size: tuple[int, int]) -> Image.Image:
    groups = gallery_groups()
    source = Image.open(OUT / "gallery-front.png").convert("RGB")
    start, end = groups[index]
    padding = 14
    crop = source.crop((max(0, start - padding), 0, min(source.width, end + padding), source.height))
    scale = min(size[0] / crop.width, size[1] / crop.height)
    resized = crop.resize(
        (max(1, int(crop.width * scale)), max(1, int(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    panel = Image.new("RGB", size, PANEL)
    panel.paste(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    return panel


def stats() -> dict:
    result = {}
    for variant_id in ORDER:
        path = SOURCE / f"game-set-{variant_id}-bare-results.json"
        if not path.exists():
            path = SOURCE / f"game-set-{variant_id}-results.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        result[variant_id] = next(s for s in data["final"]["reefSetStats"] if s["id"] == variant_id)
    return result


def compose(
    tile_size: tuple[int, int],
    gap: int,
    caption_height: int,
    title: str,
    subtitle: str,
    filename: str,
) -> None:
    info = stats()
    compact = tile_size[0] < 300
    width = len(ORDER) * tile_size[0] + (len(ORDER) + 1) * gap
    height = 86 + tile_size[1] + caption_height + gap
    sheet = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    draw.text((gap, 18), title, font=font(28, True), fill=TEXT)
    draw.text((gap, 52), subtitle, font=font(15), fill=MUTED)

    for index, variant_id in enumerate(ORDER):
        x = gap + index * (tile_size[0] + gap)
        y = 78
        draw.rounded_rectangle(
            (x - 4, y - 4, x + tile_size[0] + 4, y + tile_size[1] + caption_height),
            radius=6,
            fill=PANEL,
        )
        sheet.paste(gallery_tile(index, tile_size), (x, y))
        label = (
            f"{SHORT_NAMES[variant_id]} · {DIMENSIONS[variant_id].split('×')[0].strip()} m"
            if compact else LABELS[variant_id]
        )
        draw.text(
            (x + 8, y + tile_size[1] + 8),
            label,
            font=font(13 if compact else 17, True),
            fill=TEXT,
        )
        entry = info[variant_id]
        detail = (
            f"{entry['trianglesNear']:,} tris · {entry['epibiontInstances']} epi · "
            f"{entry['epibiontCoverage'] * 100:.0f}%"
            if compact else
            f"near {entry['trianglesNear']:,} tris · "
            f"{entry['epibiontInstances']} epibionts · "
            f"{entry['epibiontCoverage'] * 100:.0f}% cover"
        )
        draw.text(
            (x + 8, y + tile_size[1] + 28),
            detail,
            font=font(10 if compact else 13),
            fill=MUTED,
        )

    sheet.save(OUT / filename, optimize=True)
    print("wrote", (OUT / filename).relative_to(ROOT), sheet.size)


def label_gallery(filename: str, output: str) -> None:
    source = OUT / filename
    image = Image.open(source).convert("RGB")
    groups = gallery_groups()
    strip = 82
    labeled = Image.new("RGB", (image.width, image.height + strip), BACKGROUND)
    labeled.paste(image, (0, 0))
    draw = ImageDraw.Draw(labeled)
    for index, (start, end) in enumerate(groups):
        center = (start + end) // 2
        name = SHORT_NAMES[ORDER[index]]
        name_font = font(16, True)
        dim_font = font(12)
        name_bounds = draw.textbbox((0, 0), name, font=name_font)
        dim_bounds = draw.textbbox((0, 0), DIMENSIONS[ORDER[index]], font=dim_font)
        draw.text(
            (center - (name_bounds[2] - name_bounds[0]) // 2, image.height + 14),
            name,
            font=name_font,
            fill=TEXT,
        )
        draw.text(
            (center - (dim_bounds[2] - dim_bounds[0]) // 2, image.height + 38),
            DIMENSIONS[ORDER[index]],
            font=dim_font,
            fill=MUTED,
        )
    labeled.save(OUT / output, optimize=True)
    print("wrote", (OUT / output).relative_to(ROOT), labeled.size)


def main() -> None:
    compose(
        tile_size=(300, 420),
        gap=16,
        caption_height=58,
        title="Reef variants — enlarged 8–9 m set",
        subtitle="Studio gallery, near LOD, no fish or kelp. Each reef is at least 3× the 2.5 m detail-seaweed height.",
        filename="variant-sheet.png",
    )
    compose(
        tile_size=(240, 320),
        gap=12,
        caption_height=54,
        title="320 px silhouette check",
        subtitle="Each panel is a 240 × 320 crop; the stepped, column and twin profiles stay readable at thumbnail size.",
        filename="variant-thumbnails-320.png",
    )
    label_gallery("gallery-front.png", "gallery-front-labeled.png")
    label_gallery("gallery-silhouette.png", "gallery-silhouette-labeled.png")


if __name__ == "__main__":
    main()
