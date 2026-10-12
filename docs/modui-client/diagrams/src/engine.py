"""Diagram engine: entity boxes + orthogonal connectors, drawn as one standalone SVG per diagram.

Not meant to be run: `build.py` imports it, together with the diagram definitions in `specs.py`.
Style: the one of docs/architecture-diagram-detailed.html (diagram-design skill): paper background, ink strokes, one terracotta accent,
purple for the TypeScript library; Geist / Geist Mono / Instrument Serif with system fallbacks.
"""
import html, math, re

PAPER, INK, MUTED, SOFT, ACCENT, LINK = '#f5f5f5', '#2e1f33', '#5c4a64', '#6f5a78', '#a84e0a', '#883996'
MONO = "'Geist Mono', monospace"
SANS = "'Geist', sans-serif"
SERIF = "'Instrument Serif', serif"
CHAR_MONO = 5.6   # px per char of the 9px mono sublabels (with margin for fallback fonts)


def esc(s):
    return html.escape(s, quote=False)


def up4(v):
    return int(math.ceil(v / 4.0) * 4)


KINDS = {
    # kind: (fill, stroke, tag text, tag color, tag stroke, dash)
    'class':    ('rgba(136,57,150,0.07)', LINK, 'CLASS', LINK, 'rgba(136,57,150,0.50)', None),
    'wire':     ('#ffffff', INK, 'WIRE', INK, 'rgba(46,31,51,0.40)', None),
    'data':     ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', 'DATA', SOFT, 'rgba(46,31,51,0.22)', None),
    'internal': ('rgba(136,57,150,0.03)', LINK, 'INTERNAL', LINK, 'rgba(136,57,150,0.50)', '4,3'),
    'stub':     ('#ffffff', 'rgba(46,31,51,0.45)', 'SEE', SOFT, 'rgba(46,31,51,0.30)', '4,3'),
    'ext':      ('rgba(92,74,100,0.10)', SOFT, 'EXT', SOFT, 'rgba(92,74,100,0.40)', None),
    'client':   ('rgba(136,57,150,0.07)', LINK, 'TS', LINK, 'rgba(136,57,150,0.50)', None),
    'legacy':   ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', 'JS', SOFT, 'rgba(46,31,51,0.22)', None),
    'backend':  ('#ffffff', INK, 'PY', INK, 'rgba(46,31,51,0.40)', None),
    'http':     ('#ffffff', INK, 'HTTP', INK, 'rgba(46,31,51,0.40)', None),
    'app':      ('#ffffff', INK, 'APP', INK, 'rgba(46,31,51,0.40)', '4,3'),
}
TAGW = {'CLASS': 32, 'WIRE': 28, 'DATA': 28, 'SEE': 24, 'INTERNAL': 48, 'EXT': 28, 'TS': 20, 'JS': 20, 'PY': 20, 'HTTP': 28, 'APP': 28}


class Ent:
    def __init__(self, key, kind, name, fields=(), ops=(), sub=None, note=None, w=None, focal=False, tag=None, x=0, y=0, h=None):
        self.key, self.kind, self.name = key, kind, name
        self.fields, self.ops, self.sub, self.note, self.focal = list(fields), list(ops), sub, note, focal
        self.tag = tag or KINDS[kind][2]
        self.x, self.y = x, y
        lines = self.fields + self.ops + ([sub] if sub else []) + ([note] if note else [])
        need = max([len(l) for l in lines] + [0]) * CHAR_MONO + 24
        need = max(need, len(name) * 7.4 + 24 + 2 * TAGW.get(self.tag, 28) * 0)
        self.w = w or max(up4(need), 168)
        self.hdr = 44 + (12 if sub else 0)
        if kind == 'stub':
            self.h = 60
        else:
            self.h = up4(self.hdr + (10 + 14 * len(self.fields) if self.fields else 0) + (10 + 14 * len(self.ops) if self.ops else 0))
        if h:
            self.h = h

    @property
    def r(self): return self.x + self.w
    @property
    def b(self): return self.y + self.h
    @property
    def cx(self): return self.x + self.w / 2
    @property
    def cy(self): return self.y + self.h / 2

    def draw(self):
        fill, stroke, _, tagc, tags, dash = KINDS[self.kind]
        if self.focal:
            fill, stroke, tagc, tags = 'rgba(168,78,10,0.08)', ACCENT, ACCENT, 'rgba(168,78,10,0.50)'
        x, y, w, h = self.x, self.y, self.w, self.h
        d = f' stroke-dasharray="{dash}"' if dash else ''
        o = [f'<g>', f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>',
             f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{d}/>']
        tw = TAGW.get(self.tag, 28)
        o.append(f'<rect x="{x+8}" y="{y+8}" width="{tw}" height="12" rx="2" fill="transparent" stroke="{tags}" stroke-width="0.8"/>')
        o.append(f'<text x="{x+8+tw/2}" y="{y+17}" fill="{tagc}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{self.tag}</text>')
        o.append(f'<text x="{x+w/2}" y="{y+36}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{esc(self.name)}</text>')
        if self.sub:
            o.append(f'<text x="{x+w/2}" y="{y+49}" fill="{SOFT}" font-size="8" font-family="{MONO}" text-anchor="middle">{esc(self.sub)}</text>')
        if self.note:
            o.append(f'<text x="{x+w/2}" y="{y+52}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{esc(self.note)}</text>')
        ty = y + self.hdr
        for lines, color in ((self.fields, MUTED), (self.ops, SOFT)):
            if not lines:
                continue
            o.append(f'<line x1="{x}" y1="{ty}" x2="{x+w}" y2="{ty}" stroke="rgba(46,31,51,0.15)" stroke-width="0.8"/>')
            for i, l in enumerate(lines):
                o.append(f'<text x="{x+12}" y="{ty+15+14*i}" fill="{color}" font-size="9" font-family="{MONO}">{esc(l)}</text>')
            ty += 10 + 14 * len(lines)
        o.append('</g>')
        return '\n'.join(o)


class Node(Ent):
    """Reference-style architecture node: tag, name, two sublabels."""
    def __init__(self, key, kind, name, subs, x, y, w=160, h=80, focal=False, dashed=False):
        super().__init__(key, kind, name, w=w, x=x, y=y, focal=focal)
        self.subs, self.h = subs, h

    def draw(self):
        fill, stroke, _, tagc, tags, dash = KINDS[self.kind]
        if self.focal:
            fill, stroke, tagc, tags = 'rgba(168,78,10,0.08)', ACCENT, ACCENT, 'rgba(168,78,10,0.50)'
        x, y, w, h = self.x, self.y, self.w, self.h
        tw = TAGW[self.tag]
        o = ['<g>', f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>',
             f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"/>',
             f'<rect x="{x+8}" y="{y+8}" width="{tw}" height="12" rx="2" fill="transparent" stroke="{tags}" stroke-width="0.8"/>',
             f'<text x="{x+8+tw/2}" y="{y+17}" fill="{tagc}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{self.tag}</text>',
             f'<text x="{x+w/2}" y="{y+40}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{esc(self.name)}</text>']
        for i, s in enumerate(self.subs):
            o.append(f'<text x="{x+w/2}" y="{y+56+14*i}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{esc(s)}</text>')
        o.append('</g>')
        return '\n'.join(o)


def attach(e, side, at):
    """Point on the edge `side` of entity e; `at` is the absolute coordinate along the edge (None = middle)."""
    if side == 'R': return (e.r, at if at is not None else e.cy)
    if side == 'L': return (e.x, at if at is not None else e.cy)
    if side == 'T': return (at if at is not None else e.cx, e.y)
    if side == 'B': return (at if at is not None else e.cx, e.b)


def route(p1, s1, p2, s2, mid=None):
    (x1, y1), (x2, y2) = p1, p2
    h1, h2 = s1 in 'LR', s2 in 'LR'
    if h1 and h2:
        if abs(y1 - y2) < 0.5: return [p1, p2]
        xm = mid if mid is not None else (x1 + x2) / 2
        return [p1, (xm, y1), (xm, y2), p2]
    if not h1 and not h2:
        if abs(x1 - x2) < 0.5: return [p1, p2]
        ym = mid if mid is not None else (y1 + y2) / 2
        return [p1, (x1, ym), (x2, ym), p2]
    if h1 and not h2: return [p1, (x2, y1), p2]
    return [p1, (x1, y2), p2]


def rounded(pts, r=8):
    d = [f'M {pts[0][0]:g},{pts[0][1]:g}']
    for i in range(1, len(pts) - 1):
        (ax, ay), (bx, by), (cx, cy) = pts[i - 1], pts[i], pts[i + 1]
        l1, l2 = math.hypot(bx - ax, by - ay), math.hypot(cx - bx, cy - by)
        rr = min(r, l1 / 2, l2 / 2)
        sx, sy = bx - (bx - ax) / l1 * rr, by - (by - ay) / l1 * rr
        ex, ey = bx + (cx - bx) / l2 * rr, by + (cy - by) / l2 * rr
        d.append(f'L {sx:g},{sy:g} Q {bx:g},{by:g} {ex:g},{ey:g}')
    d.append(f'L {pts[-1][0]:g},{pts[-1][1]:g}')
    return ' '.join(d)


STYLES = {
    'own':    dict(stroke=MUTED, w=1.2, dash=None, end=False, start=False, marker='arrow'),
    'ref':    dict(stroke=MUTED, w=1.0, dash='4,3', end=True, start=False, marker='arrow'),
    'call':   dict(stroke=MUTED, w=1.2, dash=None, end=True, start=False, marker='arrow'),
    'http':   dict(stroke=LINK, w=1.2, dash=None, end=True, start=False, marker='arrow-link'),
    'ws':     dict(stroke=ACCENT, w=1.4, dash=None, end=True, start=True, marker='arrow-accent'),
    'push':   dict(stroke=ACCENT, w=1.4, dash=None, end=True, start=False, marker='arrow-accent'),
}
LABEL_CH = 5.2


class Conn:
    def __init__(self, a, sa, b, sb, kind='own', at_a=None, at_b=None, mid=None, ca=None, cb=None, label=None, seg=None, lside=None):
        self.a, self.sa, self.b, self.sb, self.kind = a, sa, b, sb, kind
        self.at_a, self.at_b, self.mid, self.ca, self.cb, self.label, self.seg, self.lside = at_a, at_b, mid, ca, cb, label, seg, lside
        self.pts = route(attach(a, sa, at_a), sa, attach(b, sb, at_b), sb, mid)
        self.masks = []   # (x, y, w, h, text-svg)
        self._labels()

    def _mask(self, text, x, base, anchor, size=8):
        w = len(text) * LABEL_CH + 4
        mx = x - 2 if anchor == 'start' else (x - w + 2 if anchor == 'end' else x - w / 2)
        r = (mx, base - 9, w, 12)
        svg = (f'<rect x="{r[0]:g}" y="{r[1]:g}" width="{r[2]:g}" height="{r[3]}" fill="{PAPER}"/>'
               f'<text x="{x:g}" y="{base:g}" fill="{MUTED}" font-size="{size}" font-family="{MONO}" text-anchor="{anchor}" letter-spacing="0.04em">{esc(text)}</text>')
        self.masks.append((r, svg))

    def _end_label(self, text, p, d, outward):
        """Cardinality label next to endpoint p. d = direction of travel leaving (outward=True) or arriving (False)."""
        dx, dy = d
        if not outward: dx, dy = -dx, -dy   # make d point away from the box
        if dx:  # horizontal, leaves the box sideways
            x = p[0] + dx * 12
            self._mask(text, x, p[1] - 9, 'start' if dx > 0 else 'end')
        else:
            base = p[1] + 16 if dy > 0 else p[1] - 12
            self._mask(text, p[0] + 8, base, 'start')

    def _labels(self):
        P = self.pts
        d1 = (P[1][0] - P[0][0], P[1][1] - P[0][1]); n1 = math.hypot(*d1); d1 = (d1[0] / n1, d1[1] / n1)
        d2 = (P[-1][0] - P[-2][0], P[-1][1] - P[-2][1]); n2 = math.hypot(*d2); d2 = (d2[0] / n2, d2[1] / n2)
        if self.ca: self._end_label(self.ca, P[0], d1, True)
        if self.cb: self._end_label(self.cb, P[-1], d2, False)
        if self.label:
            segs = [(i, math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1])) for i in range(len(P) - 1)]
            i = self.seg if self.seg is not None else max(segs, key=lambda s: s[1])[0]
            (ax, ay), (bx, by) = P[i], P[i + 1]
            t = self.label.upper()
            if abs(ay - by) < 0.5:
                self._mask(t, (ax + bx) / 2, ay + 17 if self.lside == 'B' else ay - 9, 'middle')
            else:
                my = (ay + by) / 2 + 3
                if self.lside == 'L': self._mask(t, ax - 9, my, 'end')
                else: self._mask(t, ax + 9, my, 'start')

    def draw_line(self):
        s = STYLES[self.kind]
        d = f' stroke-dasharray="{s["dash"]}"' if s['dash'] else ''
        m = ''
        if s['end']: m += f' marker-end="url(#{s["marker"]})"'
        if s['start']: m += f' marker-start="url(#{s["marker"]})"'
        return f'<path d="{rounded(self.pts)}" fill="none" stroke="{s["stroke"]}" stroke-width="{s["w"]}"{d}{m}/>'


# ---------------------------------------------------------------------------------------------------------------- checks
def seg_rect(p, q, m=0):
    return (min(p[0], q[0]) - m, min(p[1], q[1]) - m, abs(p[0] - q[0]) + 2 * m, abs(p[1] - q[1]) + 2 * m)


def overlap(r1, r2):
    return r1[0] < r2[0] + r2[2] and r2[0] < r1[0] + r1[2] and r1[1] < r2[1] + r2[3] and r2[1] < r1[1] + r1[3]


def check(name, ents, conns, W, H):
    boxes = {e.key: (e.x, e.y, e.w, e.h) for e in ents}
    warn = []
    for e in ents:
        if e.x < 0 or e.y < 0 or e.r > W or e.b > H: warn.append(f'{e.key} outside viewBox')
        for f in ents:
            if e is not f and overlap((e.x - 8, e.y - 8, e.w + 16, e.h + 16), (f.x, f.y, f.w, f.h)): warn.append(f'boxes {e.key}/{f.key} too close')
    for i, c in enumerate(conns):
        tag = f'{c.a.key}->{c.b.key}'
        for k in range(len(c.pts) - 1):
            r = seg_rect(c.pts[k], c.pts[k + 1], 0.5)
            for e in ents:
                if e is c.a or e is c.b: continue
                if overlap(r, boxes[e.key]): warn.append(f'{tag}: segment passes behind {e.key}')
            for j, o in enumerate(conns):
                if j <= i: continue
                for m in range(len(o.pts) - 1):
                    r2 = seg_rect(o.pts[m], o.pts[m + 1], 0.5)
                    if overlap(r, r2):
                        # collinear overlap vs crossing
                        a1, a2, b1, b2 = c.pts[k], c.pts[k + 1], o.pts[m], o.pts[m + 1]
                        if (abs(a1[0] - a2[0]) < .5 and abs(b1[0] - b2[0]) < .5) or (abs(a1[1] - a2[1]) < .5 and abs(b1[1] - b2[1]) < .5):
                            warn.append(f'{tag} and {o.a.key}->{o.b.key}: overlapping strokes')
                        else:
                            warn.append(f'{tag} crosses {o.a.key}->{o.b.key}')
        for (r, _) in c.masks:
            for e in ents:
                if overlap(r, boxes[e.key]): warn.append(f'{tag}: label mask touches {e.key}')
            for j, o in enumerate(conns):
                if o is c: continue
                for m in range(len(o.pts) - 1):
                    if overlap(r, seg_rect(o.pts[m], o.pts[m + 1], 3)): warn.append(f'{tag}: label touches stroke of {o.a.key}->{o.b.key}')
            for j, o in enumerate(conns):
                if j <= i: continue
                for (r2, _) in o.masks:
                    if overlap(r, r2): warn.append(f'{tag}: label overlaps label of {o.a.key}->{o.b.key}')
            if r[0] < 0 or r[0] + r[2] > W: warn.append(f'{tag}: label outside viewBox')
    # attach points on the same edge >= 12px apart
    pts = {}
    for c in conns:
        for e, s, p in ((c.a, c.sa, c.pts[0]), (c.b, c.sb, c.pts[-1])):
            pts.setdefault((e.key, s), []).append(p)
    for k, v in pts.items():
        for i in range(len(v)):
            for j in range(i + 1, len(v)):
                if math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1]) < 12: warn.append(f'{k}: attach points closer than 12px')
    for w in warn: print(f'  [{name}] WARN {w}')
    return warn


# ---------------------------------------------------------------------------------------------------------------- page
LEGEND = {
    'class':  ('Client class', ('rgba(136,57,150,0.07)', LINK, None)),
    'wire':   ('Wire type (backend JSON)', ('#ffffff', INK, None)),
    'data':   ('Plain data / enum', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', None)),
    'internal': ('Internal (not exported)', ('rgba(136,57,150,0.03)', LINK, '3,2')),
    'stub':   ('Defined in another diagram', ('#ffffff', 'rgba(46,31,51,0.45)', '3,2')),
    'focal':  ('Aggregate root of this domain', ('rgba(168,78,10,0.08)', ACCENT, None)),
    'ext':    ('External process', ('rgba(92,74,100,0.10)', SOFT, None)),
    'client': ('TypeScript library', ('rgba(136,57,150,0.07)', LINK, None)),
    'legacy': ('Legacy browser code', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', None)),
    'backend': ('Backend module', ('#ffffff', INK, None)),
    'app':    ('Your code', ('#ffffff', INK, '3,2')),
}
LINE_LEGEND = {
    'own':  ('Owns / contains (cardinality at each end)', MUTED, None, False, ''),
    'ref':  ('Creates / reads / refers to', MUTED, '4,3', True, 'arrow'),
    'call': ('Call / protocol', MUTED, None, True, 'arrow'),
    'http': ('HTTP request', LINK, None, True, 'arrow-link'),
    'ws':   ('WebSocket (both ways)', ACCENT, None, True, 'arrow-accent'),
    'push': ('Broadcast to every socket', ACCENT, None, True, 'arrow-accent'),
}


def legend(y, W, kinds, lines):
    o = [f'<line x1="40" y1="{y}" x2="{W-40}" y2="{y}" stroke="rgba(46,31,51,0.10)" stroke-width="0.8"/>',
         f'<text x="40" y="{y+20}" fill="{MUTED}" font-size="8" font-family="{MONO}" letter-spacing="0.18em">LEGEND</text>']
    x, row = 40, 0
    ky = y + 28
    items = [('box', k) for k in kinds] + [('line', k) for k in lines]
    for typ, k in items:
        label = (LEGEND[k][0] if typ == 'box' else LINE_LEGEND[k][0])
        w = (14 if typ == 'box' else 28) + 6 + len(label) * 4.6 + 24
        if x + w > W - 40:
            x, ky = 40, ky + 20
        if typ == 'box':
            fill, stroke, dash = LEGEND[k][1]
            d = f' stroke-dasharray="{dash}"' if dash else ''
            o.append(f'<rect x="{x}" y="{ky}" width="14" height="10" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"{d}/>')
            o.append(f'<text x="{x+20}" y="{ky+8}" fill="{MUTED}" font-size="8.5" font-family="{SANS}">{esc(label)}</text>')
        else:
            _, color, dash, arrow, marker = LINE_LEGEND[k]
            d = f' stroke-dasharray="{dash}"' if dash else ''
            m = f' marker-end="url(#{marker})"' if arrow else ''
            ms = f' marker-start="url(#{marker})"' if k == 'ws' else ''
            o.append(f'<line x1="{x+ (4 if k=="ws" else 0)}" y1="{ky+5}" x2="{x+28}" y2="{ky+5}" stroke="{color}" stroke-width="1.2"{d}{m}{ms}/>')
            o.append(f'<text x="{x+34}" y="{ky+8}" fill="{MUTED}" font-size="8.5" font-family="{SANS}">{esc(label)}</text>')
        x += w
    return '\n'.join(o), ky + 20


def callout(x, y, lines):
    return '\n'.join(f'<text x="{x}" y="{y+14*i}" fill="{MUTED}" font-size="12" font-style="italic" font-family="{SERIF}">{esc(l)}</text>' for i, l in enumerate(lines))



FONTS_URL = ('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&amp;family=Geist:wght@400;500;600'
             '&amp;family=Geist+Mono:wght@400;500;600&amp;display=swap')


def ident(name):
    return re.sub(r'[^A-Za-z0-9_]', '', name)


def mermaid_class(d):
    """Mermaid classDiagram with the content of a domain diagram (entities, fields, operations, relations, notes). Not the layout."""
    def clean(t):
        t = t.replace('·', ',').replace('|', 'or').replace('&', 'and')
        return re.sub(r'[{}<>"`]', '', t).strip()
    out = ['classDiagram', '  direction LR']
    for en in d['ents']:
        out.append(f'  class {ident(en.name)} {{')
        out.append(f'    <<{"focal " if en.focal else ""}{"see another diagram" if en.kind == "stub" else en.kind}>>')
        for m in en.fields + en.ops:
            out.append(f'    {clean(m)}')
        out.append('  }')
        if en.sub: out.append(f'  note for {ident(en.name)} "{clean(en.sub)}"')
    for c in d['conns']:
        a, b = ident(c.a.name), ident(c.b.name)
        ca = f' "{c.ca}"' if c.ca else ''
        cb = f' "{c.cb}"' if c.cb else ''
        arrow = '*--' if c.kind == 'own' else '..>'
        out.append(f'  {a}{ca} {arrow}{cb} {b}' + (f' : {clean(c.label)}' if c.label else ''))
    for co in d.get('callouts', ()):
        out.append(f'  note "{clean(" ".join(co[2]))}"')
    return '\n'.join(out)


def mermaid_flow(d):
    """Mermaid flowchart with the content of the architecture diagram (nodes, groups, flows). Not the layout."""
    out = ['flowchart LR']
    placed = set()
    for label, keys in d['groups']:
        out.append(f'  subgraph {ident(label)}["{label}"]')
        for k in keys:
            en = next(x for x in d['ents'] if x.key == k)
            out.append(f'    {en.key}["{en.name}<br/>{"<br/>".join(en.subs)}"]')
            placed.add(k)
        out.append('  end')
    for en in d['ents']:
        if en.key not in placed:
            out.append(f'  {en.key}["{en.name}<br/>{"<br/>".join(en.subs)}"]')
    for c in d['conns']:
        arrow = '<-->' if c.kind == 'ws' else '-->'
        out.append(f'  {c.a.key} {arrow}' + (f'|{c.label}|' if c.label else '') + f' {c.b.key}')
    return '\n'.join(out)


def render_svg(d):
    """Return the standalone SVG text (XML) of one diagram spec; geometry problems are printed by check()."""
    slug, W, ents, conns = d['slug'], d.get('W', 960), d['ents'], d['conns']
    callouts = d.get('callouts', ())
    bot = d.get('bottom') or max([e.b for e in ents] + [c[1] + 14 * len(c[2]) for c in callouts])
    ly = up4(bot + 48)
    leg, lend = legend(ly, W, d['kinds'], d['lines'])
    H = up4(lend + 24)
    check(slug, ents, conns, W, H)
    md = mermaid_flow(d) if 'groups' in d else mermaid_class(d)
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">',
           f'<title id="{slug}-title">{esc(d["title"])}</title>',
           f'<desc id="{slug}-desc">{esc(d["desc"])}</desc>',
           '<metadata><![CDATA[',
           f'GENERATED by docs/modui-client/diagrams/src/build.py from specs.py ({slug}). Do not edit this file by hand.',
           'Content of the diagram as Mermaid (a summary for readers and AI tools; the layout lives in specs.py):',
           '', md, ']]></metadata>',
           '<defs>',
           f'<style>@import url(\'{FONTS_URL}\');</style>',
           f'<pattern id="{slug}-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="rgba(46,31,51,0.10)"/></pattern>']
    for mid, col in (('arrow', MUTED), ('arrow-accent', ACCENT), ('arrow-link', LINK)):
        out.append(f'<marker id="{slug}-{mid}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto-start-reverse"><polygon points="0 0, 8 3, 0 6" fill="{col}"/></marker>')
    out += ['</defs>', f'<rect width="100%" height="100%" fill="{PAPER}"/>', f'<rect width="100%" height="100%" fill="url(#{slug}-dots)" opacity="0.55"/>']
    if d.get('zones'): out.append(d['zones'])
    out.append('<!-- Connectors (behind boxes) -->')
    out += [c.draw_line() for c in conns]
    out.append('<!-- Labels -->')
    out += [m[1] for c in conns for m in c.masks]
    out.append('<!-- Entities -->')
    out += [en.draw() for en in ents]
    out += [callout(*c) for c in callouts]
    out.append(leg)
    out.append('</svg>')
    svg = '\n'.join(out)
    return re.sub(r'url\(#(arrow[a-z-]*)\)', lambda m: f'url(#{slug}-{m.group(1)})', svg), W, H


def at(e, x, y):
    e.x, e.y = x, y
    return e
