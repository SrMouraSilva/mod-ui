"""Definitions of the diagrams of docs/mod-ui.md: the single place to edit them. See ../README.md.

Two kinds of function, both returning a dict:
  engine spec   slug, title, desc, ents, conns, kinds, lines, callouts, zones, eyebrow, h1   (boxes and connectors, drawn by the shared engine)
  canvas spec   {'canvas': Canvas}                                                         (everything else, drawn with kit.Canvas)
Numbers (lines of code, imports, counts) come from measure.py, never typed here.
"""
import collections
import os

import data
import measure
from kit import *  # noqa: F401,F403
from engine import Node, Conn, at, zone, KINDS, TAGW, LEGEND  # noqa: F401

# kinds that only this guide uses
KINDS['clib'] = ('rgba(136,57,150,0.03)', LINK, 'C++', LINK, 'rgba(136,57,150,0.50)', None)
KINDS['cloud'] = ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', 'WEB', SOFT, 'rgba(46,31,51,0.22)', '4,3')
KINDS['page'] = ('#ffffff', INK, 'HTML', INK, 'rgba(46,31,51,0.40)', None)
KINDS['unused'] = ('rgba(136,57,150,0.03)', LINK, 'TS', LINK, 'rgba(136,57,150,0.50)', '4,3')
KINDS['lib'] = ('rgba(92,74,100,0.10)', SOFT, 'LIB', SOFT, 'rgba(92,74,100,0.40)', None)
TAGW['HTML'] = 28
TAGW['LIB'] = 24
KINDS['state'] = ('#ffffff', INK, 'STATE', INK, 'rgba(46,31,51,0.40)', None)
KINDS['end'] = ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.45)', 'END', SOFT, 'rgba(46,31,51,0.30)', '4,3')
TAGW['STATE'] = 36
TAGW['END'] = 24
TAGW['C++'] = 28
TAGW['WEB'] = 28
LEGEND['mute'] = ('Dead end worth fixing', ('rgba(168,78,10,0.08)', ACCENT, None))
LEGEND['state'] = ('State of the Host link', ('#ffffff', INK, None))
LEGEND['end'] = ('The process ends', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.45)', '3,2'))
LEGEND['clib'] = ('Native library (C++ via ctypes)', ('rgba(136,57,150,0.03)', LINK, None))
LEGEND['cloud'] = ('Internet service', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', '3,2'))
LEGEND['legacy'] = ('Browser code (jQuery)', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', None))
LEGEND['client'] = ('Typed client (TypeScript)', ('rgba(136,57,150,0.07)', LINK, None))
LEGEND['http'] = ('Tornado handlers', ('#ffffff', INK, None))
LEGEND['backend'] = ('Python module', ('#ffffff', INK, None))
LEGEND['focal'] = ('The running state lives here', ('rgba(168,78,10,0.08)', ACCENT, None))
LEGEND['ext'] = ('Separate process or device', ('rgba(92,74,100,0.10)', SOFT, None))


def context():
    W = 992
    NW, NH = 176, 80
    ax, bx, cx = 56, 408, 760
    r0, r1, r2, r3 = 96, 232, 352, 472
    cloud = Node('cloud', 'cloud', 'mod.audio cloud', ['api · plugins · pedalboards', 'TONE3000 (NAM models)'], ax, r0, NW, NH)
    classic = Node('classic', 'legacy', 'Classic UI', ['html/js · jQuery', 'host.js · desktop.js'], ax, r1, NW, NH)
    client = Node('client', 'client', 'modui-client', ['typed fetch + WebSocket', 'new UIs · Node.js'], ax, r2, NW, NH)
    web = Node('web', 'http', 'Webserver', ['webserver.py · Tornado 4.3', '89 routes · 3 sockets'], bx, r1, NW, NH)
    host = Node('host', 'backend', 'Session + Host', ['session.py · host.py', 'one shared state'], bx, r2, NW, NH, focal=True)
    libs = Node('libs', 'clib', 'libmod_utils', ['modtools/utils.py · ctypes', 'lilv · JACK · ALSA'], bx, r3, NW, NH)
    hmi = Node('hmi', 'ext', 'HMI', ['serial · knobs · screens', 'Duo · Duo X · Dwarf'], cx, r1, NW, NH)
    cc = Node('cc', 'ext', 'Control Chain', ['unix socket', 'external pedals'], cx, r2, NW, NH)
    mh = Node('mh', 'ext', 'mod-host + JACK', ['TCP :5555 / :5556', 'LV2 audio engine'], cx, r3, NW, NH)
    ents = [cloud, classic, client, web, host, libs, hmi, cc, mh]
    zones = '\n'.join([
        zone(40, 72, 208, 128, 'INTERNET'),
        zone(40, 216, 208, 240, 'BROWSER'),
        zone(392, 216, 208, 372, 'MOD-UI · PYTHON'),
        zone(744, 216, 208, 372, 'DEVICE'),
    ])
    conns = [
        Conn(classic, 'T', cloud, 'B', 'http', at_a=ax + 140, at_b=ax + 140, label='https', lside='R'),
        Conn(cloud, 'R', web, 'T', 'ref', at_b=bx + 140, label='rpl · rpb ws'),
        Conn(classic, 'R', web, 'L', 'http', at_a=r1 + 28, at_b=r1 + 28, label='http · ws'),
        Conn(client, 'R', web, 'L', 'http', at_a=r2 + 40, at_b=r1 + 56, mid=320, label='http · ws', seg=2, lside='L'),
        Conn(web, 'B', host, 'T', 'call', at_a=bx + 48, at_b=bx + 48, label='calls', lside='L'),
        Conn(host, 'T', web, 'B', 'push', at_a=bx + 128, at_b=bx + 128, label='broadcast', lside='R'),
        Conn(host, 'B', libs, 'T', 'call', label='ctypes', lside='R'),
        Conn(host, 'R', hmi, 'L', 'call', at_a=r2 + 20, at_b=r1 + 40, mid=676, label='serial', seg=2, lside='R'),
        Conn(host, 'R', cc, 'L', 'call', at_a=r2 + 44, at_b=r2 + 44, label='socket'),
        Conn(host, 'R', mh, 'L', 'call', at_a=r2 + 68, at_b=r3 + 24, mid=640, label='tcp', seg=2, lside='L'),
        Conn(libs, 'R', mh, 'L', 'call', at_a=r3 + 52, at_b=r3 + 52, label='jack · alsa'),
    ]
    return dict(slug='context', W=W, title='mod-ui in its surroundings',
                desc='The classic UI and typed clients reach a Tornado webserver; Session and Host drive mod-host, the HMI and Control Chain, and libmod_utils reaches JACK and ALSA; the cloud is reached by the browser, and its website can push installs back over two sockets.',
                eyebrow='System context · mod-ui', h1='What mod-ui talks to, and who starts each conversation',
                ents=ents, conns=conns, zones=zones, kinds=['legacy', 'client', 'http', 'focal', 'clib', 'ext', 'cloud'],
                lines=['http', 'call', 'ref', 'push'],
                line_labels={'http': 'HTTP request / WebSocket from a browser', 'call': 'Call or protocol inside the device', 'ref': 'Opened from outside: the mod.audio website pushes to the device', 'push': 'Broadcast to every browser'},
                callouts=[(56, 520, ['The server never calls the cloud:', 'the browser brokers every request.'])], bottom=592)


def layers():
    L = measure.loc()
    py = {os.path.basename(k): v for k, v in L['py'].items()}
    cpp = {os.path.basename(k): v for k, v in L['cpp'].items()}
    js = sum(L['js'].values())
    html_ = sum(L['html'].values())
    session_loc = py['session.py'] + py['recorder.py'] + py['screenshot.py']
    host_loc = py['host.py'] + py['addressings.py'] + py['bank.py'] + py['profile.py'] + py['tuner.py'] + py['tempo.py']
    link_loc = py['hmi.py'] + py['protocol.py'] + py['mod_protocol.py'] + py['control_chain.py']
    bridge_py, bridge_cpp = py['utils.py'], sum(cpp.values())
    reach = measure.webserver_reach()
    counts, total = measure.host_methods()

    W = 1040
    c = Canvas('layers', 'The layers of mod-ui and how much code each holds',
               'Seven layers from the browser to the platform, each with its files and size; the Tornado handlers skip layers to reach the Host and the native bridge directly, and the Host class mixes six kinds of work.',
               W, eyebrow='Layer stack · mod-ui', h1='Seven layers on paper, and the two shortcuts that skip them',
               md='flowchart TB\n  L7["7 Browser: html/js, jQuery"] --> L6["6 Transport: webserver.py"]\n  L6 --> L5["5 Session: session.py, recorder, screenshot"]\n  L5 --> L4["4 Host: host.py, addressings, bank, profile"]\n  L4 --> L3["3 Device links: hmi, protocol, control_chain"]\n  L4 --> L2["2 Native bridge: modtools/utils.py, libmod_utils"]\n  L3 --> L1["1 Platform: mod-host, JACK, ALSA, OS image"]\n  L2 --> L1\n  L6 -. skips .-> L4\n  L6 -. skips .-> L2')
    X, BW = 160, 540
    top = 96
    spec = [  # num, name, subs, kind, height
        (7, 'Browser', ['28 scripts in html/js · jQuery widgets · global variables', 'index.html renders the globals; Mustache templates'], 'legacy', 72),
        (6, 'Transport', ['webserver.py · 89 routes · 3 WebSockets · uploads', 'also renders pages and talks to the OS (tar, systemctl)'], 'http', 100),
        (5, 'Session', ['session.py · recorder.py · screenshot.py', 'browsers, preferences, recording, thumbnails'], 'backend', 72),
        (4, 'Host', ['host.py · addressings.py · bank.py · profile.py · tempo.py', None], 'backend', 124),
        (3, 'Device links', ['hmi.py · protocol.py · mod_protocol.py · control_chain.py', 'serial and unix-socket protocols of the pedals'], 'backend', 72),
        (2, 'Native bridge', ['modtools/utils.py (ctypes) → libmod_utils.so', 'lilv scan, pedalboard files, JACK ports, ALSA mixer'], 'clib', 72),
        (1, 'Platform', ['mod-host · JACK · ALSA · LV2 bundles · systemd · OS image', 'not in this repository'], 'ext', 72),
    ]
    y = top
    pos = {}
    for num, name, subs, kind, h in spec:
        pos[num] = (y, h)
        y += h + 12
    # skip connectors first (behind the boxes)
    y6, y2, y4 = pos[6][0], pos[2][0], pos[4][0]
    c.path([(X, y6 + 24), (104, y6 + 24), (104, y2 + 28), (X, y2 + 28)], stroke=ACCENT, sw=1.4, dash='5,4', marker='arrow-accent')
    c.path([(X, y6 + 48), (132, y6 + 48), (132, y4 + 28), (X, y4 + 28)], stroke=ACCENT, sw=1.4, dash='5,4', marker='arrow-accent')
    sizes = {7: [(js, 'js'), (html_, 'html')], 6: [(py['webserver.py'], 'py')], 5: [(session_loc, 'py')], 4: [(host_loc, 'py')],
             3: [(link_loc, 'py')], 2: [(bridge_py, 'py'), (bridge_cpp, 'cpp')], 1: []}
    tone = {'js': INK_TINT2, 'html': INK_TINT, 'py': 'rgba(46,31,51,0.22)', 'cpp': 'rgba(136,57,150,0.30)'}
    scale = 224.0 / 9557
    for num, name, subs, kind, h in spec:
        y, _ = pos[num]
        fill, stroke, _, tagc, tags, dash = engine.KINDS[kind]
        d = f' stroke-dasharray="{dash}"' if dash else ''
        c.raw(f'<rect x="{X}" y="{y}" width="{BW}" height="{h}" rx="6" fill="{PAPER}"/>')
        c.raw(f'<rect x="{X}" y="{y}" width="{BW}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{d}/>')
        c.tag(X + 12, y + 12, f'L{num}', tagc)
        c.text(X + 52, y + 22, name, size=12, fill=INK, font='sans', weight=600)
        c.text(X + 16, y + 42, subs[0], size=8.5, fill=MUTED)
        if subs[1]:
            c.text(X + 16, y + 56, subs[1], size=8.5, fill=SOFT)
        # size bar: the number above, the bar below (a bar wider than the column is cut with a break mark)
        bx = 744
        total_n = sum(n for n, _ in sizes[num])
        if not sizes[num]:
            c.text(744, y + 27, 'external, not counted', size=9, fill=SOFT)
            continue
        label = f'{total_n:,}' + (f' = {sizes[num][0][0]:,} JS + {sizes[num][1][0]:,} HTML' if num == 7 else (f' = {sizes[num][0][0]:,} PY + {sizes[num][1][0]:,} C++' if num == 2 else ''))
        c.text(744, y + 20, label, size=9, fill=INK)
        cut = False
        for n, lang in sizes[num]:
            w = n * scale
            if bx + w > 744 + 224:
                w, cut = 744 + 224 - bx, True
            if w > 0:
                c.rect(bx, y + 28, max(2, w), 16, fill=tone[lang], stroke='rgba(46,31,51,0.30)', sw=0.8, rx=2)
            bx += max(2, w)
        if cut:
            c.rect(744 + 224 - 12, y + 26, 5, 20, fill=PAPER)
            c.line(744 + 224 - 14, y + 46, 744 + 224 - 6, y + 26, stroke=INK, sw=0.9)
    # transport: the shortcuts, counted
    y6 = pos[6][0]
    c.text(X + 16, y6 + 74, f'skips the Session: {reach["host_calls"]} calls of SESSION.host.* (vs {reach["session_calls"]} through Session)', size=8.5, fill=INK)
    c.text(X + 16, y6 + 86, f'skips the Host: {reach["utils_names"]} names imported from modtools.utils', size=8.5, fill=INK)
    # host: what its methods are about
    y4, h4 = pos[4]
    order = ['HMI handlers and display', 'Plugin graph, session, stats', 'Addressing', 'Pedalboard files, snapshots, presets', 'JACK, MIDI, transport', 'Socket to mod-host']
    short = {'HMI handlers and display': 'HMI handlers', 'Plugin graph, session, stats': 'plugin graph · session', 'Addressing': 'addressing',
             'Pedalboard files, snapshots, presets': 'files', 'JACK, MIDI, transport': 'JACK · MIDI', 'Socket to mod-host': 'socket'}
    c.text(X + 16, y4 + 56, f'class Host: {total} methods, by what they are about', size=8.5, fill=SOFT)
    bar_x, bar_w = X + 16, BW - 32
    xx = bar_x
    shades = ['rgba(46,31,51,0.30)', 'rgba(46,31,51,0.18)', 'rgba(46,31,51,0.28)', 'rgba(46,31,51,0.16)', 'rgba(46,31,51,0.26)', 'rgba(46,31,51,0.14)']
    for i, k in enumerate(order):
        w = counts[k] / total * bar_w
        c.rect(xx, y4 + 64, w, 14, fill=shades[i], stroke=PAPER, sw=1)
        label = f'{counts[k]} {short[k]}'
        row = y4 + 92 + (12 if i % 2 else 0)
        if i == len(order) - 1:
            c.text(bar_x + bar_w, row, label, size=8, fill=MUTED, anchor='end')
        else:
            c.text(xx, row, label, size=8, fill=MUTED)
        c.line(xx + 2, y4 + 80, xx + 2, row - 8, stroke=HAIR, sw=0.8)
        xx += w
    c.heading(744, top - 12, 'Lines of code')
    c.callout(744, pos[4][0] + 76, ['Only the Host remembers the running', 'pedalboard; every browser is rebuilt from it.'])
    c.legend([('box', tone['js'], 'rgba(46,31,51,0.30)', None, 'JavaScript'), ('box', tone['html'], 'rgba(46,31,51,0.30)', None, 'HTML templates'),
              ('box', tone['py'], 'rgba(46,31,51,0.30)', None, 'Python'), ('box', tone['cpp'], 'rgba(46,31,51,0.30)', None, 'C++'),
              ('line', ACCENT, '5,4', 'arrow-accent', 'Layer skipped by the Tornado handlers')])
    return {'canvas': c}


def imports():
    E = measure.import_edges()
    order = [  # key, label, group
        ('server', 'server.py', 'ENTRY'), ('mod/webserver', 'webserver.py', 'ENTRY'),
        ('mod/session', 'session.py', 'SESSION'), ('mod/development', 'development.py', 'SESSION'),
        ('mod/host', 'host.py', 'HOST'), ('mod/addressings', 'addressings.py', 'HOST'),
        ('mod/hmi', 'hmi.py', 'DEVICE LINKS'), ('mod/protocol', 'protocol.py', 'DEVICE LINKS'), ('mod/mod_protocol', 'mod_protocol.py', 'DEVICE LINKS'),
        ('mod/control_chain', 'control_chain.py', 'DEVICE LINKS'),
        ('mod/profile', 'profile.py', 'HELPERS'), ('mod/bank', 'bank.py', 'HELPERS'), ('modtools/tempo', 'tempo.py (modtools)', 'HELPERS'),
        ('mod/tuner', 'tuner.py', 'HELPERS'), ('mod/recorder', 'recorder.py', 'HELPERS'), ('mod/screenshot', 'screenshot.py', 'HELPERS'),
        ('mod/hostinfo', 'hostinfo.py', 'HELPERS'), ('mod/communication', 'communication/', 'HELPERS'),
        ('modtools/pedalboard', 'pedalboard.py (modtools)', 'NATIVE'), ('modtools/utils', 'utils.py (modtools)', 'NATIVE'),
        ('mod/__init__', '__init__.py', 'KERNEL'), ('mod/settings', 'settings.py', 'KERNEL'),
    ]
    n = len(order)
    idx = {k: i for i, (k, _, _) in enumerate(order)}
    cells = [(idx[a], idx[b]) for a, ts in E.items() for b in ts if a in idx and b in idx]
    fan_out = collections.Counter(r for r, _ in cells)
    fan_in = collections.Counter(c_ for _, c_ in cells)
    upward = [(r, c_) for r, c_ in cells if c_ < r]
    W, cell = 1040, 20
    x0, y0 = 252, 104
    c = Canvas('imports', 'Who imports whom among the Python modules of mod-ui',
               f'A dependency matrix of {n} modules and {len(cells)} imports, ordered from the entry point down to the kernel: every import points down the stack, there are no import cycles, and settings.py and __init__.py are imported by about half of the modules.',
               W, eyebrow='Dependency matrix · mod/ and modtools/', h1='The imports are clean; the coupling is somewhere else',
               md='%% Dependency structure matrix; row imports column. Mermaid has no matrix, so the edges follow as a flowchart.\nflowchart TB\n' +
                  '\n'.join(f'  {a.replace("/", "_")} --> {b.replace("/", "_")}' for a, ts in sorted(E.items()) for b in sorted(ts)))
    # bands and group labels
    groups = []
    for i, (_, _, g) in enumerate(order):
        if groups and groups[-1][0] == g:
            groups[-1][2] = i
        else:
            groups.append([g, i, i])
    for gi, (g, a, b) in enumerate(groups):
        if gi % 2 == 0:
            c.rect(40, y0 + a * cell, x0 + n * cell - 40, (b - a + 1) * cell, fill='rgba(46,31,51,0.035)')
        c.text(40, y0 + a * cell + 13, g, size=7, fill=SOFT, ls='0.14em')
        c.line(40, y0 + a * cell, x0 + n * cell, y0 + a * cell, stroke=HAIR, sw=0.8)
    c.line(40, y0 + n * cell, x0 + n * cell, y0 + n * cell, stroke=HAIR, sw=0.8)
    # grid, diagonal, labels
    for i, (k, label, g) in enumerate(order):
        c.text(x0 - 8, y0 + i * cell + 13.5, f'{i+1:02d}  {label}', size=8.5, fill=INK, anchor='end')
        c.text(x0 + i * cell + cell / 2, y0 - 8, f'{i+1}', size=8, fill=MUTED, anchor='middle')
        c.rect(x0 + i * cell + 1, y0 + i * cell + 1, cell - 2, cell - 2, fill='rgba(46,31,51,0.10)', rx=2)
        c.line(x0 + (i + 1) * cell, y0, x0 + (i + 1) * cell, y0 + n * cell, stroke='rgba(46,31,51,0.05)', sw=0.8)
        c.line(x0, y0 + (i + 1) * cell, x0 + n * cell, y0 + (i + 1) * cell, stroke='rgba(46,31,51,0.05)', sw=0.8)
    for r, c_ in cells:
        bad = (r, c_) in upward
        c.rect(x0 + c_ * cell + 4, y0 + r * cell + 4, cell - 8, cell - 8, fill=ACCENT if bad else INK, rx=2)
    # totals
    c.heading(x0 + n * cell + 10, y0 - 8, 'out')
    top_in = sorted(fan_in.values(), reverse=True)[:2]
    for i in range(n):
        c.text(x0 + n * cell + 10, y0 + i * cell + 13.5, str(fan_out.get(i, 0)), size=8.5, fill=MUTED)
        hot = fan_in.get(i, 0) in top_in and fan_in.get(i, 0) > 0
        c.text(x0 + i * cell + cell / 2, y0 + n * cell + 14, str(fan_in.get(i, 0)), size=8.5, fill=ACCENT if hot else MUTED, anchor='middle', weight=600 if hot else None)
    c.text(x0 - 8, y0 + n * cell + 14, 'IN (files that import it)', size=7.5, fill=MUTED, anchor='end', ls='0.06em')
    # reading guide and numbers
    px = 760
    c.heading(px, y0 - 8, 'How to read it')
    c.text(px, y0 + 12, 'A square in row R, column C means', size=8.5, fill=MUTED)
    c.text(px, y0 + 24, 'module R imports module C.', size=8.5, fill=MUTED)
    c.text(px, y0 + 42, 'Right of the diagonal: an import that', size=8.5, fill=MUTED)
    c.text(px, y0 + 54, 'goes down the stack (the normal way).', size=8.5, fill=MUTED)
    c.text(px, y0 + 72, 'Left of it: an upward import.', size=8.5, fill=MUTED)
    heavy = sorted(((fan_out[i], order[i][1]) for i in fan_out), reverse=True)[:3]
    c.heading(px, y0 + 112, 'Numbers')
    rows = [f'{n} modules, {len(cells)} imports', f'{len(upward)} upward imports, 0 import cycles',
            f'most imports out: {heavy[0][1]} ({heavy[0][0]}), {heavy[1][1]} ({heavy[1][0]})',
            'most imports in: ' + ', '.join(order[i][1] for i, _ in fan_in.most_common(2))]
    for i, t in enumerate(rows):
        c.text(px, y0 + 132 + 14 * i, t, size=8.5, fill=INK)
    c.callout(px, y0 + 220, ['The stack holds in the imports.', 'Layers get crossed at run time, through', 'SESSION, callbacks and module globals.'])
    c.legend([('box', INK, INK, None, 'Import (row uses column)'), ('box', 'rgba(46,31,51,0.10)', 'rgba(46,31,51,0.30)', None, 'Diagonal'),
              ('dot', ACCENT, 'Highest fan-in'), ('box', 'rgba(46,31,51,0.035)', 'rgba(46,31,51,0.15)', None, 'Layer band')])
    return {'canvas': c}


def load_sequence():
    W = 1040
    cx = [100, 300, 540, 740, 940]
    actors = [('Browser', 'classic UI · client', 'legacy'), ('Webserver', 'webserver.py · session.py', 'http'), ('Host', 'host.py · addressings.py', 'backend'),
              ('libmod_utils', 'lilv · ctypes', 'clib'), ('mod-host', 'TCP :5555', 'ext')]
    c = Canvas('load-pedalboard', 'What happens when a pedalboard is loaded',
               'Sequence of a pedalboard load: the browser posts the bundle, the Host reads it through libmod_utils, tells mod-host to add every plugin and connection while pushing the same frames to the browsers, then confirms with loading_end and the HTTP answer.',
               W, eyebrow='Sequence · POST /pedalboard/load_bundle/', h1='One load: every change goes to mod-host and to every browser',
               md='sequenceDiagram\n  participant B as Browser\n  participant W as Webserver\n  participant H as Host\n  participant L as libmod_utils\n  participant M as mod-host\n'
                  '  B->>W: POST /pedalboard/load_bundle/\n  W->>H: SESSION.load_pedalboard(bundle)\n  H->>L: get_pedalboard_info(bundle)\n  L-->>H: plugins, connections\n  H--)B: loading_start, size\n'
                  '  loop each plugin\n    H->>M: add uri id\n    H--)B: add instance\n  end\n  loop each connection\n    H->>M: connect a b\n    H--)B: connect a b\n  end\n'
                  '  H->>M: state_load bundle\n  H--)B: loading_end\n  W-->>B: 200 ok, name')
    top = 76
    for i, (name, sub, kind) in enumerate(actors):
        c.node(cx[i] - 68, top, 136, 56, name, [sub], kind=kind, tagtext='')
    life_top, life_bot = top + 56, 724
    for x in cx:
        c.line(x, life_top, x, life_bot, stroke='rgba(46,31,51,0.20)', sw=1, dash='3,3')

    def frame(y1, y2, tag, guard):
        c.rect(72, y1, 896, y2 - y1, fill='rgba(46,31,51,0.02)', stroke='rgba(46,31,51,0.22)', sw=1, rx=4)
        c.rect(72, y1, 48, 16, fill=PAPER, stroke='rgba(46,31,51,0.22)', sw=1, rx=2)
        c.text(96, y1 + 12, tag, size=8, fill=MUTED, anchor='middle', ls='0.12em')
        c.text(130, y1 + 12, guard, size=8, fill=MUTED, ls='0.04em')

    def act(i, y1, y2):
        c.rect(cx[i] - 4, y1, 8, y2 - y1, fill='rgba(46,31,51,0.06)', stroke=MUTED, sw=0.8)

    msgs = []   # (y, a, b, text, kind, label x)

    def msg(y, a, b, text, kind='call', lx=None):
        msgs.append((y, a, b, text, kind, lx))
    msg(180, 0, 1, 'POST /pedalboard/load_bundle/', 'http')
    msg(212, 1, 2, 'SESSION.load_pedalboard()')
    msg(244, 2, 3, 'get_pedalboard_info()')
    msg(276, 3, 2, 'plugins · connections', 'ret')
    msg(308, 2, 0, 'loading_start · size', 'async', 420)
    frame(332, 452, 'LOOP', '[for each plugin]')
    msg(396, 2, 4, 'add uri id')
    msg(428, 2, 0, 'add instance', 'async', 420)
    frame(468, 588, 'LOOP', '[for each connection]')
    msg(532, 2, 4, 'connect a b')
    msg(564, 2, 0, 'connect a b', 'async', 420)
    msg(624, 2, 4, 'state_load bundle')
    msg(656, 2, 0, 'loading_end', 'async', 420)
    msg(688, 1, 0, '200 {ok, name}', 'ok')
    # activation bars (behind the arrows)
    act(1, 180, 688)
    act(2, 212, 656)
    act(3, 244, 276)
    for y, a, b, text, kind, lx in msgs:
        x1, x2 = cx[a], cx[b]
        d = 1 if x2 > x1 else -1
        x1 += 4 * d
        x2 -= 4 * d
        if kind == 'call':
            c.line(x1, y, x2, y, stroke=MUTED, sw=1.2, marker='arrow')
        elif kind == 'http':
            c.line(x1, y, x2, y, stroke=LINK, sw=1.2, marker='arrow-link')
        elif kind == 'ret':
            c.line(x1, y, x2, y, stroke=MUTED, sw=1.2, dash='5,4', marker='arrow')
        elif kind == 'async':
            c.line(x1, y, x2, y, stroke=MUTED, sw=1.2, dash='5,4', marker='arrow-open')
        elif kind == 'ok':
            c.line(x1, y, x2, y, stroke=ACCENT, sw=1.6, dash='5,4', marker='arrow-accent')
        mx = lx if lx is not None else (x1 + x2) / 2
        c.label(mx, y - 12, text, size=8.5, fill=ACCENT if kind == 'ok' else MUTED, upper=False)
    c.callout(40, 764, ['feature_enable processing 0 … 1 brackets the whole load:', 'plugin processing is paused while they are added.'])
    c.callout(560, 764, ['Every step is sent twice: to mod-host, and to every', 'browser, so a second browser follows along.'])
    c.legend([('line', LINK, None, 'arrow-link', 'HTTP request'), ('line', MUTED, None, 'arrow', 'Call'), ('line', MUTED, '5,4', 'arrow', 'Return'),
              ('line', MUTED, '5,4', 'arrow-open', 'WebSocket frame to the browsers (no reply)'), ('line', ACCENT, '5,4', 'arrow-accent', 'HTTP answer')])
    return {'canvas': c}


def event_loop():
    blocking = measure.blocking_calls()
    gen_sites = measure.gen_task_sites()
    W = 1040
    c = Canvas('event-loop', 'One thread and three serialized request queues',
               'A single Tornado thread serves the browsers, mod-host, the HMI and Control Chain; each device has its own first-in first-out queue that lets only one request fly at a time, and the browsers are throttled with data_ready; several calls block the thread.',
               W, eyebrow='Data flow · concurrency model', h1='One thread, three copies of the same queue',
               md='flowchart LR\n  IOLoop["Tornado IOLoop (1 thread)"] --> Q1["Host._queue"] --> M["mod-host :5555"]\n  M -. "resp, events :5556" .-> IOLoop\n'
                  '  IOLoop --> Q2["HMI.queue"] --> H["HMI serial"]\n  H -. reply .-> IOLoop\n  IOLoop --> Q3["ControlChain.write_queue"] --> C["control-chain.sock"]\n  C -. reply .-> IOLoop\n'
                  '  IOLoop -- write_message --> B["Browsers"]\n  B -. data_ready .-> IOLoop')
    ix, iy, iw = 40, 96, 184
    lanes = [
        ('mod-host', 'TCP :5555 · events on :5556', 'ext', 'host.py · Host._queue', ['add', 'param_set', 'connect', 'bypass'], 'tcp :5555', 'resp · events'),
        ('HMI', 'serial · knobs, LEDs, screens', 'ext', 'hmi.py · HMI.queue', ['a …', 's …', 'l …', 'pi'], 'serial', 'reply'),
        ('Control Chain', 'unix socket · external pedals', 'ext', 'control_chain.py · write_queue', ['device_list', 'device_status', 'device_descriptor'], 'unix socket', 'reply'),
    ]
    pitch = 116
    y0s = [iy + 24 + i * pitch for i in range(4)]
    ih = y0s[-1] + 88 - iy
    # connectors first
    for i, (name, sub, kind, caption, cells, sock, back) in enumerate(lanes):
        y0 = y0s[i]
        c.line(ix + iw, y0 + 36, 296, y0 + 36, stroke=MUTED, sw=1.2, marker='arrow')
        c.line(584, y0 + 36, 704, y0 + 36, stroke=MUTED, sw=1.2, marker='arrow')
        c.line(704, y0 + 68, ix + iw, y0 + 68, stroke=MUTED, sw=1.2, dash='5,4', marker='arrow')
        c.label(644, y0 + 28, sock, size=8)
        c.label(464, y0 + 84, back, size=8)
    yb = y0s[3]
    c.line(ix + iw, yb + 36, 296, yb + 36, stroke=ACCENT, sw=1.4, marker='arrow-accent')
    c.line(584, yb + 36, 704, yb + 36, stroke=ACCENT, sw=1.4, marker='arrow-accent')
    c.line(704, yb + 68, ix + iw, yb + 68, stroke=MUTED, sw=1.2, dash='5,4', marker='arrow')
    c.label(644, yb + 28, 'ws frame', size=8, fill=ACCENT)
    c.label(464, yb + 84, 'data_ready n', size=8)
    # boxes
    c.node(ix, iy, iw, ih, 'Tornado IOLoop', ['one thread', 'callbacks, no await', f'{gen_sites} gen / async sites'], kind='backend', focal=True, tagtext='PY')
    for k, line in enumerate(['TIMERS', 'stats  every 1 s', 'memory  every 5 s', 'HMI ping  every 5 s *', '', 'SIGNALS', 'SIGUSR1: save, screenshot', 'SIGUSR2: disconnect, checks', '', '* only if HMI_TIMEOUT > 0']):
        if line:
            c.text(ix + 16, iy + 138 + 14 * k, line, size=7.5 if line.isupper() else 8.5, fill=SOFT if line.isupper() else MUTED, ls='0.14em' if line.isupper() else None)
    for i, (name, sub, kind, caption, cells, sock, back) in enumerate(lanes):
        y0 = y0s[i]
        c.text(296, y0 + 12, caption, size=8, fill=SOFT)
        cw = (288 - 8 * (len(cells) - 1)) / len(cells)
        for j, t in enumerate(cells):
            x = 296 + j * (cw + 8)
            c.rect(x, y0 + 20, cw, 32, fill='rgba(46,31,51,0.04)', stroke='rgba(46,31,51,0.30)', sw=1, rx=3)
            c.text(x + cw / 2, y0 + 40, t, size=8, fill=INK, anchor='middle')
        c.node(704, y0, 232, 88, name, [sub], kind=kind)
    c.text(296, yb + 12, 'host.py · web_data_ready_ok', size=8, fill=SOFT)
    c.rect(296, yb + 20, 288, 32, fill='rgba(46,31,51,0.04)', stroke='rgba(46,31,51,0.30)', sw=1, rx=3)
    c.text(440, yb + 40, 'data_finish waits for the ack', size=8.5, fill=INK, anchor='middle')
    c.node(704, yb, 232, 88, 'Browsers', ['every open /websocket', 'all see the same frames'], kind='legacy', tagtext='JS')
    # what blocks the loop
    by = ih + iy + 28
    c.heading(40, by, 'Call sites that stop the only thread until they return')
    x = 40
    for name, n in blocking.items():
        w = max(132, tw(name, 8.5) + 28)
        c.rect(x, by + 14, w, 44, fill='rgba(46,31,51,0.03)', stroke='rgba(46,31,51,0.30)', sw=1, rx=4)
        c.text(x + 12, by + 36, str(n), size=16, fill=INK, font='sans', weight=600)
        c.text(x + 12, by + 51, name, size=8, fill=MUTED)
        x += w + 12
    c.callout(40, by + 92, ['session.hmi_reinit_cb restarts the HMI with os.system("hmi-reset; sleep 3"):', 'every browser, the HMI and mod-host callbacks wait for those three seconds.'])
    c.legend([('line', MUTED, None, 'arrow', 'Request, first in first out'), ('line', MUTED, '5,4', 'arrow', 'Reply or event, handled when it arrives'),
              ('line', ACCENT, None, 'arrow-accent', 'Frame pushed to the browsers'), ('box', 'rgba(46,31,51,0.04)', 'rgba(46,31,51,0.30)', None, 'Queued message')])
    return {'canvas': c}


def host_link():
    W = 1040
    NW, NH = 176, 80
    st = Node('s', 'state', 'Starting', ['init_host()', 'init_jack · open sockets'], 56, 224, NW, NH)
    cn = Node('c', 'state', 'Connecting', ['writesock :5555', 'readsock :5556'], 320, 224, NW, NH)
    rn = Node('r', 'state', 'Running', ['one request in flight', 'stats timers on'], 584, 224, NW, NH)
    mu = Node('m', 'state', 'Linked, mute', ['sockets up, crashed = True', 'every send_*() is dropped'], 452, 80, NW, NH, focal=True)
    kr = Node('k', 'state', 'Crashed', ['writer socket closed', 'browsers get "stop"', 'queue drained, no reply'], 584, 392, NW, 96)
    ex = Node('x', 'end', 'Exit', ['checkhost() at start-up', 'sys.exit(1)'], 56, 392, NW, NH)
    ents = [st, cn, rn, mu, kr, ex]
    conns = [
        Conn(st, 'R', cn, 'L', 'call', label='open sockets', lside='B'),
        Conn(cn, 'R', rn, 'L', 'call', label='sockets up', lside='B'),
        Conn(cn, 'T', mu, 'L', 'call', at_a=cn.x + 44, at_b=mu.y + 40, label='up · no ui', seg=0, lside='L'),
        Conn(mu, 'R', rn, 'T', 'push', at_b=rn.x + 128, label='ui opens', seg=1, lside='R'),
        Conn(rn, 'B', kr, 'T', 'call', at_a=rn.x + 128, at_b=kr.x + 128, label='socket closed', lside='R'),
        Conn(kr, 'L', cn, 'B', 'call', at_a=kr.y + 56, at_b=cn.x + 136, label='5 s · ui opens', lside='B'),
        Conn(cn, 'B', ex, 'R', 'call', at_a=cn.x + 44, at_b=ex.y + 32, label='start-up fail', lside='L'),
    ]
    return dict(slug='host-link', W=W, title='The link between the Host and mod-host',
                desc='States of the Host connection to mod-host: starting, connecting, running, crashed and the exit at start-up; after a crash with no browser open the sockets come back but every command is dropped until a browser opens the UI.',
                eyebrow='State machine · Host ↔ mod-host', h1='After a crash, the link only heals when a browser opens the page',
                ents=ents, conns=conns, zones='', kinds=['state', 'mute', 'end'], lines=['call', 'push'],
                line_labels={'call': 'Transition', 'push': 'Transition that replays the whole pedalboard'},
                callouts=[(792, 96, ['After a crash with no browser', 'open, the sockets reconnect but', 'crashed stays True: only', 'report_current_state(), which', 'needs a websocket, resets it.']),
                          (56, 520, ['reconnect_jack() tries once; if init_jack() fails nothing schedules another try.', 'Both are a reading of the code and have not been run on a device.'])],
                bottom=560)


def modes():
    W = 1040
    c = Canvas('modes', 'What is real in each way of running mod-ui',
               'A matrix of eight components against three runtime modes: on a MOD device everything is real; in MOD Desktop the HMI is a fake, Control Chain, the hardware descriptor and the OS tools are absent; in development mod-host is also a fake.',
               W, eyebrow='Runtime modes · device, MOD Desktop, development', h1='The same code runs three ways; each one removes a different piece',
               md='%% Matrix: component x mode, value = real | fake | absent (note)\n%% Python server | device: real (systemd, Python 3.4) | desktop: real (frozen, 127.0.0.1) | dev: real (python3 server.py :8888)\n'
                  '%% mod-host + JACK | device: real | desktop: real (started by the app) | dev: fake (FakeHost, MOD_DEV_HOST)\n%% libmod_utils | real | real (_MOD_DESKTOP, no ALSA) | real\n'
                  '%% HMI serial | device: real | desktop: fake (port does not open) | dev: fake (FakeHMI)\n%% Control Chain | device: real | desktop: absent (socket missing) | dev: absent\n'
                  '%% Hardware descriptor | device: real | desktop: absent | dev: absent\n%% OS tools | device: real | desktop: absent | dev: absent\n%% Cloud and store | device: real | desktop: partial (locked panels) | dev: real')
    cols = [('MOD device', 'Duo · Duo X · Dwarf'), ('MOD Desktop', 'macOS · Windows · Linux'), ('Development', 'python3 server.py')]
    rows = [  # component, then (state, note) per mode
        ('Python server (mod/)', [('real', 'systemd · Python 3.4 · :80'), ('real', 'frozen binary · 127.0.0.1'), ('real', 'MOD_DEV_ENVIRONMENT=0 · :8888')]),
        ('mod-host + JACK', [('real', 'TCP :5555 / :5556'), ('real', 'provided by the app'), ('fake', 'FakeHost: MOD_DEV_HOST=1')]),
        ('libmod_utils (C++)', [('real', 'lilv · JACK · ALSA'), ('real', '_MOD_DESKTOP, no ALSA'), ('real', 'lilv · JACK optional')]),
        ('HMI (serial)', [('real', '/dev/ttyUSB0 · 10 Mbaud'), ('fake', 'FakeHMI: port does not open'), ('fake', 'FakeHMI: MOD_DEV_HMI=1')]),
        ('Control Chain', [('real', '/tmp/control-chain.sock'), ('absent', 'socket missing: skipped'), ('absent', 'socket missing: skipped')]),
        ('Hardware descriptor', [('real', '/etc/mod-hardware-descriptor.json'), ('absent', 'empty dict: flags are False'), ('absent', 'empty dict: flags are False')]),
        ('OS tools and image', [('real', 'mod-amixer · systemctl · hmi-reset'), ('absent', 'calls guarded or fail'), ('absent', 'calls guarded or fail')]),
        ('Cloud, store, Tone3000', [('real', 'through the browser'), ('partial', 'store and banks: locked panels'), ('real', 'through the browser')]),
    ]
    lx, cx0, cw, rh = 40, 276, 240, 52
    top = 112
    for j, (name, sub) in enumerate(cols):
        x = cx0 + j * (cw + 12)
        c.rect(x, top - 44, cw, 40, fill='rgba(46,31,51,0.04)', stroke='rgba(46,31,51,0.30)', sw=1, rx=6)
        c.text(x + cw / 2, top - 26, name, size=12, fill=INK, font='sans', weight=600, anchor='middle')
        c.text(x + cw / 2, top - 12, sub, size=8, fill=MUTED, anchor='middle')
    for i, (name, cells) in enumerate(rows):
        y = top + 8 + i * (rh + 8)
        c.text(lx, y + 22, name, size=12, fill=INK, font='sans', weight=600)
        for j, (state, note) in enumerate(cells):
            x = cx0 + j * (cw + 12)
            if state == 'real':
                c.rect(x, y, cw, rh, fill='#ffffff', stroke=INK, sw=1, rx=6)
                c.raw(f'<circle cx="{x+18}" cy="{y+rh/2}" r="6" fill="{INK}"/>')
            elif state == 'fake':
                c.rect(x, y, cw, rh, fill='rgba(136,57,150,0.07)', stroke=LINK, sw=1, rx=6, dash='4,3')
                c.raw(f'<circle cx="{x+18}" cy="{y+rh/2}" r="6" fill="none" stroke="{LINK}" stroke-width="1.4" stroke-dasharray="2,2"/>')
            elif state == 'partial':
                c.rect(x, y, cw, rh, fill='rgba(46,31,51,0.04)', stroke='rgba(46,31,51,0.45)', sw=1, rx=6)
                c.raw(f'<path d="M {x+12},{y+rh/2} a 6,6 0 0 1 12,0 z" fill="{INK}"/><circle cx="{x+18}" cy="{y+rh/2}" r="6" fill="none" stroke="{INK}" stroke-width="1"/>')
            else:
                c.rect(x, y, cw, rh, fill='rgba(46,31,51,0.02)', stroke='rgba(46,31,51,0.18)', sw=1, rx=6, dash='2,3')
                c.raw(f'<circle cx="{x+18}" cy="{y+rh/2}" r="6" fill="none" stroke="rgba(46,31,51,0.35)" stroke-width="1"/>')
            c.text(x + 34, y + 22, state, size=9, fill=INK if state != 'absent' else SOFT, weight=600)
            c.text(x + 34, y + 38, note, size=8, fill=MUTED if state != 'absent' else SOFT)
    c.callout(40, top + 8 + 8 * (rh + 8) + 26, ['A fake is a stand-in the code installs on purpose (FakeHost, FakeHMI); an absent piece is simply not there and the code skips it.'])
    c.legend([('dot', INK, 'Real'), ('dot', LINK, 'Fake, installed by the code'), ('dot', 'rgba(46,31,51,0.45)', 'Partly there'), ('dot', 'rgba(46,31,51,0.18)', 'Absent, code skips it')])
    return {'canvas': c}


def devices():
    B = measure.device_branches()
    flags = measure.descriptor_flags()
    reads = sum(n for n, _ in flags.values())
    devs = list(measure.DEVICE_PATTERNS)
    how = {
        'libmod_utils (C++)': '#ifdef _MOD_DEVICE_* at build time',
        'HMI schema · mod_protocol.py': 'CMD_ARGS table per model',
        'Host · host.py': 'register_cmd_callback(model, ...)',
        'HMI driver · hmi.py': 'CMD_* constants of each model',
        'Audio profile · profile.py': 'MOD_SOUNDCARD environment variable',
        'Webserver · session': 'MOD_DESKTOP environment variable',
        'Browser · html/': 'USING_MOD_DESKTOP · model strings',
    }
    W = 1040
    c = Canvas('devices', 'Where the code names a device',
               'A heat map of the lines that name a MOD device or the Desktop build, per layer: Duo X and the HMI schema dominate on the device side, the Desktop build is a flag in the server and the browser, and the web layers never name a device.',
               W, eyebrow='Heat map · device-specific code', h1='Three places know the devices; the rest asks the hardware descriptor',
               md='%% Lines that name a device, per layer (rows) and device (columns)\n%% ' + ' | '.join(['layer'] + devs) + '\n' + '\n'.join('%% ' + ' | '.join([k] + [str(v[d]) for d in devs]) for k, v in B.items()))
    x0, y0, cw, ch = 292, 124, 96, 40
    for j, d in enumerate(devs):
        c.text(x0 + j * (cw + 6) + cw / 2, y0 - 14, d, size=12, fill=INK, font='sans', weight=600, anchor='middle')
    c.heading(x0 + 5 * (cw + 6) + 8, y0 - 14, 'How the code decides')
    vmax = max(max(r.values()) for r in B.values())
    for i, (layer, row) in enumerate(B.items()):
        y = y0 + i * (ch + 6)
        c.text(40, y + 24, layer, size=12, fill=INK, font='sans', weight=600)
        for j, d in enumerate(devs):
            v = row[d]
            x = x0 + j * (cw + 6)
            if v == 0:
                c.rect(x, y, cw, ch, fill='rgba(46,31,51,0.02)', stroke='rgba(46,31,51,0.12)', sw=0.8, rx=4)
                c.text(x + cw / 2, y + 24, '·', size=10, fill=SOFT, anchor='middle')
            else:
                a = 0.10 + 0.70 * math.sqrt(v / vmax)
                c.rect(x, y, cw, ch, fill=f'rgba(46,31,51,{a:.2f})', stroke='rgba(46,31,51,0.35)', sw=0.8, rx=4)
                c.text(x + cw / 2, y + 25, str(v), size=12, fill='#ffffff' if a > 0.45 else INK, font='sans', weight=600, anchor='middle')
        c.text(x0 + 5 * (cw + 6) + 8, y + 24, how[layer], size=8.5, fill=MUTED)
    yb = y0 + len(B) * (ch + 6) + 8
    c.rect(40, yb, x0 + 5 * (cw + 6) - 46, 52, fill='rgba(46,31,51,0.03)', stroke='rgba(46,31,51,0.30)', sw=1, rx=6)
    c.text(56, yb + 22, 'Any device', size=12, fill=INK, font='sans', weight=600)
    c.text(56, yb + 38, f'{len(flags)} keys of the hardware descriptor JSON, read {reads} times (the values live outside the repository)', size=8.5, fill=MUTED)
    c.text(x0 + 5 * (cw + 6) + 8, yb + 30, '/etc/mod-hardware-descriptor.json', size=8.5, fill=MUTED)
    c.callout(40, yb + 90, ['Device names are concentrated in the C++ #ifdefs, the HMI schema and the soundcard profile.', 'Everything else is meant to ask the descriptor; the Desktop build is a single flag.'])
    c.legend([('box', 'rgba(46,31,51,0.20)', 'rgba(46,31,51,0.35)', None, 'Few lines'), ('box', 'rgba(46,31,51,0.75)', 'rgba(46,31,51,0.35)', None, 'Many lines (colour follows the square root of the count)'),
              ('box', 'rgba(46,31,51,0.02)', 'rgba(46,31,51,0.12)', None, 'None')])
    return {'canvas': c}


def features():
    W = 1040
    comps = data.COMPONENTS
    c = Canvas('features', 'Which parts of mod-ui each feature touches',
               'A matrix of eighteen features against eight components: the browser, the webserver, the session, the host, the addressing and device-link modules, libmod_utils, mod-host and the files on disk.',
               W, eyebrow='Traceability matrix · features and components', h1='Every feature crosses the Host; only a few need the pedals or the C++ library',
               md='%% Feature x component matrix (P = carries it, s = supports it)\n%% ' + ' | '.join(['feature'] + comps) + '\n' + '\n'.join('%% ' + ' | '.join([f[1]] + list(f[3])) for f in data.FEATURES))
    lx, gx, cw, rh = 40, 352, 80, 34
    y = 96
    for j, name in enumerate(comps):
        c.text(gx + j * cw + cw / 2, y, name, size=8, fill=INK, anchor='middle', weight=600)
    y += 14
    last = None
    for g, name, entry, cells in data.FEATURES:
        if g != last:
            y += 10
            c.text(lx, y + 2, g, size=7.5, fill=SOFT, ls='0.14em')
            c.line(lx + tw(g, 7.5) + 14, y - 2, gx + len(comps) * cw, y - 2, stroke=HAIR, sw=0.8)
            y += 12
            last = g
        for j, ch_ in enumerate(cells):
            cx = gx + j * cw + cw / 2
            cy = y + rh / 2 - 6
            if ch_ == 'P':
                c.rect(cx - 7, cy - 7, 14, 14, fill=INK, rx=3)
            elif ch_ == 's':
                c.rect(cx - 6, cy - 6, 12, 12, fill='none', stroke=INK, sw=1.2, rx=3)
        c.text(lx, y + 12, name, size=11, fill=INK, font='sans', weight=600)
        c.text(lx, y + 25, entry, size=7.5, fill=SOFT)
        c.line(lx, y + rh - 2, gx + len(comps) * cw, y + rh - 2, stroke='rgba(46,31,51,0.05)', sw=0.8)
        y += rh
    for j in range(len(comps) + 1):
        c.line(gx + j * cw, 110, gx + j * cw, y, stroke='rgba(46,31,51,0.05)', sw=0.8)
    # column totals
    for j in range(len(comps)):
        n = sum(1 for f in data.FEATURES if f[3][j] in 'Ps')
        c.text(gx + j * cw + cw / 2, y + 16, str(n), size=11, fill=ACCENT if j == 3 else INK, font='sans', weight=600, anchor='middle')
    c.text(gx - 12, y + 16, 'features touched', size=8, fill=MUTED, anchor='end', ls='0.06em')
    per = [sum(1 for f in data.FEATURES if f[3][j] in 'Ps') for j in range(len(comps))]
    c.callout(40, y + 44, [f'The host is involved in {per[3]} of {len(data.FEATURES)} features, the pedals (addr · hmi · cc) in {per[4]}, libmod_utils in {per[5]}, mod-host in {per[6]}.',
                           'The session, the only layer meant to sit between the webserver and the host, appears in just %d.' % per[2]])
    c.legend([('box', INK, INK, None, 'Carries the feature'), ('box', 'none', INK, None, 'Supports it'), ('dot', ACCENT, 'Most touched column')])
    return {'canvas': c}


def coupling():
    C = measure.coupling()
    order = sorted(C.items(), key=lambda kv: -kv[1][0])
    note = {
        'Fixed paths of the OS image': 'the layout of the MOD OS image (/data, /root, /etc/mod-*, /usr/bin)',
        'Fixed JACK client names': 'the JACK graph that the image\'s services build (mod-monitor, ttymidi, ...)',
        'Shell-outs': 'binaries shipped by the image: mod-amixer, systemctl, hmi-reset, tar, ...',
        'Hardware-descriptor reads': 'the declarative seam: a JSON file outside the repository',
        'Device or build names': 'Duo, Duo X, Dwarf and the Desktop build',
    }
    W = 1040
    c = Canvas('coupling', 'What the code is tied to',
               'Bars count the places where the Python and C++ code depend on the MOD OS image or on a named device: fixed paths, fixed JACK client names, shell-outs, descriptor reads and device names.',
               W, eyebrow='Bar chart · coupling to the platform', h1='The code leans on the OS image far more than on any one device',
               md='%% Counted from the working tree (see measure.py)\n' + '\n'.join(f'%% {k}: {v[0]} {v[1]}' for k, v in order))
    x0, bw, top, rh = 380, 360, 120, 64
    vmax = max(v[0] for _, v in order)
    for i, (name, (n, unit)) in enumerate(order):
        y = top + i * rh
        short = next(k for k in note if name.startswith(k))
        hot = short.startswith('Hardware')
        c.text(40, y + 20, short, size=12, fill=INK, font='sans', weight=600)
        c.text(40, y + 36, f'{unit}', size=8, fill=SOFT)
        w = bw * n / vmax
        c.rect(x0, y + 6, w, 28, fill=ACCENT_TINT if hot else 'rgba(46,31,51,0.14)', stroke=ACCENT if hot else 'rgba(46,31,51,0.40)', sw=1, rx=3)
        c.text(x0 + w + 10, y + 26, str(n), size=14, fill=ACCENT if hot else INK, font='sans', weight=600)
        c.text(x0, y + 50, note[short], size=8.5, fill=MUTED)
    yb = top + len(order) * rh
    c.callout(40, yb + 16, ['The descriptor reads are the only coupling that is declared as data, so a new device can be described instead of coded.', 'Everything else is a string that has to match the image: rename a path or a JACK client in the image and the code has to be edited by hand.'])
    c.legend([('box', 'rgba(46,31,51,0.14)', 'rgba(46,31,51,0.40)', None, 'Tied to the image or to a device name'), ('box', ACCENT_TINT, ACCENT, None, 'Declared as data (the way out)')])
    return {'canvas': c}


def code_map():
    L = measure.loc()
    py, cpp, js = L['py'], L['cpp'], L['js']
    bn = os.path.basename
    big = {'host.py': ('py', py['mod/host.py']), 'webserver.py': ('py', py['mod/webserver.py']), 'addressings.py': ('py', py['mod/addressings.py']),
           'pedalboard.js': ('js', js['html/js/pedalboard.js']), 'modgui.js': ('js', js['html/js/modgui.js'])}
    other_py = sum(v for k, v in py.items() if bn(k) not in big)
    other_js = sum(v for k, v in js.items() if bn(k) not in big)
    cells = {k: v for k, v in big.items()}
    cells['libmod_utils (C++)'] = ('cpp', sum(cpp.values()))
    cells[f'other JavaScript ({len(js) - 2} files)'] = ('js', other_js)
    cells[f'other Python ({len(py) - 3} files)'] = ('py', other_py)
    total = sum(v for _, v in cells.values())
    items = sorted(((k, v[1]) for k, v in cells.items()), key=lambda kv: -kv[1])
    W = 1040
    c = Canvas('code-map', 'Where the lines of code live',
               f'A treemap of {total:,} lines of Python, C++ and JavaScript in eight cells: host.py alone is the largest cell, followed by the C++ library, the pedalboard canvas and the plugin GUI script.',
               W, eyebrow='Treemap · lines of code', h1='One file in six is host.py',
               md='%% Lines of code (Python, C++, JavaScript; libraries, tests and templates left out)\n' + '\n'.join(f'%% {k}: {v:,}' for k, v in items))
    rects = squarify(items, 40, 96, 960, 440)
    fills = {'py': 'rgba(46,31,51,0.16)', 'cpp': 'rgba(136,57,150,0.22)', 'js': 'rgba(46,31,51,0.06)'}
    for k, v in items:
        x, y, w, h = rects[k]
        lang = cells[k][0]
        focal = k == 'host.py'
        c.rect(x + 1.5, y + 1.5, w - 3, h - 3, fill=ACCENT_TINT if focal else fills[lang], stroke=ACCENT if focal else 'rgba(46,31,51,0.40)', sw=1, rx=4)
        big_cell = w > 150 and h > 80
        narrow = w < 110
        c.text(x + (9 if narrow else 14), y + 28, k, size=14 if big_cell else (9.5 if narrow else 11), fill=INK, font='sans', weight=600)
        c.text(x + (9 if narrow else 14), y + 44 if big_cell else y + 42, f'{v:,} lines', size=9 if not narrow else 8, fill=MUTED)
        c.text(x + (9 if narrow else 14), y + 58 if big_cell else y + 55, f'{100 * v / total:.0f}% of the code' if not narrow else f'{100 * v / total:.0f}%', size=8, fill=SOFT)
    c.callout(40, 572, [f'html/ adds {sum(L["html"].values()):,} lines of templates and pages, and html/js/lib holds the third-party scripts; none of those are counted here.',
                        'Python 3.4 is the device runtime, so host.py is also the largest file that cannot use async/await.'])
    c.legend([('box', fills['py'], 'rgba(46,31,51,0.40)', None, 'Python'), ('box', fills['cpp'], 'rgba(136,57,150,0.50)', None, 'C++'), ('box', fills['js'], 'rgba(46,31,51,0.40)', None, 'JavaScript'),
              ('box', ACCENT_TINT, ACCENT, None, 'The largest file')])
    return {'canvas': c}


def dependency_age():
    use = measure.dependency_usage()
    npy = len(measure.tracked('mod/*.py', 'modtools/*.py', 'server.py'))
    pts = [  # label, release year (approximate where marked), files that use it, short label side
        ('Python 3.4 (device runtime)', 2014.2, npy, 'r', True),
        ('Tornado 4.3', 2015.85, use['tornado 4.3'], 'r', True),
        ('pyserial 3.0', 2015.7, use['pyserial 3.0'], 'r', False),
        ('jQuery 1.9.1', 2013.1, use['jQuery 1.9.1'], 'r', False),
        ('jQuery UI 1.10.1', 2013.1, use['jQuery UI 1.10.1'], 'r', False),
        ('Mustache 0.5 dev', 2012.0, use['Mustache 0.5.0-dev'], 'r', False),
        ('Lunr 0.7', 2016.3, use['Lunr 0.7'], 'r', False),
        ('Pillow ≥ 8.2', 2021.3, use['Pillow'], 'r', False),
        ('pycryptodomex 3.18', 2023.4, use['pycryptodomex 3.18'], 'l', False),
        ('Knockout 2.1 and LESS 1.3 (shipped, never loaded)', 2012.2, 0, 'r', False),
    ]
    W = 1040
    c = Canvas('dependency-age', 'How old the dependencies are, and how much code leans on them',
               'A scatter of third-party pieces by release year and by the number of source files that use them: Python 3.4, Tornado 4.3 and jQuery 1.9.1 are old and widely used; Knockout and LESS are shipped but loaded by no page.',
               W, eyebrow='Scatter · age and reach of dependencies', h1='Old and everywhere: Python 3.4, Tornado 4.3, jQuery 1.9.1',
               md='%% Release year of the version in use (approximate) and number of files that use it\n' + '\n'.join(f'%% {p[0]}: {p[1]:.0f}, {p[2]}' for p in pts))
    px, py_, pw, ph = 88, 104, 880, 400
    y0y, y1y = 2011.0, 2024.0
    ymax = 36
    def X(yr): return px + (yr - y0y) / (y1y - y0y) * pw
    def Y(n): return py_ + ph - 28 - n / ymax * (ph - 28)
    # shaded "old and widely used" region
    c.rect(px, py_, X(2016.5) - px, Y(4) - py_, fill='rgba(168,78,10,0.05)')
    c.text(px + 10, py_ + 16, 'OLD AND WIDELY USED', size=8, fill=ACCENT, ls='0.14em')
    for yr in range(2011, 2025):
        c.line(X(yr), py_, X(yr), py_ + ph, stroke='rgba(46,31,51,0.06)', sw=0.8)
        c.text(X(yr), py_ + ph + 16, str(yr), size=8.5, fill=MUTED, anchor='middle')
    for n in (0, 10, 20, 30):
        c.line(px, Y(n), px + pw, Y(n), stroke='rgba(46,31,51,0.10)', sw=0.8)
        c.text(px - 10, Y(n) + 4, str(n), size=8.5, fill=MUTED, anchor='end')
    c.line(px, py_ + ph, px + pw, py_ + ph, stroke=INK, sw=1)
    c.heading(40, py_ - 12, 'Source files that use it')
    c.text(px + pw, py_ + ph + 34, 'RELEASE YEAR OF THE VERSION IN USE', size=8, fill=MUTED, anchor='end', ls='0.14em')
    for name, yr, n, side, hot in pts:
        x, y = X(yr), Y(n)
        r = 7 if hot else 5.5
        c.raw(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{ACCENT if hot else INK}" opacity="{1 if n else 0.5}"/>')
        label = f'{name} · {n} file' + ('' if n == 1 else 's')
        if n == 0:
            label = name
        if side == 'r':
            c.text(x + r + 8, y + 3, label, size=8.5, fill=ACCENT if hot else INK)
        else:
            c.text(x - r - 8, y + 3, label, size=8.5, fill=INK, anchor='end')
    c.callout(40, py_ + ph + 64, ['Python 3.4 (March 2014, end of life 2019) is the runtime of the device image: it rules out async/await and Tornado 6,', 'so the whole backend keeps the Tornado 4.3 callback style. Years are the release of the pinned version, rounded.'])
    c.legend([('dot', ACCENT, 'Pinned by the device image'), ('dot', INK, 'Other dependency'), ('dot', 'rgba(46,31,51,0.5)', 'Shipped but unused')])
    return {'canvas': c}


def frontend():
    W = 1040
    NW, NH = 176, 80
    LEGEND['page'] = ('Page rendered by Tornado', ('#ffffff', INK, None))
    LEGEND['lib'] = ('Third-party libraries', ('rgba(92,74,100,0.10)', SOFT, None))
    LEGEND['desk'] = ('The controller everything hangs from', ('rgba(168,78,10,0.08)', ACCENT, None))
    LEGEND['unused'] = ('Loaded, used by no classic script', ('rgba(136,57,150,0.03)', LINK, '3,2'))
    r0, r1, r2, r3 = 96, 216, 336, 456
    A = Node('A', 'page', 'index.html', ['rendered by Tornado', 'globals: PLATFORM, ...'], 56, r0, NW, NH)
    I = Node('I', 'unused', 'modui-client', ['index.html loads it', 'no classic script calls it'], 392, r0, NW, NH)
    B = Node('B', 'legacy', 'Desktop', ['desktop.js · 2,193 lines', 'builds every manager'], 392, 276, NW, NH, focal=True)
    C = Node('C', 'legacy', 'host.js', ['WebSocket router', 'frames → desktop.*'], 56, r3, NW, NH)
    D = Node('D', 'legacy', 'Pedalboard canvas', ['pedalboard.js · 3,413', 'plugins, cables, drag'], 728, r0, NW, NH)
    E = Node('E', 'legacy', 'Plugin GUIs', ['modgui.js · 3,114', 'icons, knobs, plugin JS'], 728, r1, NW, NH)
    F = Node('F', 'legacy', 'Library boxes', ['effects · cloudplugin · banks', 'pedalboards · file_manager'], 728, r2, NW, NH)
    G = Node('G', 'legacy', 'Device panels', ['hardware · snapshot · transport', 'mididevices · cc-manager'], 728, r3, NW, NH)
    H = Node('H', 'lib', 'Third-party stack', ['jQuery 1.9.1 · jQuery UI 1.10.1 · Mustache 0.5 · Lunr · slick · crypto-js', 'plus 3.5 MB under html/js/lib that no page loads'], 56, 636, 848, NH)
    ents = [A, I, B, C, D, E, F, G, H]
    conns = [
        Conn(A, 'R', I, 'L', 'ref', label='loads', lside='B'),
        Conn(A, 'B', B, 'L', 'call', at_a=56 + 148, at_b=276 + 24, label='globals', seg=1, lside='B'),
        Conn(C, 'T', B, 'L', 'call', at_a=56 + 28, at_b=276 + 56, label='frames', seg=1, lside='B'),
        Conn(B, 'R', D, 'L', 'call', at_a=276 + 12, at_b=r0 + 40, mid=668, label='builds', lside='L', seg=1),
        Conn(B, 'R', F, 'L', 'call', at_a=276 + 36, at_b=r2 + 40, mid=688, label='builds', seg=0),
        Conn(B, 'R', G, 'L', 'call', at_a=276 + 60, at_b=r3 + 40, mid=648, label='builds', lside='L', seg=1),
        Conn(D, 'B', E, 'T', 'call', label='uses', lside='R'),
    ]
    return dict(slug='frontend', W=W, title='How the classic browser code is put together',
                desc='The page rendered by Tornado sets global variables and loads about twenty-eight scripts; the Desktop object builds every manager, the host.js router turns WebSocket frames into calls on it, and the whole thing stands on a 2013 jQuery stack.',
                eyebrow='Architecture · html/js', h1='One Desktop object, built from globals, on a 2013 jQuery stack',
                ents=ents, conns=conns, zones='', kinds=['page', 'desk', 'legacy', 'unused', 'lib'], lines=['call', 'ref'],
                line_labels={'call': 'Creates or calls', 'ref': 'Loads'},
                callouts=[(56, 568, ['Scripts share globals (desktop, PLATFORM, HARDWARE_PROFILE) and jQuery $.fn plugins: there are no modules,', 'so the tests load the real files into jsdom (test/js/harness.js).'])],
                bottom=724)


def improvements():
    W = 1040
    items = [  # number, effort, impact, title, detail, accent
        (1, 1.0, 1.8, 'Delete the unused vendored libraries', 'knockout, less, n3, datatables, development-bundle: 3.5 MB', False),
        (2, 1.6, 8.2, 'Heal the mod-host link without a browser', 'replay state on reconnect; retry reconnect_jack()', True),
        (3, 2.8, 4.8, 'Stop blocking the loop with os.system()', 'use the async run_command() for mod-amixer and hmi-reset', False),
        (4, 4.4, 5.2, 'One request-queue class for three devices', 'Host._queue, HMI.queue, ControlChain.write_queue', False),
        (5, 4.3, 8.5, 'Protect the local API', 'same-origin check or token; stop mutating over GET', False),
        (6, 5.6, 7.0, 'Test the webserver and Host over FakeHost', 'unittest with FakeHost and FakeHMI; none exist today', False),
        (7, 6.4, 6.0, 'Version the WebSocket frames', 'JSON with a version, schema in docs/openapi.yml', False),
        (8, 7.4, 8.8, 'Describe devices as data', 'one profile for soundcard, HMI schema and #ifdefs', True),
        (9, 8.5, 7.6, 'Split host.py by responsibility', 'graph, mod-host link, HMI handlers, pedalboard files', False),
        (10, 9.2, 4.4, 'Move to async/await and current Tornado', 'when the image no longer ships Python 3.4', False),
    ]
    c = Canvas('improvements', 'Improvements, by effort and impact',
               'A quadrant of ten improvements by estimated effort and impact; healing the mod-host link without a browser and protecting the local API are cheap and valuable, describing devices as data is the structural one, and splitting host.py is expensive but valuable.',
               W, eyebrow='Quadrant · what to improve first', h1='Cheap and valuable first; structure second',
               md='quadrantChart\n  title Improvements\n  x-axis Low effort --> High effort\n  y-axis Low impact --> High impact\n' + '\n'.join(f'  "{i[0]} {i[3]}": [{i[1]/10:.2f}, {i[2]/10:.2f}]' for i in items))
    px, py_, pw, ph = 56, 104, 560, 440
    def X(v): return px + v / 10 * pw
    def Y(v): return py_ + ph - v / 10 * ph
    c.rect(px, py_, pw, ph, fill='rgba(46,31,51,0.02)', stroke='rgba(46,31,51,0.20)', sw=1, rx=6)
    c.line(px + pw / 2, py_, px + pw / 2, py_ + ph, stroke='rgba(46,31,51,0.18)', sw=1, dash='4,3')
    c.line(px, py_ + ph / 2, px + pw, py_ + ph / 2, stroke='rgba(46,31,51,0.18)', sw=1, dash='4,3')
    for t, x, y in (('DO FIRST', px + 14, py_ + 22), ('PLAN IT', px + pw / 2 + 14, py_ + 22), ('WHEN CONVENIENT', px + 14, py_ + ph - 12), ('PROBABLY NOT NOW', px + pw / 2 + 14, py_ + ph - 12)):
        c.text(x, y, t, size=8, fill=SOFT, ls='0.16em')
    c.text(px + pw / 2, py_ + ph + 24, 'EFFORT  →', size=8, fill=MUTED, anchor='middle', ls='0.18em')
    c.text(px, py_ - 12, 'IMPACT  ↑', size=8, fill=MUTED, ls='0.18em')
    for n, e, im, title, detail, hot in items:
        x, y = X(e), Y(im)
        c.raw(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="12" fill="{ACCENT if hot else INK}"/>')
        c.text(x, y + 4, str(n), size=11, fill='#ffffff', font='sans', weight=600, anchor='middle')
    lx = 656
    c.heading(lx, py_ - 12, 'The ten, in order of effort')
    for k, (n, e, im, title, detail, hot) in enumerate(items):
        y = py_ + 8 + k * 43
        c.raw(f'<circle cx="{lx+10}" cy="{y+6}" r="9" fill="{ACCENT if hot else INK}"/>')
        c.text(lx + 10, y + 10, str(n), size=9, fill='#ffffff', font='sans', weight=600, anchor='middle')
        c.text(lx + 28, y + 5, title, size=11, fill=INK, font='sans', weight=600)
        c.text(lx + 28, y + 19, detail, size=8, fill=MUTED)
    c.callout(40, py_ + ph + 52, ['Effort and impact are the author\'s estimate, not a measurement. Most items change mod/, which the project rules reserve for a decision of the maintainers.'])
    c.legend([('dot', ACCENT, 'Cheap and valuable (2) · the structural fix (8)'), ('dot', INK, 'The rest')])
    return {'canvas': c}


SPECS = [context, layers, imports, load_sequence, event_loop, host_link, modes, devices, features, coupling, code_map, dependency_age, frontend, improvements]


from specs_deep import DEEP  # noqa: E402
SPECS = SPECS + DEEP
