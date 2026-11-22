"""Oppslag app icon, v5 concepts: a leather-bound book (spine on the left, pages opening on the right,
like Apple's Dictionary icon) with a drawn "ø" on the cover.

The ø is drawn, not typeset:
  - the "o" is an upright oval with a tall stadium-shaped counter: thick sides, thin top and bottom
    (high stroke contrast, after the owner's reference #1, with the elongated width of #4)
  - the slash is a parallelogram with horizontal cut ends (reference #2), set into the letter with a
    thin leather-coloured gap on both sides, like an inlay

Writes SVG; render with headless Chrome (render_icons.sh) to keep the leather and paper filters.
Run:  python3 -I icon_svg.py OUTDIR
"""
import math, os, sys

S = 1024

def oe(cx, cy, rx, ry, side, top, slash_w, gap, ext, angle_deg, mode, slash_fill='url(#blue)', joins='open'):
    """Return SVG for the ø. mode: 'inlay' (blue slash, leather gaps), 'cut' (slash is a gap only)."""
    cw = rx - side          # counter half-width
    ch = ry - top           # counter half-height
    a = math.radians(angle_deg)
    # parallelogram through the centre, ends cut horizontally at y = cy ± (ry + ext)
    yt, yb = cy - ry - ext, cy + ry + ext
    dx = lambda y: (cy - y) / math.tan(a)           # x offset of the centre line at height y
    hw = slash_w / 2 / math.sin(a)                   # half width measured horizontally
    def para(h, y0, y1):
        return f"M{cx + dx(y0) - h:.1f},{y0:.1f} L{cx + dx(y0) + h:.1f},{y0:.1f} L{cx + dx(y1) + h:.1f},{y1:.1f} L{cx + dx(y1) - h:.1f},{y1:.1f} Z"
    o_path = (f"M{cx - rx},{cy} A{rx},{ry} 0 1,0 {cx + rx},{cy} A{rx},{ry} 0 1,0 {cx - rx},{cy} Z "
              f"M{cx - cw},{cy - ch + cw} A{cw},{cw} 0 0,1 {cx + cw},{cy - ch + cw} L{cx + cw},{cy + ch - cw} A{cw},{cw} 0 0,1 {cx - cw},{cy + ch - cw} Z")
    g = gap / math.sin(a)
    def strip(h0, h1, y0, y1):
        return f"M{cx + dx(y0) + h0:.1f},{y0:.1f} L{cx + dx(y0) + h1:.1f},{y0:.1f} L{cx + dx(y1) + h1:.1f},{y1:.1f} L{cx + dx(y1) + h0:.1f},{y1:.1f} Z"
    if joins == 'pinwheel':
        # the top arc and the bottom arc run into the slash; the right side's top end and the
        # left side's bottom end keep their gap, so the letter turns like a pinwheel (reference 1)
        cut = strip(hw, hw + g, yt - 40, cy) + ' ' + strip(-hw - g, -hw, cy, yb + 40)   # the o runs under the slash: one shape, no seam
    else:
        cut = para(hw + g, yt - 40, yb + 40)
    out = f"""
  <mask id="oeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="{S}" height="{S}">
    <rect width="{S}" height="{S}" fill="#fff"/><path d="{cut}" fill="#000"/>
  </mask>
  <g filter="url(#press)">
    <path d="{o_path}" fill-rule="evenodd" fill="url(#ink)" mask="url(#oeMask)"/>"""
    if mode == 'inlay':
        out += f"""
    <path d="{para(hw, yt, yb)}" fill="{slash_fill}"/>"""
    out += "\n  </g>"
    return out

def icon(mode='inlay', rx=212, ry=240, side=100, top=33, slash_w=50, gap=14, ext=32, angle=56, mask=True, label='', slash_fill='url(#blue)', joins='open'):
    COVER_B = 792                     # bottom of the cover face
    M = 54                            # even margin of back cover round the pages (bottom and right)
    PB_L, PB_R, PB_B = 40, S - M, S - M   # page block
    RC = 230 - M                      # fore-edge corner, parallel to the icon's own corner
    RP = 190                          # page block's bottom-left corner, concentric with the icon's corner
    CL = 48                           # radius of the cover's bottom-left corner: its lip tucks over the pages
    # page lines run along the bottom, curve up into the spine on the left (concentric with the
    # rounded corner, like the pages of a bound book) and up the fore-edge on the right
    lines = []
    n = 26
    for k in range(n):
        t = k / (n - 1)
        y = COVER_B + 22 + t * (PB_B - COVER_B - 30)
        d = PB_B - y                  # every page line is concentric with the fore-edge corner
        r = max(24, RC - d)
        xr = PB_R - d
        rl = max(26, RP - (PB_B - y) - 6)
        xl = PB_L + RP - rl
        shade = 0.20 + 0.25 * ((k * 7) % 5) / 4      # irregular, like real page edges
        lines.append(f'<path d="M{xl:.1f},{y - rl - 22:.1f} V{y - rl:.1f} A{rl:.1f},{rl:.1f} 0 0,0 {xl + rl:.1f},{y:.1f} H{xr - r:.1f} A{r:.1f},{r:.1f} 0 0,0 {xr:.1f},{y - r:.1f} V{COVER_B - 60}" '
                     f'fill="none" stroke="#9C8F78" stroke-opacity="{shade:.2f}" stroke-width="{1.6 if k % 3 else 2.4}"/>')
    lines = '\n    '.join(lines)
    mark = oe(S / 2, COVER_B / 2 + 6, rx, ry, side, top, slash_w, gap, ext, angle, mode, slash_fill, joins)
    PAGES = f"M{PB_L},{COVER_B - 80} H{PB_R} V{PB_B - RC} A{RC},{RC} 0 0,1 {PB_R - RC},{PB_B} H{PB_L + RP} A{RP},{RP} 0 0,1 {PB_L},{PB_B - RP} Z"
    # the cover's bottom edge rolls down round the pages' top-left corner and carries on as the spine
    # (Apple's Dictionary icon): a convex lip, not a corner
    LIP_R, LIP_X = 70, 30             # lip radius; x of the spine's inner edge
    def cover(dy=0):
        b = COVER_B + dy
        x0 = LIP_X + LIP_R
        return f"M0,0 H{S} V{b - 132} A132,132 0 0,1 {S - 132},{b} H{x0} A{LIP_R},{LIP_R} 0 0,0 {LIP_X},{b + LIP_R} V{S} H0 Z"
    COVER = cover()
    clip = f'<clipPath id="squircle"><rect width="{S}" height="{S}" rx="230" ry="230"/></clipPath>' if mask else ''
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
<defs>
  {clip}
  <linearGradient id="leather" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="{COVER_B}">
    <stop offset="0" stop-color="#B23B3B"/><stop offset=".55" stop-color="#9A2C30"/><stop offset="1" stop-color="#83232A"/>
  </linearGradient>
  <linearGradient id="back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7A2328"/><stop offset="1" stop-color="#5E181C"/></linearGradient>
  <linearGradient id="rimFade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{S - 260}" y2="0"><stop offset="0" stop-color="#C4585A" stop-opacity=".55"/><stop offset=".45" stop-color="#C4585A" stop-opacity=".4"/><stop offset="1" stop-color="#C4585A" stop-opacity="0"/></linearGradient>
  <radialGradient id="crease"><stop offset="0" stop-color="#4A2418" stop-opacity=".42"/><stop offset="1" stop-color="#4A2418" stop-opacity="0"/></radialGradient>
  <linearGradient id="pageShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5A3A2A" stop-opacity=".30"/><stop offset=".07" stop-color="#5A3A2A" stop-opacity="0"/></linearGradient>
  <linearGradient id="spine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#5E181D"/><stop offset=".55" stop-color="#8A2A2E"/><stop offset=".8" stop-color="#9E3436"/><stop offset="1" stop-color="#6E1F24"/>
  </linearGradient>
  <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF6EA"/><stop offset="1" stop-color="#E8DDC6"/></linearGradient>
  <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="120" x2="0" y2="700"><stop offset="0" stop-color="#FFF9EE"/><stop offset="1" stop-color="#F1E7D6"/></linearGradient>
  <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2F57A8"/><stop offset="1" stop-color="#22448C"/></linearGradient>
  <radialGradient id="sheen" gradientUnits="userSpaceOnUse" cx="287" cy="95" r="700"><stop offset="0" stop-color="#F2A49A" stop-opacity=".32"/><stop offset="1" stop-color="#F2A49A" stop-opacity="0"/></radialGradient>
  <radialGradient id="vignette" gradientUnits="userSpaceOnUse" cx="512" cy="360" r="720"><stop offset=".6" stop-color="#3A0A0E" stop-opacity="0"/><stop offset="1" stop-color="#3A0A0E" stop-opacity=".35"/></radialGradient>
  <!-- pebbled leather: noise lit from the top-left -->
  <filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="3" seed="11" result="n"/>
    <feDiffuseLighting in="n" surfaceScale="2.2" lighting-color="#ffffff" result="l"><feDistantLight azimuth="225" elevation="52"/></feDiffuseLighting>
    <feColorMatrix in="l" type="saturate" values="0"/>
  </filter>
  <filter id="fibre" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".9 .04" numOctaves="2" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 .45  0 0 0 0 .40  0 0 0 0 .32  0 0 0 .55 0"/>
  </filter>
  <!-- printed into the leather: a soft shadow below, a faint dark rim above -->
  <filter id="press" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="6" result="s"/>
    <feFlood flood-color="#3A0A0E" flood-opacity=".45"/><feComposite in2="s" operator="in" result="sh"/>
    <feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id="soft2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5"/></filter>
  <clipPath id="pagesClip"><path d="{PAGES}"/></clipPath>
  <clipPath id="coverClip"><path d="{COVER}"/></clipPath>
</defs>
<g clip-path="{'url(#squircle)' if mask else 'none'}">
  <!-- back cover -->
  <rect width="{S}" height="{S}" fill="url(#back)"/>
  <rect width="{S}" height="{S}" filter="url(#grain)" opacity=".16" style="mix-blend-mode:multiply"/>
  <!-- page block: bottom and fore-edge only -->
  <g clip-path="url(#pagesClip)">
    <rect x="{PB_L}" y="{COVER_B - 80}" width="{PB_R - PB_L}" height="{PB_B - COVER_B + 80}" fill="url(#paper)"/>
    <rect x="{PB_L}" y="{COVER_B - 80}" width="{PB_R - PB_L}" height="{PB_B - COVER_B + 80}" filter="url(#fibre)" opacity=".5"/>
    {lines}
    <rect x="{PB_L}" y="{COVER_B - 80}" width="{PB_R - PB_L}" height="{PB_B - COVER_B + 80}" fill="url(#pageShade)"/>
    <ellipse cx="{PB_L + 40}" cy="{COVER_B + 6}" rx="150" ry="70" fill="url(#crease)"/>
    <path d="{PAGES}" fill="none" stroke="#4A1A16" stroke-opacity=".35" stroke-width="6"/>
    <!-- the cover's shadow on the pages, deepest under the cover -->
    <path d="{cover(20)}" fill="#2B0A0C" opacity=".38" filter="url(#soft)"/>
  </g>
  <!-- spine side: the leather rim curves round the corner; light catches it, the pages sit in its shadow -->
  <path d="M{PB_L - 16},{COVER_B} V{PB_B - RP} A{RP + 16},{RP + 16} 0 0,0 {PB_L + RP},{PB_B + 16} H{S - 260}" fill="none" stroke="url(#rimFade)" stroke-width="10" filter="url(#soft2)"/>
  <!-- cover board thickness -->
  <path d="{cover(16)}" fill="#6A1C21"/>
  <!-- cover face -->
  <g clip-path="url(#coverClip)">
    <rect width="{S}" height="{S}" fill="url(#leather)"/>
    <rect width="{S}" height="{S}" filter="url(#grain)" opacity=".22" style="mix-blend-mode:multiply"/>
    <rect width="{S}" height="{S}" fill="url(#sheen)"/>
    <rect width="{S}" height="{S}" fill="url(#vignette)"/>
    <path d="M{LIP_X - 2},{COVER_B + LIP_R + 1} V{COVER_B + LIP_R} A{LIP_R + 2},{LIP_R + 2} 0 0,1 {LIP_X + LIP_R},{COVER_B - 2} H{S - 132} A129,129 0 0,0 {S - 3},{COVER_B - 132}" fill="none" stroke="#E07F7A" stroke-opacity=".45" stroke-width="4"/>
  </g>
  <path d="M{LIP_X - 2},{COVER_B + LIP_R} A{230 - LIP_X + 2},{S - 14 - COVER_B - LIP_R} 0 0,0 230,{S - 14} H{S - 230} A227,216 0 0,0 {S - 3},{S - 230} V{COVER_B - 132}"
        fill="none" stroke="#E07F7A" stroke-opacity=".45" stroke-width="4"/>
  {mark}
</g>
</svg>"""

CONCEPTS = {
    'A': dict(mode='inlay', label='A · Blue inlay'),
    'B': dict(mode='cut', slash_w=44, gap=0, ext=0, label='B · Cut (reference 1)'),
    'C': dict(mode='inlay', slash_fill='url(#ink)', slash_w=46, gap=15, ext=70, joins='pinwheel', label='C · Cream, long slash (reference 2)'),
}

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for k, kw in CONCEPTS.items():
        kw = dict(kw); kw.pop('label')
        open(os.path.join(out, f'concept-{k}.svg'), 'w').write(icon(mask=False, **kw))
    print('ok')
