"""
Generate app icon set from assets/icon-master.png (B&W slash mark).

Resizes the master into public/, and writes the Electron
build icons (build/icon.png, build/icon.ico; build/icon.icns is kept as is).
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
    # Match the in-app canvas (#111111), not pitch black.
    bg = Image.new("RGBA", (size, size), (17, 17, 17, 255))
    bg.alpha_composite(resized)
    # Crush near-black AA to pure black / near-white to white for crisp B&W
    pixels = bg.load()
    assert pixels is not None
    for y in range(size):
        for x in range(size):
            r, g, b, a = pixels[x, y]
            lum = (r + g + b) / 3
            if lum < 40:
                pixels[x, y] = (17, 17, 17, 255)
            elif lum > 200:
                pixels[x, y] = (236, 236, 236, 255)
            else:
                # Mid tones → hard threshold for tiny-icon clarity
                pixels[x, y] = (236, 236, 236, 255) if lum >= 110 else (17, 17, 17, 255)
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
    build = ROOT / "build"
    public.mkdir(exist_ok=True)
    build.mkdir(exist_ok=True)

    render(512, master).save(public / "logo.png")
    render(32, master).save(public / "favicon-32.png")
    render(16, master).save(public / "favicon-16.png")
    render(256, master).save(public / "logo-mark.png")
    render(1024, master).save(build / "icon.png")
    write_ico(build / "icon.ico", [16, 24, 32, 48, 64, 128, 256], master)

    print(f"Master: {MASTER}")
    print("Wrote public/, build/")
    print("ALL OK")


if __name__ == "__main__":
    main()
