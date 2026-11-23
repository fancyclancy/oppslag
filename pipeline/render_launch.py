"""Render iOS launch images (apple-touch-startup-image) for the Home Screen app, and write their <link>
tags into app/index.html between the LAUNCH-IMAGES markers.

iOS shows the launch image while it zooms the app open. Without one it shows plain white until the page
paints. Each image is an exact copy of the app's own launch screen (#splash): --paper background, the
icon (bok7-logo.png) at 112pt in the centre of the screen with the same drop shadow, so the hand-over
from iOS's image to the page is invisible. iOS only uses an image whose size matches the device exactly,
so there is one per iPhone screen size, in light and dark.

Run after render_icon.py whenever the icon changes (the file names carry the icon's prefix):
    python3 -I render_launch.py
"""
import os, re
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
# the icon's file prefix, read from render_icon.py (importing it would re-render the icon)
PREFIX = re.search(r"^PREFIX = '([^']+)'", open(os.path.join(HERE, 'render_icon.py')).read(), re.M).group(1)

APP = os.path.join(HERE, '..', 'app')
ICON = os.path.join(APP, 'icons', f'{PREFIX}-logo.png')
PAPER = {'light': (0xF5, 0xF2, 0xEC), 'dark': (0x1C, 0x1B, 0x1C)}
ICON_PT, SHADOW_Y, SHADOW_BLUR, SHADOW_A = 112, 10, 22, .18   # same as #splash img in styles.css
# portrait screen sizes in points, and pixel ratio
DEVICES = [
    (375, 667, 2),   # iPhone SE (2nd/3rd gen), 8
    (414, 736, 3),   # 8 Plus
    (375, 812, 3),   # X, XS, 11 Pro, 12 mini, 13 mini
    (414, 896, 2),   # XR, 11
    (414, 896, 3),   # XS Max, 11 Pro Max
    (390, 844, 3),   # 12, 13, 14, 12 Pro, 13 Pro
    (428, 926, 3),   # 12 Pro Max, 13 Pro Max, 14 Plus
    (393, 852, 3),   # 14 Pro, 15, 15 Pro, 16
    (430, 932, 3),   # 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    (402, 874, 3),   # 16 Pro, 17, 17 Pro
    (420, 912, 3),   # iPhone Air
    (440, 956, 3),   # 16 Pro Max, 17 Pro Max
]

src = Image.open(ICON).convert('RGBA')
links = []
for w, h, r in DEVICES:
    W, H = w * r, h * r
    size = ICON_PT * r
    icon = src.resize((size, size), Image.LANCZOS)
    pad = SHADOW_BLUR * r * 2
    shadow = Image.new('RGBA', (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
    a = icon.split()[3].point(lambda v: int(v * SHADOW_A))
    layer = Image.new('RGBA', icon.size, (30, 36, 33, 0)); layer.putalpha(a)
    shadow.paste(layer, (pad, pad))
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR * r / 2))   # CSS blur radius = 2 × std dev
    x, y = (W - size) // 2, (H - size) // 2
    for mode, bg in PAPER.items():
        im = Image.new('RGBA', (W, H), bg + (255,))
        im.alpha_composite(shadow, (x - pad, y - pad + SHADOW_Y * r))
        im.alpha_composite(icon, (x, y))
        name = f'{PREFIX}-launch-{W}x{H}' + ('-dark' if mode == 'dark' else '') + '.png'
        im.convert('RGB').save(os.path.join(APP, 'icons', name), optimize=True)
        media = f'(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: portrait)'
        if mode == 'dark': media += ' and (prefers-color-scheme: dark)'
        links.append((mode, f'<link rel="apple-touch-startup-image" media="{media}" href="icons/{name}">'))
    print('wrote', W, 'x', H)

# light first, then dark: in dark mode both match and the later one wins
tags = [t for m, t in links if m == 'light'] + [t for m, t in links if m == 'dark']
html_path = os.path.join(APP, 'index.html')
html = open(html_path).read()
block = '<!-- LAUNCH-IMAGES (pipeline/render_launch.py) -->\n' + '\n'.join(tags) + '\n<!-- /LAUNCH-IMAGES -->'
if '<!-- LAUNCH-IMAGES' in html:
    html = re.sub(r'<!-- LAUNCH-IMAGES.*?<!-- /LAUNCH-IMAGES -->', lambda m: block, html, flags=re.S)
else:
    html = html.replace('<link rel="apple-touch-icon"', block + '\n<link rel="apple-touch-icon"', 1)
open(html_path, 'w').write(html)
print(len(tags), 'link tags in index.html')
