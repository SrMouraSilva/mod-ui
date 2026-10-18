"""Drawing kit for the diagrams of docs/mod-ui.md that are not boxes-and-connectors (matrices, bars, treemap, lanes, sequence, scatter, ...).

The boxes-and-connectors diagrams reuse the shared engine (docs/modui-client/diagrams/src/engine.py: nodes, orthogonal connectors, label masks,
geometry checks). This module adds a `Canvas` for the rest, in the same style: paper background, ink strokes, one terracotta accent, Geist /
Geist Mono / Instrument Serif with system fallbacks. Standard library only.
"""
import html
import math
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / 'modui-client' / 'diagrams' / 'src'))
import engine  # noqa: E402
from engine import PAPER, INK, MUTED, SOFT, ACCENT, LINK, MONO, SANS, SERIF, FONTS_URL, esc, up4  # noqa: E402,F401

RULE = 'rgba(46,31,51,0.10)'
HAIR = 'rgba(46,31,51,0.15)'
INK_TINT = 'rgba(46,31,51,0.06)'
INK_TINT2 = 'rgba(46,31,51,0.12)'
LINK_TINT = 'rgba(136,57,150,0.10)'
ACCENT_TINT = 'rgba(168,78,10,0.08)'
FONT = {'mono': MONO, 'sans': SANS, 'serif': SERIF}


def tw(s, size, kind='mono'):
    """Rough text width in px (Geist Mono 0.60em, Geist 0.56em; a little generous so the system fallbacks fit too)."""
    return len(s) * size * (0.62 if kind == 'mono' else 0.58)


class Canvas:
    """One standalone SVG. Add parts with the helpers, then call `finish(legend_items)` and read `.svg`."""

    def __init__(self, slug, title, desc, W, md='', eyebrow='', h1=''):
        self.slug, self.title, self.desc, self.W, self.md = slug, title, desc, W, md
        self.eyebrow, self.h1 = eyebrow, h1
        self.parts = []
        self.bottom = 0

    # -------------------------------------------------------------------------------------------------------------- primitives
    def raw(self, s):
        self.parts.append(s)

    def _grow(self, y):
        self.bottom = max(self.bottom, y)

    def text(self, x, y, s, size=9, fill=MUTED, font='mono', anchor='start', weight=None, ls=None, italic=False, opacity=None, rot=None):
        a = f' font-weight="{weight}"' if weight else ''
        a += f' letter-spacing="{ls}"' if ls else ''
        a += ' font-style="italic"' if italic else ''
        a += f' opacity="{opacity}"' if opacity else ''
        a += f' text-anchor="{anchor}"' if anchor != 'start' else ''
        self.parts.append(f'<text x="{x:g}" y="{y:g}" fill="{fill}" font-size="{size}" font-family="{FONT[font]}"{a}>{esc(s)}</text>')
        self._grow(y + 4)

    def rect(self, x, y, w, h, fill='none', stroke=None, sw=1, rx=0, dash=None, opacity=None):
        a = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
        a += f' stroke-dasharray="{dash}"' if dash else ''
        a += f' opacity="{opacity}"' if opacity else ''
        self.parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx}" fill="{fill}"{a}/>')
        self._grow(y + h)

    def line(self, x1, y1, x2, y2, stroke=MUTED, sw=1.2, dash=None, marker=None, start=None):
        a = f' stroke-dasharray="{dash}"' if dash else ''
        a += f' marker-end="url(#{marker})"' if marker else ''
        a += f' marker-start="url(#{start})"' if start else ''
        self.parts.append(f'<line x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" stroke="{stroke}" stroke-width="{sw}"{a}/>')
        self._grow(max(y1, y2))

    def path(self, pts, stroke=MUTED, sw=1.2, dash=None, marker=None, start=None, r=8):
        """Orthogonal rounded polyline through pts."""
        a = f' stroke-dasharray="{dash}"' if dash else ''
        a += f' marker-end="url(#{marker})"' if marker else ''
        a += f' marker-start="url(#{start})"' if start else ''
        self.parts.append(f'<path d="{engine.rounded(pts, r)}" fill="none" stroke="{stroke}" stroke-width="{sw}"{a}/>')
        self._grow(max(p[1] for p in pts))

    def label(self, x, y, s, anchor='middle', size=8, fill=MUTED, pad=3, upper=True):
        """Arrow label: uppercase mono on an opaque paper mask (identifiers and paths keep their case with upper=False). (x, y) is the text baseline."""
        s = s.upper() if upper else s
        w = tw(s, size) + 2 * pad
        mx = x - w / 2 if anchor == 'middle' else (x - pad if anchor == 'start' else x - w + pad)
        self.parts.append(f'<rect x="{mx:g}" y="{y-size-1:g}" width="{w:g}" height="{size+5}" fill="{PAPER}"/>')
        self.text(x, y, s, size=size, fill=fill, anchor=anchor, ls='0.04em' if upper else None)

    def tag(self, x, y, s, color=SOFT):
        w = max(24, tw(s, 7) + 10)
        self.parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="12" rx="2" fill="transparent" stroke="{color}" stroke-opacity="0.55" stroke-width="0.8"/>')
        self.text(x + w / 2, y + 9, s, size=7, fill=color, anchor='middle', ls='0.08em')
        return w

    def node(self, x, y, w, h, name, subs=(), kind='backend', focal=False, tagtext=None, dash=None):
        """A node box in the style of the engine (tag, name, sublabels) for canvases that place their own boxes."""
        fill, stroke, tg, tagc, tags, kd = engine.KINDS[kind]
        if focal:
            fill, stroke, tagc = ACCENT_TINT, ACCENT, ACCENT
        d = f' stroke-dasharray="{dash or kd}"' if (dash or kd) else ''
        self.parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="6" fill="{PAPER}"/>')
        self.parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{d}/>')
        if tagtext or tg:
            self.tag(x + 8, y + 8, tagtext or tg, tagc)
        self.text(x + w / 2, y + 36, name, size=12, fill=INK, font='sans', weight=600, anchor='middle')
        for i, s in enumerate(subs):
            self.text(x + w / 2, y + 50 + 12 * i, s, size=8.5, fill=MUTED, anchor='middle')
        self._grow(y + h)

    def zone(self, x, y, w, h, label):
        self.parts.append(engine.zone(x, y, w, h, label))
        self._grow(y + h)

    def callout(self, x, y, lines):
        self.parts.append(engine.callout(x, y, lines))
        self._grow(y + 14 * len(lines))

    def heading(self, x, y, s):
        """Small uppercase eyebrow used as a column/section heading inside a diagram."""
        self.text(x, y, s.upper(), size=8, fill=MUTED, ls='0.18em')

    # -------------------------------------------------------------------------------------------------------------- legend
    def legend(self, items, y=None):
        """items: ('box', fill, stroke, dash, label) | ('line', color, dash, marker, label) | ('dot', fill, label)."""
        y = up4((y if y is not None else self.bottom) + 40)
        W = self.W
        o = [f'<line x1="40" y1="{y}" x2="{W-40}" y2="{y}" stroke="{RULE}" stroke-width="0.8"/>',
             f'<text x="40" y="{y+20}" fill="{MUTED}" font-size="8" font-family="{MONO}" letter-spacing="0.18em">LEGEND</text>']
        x, ky = 40, y + 28
        for it in items:
            kind, label = it[0], it[-1]
            w = (14 if kind != 'line' else 28) + 6 + len(label) * 4.6 + 24
            if x + w > W - 40:
                x, ky = 40, ky + 20
            if kind == 'box':
                _, fill, stroke, dash, _ = it
                d = f' stroke-dasharray="{dash}"' if dash else ''
                o.append(f'<rect x="{x}" y="{ky}" width="14" height="10" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"{d}/>')
                o.append(f'<text x="{x+20}" y="{ky+8}" fill="{MUTED}" font-size="8.5" font-family="{SANS}">{esc(label)}</text>')
            elif kind == 'dot':
                _, fill, _ = it
                o.append(f'<circle cx="{x+7}" cy="{ky+5}" r="4" fill="{fill}"/>')
                o.append(f'<text x="{x+20}" y="{ky+8}" fill="{MUTED}" font-size="8.5" font-family="{SANS}">{esc(label)}</text>')
            else:
                _, color, dash, marker, _ = it
                d = f' stroke-dasharray="{dash}"' if dash else ''
                m = f' marker-end="url(#{marker})"' if marker else ''
                o.append(f'<line x1="{x}" y1="{ky+5}" x2="{x+28}" y2="{ky+5}" stroke="{color}" stroke-width="1.2"{d}{m}/>')
                o.append(f'<text x="{x+34}" y="{ky+8}" fill="{MUTED}" font-size="8.5" font-family="{SANS}">{esc(label)}</text>')
            x += w
        self.parts.append('\n'.join(o))
        self.bottom = ky + 20

    # -------------------------------------------------------------------------------------------------------------- output
    def svg(self):
        slug, W = self.slug, self.W
        H = up4(self.bottom + 24)
        out = ['<?xml version="1.0" encoding="UTF-8"?>',
               f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">',
               f'<title id="{slug}-title">{esc(self.title)}</title>',
               f'<desc id="{slug}-desc">{esc(self.desc)}</desc>',
               '<metadata><![CDATA[',
               f'GENERATED by docs/mod-ui/diagrams/src/build.py from specs.py ({slug}). Do not edit this file by hand.',
               'Content of the diagram as Mermaid or plain data (a summary for readers and AI tools; the layout lives in specs.py):',
               '', self.md.replace(']]>', ']] >'), ']]></metadata>',
               '<defs>',
               f'<style>@import url(\'{FONTS_URL}\');</style>',
               f'<pattern id="{slug}-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="rgba(46,31,51,0.10)"/></pattern>']
        for mid, col in (('arrow', MUTED), ('arrow-accent', ACCENT), ('arrow-link', LINK)):
            out.append(f'<marker id="{slug}-{mid}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto-start-reverse"><polygon points="0 0, 8 3, 0 6" fill="{col}"/></marker>')
        out.append(f'<marker id="{slug}-arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0, 8 3, 0 6" fill="none" stroke="{MUTED}" stroke-width="1.2"/></marker>')
        out += ['</defs>', f'<rect width="100%" height="100%" fill="{PAPER}"/>', f'<rect width="100%" height="100%" fill="url(#{slug}-dots)" opacity="0.55"/>']
        out += self.parts
        out.append('</svg>')
        svg = '\n'.join(out)
        svg = re.sub(r'url\(#(arrow[a-z-]*)\)', lambda m: f'url(#{slug}-{m.group(1)})', svg)
        return svg, W, H


# ------------------------------------------------------------------------------------------------------------------- treemap
def squarify(items, x, y, w, h):
    """items: [(key, value)] sorted by value descending. Returns {key: (x, y, w, h)} (squarified treemap, Bruls et al.)."""
    total = float(sum(v for _, v in items))
    scale = w * h / total
    areas = [(k, v * scale) for k, v in items]
    out = {}

    def worst(row, side):
        s = sum(a for _, a in row)
        return max(max(side * side * a / (s * s), (s * s) / (side * side * a)) for _, a in row)

    def layout(row, x, y, w, h):
        s = sum(a for _, a in row)
        if w >= h:                       # fill a column on the left
            cw = s / h
            yy = y
            for k, a in row:
                ch = a / cw
                out[k] = (x, yy, cw, ch)
                yy += ch
            return x + cw, y, w - cw, h
        rh = s / w                       # fill a row on the top
        xx = x
        for k, a in row:
            cw = a / rh
            out[k] = (xx, y, cw, rh)
            xx += cw
        return x, y + rh, w, h - rh

    row = []
    rest = list(areas)
    while rest:
        side = min(w, h)
        nxt = rest[0]
        if not row or worst(row + [nxt], side) <= worst(row, side):
            row.append(nxt)
            rest.pop(0)
        else:
            x, y, w, h = layout(row, x, y, w, h)
            row = []
    if row:
        layout(row, x, y, w, h)
    return out


# ------------------------------------------------------------------------------------------------------------------- sequence
def sequence(c, actors, cx, items, acts=(), top=76, step=34, left=40, right=1000, node_w=136):
    """Draws a sequence diagram on canvas c (the type budget of the skill applies: 5 lifelines, 12 messages, 2 fragments).

    actors: [(name, sublabel, node kind)]; cx: x of each lifeline.
    items: ('msg', a, b, text, kind[, label_x]) with kind call | http | ret | async | ok
           ('self', a, text) ; ('note', a, text, side) ; ('frame', 'LOOP'|'OPT', guard, [items]) (one level, no nesting)
    acts: [(lifeline, first message index, last message index)] activation bars; indexes count msg and self items in order.
    Returns the y below the last lifeline.
    """
    for i, (name, sub, kind) in enumerate(actors):
        c.node(cx[i] - node_w // 2, top, node_w, 56, name, [sub], kind=kind, tagtext='')
    life_top = top + 56
    # pass 1: y of every item
    y = life_top + 40
    placed = []          # (item, y)
    frames = []          # (y1, y2, tag, guard)
    msg_y = []

    def place(item):
        nonlocal y
        placed.append((item, y))
        if item[0] in ('msg', 'self'):
            msg_y.append(y)
        y += step + (16 if item[0] == 'self' else 0)

    for it in items:
        if it[0] == 'frame':
            y += 14
            y1 = y
            y += 40
            for sub in it[3]:
                place(sub)
            y -= step - 22
            frames.append((y1, y, it[1], it[2]))
            y += 14
        else:
            place(it)
    life_bot = y + 20
    for x in cx:
        c.line(x, life_top, x, life_bot, stroke='rgba(46,31,51,0.20)', sw=1, dash='3,3')
    for y1, y2, tag, guard in frames:
        c.rect(left, y1, right - left, y2 - y1, fill='rgba(46,31,51,0.02)', stroke='rgba(46,31,51,0.22)', sw=1, rx=4)
        c.rect(left, y1, 48, 16, fill=PAPER, stroke='rgba(46,31,51,0.22)', sw=1, rx=2)
        c.text(left + 24, y1 + 12, tag, size=8, fill=MUTED, anchor='middle', ls='0.12em')
        c.text(left + 58, y1 + 12, guard, size=8, fill=MUTED, ls='0.04em')
    for lf, i1, i2 in acts:
        c.rect(cx[lf] - 4, msg_y[i1], 8, msg_y[i2] - msg_y[i1], fill='rgba(46,31,51,0.06)', stroke=MUTED, sw=0.8)
    for it, y in placed:
        if it[0] == 'note':
            _, a, text, side = it
            w = tw(text, 8.5) + 20
            x = cx[a] + 14 if side == 'r' else cx[a] - 14 - w
            c.rect(x, y - 14, w, 26, fill='rgba(46,31,51,0.04)', stroke='rgba(46,31,51,0.30)', sw=0.8, rx=4)
            c.text(x + 10, y + 3, text, size=8.5, fill=INK)
        elif it[0] == 'self':
            _, a, text = it
            x = cx[a] + 4
            c.path([(x, y), (x + 34, y), (x + 34, y + 16), (x, y + 16)], stroke=MUTED, sw=1.2, marker='arrow', r=5)
            c.text(x + 44, y + 11, text, size=8.5, fill=INK)
        else:
            _, a, b, text, kind = it[:5]
            lx = it[5] if len(it) > 5 else None
            x1, x2 = cx[a], cx[b]
            d = 1 if x2 > x1 else -1
            x1, x2 = x1 + 4 * d, x2 - 4 * d
            sty = {'call': (MUTED, None, 'arrow', 1.2), 'http': (LINK, None, 'arrow-link', 1.2), 'ret': (MUTED, '5,4', 'arrow', 1.2),
                   'async': (MUTED, '5,4', 'arrow-open', 1.2), 'ok': (ACCENT, '5,4', 'arrow-accent', 1.6)}[kind]
            c.line(x1, y, x2, y, stroke=sty[0], sw=sty[3], dash=sty[1], marker=sty[2])
            c.label(lx if lx is not None else (x1 + x2) / 2, y - 12, text, size=8.5, fill=ACCENT if kind == 'ok' else MUTED, upper=False)
    return life_bot


# ------------------------------------------------------------------------------------------------------------------- runner
def render(d):
    """Dispatch: an engine spec (dict with 'ents') or a Canvas spec (dict with 'canvas')."""
    if 'canvas' in d:
        c = d['canvas']
        return c.svg()
    return engine.render_svg(d)


def run(specs, out, index_title, argv, build_py):
    """Like engine.run, for a mix of engine specs and Canvas specs."""
    check_only = '--check' in argv
    sections = []
    for make in specs:
        d = make()
        svg, w, h = render(d)
        slug = d['slug'] if 'slug' in d else d['canvas'].slug
        meta = d if 'slug' in d else {'eyebrow': d['canvas'].eyebrow, 'h1': d['canvas'].h1, 'title': d['canvas'].title}
        print(f'{slug}: {w}x{h}')
        if check_only:
            continue
        (out / f'{slug}.svg').write_text(svg + '\n', encoding='utf-8')
        sections.append(
            f'    <section id="{slug}">\n      <p class="eyebrow">{html.escape(meta["eyebrow"])}</p>\n      <h1>{html.escape(meta["h1"])}</h1>\n'
            f'      <div class="diagram-container"><object type="image/svg+xml" data="{slug}.svg" style="min-width:{w}px;aspect-ratio:{w}/{h}" '
            f'aria-label="{html.escape(meta["title"])}"></object></div>\n    </section>')
    if not check_only:
        (out / 'index.html').write_text(engine.INDEX.format(title=html.escape(index_title), build=build_py, sections='\n'.join(sections)), encoding='utf-8')
