"""Crop 3x3 framed sprite sheets into individual images (no black borders)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "dragon_sprites"

SHEETS = [
    Path(__file__).resolve().parents[1]
    / "ChatGPT Image Jul 21, 2026, 02_13_35 PM.png",
    Path(__file__).resolve().parents[1]
    / "ChatGPT Image Jul 21, 2026, 02_13_42 PM.png",
]


def cluster_positions(positions: list[int], gap: int = 8) -> list[tuple[int, int]]:
    if not positions:
        return []
    positions = sorted(positions)
    groups: list[list[int]] = [[positions[0]]]
    for p in positions[1:]:
        if p - groups[-1][-1] <= gap:
            groups[-1].append(p)
        else:
            groups.append([p])
    return [(g[0], g[-1]) for g in groups]


def detect_border_bands(
    arr_gray: np.ndarray, thr: int = 120, density: float = 0.25, gap: int = 8
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    dark = arr_gray < thr
    row_frac = dark.mean(axis=1)
    col_frac = dark.mean(axis=0)
    row_pos = np.where(row_frac >= density)[0].tolist()
    col_pos = np.where(col_frac >= density)[0].tolist()
    return cluster_positions(row_pos, gap), cluster_positions(col_pos, gap)


def intervals_from_bands(bands: list[tuple[int, int]]) -> list[tuple[int, int]]:
    bands = sorted(bands)
    if len(bands) >= 6:
        b = bands[:6]
        return [(b[i][1] + 1, b[i + 1][0] - 1) for i in (0, 2, 4)]
    if len(bands) == 4:
        return [(bands[i][1] + 1, bands[i + 1][0] - 1) for i in range(3)]
    if len(bands) >= 3:
        left = bands[0][1] + 1
        right = bands[-1][0] - 1
        span = right - left + 1
        cell = span / 3
        return [
            (int(round(left + i * cell)), int(round(left + (i + 1) * cell)) - 1)
            for i in range(3)
        ]
    raise ValueError(f"Not enough bands: {bands}")


def refine_box(
    arr_gray: np.ndarray, x0: int, y0: int, x1: int, y1: int, thr: int = 120
) -> tuple[int, int, int, int]:
    h, w = arr_gray.shape
    y0c, y1c = max(0, y0), min(h - 1, y1)
    x0c, x1c = max(0, x0), min(w - 1, x1)

    def edge_dark_h(y: int, xa: int, xb: int) -> bool:
        if y < 0 or y >= h or xb < xa:
            return False
        return bool((arr_gray[y, xa : xb + 1] < thr).mean() > 0.4)

    def edge_dark_v(x: int, ya: int, yb: int) -> bool:
        if x < 0 or x >= w or yb < ya:
            return False
        return bool((arr_gray[ya : yb + 1, x] < thr).mean() > 0.4)

    while y0c < y1c and edge_dark_h(y0c, x0c, x1c):
        y0c += 1
    while y1c > y0c and edge_dark_h(y1c, x0c, x1c):
        y1c -= 1
    while x0c < x1c and edge_dark_v(x0c, y0c, y1c):
        x0c += 1
    while x1c > x0c and edge_dark_v(x1c, y0c, y1c):
        x1c -= 1
    return x0c, y0c, x1c, y1c


def crop_sheet(path: Path, start_index: int) -> list[tuple[str, tuple[int, int]]]:
    im = Image.open(path).convert("RGB")
    gray = np.array(im.convert("L"))

    best = None
    for thr in (100, 120, 80, 140, 60):
        for dens in (0.20, 0.25, 0.30, 0.15):
            rb, cb = detect_border_bands(gray, thr=thr, density=dens)
            if len(rb) >= 4 and len(cb) >= 4:
                score = (min(len(rb), 6), min(len(cb), 6), -abs(len(rb) - 6) - abs(len(cb) - 6))
                cand = (score, thr, dens, rb, cb)
                if best is None or cand[0] > best[0]:
                    best = cand
                if len(rb) >= 6 and len(cb) >= 6:
                    break
        if best and best[0][0] >= 6 and best[0][1] >= 6:
            break

    if best is None:
        raise RuntimeError(f"Could not detect grid in {path.name}")

    _, thr, dens, rb, cb = best
    print(f"{path.name}: thr={thr} dens={dens}")
    print(f"  row bands ({len(rb)}): {rb}")
    print(f"  col bands ({len(cb)}): {cb}")

    rows = intervals_from_bands(rb)
    cols = intervals_from_bands(cb)
    print(f"  row intervals: {rows}")
    print(f"  col intervals: {cols}")

    saved: list[tuple[str, tuple[int, int]]] = []
    i = 0
    for y0, y1 in rows:
        for x0, x1 in cols:
            bx0, by0, bx1, by1 = refine_box(gray, x0, y0, x1, y1, thr=thr)
            crop = im.crop((bx0, by0, bx1 + 1, by1 + 1))
            idx = start_index + i
            out = OUT / f"dragon_{idx:02d}.png"
            crop.save(out)
            saved.append((out.name, crop.size))
            print(f"  saved {out.name} size={crop.size} box=({bx0},{by0})-({bx1},{by1})")
            i += 1
    return saved


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    all_saved: list[tuple[str, tuple[int, int]]] = []
    n = 1
    for sheet in SHEETS:
        if not sheet.exists():
            raise FileNotFoundError(sheet)
        all_saved.extend(crop_sheet(sheet, n))
        n += 9
    print(f"\nTotal: {len(all_saved)} images in {OUT}")


if __name__ == "__main__":
    main()
