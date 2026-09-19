"""
The installable app's icons, drawn from the product's own mark: the white "M" stroke of
components/SideNav.tsx on the brand gradient (--accent #09705F → --accent-2 #2F6FD8).

    python scripts/make-app-icons.py

Writes public/icons/*.png. Re-run only if the mark or the colours change.

  icon-192 / icon-512      rounded tile, for Android, Windows, macOS and the install dialog
  maskable-512             full-bleed square with the mark inside the 80% safe zone — Android
                           crops it to a circle, a squircle or a teardrop as the launcher likes
  apple-touch-icon (180)   full-bleed square: iOS rounds the corners itself
  favicon-32 / favicon-16  the browser tab
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
ACCENT = (0x09, 0x70, 0x5F)
ACCENT_2 = (0x2F, 0x6F, 0xD8)
SCALE = 4  # draw large, shrink once: smooth edges without an SVG renderer

# The mark, in the 24×24 box of the SVG: M4 17 V7 l8 7 8-7 v10
MARK = [(4, 17), (4, 7), (12, 14), (20, 7), (20, 17)]
STROKE = 2.4


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for x in range(size):
        t = x / max(1, size - 1)
        colour = tuple(round(a + (b - a) * t) for a, b in zip(ACCENT, ACCENT_2))
        for y in range(size):
            px[x, y] = colour
    return img


def draw_mark(img: Image.Image, box: float) -> None:
    """The M, centred, occupying `box` (0–1) of the tile's width."""
    size = img.size[0]
    unit = size * box / 24
    offset = (size - 24 * unit) / 2
    pts = [(offset + x * unit, offset + y * unit) for x, y in MARK]
    width = max(1, round(STROKE * unit))
    d = ImageDraw.Draw(img)
    d.line(pts, fill="white", width=width, joint="curve")
    r = width / 2
    for x, y in pts:  # round caps and joins, as the SVG has
        d.ellipse([x - r, y - r, x + r, y + r], fill="white")


def tile(size: int, *, rounded: bool, box: float) -> Image.Image:
    big = size * SCALE
    img = gradient(big)
    draw_mark(img, box)
    img = img.convert("RGBA")
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.22), fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tile(192, rounded=True, box=0.62).save(OUT / "icon-192.png", optimize=True)
    tile(512, rounded=True, box=0.62).save(OUT / "icon-512.png", optimize=True)
    tile(512, rounded=False, box=0.50).save(OUT / "maskable-512.png", optimize=True)
    tile(180, rounded=False, box=0.60).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    tile(32, rounded=True, box=0.70).save(OUT / "favicon-32.png", optimize=True)
    tile(16, rounded=True, box=0.74).save(OUT / "favicon-16.png", optimize=True)
    for f in sorted(OUT.glob("*.png")):
        print(f"{f.name:24} {f.stat().st_size:>7} bytes")


if __name__ == "__main__":
    main()
