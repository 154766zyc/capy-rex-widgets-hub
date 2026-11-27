"""Deterministically adapt the supplied Rex PNG; no image-generation service."""
import argparse
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--preview", type=Path)
args = parser.parse_args()
source = Image.open(args.source).convert("RGBA")
assert source.size == (640, 640), "Expected the original 640px Rex artwork"
size = source.width
pixels = source.load()
edges = {}
for y in range(size):
    opaque = [x for x in range(size) if pixels[x, y][3] >= 250]
    if opaque:
        edges[y] = (pixels[opaque[0], y][:3], pixels[opaque[-1], y][:3])

# Continue the pearl background into the transparent corners, not black/white.
background = Image.new("RGB", source.size)
bg = background.load()
for y in range(size):
    left, right = edges[min(edges, key=lambda row: abs(row-y))]
    for x in range(size):
        mix = x / (size-1)
        bg[x, y] = tuple(round(a*(1-mix)+b*mix) for a, b in zip(left, right))
background = background.filter(ImageFilter.GaussianBlur(10))
square = background.copy()
square.paste(source, (0, 0), source)

# Leave extra room around the actual mulberry mark for Android's circular mask.
foreground_radius = max(math.hypot(x-319.5, y-319.5)
    for y in range(size) for x in range(size)
    if (lambda p: p[3] > 240 and p[1] < 130 and p[0] < 220 and p[0]-p[1] > 45 and p[2]-p[1] > 25)(pixels[x, y]))
scale = min(0.90, (size*0.4-12)/foreground_radius)
inner = round(size*scale)
offset = (size-inner)//2
tile = square.resize((inner, inner), Image.Resampling.LANCZOS)
feather = Image.new("L", (inner, inner))
fp = feather.load()
for y in range(inner):
    for x in range(inner):
        fp[x, y] = round(255*min(1, min(x, y, inner-1-x, inner-1-y)/24))
maskable = background.copy()
maskable.paste(tile, (offset, offset), feather)

output = Path(__file__).resolve().parents[1] / "public" / "app-icons"
output.mkdir(parents=True, exist_ok=True)
for width in (16, 32, 180, 192, 512):
    square.resize((width, width), Image.Resampling.LANCZOS).save(output / f"rex-mulberry-v1-{width}.png", optimize=True)
for width in (192, 512):
    maskable.resize((width, width), Image.Resampling.LANCZOS).save(output / f"rex-mulberry-v1-maskable-{width}.png", optimize=True)
square.save(output / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

if args.preview:
    preview = Image.new("RGB", (960, 380), "#e7e7ed")
    draw = ImageDraw.Draw(preview)
    for index, (name, artwork, radius) in enumerate([
        ("iPhone / iPad", square, 60),
        ("Android circle", maskable, 144),
        ("Desktop / PWA", square, 48),
    ]):
        icon = artwork.resize((288, 288), Image.Resampling.LANCZOS)
        clip = Image.new("L", (288, 288))
        ImageDraw.Draw(clip).rounded_rectangle((0, 0, 287, 287), radius=radius, fill=255)
        preview.paste(icon, (index*320+16, 16), clip)
        draw.text((index*320+28, 328), name, fill="#4d2655", font_size=22)
    preview.save(args.preview)
print(f"Generated 8 icons; maskable artwork scale={scale:.3f}; mark radius={foreground_radius*scale/size:.3f} (<0.4 safe zone)")
