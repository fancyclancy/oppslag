"""Draw the Oppslag app icon: a leather-bound book with a white "ø" (blue slash) on the cover.

Layers, back to front: back cover, page block (with curved page edges), cover thickness, leather
cover (gradient + grain), shadow the cover casts on the pages, then the embossed ø.
The ø is Helvetica Neue Bold; the slash geometry is measured from the font's own "ø" (pixels in "ø"
that aren't in "o") and drawn as one solid bar on top of the "o".
Run:  python3 -I make_logo.py
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'app', 'icons')
FONT = ('/System/Library/Fonts/HelveticaNeue.ttc', 1)      # Helvetica Neue Bold
S = 1024                                                    # working resolution

LEATHER_TOP, LEATHER_BOTTOM = (176, 50, 52), (128, 30, 36)  # oxblood leather
COVER_EDGE = (92, 22, 27)
BACK = (70, 18, 22)
PAGE, PAGE_LINE = (247, 242, 231), (196, 184, 162)
O_COLOUR, SLASH_COLOUR = (251, 246, 236), (37, 70, 140)     # warm white "o", blue slash

COVER_BOTTOM = 820          # where the cover face ends; pages show below it
COVER_R = 150               # radius of the cover's bottom corners

def rounded(box, r, size=(S, S)):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=r, fill=255)
    return m

def glyph(ch, size, W):
    f = ImageFont.truetype(FONT[0], size, index=FONT[1])
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).text((int(W * .18), int(W * .78)), ch, font=f, fill=255, anchor='ls')
    return m

def oe_masks(size):
    """Return (o_mask, slash_mask) for a Helvetica Neue Bold ø at `size` px."""
    W = S
    o, oe = glyph('o', size, W), glyph('ø', size, W)
    slash = ImageChops.subtract(oe, o)
    pts = [(x, y) for y in range(0, W, 2) for x in range(0, W, 2) if slash.getpixel((x, y)) > 200]
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - cx) ** 2 for p in pts); syy = sum((p[1] - cy) ** 2 for p in pts); sxy = sum((p[0] - cx) * (p[1] - cy) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang); nx, ny = -uy, ux
    along = [(p[0] - cx) * ux + (p[1] - cy) * uy for p in pts]
    bb = o.getbbox(); row = (bb[1] + bb[3]) // 2; run = 0
    for x in range(bb[0], bb[2]):
        if o.getpixel((x, row)) > 128: run += 1
        elif run: break
    hw = run * .62 / 2                                       # slash ≈ 0.6 of the bowl's stroke
    a0, a1 = min(along), max(along)
    bar = Image.new('L', (W, W), 0)
    ImageDraw.Draw(bar).polygon([(cx + ux * a0 + nx * hw, cy + uy * a0 + ny * hw), (cx + ux * a1 + nx * hw, cy + uy * a1 + ny * hw),
                                 (cx + ux * a1 - nx * hw, cy + uy * a1 - ny * hw), (cx + ux * a0 - nx * hw, cy + uy * a0 - ny * hw)], fill=255)
    return o, bar

def book():
    img = Image.new('RGB', (S, S), BACK)
    d = ImageDraw.Draw(img)
    # page block: stacked rounded outlines read as curved page edges
    img.paste(PAGE, (0, 0), rounded((40, COVER_BOTTOM - 120, S - 40, 980), 120))
    for y in range(COVER_BOTTOM + 30, 976, 11):
        inset = 40 + int((y - COVER_BOTTOM) * .32)
        d.rounded_rectangle((inset, COVER_BOTTOM - 140, S - inset, y), radius=120, outline=PAGE_LINE, width=3)
    # shadow the cover casts onto the pages
    sh = rounded((0, -40, S, COVER_BOTTOM + 26), COVER_R).filter(ImageFilter.GaussianBlur(14))
    img.paste((40, 12, 14), (0, 0), sh.point(lambda v: int(v * .55)))
    # cover thickness, then the cover face
    img.paste(COVER_EDGE, (0, 0), rounded((0, -40, S, COVER_BOTTOM + 18), COVER_R))
    face = Image.new('RGB', (S, S))
    fd = ImageDraw.Draw(face)
    for y in range(S):
        t = min(1, y / COVER_BOTTOM)
        fd.line([(0, y), (S, y)], fill=tuple(int(LEATHER_TOP[i] + (LEATHER_BOTTOM[i] - LEATHER_TOP[i]) * t) for i in range(3)))
    # leather grain: blurred noise, embossed, blended softly
    rnd = random.Random(7)
    noise = Image.new('L', (S // 2, S // 2))
    noise.putdata([rnd.randint(0, 255) for _ in range((S // 2) ** 2)])
    grain = noise.resize((S, S), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.6)).filter(ImageFilter.EMBOSS)
    face = Image.blend(face, Image.merge('RGB', (grain, grain, grain)), .10)
    # soft light from the top-left
    light = Image.new('L', (S, S), 0)
    ImageDraw.Draw(light).ellipse((-300, -420, 760, 520), fill=34)
    face = Image.composite(Image.new('RGB', (S, S), (232, 150, 140)), face, light.filter(ImageFilter.GaussianBlur(160)))
    cover_mask = rounded((0, -40, S, COVER_BOTTOM), COVER_R)
    img.paste(face, (0, 0), cover_mask)
    # thin highlight along the cover's bottom edge (bevel)
    edge = ImageChops.subtract(cover_mask, rounded((0, -40, S, COVER_BOTTOM - 5), COVER_R - 4))
    img.paste((205, 96, 92), (0, 0), edge.point(lambda v: int(v * .5)))
    # embossed ø, centred on the cover face
    o, bar = oe_masks(int(S * .70))
    both = ImageChops.lighter(o, bar)
    bb = both.getbbox(); dx = S // 2 - (bb[0] + bb[2]) // 2; dy = (COVER_BOTTOM - 20) // 2 - (bb[1] + bb[3]) // 2
    o = ImageChops.offset(o, dx, dy); bar = ImageChops.offset(bar, dx, dy); both = ImageChops.offset(both, dx, dy)
    img.paste((70, 14, 18), (0, 0), ImageChops.offset(both, 0, 8).filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * .55)))   # pressed shadow
    img.paste(O_COLOUR, (0, 0), o)
    img.paste(SLASH_COLOUR, (0, 0), bar)
    return img

def save(img, size, name, rounded_corners=False):
    im = img.resize((size, size), Image.LANCZOS)
    if rounded_corners:
        m = rounded((0, 0, size * 4 - 1, size * 4 - 1), int(size * 4 * .225), (size * 4, size * 4)).resize((size, size), Image.LANCZOS)
        im = im.convert('RGBA'); im.putalpha(m)
    im.save(os.path.join(OUT, name))
    print('wrote', name)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    art = book()
    save(art, 180, 'apple-touch-icon.png')          # iOS rounds the corners itself
    save(art, 512, 'icon-512.png')
    save(art, 192, 'icon-192.png', True)
    save(art, 256, 'logo.png', True)                 # splash and menu
