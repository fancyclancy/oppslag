"""Draw the Oppslag logo: a white Helvetica Neue Bold "ø" on Norwegian red, with the slash in blue.

The slash geometry is measured from the font itself (pixels in "ø" that aren't in "o"), then drawn
as one solid blue bar on top of the white "o". Writes the app icons and an in-app logo image.
Run:  python3 -I make_logo.py
"""
import math, os
from PIL import Image, ImageDraw, ImageFont, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'app', 'icons')
FONT = ('/System/Library/Fonts/HelveticaNeue.ttc', 1)          # Helvetica Neue Bold
RED, WHITE, BLUE = (186, 12, 47), (255, 255, 255), (0, 32, 91)  # Norwegian flag colours
S = 2048                                                        # working resolution

def glyph_mask(ch, size):
    f = ImageFont.truetype(FONT[0], size, index=FONT[1])
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).text((int(S * .18), int(S * .78)), ch, font=f, fill=255, anchor='ls')   # same baseline/origin for o and ø
    return m

def measure(size):
    o, oe = glyph_mask('o', size), glyph_mask('ø', size)
    slash = ImageChops.subtract(oe, o)
    pts = [(x, y) for y in range(0, S, 2) for x in range(0, S, 2) if slash.getpixel((x, y)) > 200]
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - cx) ** 2 for p in pts); syy = sum((p[1] - cy) ** 2 for p in pts); sxy = sum((p[0] - cx) * (p[1] - cy) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)                  # direction of the slash
    ux, uy = math.cos(ang), math.sin(ang); nx, ny = -uy, ux
    along = [(p[0] - cx) * ux + (p[1] - cy) * uy for p in pts]
    across = sorted((p[0] - cx) * nx + (p[1] - cy) * ny for p in pts)
    thick = across[int(len(across) * .98)] - across[int(len(across) * .02)]
    # the font's own slash is hairline-ish next to the bold bowl; give it ~0.6 of the bowl's stroke weight
    bb = o.getbbox(); row = int((bb[1] + bb[3]) / 2)
    run = 0
    for x in range(bb[0], bb[2]):
        if o.getpixel((x, row)) > 128: run += 1
        elif run: break
    thick = max(thick, run * .62)
    return o, oe, (cx, cy, ux, uy, nx, ny, min(along), max(along), thick)

def draw(size_px, glyph_scale, rounded, name):
    base = Image.new('RGB', (S, S), RED)
    o, oe, (cx, cy, ux, uy, nx, ny, a0, a1, th) = measure(int(S * glyph_scale))
    # centre the whole ø (slash included) optically in the tile
    bbox = oe.getbbox(); dx = S / 2 - (bbox[0] + bbox[2]) / 2; dy = S / 2 - (bbox[1] + bbox[3]) / 2
    base.paste(WHITE, (int(dx), int(dy)), o)
    bar = Image.new('L', (S, S), 0)
    hw = th / 2
    poly = [(cx + ux * a0 + nx * hw, cy + uy * a0 + ny * hw), (cx + ux * a1 + nx * hw, cy + uy * a1 + ny * hw),
            (cx + ux * a1 - nx * hw, cy + uy * a1 - ny * hw), (cx + ux * a0 - nx * hw, cy + uy * a0 - ny * hw)]
    ImageDraw.Draw(bar).polygon([(x + dx, y + dy) for x, y in poly], fill=255)
    base.paste(BLUE, (0, 0), bar)
    img = base.resize((size_px, size_px), Image.LANCZOS)
    if rounded:
        m = Image.new('L', (size_px * 4, size_px * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size_px * 4 - 1, size_px * 4 - 1], radius=int(size_px * 4 * .225), fill=255)
        rgba = img.convert('RGBA'); rgba.putalpha(m.resize((size_px, size_px), Image.LANCZOS)); img = rgba
    img.save(os.path.join(OUT, name))
    print('wrote', name)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    # iOS rounds the corners itself; the 512 icon is "maskable" so the glyph stays inside the safe zone
    draw(180, 1.16, False, 'apple-touch-icon.png')
    draw(512, .98, False, 'icon-512.png')
    draw(192, 1.16, True, 'icon-192.png')
    draw(256, 1.16, True, 'logo.png')       # in-app logo (splash, menu)
