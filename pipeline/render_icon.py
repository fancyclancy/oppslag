"""Render the Oppslag app icon (design C in icon_svg.py) into app/icons/.

Draws the SVG, renders it at 1024px with headless Chrome (needed for the leather and paper filters),
then downsizes. File names carry the design version ("bok5") because iOS caches icons by URL:
change the prefix whenever the icon changes.
Run:  python3 -I render_icon.py
"""
import os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from icon_svg import icon, CONCEPTS
from PIL import Image, ImageDraw

OUT = os.path.join(HERE, '..', 'app', 'icons')
PREFIX = 'bok6'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

kw = dict(CONCEPTS['C']); kw.pop('label')
tmp = tempfile.mkdtemp()
svg, png = os.path.join(tmp, 'icon.svg'), os.path.join(tmp, 'icon.png')
open(svg, 'w').write(icon(mask=False, **kw))
subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1024,1024', f'--screenshot={png}', 'file://' + svg],
               check=True, capture_output=True)
art = Image.open(png).convert('RGB')
assert art.size == (1024, 1024), art.size

def save(size, name, rounded=False):
    im = art.resize((size, size), Image.LANCZOS)
    if rounded:   # for places that show the file as-is (browser tab, menu, launch screen)
        m = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * .225), fill=255)
        im = im.convert('RGBA'); im.putalpha(m.resize((size, size), Image.LANCZOS))
    im.save(os.path.join(OUT, f'{PREFIX}-{name}.png'), optimize=True)
    print('wrote', f'{PREFIX}-{name}.png')

save(180, '180')                 # apple-touch-icon: iOS rounds the corners itself
save(512, '512')                 # manifest, also maskable (full-bleed square)
save(192, '192', True)           # manifest + favicon
save(384, 'logo', True)          # launch screen (112pt at 3x) and menu
