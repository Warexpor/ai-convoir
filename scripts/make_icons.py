"""
Generate app icon set from assets/icon-master.png (B&W slash mark).

Resizes the master into public/, src/assets/, and src-tauri/icons/,
plus a multi-size Windows ICO.
"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "assets" / "icon-master.png"


def load_master() -> Image.Image:
    if not MASTER.exists():
        raise SystemExit(f"Missing master icon: {MASTER}")
    return Image.open(MASTER).convert("RGBA")


def render(size: int, master: Image.Image) -> Image.Image:
    """Resize master to exact size on an opaque Cursor-gray square."""
    # Near-neighbor for tiny sizes can look crunchy; LANCZOS is better overall.
    resized = master.resize((size, size), Image.Resampling.LANCZOS)
    # Match the in-app canvas (#121212), not pitch black.
    bg = Image.new("RGBA", (size, size), (18, 18, 18, 255))
    bg.alpha_composite(resized)
    # Crush near-black AA to pure black / near-white to white for crisp B&W
    pixels = bg.load()
    assert pixels is not None
    for y in range(size):
        for x in range(size):
            r, g, b, a = pixels[x, y]
            lum = (r + g + b) / 3
            if lum < 40:
                pixels[x, y] = (18, 18, 18, 255)
            elif lum > 200:
                pixels[x, y] = (236, 236, 236, 255)
            else:
                # Mid tones → hard threshold for tiny-icon clarity
                pixels[x, y] = (236, 236, 236, 255) if lum >= 110 else (18, 18, 18, 255)
    return bg


def write_ico(path: Path, sizes: list[int], master: Image.Image) -> None:
    images = [render(s, master) for s in sizes]
    blobs: list[bytes] = []
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        blobs.append(buf.getvalue())

    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = bytearray()
    for im, blob in zip(images, blobs):
        w = 0 if im.width >= 256 else im.width
        h = 0 if im.height >= 256 else im.height
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(header + bytes(entries) + b"".join(blobs))


def main() -> None:
    master = load_master()
    public = ROOT / "public"
    assets = ROOT / "src" / "assets"
    icons = ROOT / "src-tauri" / "icons"
    public.mkdir(exist_ok=True)
    assets.mkdir(parents=True, exist_ok=True)
    icons.mkdir(parents=True, exist_ok=True)

    for s in (16, 24, 32, 48, 64, 128, 256, 512):
        render(s, master).save(assets / f"preview-{s}.png")

    render(512, master).save(assets / "logo.png")
    render(512, master).save(public / "logo.png")
    render(32, master).save(public / "favicon-32.png")
    render(16, master).save(public / "favicon-16.png")
    render(256, master).save(assets / "logo-mark.png")

    for name, size in [
        ("32x32.png", 32),
        ("64x64.png", 64),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]:
        render(size, master).save(icons / name)

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    write_ico(icons / "icon.ico", ico_sizes, master)

    print(f"Master: {MASTER}")
    print("Wrote public/, src/assets/, src-tauri/icons/")
    print("ALL OK")


if __name__ == "__main__":
    main()
