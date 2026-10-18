"""Second set of diagrams of docs/mod-ui.md (sections 13 to 17): the architecture in detail, Host and Session, the top-down trace, persistence and the cloud.

Same conventions as specs.py: engine specs (boxes and connectors) and Canvas specs; every number comes from measure.py.
"""
import collections
import os

import measure
from kit import *  # noqa: F401,F403
from engine import Node, Conn, at, zone, KINDS, TAGW, LEGEND  # noqa: F401

KINDS['step'] = ('#ffffff', INK, 'STEP', INK, 'rgba(46,31,51,0.40)', None)
TAGW['STEP'] = 28
LEGEND['step'] = ('Step or outcome', ('#ffffff', INK, None))
LEGEND['hot_trial'] = ('Trial: the case to watch', ('rgba(168,78,10,0.08)', ACCENT, None))
LEGEND['hot_broker'] = ('The broker: every message passes through it', ('rgba(168,78,10,0.08)', ACCENT, None))
LEGEND['hot_jack'] = ('mod-host: where the plugins run', ('rgba(168,78,10,0.08)', ACCENT, None))
KINDS['store'] = ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', 'DISK', SOFT, 'rgba(46,31,51,0.22)', None)
TAGW['DISK'] = 28
LEGEND['store'] = ('Files on disk', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', None))
LEGEND['clib'] = ('Native library (C++ via ctypes)', ('rgba(136,57,150,0.03)', LINK, None))
LEGEND['ext'] = ('Separate process or device', ('rgba(92,74,100,0.10)', SOFT, None))
LEGEND['cloud'] = ('Internet service', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', '3,2'))
LEGEND['legacy'] = ('Browser code (jQuery)', ('rgba(46,31,51,0.03)', 'rgba(46,31,51,0.30)', None))
LEGEND['http'] = ('Tornado handlers', ('#ffffff', INK, None))
LEGEND['backend'] = ('Python module', ('#ffffff', INK, None))
LEGEND['focal'] = ('The running state lives here', ('rgba(168,78,10,0.08)', ACCENT, None))


# ------------------------------------------------------------------------------------------------------------------- sequences
def startup():
    W = 1040
    cx = [100, 300, 540, 740, 940]
    actors = [('server.py', 'webserver.run()', 'http'), ('Session', 'session.py', 'backend'), ('Host', 'host.py', 'backend'),
              ('libmod_utils', 'lilv · JACK', 'clib'), ('mod-host', 'TCP :5555', 'ext')]
    c = Canvas('startup', 'How mod-ui starts',
               'Sequence of the start-up: importing the webserver creates the Session and the Host, then the loop starts and the Host connects to JACK and mod-host, reads the banks and the pedalboards, waits for the HMI and reloads the last pedalboard.',
               W, eyebrow='Sequence · from server.py to a loaded pedalboard', h1='Start-up: the Host reloads the last pedalboard before anyone opens the page',
               md='sequenceDiagram\n  participant S as server.py\n  participant E as Session\n  participant H as Host\n  participant L as libmod_utils\n  participant M as mod-host\n'
                  '  S->>E: import mod.session: SESSION = Session()\n  E->>H: Host(hmi, prefs, cb), schedules init_host\n  S->>S: check_environment, favorites\n  S->>L: init (scan LV2)\n  S->>S: listen, IOLoop.start\n'
                  '  H->>L: init_jack client mod-ui\n  H->>M: connect 5555/5556, processing 0, remove -1\n  H->>H: wait for the HMI (5 s)\n  H->>L: get_pedalboard_info(last)\n  H->>M: add, connect, state_load\n'
                  '  H->>M: monitor_midi_program, processing 2\n  H->>L: init_bypass')
    items = [
        ('msg', 0, 1, 'import: SESSION = Session()', 'call'),
        ('msg', 1, 2, 'Host(hmi, prefs, cb)', 'call'),
        ('self', 0, 'check_environment() · favorites'),
        ('msg', 0, 3, 'init(): scan the LV2 plugins', 'call'),
        ('self', 0, 'listen() · IOLoop.start()'),
        ('msg', 2, 3, 'init_jack(): client "mod-ui"', 'call'),
        ('msg', 2, 4, 'connect · processing 0 · remove -1', 'call'),
        ('self', 2, 'wait for the HMI, up to 5 s'),
        ('msg', 2, 3, 'get_pedalboard_info(last)', 'call'),
        ('msg', 2, 4, 'add · connect · state_load', 'call'),
        ('msg', 2, 4, 'monitor_midi_program · processing 2', 'call'),
        ('msg', 2, 3, 'init_bypass()', 'call'),
    ]
    bot = sequence(c, actors, cx, items, acts=[(2, 5, 11)])
    c.callout(40, bot + 30, ['The Host is created when mod.session is imported, but its init_host() only runs once the IOLoop starts.',
                             'checkhost() ends the process (sys.exit(1)) if a socket to mod-host cannot be opened, and polls every 0.2 s until the link is up.'])
    c.legend([('line', MUTED, None, 'arrow', 'Call')])
    return {'canvas': c}


def tuner_sequence():
    W = 1040
    cx = [120, 400, 680, 920]
    actors = [('HMI', 'serial', 'ext'), ('Host', 'host.py', 'backend'), ('mod-host', 'TCP :5555 / :5556', 'ext'), ('libmod_utils', 'JACK ports', 'clib')]
    c = Canvas('tuner-sequence', 'How the tuner works',
               'Sequence of the tuner: the HMI asks the Host to turn it on, the Host adds a tuner plugin as instance 9994 in mod-host and connects an input to it, mod-host reports the frequency, the Host converts it to a note and sends it to the HMI; the Session takes no part.',
               W, eyebrow='Sequence · the tuner', h1='The tuner is a plugin that the Host adds and removes; the Session is not involved',
               md='sequenceDiagram\n  participant Hm as HMI\n  participant H as Host\n  participant M as mod-host\n  participant L as libmod_utils\n  Hm->>H: tn\n  H->>M: add gxtuner 9994\n  M-->>H: resp 9994\n  H->>M: monitor_output 9994 FREQ\n'
                  '  H->>L: connect system:capture_N to effect_9994:in\n  opt tuner mutes outputs\n    H->>L: mute()\n  end\n  H-->>Hm: resp\n  loop while on\n    M--)H: output_set 9994 FREQ hz\n    H->>Hm: ts freq note cents\n  end\n  Hm->>H: tf\n  H->>M: remove 9994\n  H->>L: unmute()')
    items = [
        ('msg', 0, 1, 'tn (tuner on)', 'call'),
        ('msg', 1, 2, 'add urn:mod:gxtuner 9994', 'call'),
        ('msg', 2, 1, 'resp 9994', 'ret'),
        ('msg', 1, 2, 'monitor_output 9994 FREQ', 'call'),
        ('msg', 1, 3, 'connect system:capture_N → effect_9994:in', 'call'),
        ('frame', 'OPT', '[setting: tuner mutes outputs]', [('msg', 1, 3, 'mute(): disconnect mod-monitor', 'call')]),
        ('msg', 1, 0, 'resp', 'ret'),
        ('frame', 'LOOP', '[while the tuner is on]', [('msg', 2, 1, 'output_set 9994 FREQ hz', 'async'), ('msg', 1, 0, 'ts freq note cents', 'call')]),
        ('msg', 0, 1, 'tf (tuner off)', 'call'),
        ('msg', 1, 2, 'remove 9994', 'call'),
        ('msg', 1, 3, 'unmute(): reconnect mod-monitor', 'call'),
    ]
    bot = sequence(c, actors, cx, items, acts=[(1, 0, 11)])
    c.callout(40, bot + 30, ['The state of the tuner (input, mute, reference frequency) lives in the Host. The Session only owns the preferences file that the Host writes it to.',
                             'The note is computed in tuner.py (find_freqnotecents), a pure function; the browser has no tuner page.'])
    c.legend([('line', MUTED, None, 'arrow', 'Call'), ('line', MUTED, '5,4', 'arrow', 'Return'), ('line', MUTED, '5,4', 'arrow-open', 'Event from mod-host (read socket)')])
    return {'canvas': c}


def cloud_auth():
    W = 1040
    cx = [160, 520, 880]
    actors = [('Browser', 'desktop.js', 'legacy'), ('mod-ui', 'webserver · crypto', 'http'), ('mod.audio cloud', 'api.mod.audio', 'cloud')]
    c = Canvas('cloud-auth', 'How the device proves who it is to the cloud',
               'Sequence of the device authentication: the cloud sends a nonce, mod-ui signs it with the device private key and encrypts it for the cloud, the cloud answers with an encrypted token that mod-ui decrypts, and the browser keeps the token in memory.',
               W, eyebrow='Sequence · /auth/nonce and /auth/token', h1='The cloud knows the device, not a person: a signed nonce becomes a token',
               md='sequenceDiagram\n  participant B as Browser\n  participant M as mod-ui\n  participant C as Cloud\n  B->>C: GET /devices/nonce\n  C-->>B: nonce\n  B->>M: POST /auth/nonce\n  M->>M: sign with device key, encrypt for the cloud\n  M-->>B: message\n'
                  '  B->>C: POST /devices/tokens\n  C-->>B: message, signature\n  B->>M: POST /auth/token\n  M->>M: decrypt, verify the cloud signature\n  M-->>B: access_token')
    items = [
        ('msg', 0, 2, 'GET /devices/nonce', 'http'),
        ('msg', 2, 0, '{nonce}', 'ret'),
        ('msg', 0, 1, 'POST /auth/nonce {nonce}', 'http'),
        ('self', 1, 'sign the nonce (device RSA key), encrypt for the cloud key'),
        ('msg', 1, 0, '{message: nonce, tag, uid, image version, signature}', 'ret'),
        ('msg', 0, 2, 'POST /devices/tokens {message}', 'http'),
        ('msg', 2, 0, '{message, signature, upgrade info}', 'ret'),
        ('msg', 0, 1, 'POST /auth/token', 'http'),
        ('self', 1, 'decrypt with the device key, verify the cloud signature'),
        ('msg', 1, 0, '{access_token}', 'ok'),
        ('note', 0, 'kept in memory: Authorization: MOD <token>', 'r'),
    ]
    bot = sequence(c, actors, cx, items)
    c.callout(40, bot + 30, ['The server never talks to the cloud: the browser carries every message. The token is not saved by mod-ui ("don\'t ever save this token locally").',
                             'Identity is the device: tag, uid, RSA key and image version. There is no user login in this repository.'])
    c.legend([('line', LINK, None, 'arrow-link', 'HTTP request'), ('line', MUTED, '5,4', 'arrow', 'Answer'), ('line', ACCENT, '5,4', 'arrow-accent', 'The token')])
    return {'canvas': c}


def share_flow():
    W = 1040
    cx = [160, 520, 880]
    actors = [('Browser', 'share window', 'legacy'), ('mod-ui', 'webserver.py', 'http'), ('mod.audio cloud', 'api + storage', 'cloud')]
    c = Canvas('share-flow', 'How a pedalboard is shared',
               'Sequence of sharing a pedalboard: the browser saves the author name and email locally, waits for the thumbnail, authenticates, creates the pedalboard record in the cloud, asks mod-ui to pack the bundle and uploads the archive, relaying the bytes itself.',
               W, eyebrow='Sequence · Share', h1='Sharing: the browser creates the record, then carries the archive from the device to the cloud',
               md='sequenceDiagram\n  participant B as Browser\n  participant M as mod-ui\n  participant C as Cloud\n  B->>M: POST /save_user_id/ name, email\n  B->>M: GET /pedalboard/image/wait\n  B->>C: authenticate (see cloud-auth)\n  B->>C: POST /pedalboards/ author, email, title, description, hidden\n  C-->>B: id, upload_href\n'
                  '  B->>M: GET /pedalboard/pack_bundle/\n  M-->>B: pedalboard.tar.gz (+ audio.ogg)\n  B->>C: upload to upload_href\n  C-->>B: ok')
    items = [
        ('msg', 0, 1, 'POST /save_user_id/ {name, email}', 'http'),
        ('msg', 0, 1, 'GET /pedalboard/image/wait (thumbnail)', 'http'),
        ('msg', 0, 2, 'authenticate (previous figure)', 'http'),
        ('msg', 0, 2, 'POST /pedalboards/ {author, email, title, description, hidden}', 'http'),
        ('msg', 2, 0, '{id, upload_href}', 'ret'),
        ('msg', 0, 1, 'GET /pedalboard/pack_bundle/?bundlepath=', 'http'),
        ('msg', 1, 0, 'pedalboard.tar.gz (+ audio.ogg if recorded)', 'ret'),
        ('msg', 0, 2, 'upload the archive to upload_href', 'http'),
        ('msg', 2, 0, 'ok', 'ret'),
        ('note', 0, 'shows PEDALBOARDS_URL/pedalboards/<id>', 'r'),
    ]
    bot = sequence(c, actors, cx, items)
    c.callout(40, bot + 30, ['The cloud receives the whole bundle: plugin state, addressings, snapshots, thumbnail and, if you recorded one, a 3-minute audio demo.',
                             'Name and email are free text typed in the form; mod-ui keeps them in user-id.json only to prefill the next share.'])
    c.legend([('line', LINK, None, 'arrow-link', 'HTTP request'), ('line', MUTED, '5,4', 'arrow', 'Answer')])
    return {'canvas': c}


def remote_load():
    W = 1040
    cx = [100, 340, 600, 900]
    actors = [('mod.audio page', 'in the user\'s browser', 'cloud'), ('mod-ui', '/rpbsocket · /websocket', 'http'), ('Browser UI', 'desktop.js', 'legacy'), ('mod.audio cloud', 'api.mod.audio', 'cloud')]
    c = Canvas('remote-load', 'How a pedalboard from the website reaches the device',
               'Sequence of loading a pedalboard from the mod.audio website: the page opens a socket to the device, which forwards the id to the first open UI; the UI authenticates, fetches the record, installs missing plugins, downloads the archive and posts it to the device.',
               W, eyebrow='Sequence · /rpbsocket', h1='Load from the website: the page sends an id, the UI does the work',
               md='sequenceDiagram\n  participant P as mod.audio page\n  participant M as mod-ui\n  participant U as Browser UI\n  participant C as Cloud\n  P->>M: ws /rpbsocket (origin check)\n  P->>M: pedalboard id\n  M->>U: load-pb-remote id\n  M-->>P: true, close\n'
                  '  U->>C: GET /pedalboards/id\n  U->>M: POST /effect/bulk\n  U->>C: download missing plugins\n  U->>C: GET file_href\n  U->>M: POST /pedalboard/load_web/')
    items = [
        ('msg', 0, 1, 'ws /rpbsocket + pedalboard id', 'http'),
        ('msg', 1, 2, 'load-pb-remote <id>', 'async'),
        ('msg', 1, 0, 'true, then close', 'ret'),
        ('msg', 2, 3, 'GET /pedalboards/<id> (after auth)', 'http'),
        ('msg', 3, 2, '{plugins, stable, file_href}', 'ret'),
        ('msg', 2, 1, 'POST /effect/bulk: which plugins exist?', 'http'),
        ('msg', 2, 3, 'download and install the missing ones', 'http'),
        ('msg', 2, 3, 'GET file_href (archive)', 'http'),
        ('msg', 2, 1, 'POST /pedalboard/load_web/ (extract, load)', 'http'),
        ('msg', 1, 2, 'loading_start … loading_end', 'async'),
    ]
    bot = sequence(c, actors, cx, items)
    c.callout(40, bot + 30, ['mod-ui only checks the Origin header (mod.audio or moddevices.com) and forwards the id to the first open browser, if any.',
                             'A pedalboard with community (Labs) plugins is refused unless Labs plugins are enabled in the settings.'])
    c.legend([('line', LINK, None, 'arrow-link', 'HTTP or socket request'), ('line', MUTED, '5,4', 'arrow', 'Answer'), ('line', MUTED, '5,4', 'arrow-open', 'WebSocket frame')])
    return {'canvas': c}


# ------------------------------------------------------------------------------------------------------------------- engine diagrams
def architecture_detail():
    W = 1160
    NW, NH = 176, 80
    ax, bx, cx, dx = 48, 336, 624, 912
    r0, r1, r2, r3, r4 = 112, 232, 352, 472, 592
    web = Node('web', 'http', 'Webserver', ['webserver.py', '89 routes · 3 sockets'], ax, r0, NW, NH)
    ses = Node('ses', 'backend', 'Session', ['session.py', 'browsers · prefs · recorder'], ax, r1, NW, NH)
    host = Node('host', 'backend', 'Host', ['host.py · 201 methods', 'the running pedalboard'], bx, r1, NW, NH, focal=True)
    addr = Node('addr', 'backend', 'Addressings + CC', ['addressings.py', 'control_chain.py listener'], cx, r0, NW, NH)
    hmi = Node('hmi', 'backend', 'HMI driver', ['hmi.py · protocol.py', 'mod_protocol.py'], cx, r1, NW, NH)
    lib = Node('lib', 'clib', 'libmod_utils', ['JACK client "mod-ui"', 'lilv · ALSA mixer'], cx, r3, NW, NH)
    files = Node('files', 'store', 'Files', ['pedalboards · LV2 bundles', 'banks · prefs · profiles'], bx, r4, NW, NH)
    ccd = Node('ccd', 'ext', 'Control Chain', ['daemon + external pedals', '/tmp/control-chain.sock'], dx, r0, NW, NH)
    mcu = Node('mcu', 'ext', 'HMI firmware', ['knobs · LEDs · screens', '/dev/ttyUSB0 · 10 Mbaud'], dx, r1, NW, NH)
    mh = Node('mh', 'ext', 'mod-host', ['LV2 plugins as JACK clients', ':5555 commands · :5556 events'], dx, r2, NW, NH)
    jack = Node('jack', 'ext', 'JACK + ALSA', ['jackd2 · sound card', 'system:capture / playback'], dx, r3, NW, NH)
    ents = [web, ses, host, addr, hmi, lib, files, ccd, mcu, mh, jack]
    zones = '\n'.join([
        zone(32, 88, 800, 360, 'MOD-UI · ONE PYTHON PROCESS · ONE THREAD'),
        zone(608, 456, 208, 128, 'SAME PROCESS · C++'),
        zone(896, 88, 208, 504, 'DEVICE · OTHER PROCESSES'),
        f'<line x1="8" y1="{r0+40}" x2="{ax}" y2="{r0+40}" stroke="{LINK}" stroke-width="1.2" marker-end="url(#arrow-link)"/>',
        f'<rect x="10" y="{r0+22}" width="34" height="12" fill="{PAPER}"/><text x="27" y="{r0+31}" fill="{MUTED}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.04em">HTTP</text>',
    ])
    conns = [
        Conn(web, 'B', ses, 'T', 'call', label='web_*', lside='R'),
        Conn(web, 'R', host, 'T', 'ref', at_b=bx + 48, label='SESSION.host', seg=0),
        Conn(ses, 'R', host, 'L', 'call', at_a=r1 + 28, at_b=r1 + 28, label='calls'),
        Conn(host, 'L', ses, 'R', 'push', at_a=r1 + 56, at_b=r1 + 56, label='msg_callback', lside='B'),
        Conn(host, 'R', addr, 'L', 'call', at_a=r1 + 16, at_b=r0 + 56, mid=584, label='addr_*', seg=2, lside='L'),
        Conn(host, 'R', hmi, 'L', 'call', at_a=r1 + 40, at_b=r1 + 40, label='hmi_*'),
        Conn(addr, 'R', ccd, 'L', 'call', at_a=r0 + 40, at_b=r0 + 40, label='unix socket'),
        Conn(hmi, 'R', mcu, 'L', 'call', at_a=r1 + 40, at_b=r1 + 40, label='serial'),
        Conn(host, 'B', lib, 'L', 'call', at_a=bx + 100, at_b=r3 + 40, label='ctypes', seg=1, lside='B'),
        Conn(host, 'B', mh, 'L', 'call', at_a=bx + 148, at_b=r2 + 40, label='tcp 5555 · 5556', seg=1, lside='B'),
        Conn(host, 'B', files, 'T', 'call', at_a=bx + 52, at_b=bx + 52, label='read · write', lside='L'),
        Conn(lib, 'R', jack, 'L', 'call', at_a=r3 + 40, at_b=r3 + 40, label='jack · alsa'),
        Conn(mh, 'B', jack, 'T', 'call', label='clients', lside='R'),
        Conn(lib, 'B', files, 'R', 'ref', at_a=cx + 88, at_b=r4 + 40, label='lilv reads', seg=1, lside='B'),
    ]
    return dict(slug='architecture-detail', W=W, title='mod-ui, HMI, Control Chain, mod-host and JACK in detail',
                desc='The modules of the Python process and the native library, the three device peers and the JACK graph, with the protocol on each link: the Host reaches mod-host over TCP, the HMI over serial, Control Chain over a unix socket and libmod_utils through ctypes, and libmod_utils is itself a JACK client.',
                eyebrow='Architecture · the device side in detail', h1='Who talks to whom inside the device, and over which protocol',
                ents=ents, conns=conns, zones=zones, kinds=['http', 'backend', 'focal', 'clib', 'store', 'ext'], lines=['call', 'ref', 'push', 'http'],
                line_labels={'call': 'Call or protocol', 'ref': 'Handler skips the Session', 'push': 'Frames to every browser', 'http': 'HTTP and WebSocket clients, not drawn'},
                callouts=[(48, 560, ['The JACK thread of libmod_utils only', 'queues events (ports, buffer size, xruns).', 'Python polls them every second,', 'so everything stays on one thread.'])],
                bottom=700)


def jack_graph():
    W = 1160
    NW, NH = 200, 80
    sx, cxn, kx = 48, 480, 912
    rows = [112, 232, 352, 472]
    s1 = Node('s1', 'ext', 'Audio in', ['system:capture_1 · 2', 'or mod-host:out (noise gate)'], sx, rows[0], NW, NH)
    s2 = Node('s2', 'ext', 'USB and external', ['mod-usbgadget_c · mod-external', 'audio / MIDI from outside'], sx, rows[1], NW, NH)
    s3 = Node('s3', 'ext', 'CV and pedal in', ['mod-spi2jack:capture_N', 'exp_pedal'], sx, rows[2], NW, NH)
    s4 = Node('s4', 'ext', 'MIDI in', ['system:midi_* · ttymidi', 'mod-midi-merger:out'], sx, rows[3], NW, NH)
    center = Node('mh', 'ext', 'mod-host', ['one JACK client per plugin', 'effect_N:symbol', '', 'ids 9993 MIDI clock sender', '9994 tuner · 9995 the pedalboard'], cxn, rows[0], 200, 440, focal=True)
    k1 = Node('k1', 'ext', 'Audio out', ['mod-monitor:in → out', 'system:playback · mod-peakmeter'], kx, rows[0], NW, NH)
    k2 = Node('k2', 'ext', 'USB and external out', ['mod-usbgadget_p · mod-external', 'audio / MIDI to outside'], kx, rows[1], NW, NH)
    k3 = Node('k3', 'ext', 'CV out', ['mod-jack2spi:playback_N', ''], kx, rows[2], NW, NH)
    k4 = Node('k4', 'ext', 'MIDI out', ['mod-midi-broadcaster:in', 'ttymidi:MIDI_out'], kx, rows[3], NW, NH)
    ents = [s1, s2, s3, s4, center, k1, k2, k3, k4]
    conns = []
    for i, (s_, k_) in enumerate(zip((s1, s2, s3, s4), (k1, k2, k3, k4))):
        y = rows[i] + 40
        conns.append(Conn(s_, 'R', center, 'L', 'call', at_a=y, at_b=y))
        conns.append(Conn(center, 'R', k_, 'L', 'call', at_a=y, at_b=y))
    zones = '\n'.join([
        zone(32, 88, 232, 480, 'INPUTS'), zone(896, 88, 232, 480, 'OUTPUTS'),
    ])
    return dict(slug='jack-graph', W=W, title='The JACK graph around the pedalboard',
                desc='The JACK clients of a MOD device as mod-ui names them: hardware and external inputs on the left, mod-host with one client per plugin in the middle, and mod-monitor, USB, CV and MIDI outputs on the right.',
                eyebrow='Signal path · JACK clients', h1='Every port of a pedalboard is a JACK port; mod-ui only translates names',
                ents=ents, conns=conns, zones=zones, kinds=['ext', 'hot_jack'], lines=['call'], line_labels={'call': 'JACK connection, made by mod-host'},
                callouts=[(48, 584, ['mod-ui itself is a JACK client ("mod-ui"): it connects ports for the tuner, mute and MIDI devices,',
                                     'reads buffer size, xruns and transport, and records mod-monitor:out_1 and out_2 with jack_capture.']),
                          (48, 632, ['_fix_host_connection_port() turns /graph/playback_1 into mod-monitor:in_1, /graph/cv_capture_N into mod-spi2jack:capture_N,',
                                     'and /graph/<plugin>/<port> into effect_<id>:<port>; anything else is guessed as system:<name>.'])],
                bottom=676)


def license_flow():
    W = 1040
    NW, NH = 176, 80
    scan = Node('scan', 'clib', 'Plugin scan', ['libmod_utils · lilv', 'get_plugin_info()'], 48, 112, NW, NH)
    q1 = Node('q1', 'step', 'Has a license interface?', ['mod:license#interface', 'declared in the plugin TTL'], 304, 112, NW, NH)
    free = Node('free', 'step', 'licensed = 0', ['free or non-commercial', 'no key needed'], 304, 272, NW, NH)
    q2 = Node('q2', 'step', 'Key file present?', ['<KEYS_PATH>/sha1(plugin URI)', 'only the file name is checked'], 560, 112, NW, NH)
    paid = Node('paid', 'step', 'licensed = 1', ['paid', 'a key file exists'], 560, 272, NW, NH)
    trial = Node('trial', 'step', 'licensed = -1', ['trial', 'no key file'], 816, 112, 176, NH, focal=True)
    use = Node('use', 'backend', 'What mod-ui does', ['badges in the lists', 'hasTrialPlugins → HMI flag'], 816, 272, 176, NH)
    key = Node('key', 'ext', 'Where the key comes from', ['not written by mod-ui', 'purchase and delivery elsewhere'], 48, 272, NW, NH)
    enf = Node('enf', 'ext', 'Who enforces it', ['plugin binary · mod-host', 'trial plugins mute the audio'], 560, 432, NW, NH)
    ents = [scan, q1, free, q2, paid, trial, use, key, enf]
    conns = [
        Conn(scan, 'R', q1, 'L', 'call'),
        Conn(q1, 'R', q2, 'L', 'call', label='yes'),
        Conn(q1, 'B', free, 'T', 'call', label='no', lside='R'),
        Conn(q2, 'R', trial, 'L', 'call', label='no'),
        Conn(q2, 'B', paid, 'T', 'call', label='yes', lside='R'),
        Conn(trial, 'B', use, 'T', 'call', at_a=816 + 88, at_b=816 + 88),
        Conn(key, 'R', free, 'L', 'ref'),
        Conn(paid, 'B', enf, 'T', 'ref', at_a=560 + 60, at_b=560 + 60, label='ERR -4 if unlicensed', lside='R'),
    ]
    return dict(slug='license-flow', W=W, title='How mod-ui classifies a paid plugin',
                desc='mod-ui does not verify licenses: it only checks whether a file named after the SHA-1 of the plugin URI exists in the keys directory for plugins that declare a license interface, and reports free, paid or trial; enforcement lives in the plugin and in mod-host.',
                eyebrow='Flow · plugin licenses', h1='mod-ui looks for a file; it does not check a signature',
                ents=ents, conns=conns, zones='', kinds=['clib', 'step', 'hot_trial', 'backend', 'ext'], lines=['call', 'ref'],
                line_labels={'call': 'Decision or data', 'ref': 'Outside this repository'},
                callouts=[(48, 560, ['The key file is never created, read or validated by mod-ui: libmod_utils only tests that it exists.', 'Deleting the keys directory is one of the cleanup options (licenseKeys in /system/cleanup).'])],
                bottom=592)


def identity_data():
    W = 1040
    NW, NH = 176, 80
    ident = Node('ident', 'store', 'Device identity', ['tag · uid · RSA key', 'server key · image version'], 48, 112, NW, NH)
    crypto = Node('crypto', 'http', 'mod-ui crypto', ['/auth/nonce · /auth/token', 'sign · encrypt · decrypt'], 336, 112, NW, NH)
    br = Node('br', 'legacy', 'Browser', ['token in memory', 'share form'], 624, 232, NW, NH, focal=True)
    cloud = Node('cloud', 'cloud', 'mod.audio cloud', ['device-bound token', 'pedalboards · plugins'], 840, 112, 152, NH)
    uid = Node('uid', 'store', 'user-id.json', ['name · email', 'written by /save_user_id/'], 48, 352, NW, NH)
    pref = Node('pref', 'store', 'prefs.json', ['cloud-terms-accepted', 't3k-api-key'], 336, 352, NW, NH)
    t3k = Node('t3k', 'cloud', 'TONE3000', ['own OAuth popup', 'tokens in sessionStorage'], 840, 352, 152, NH)
    ents = [ident, crypto, br, cloud, uid, pref, t3k]
    conns = [
        Conn(ident, 'R', crypto, 'L', 'call', label='reads'),
        Conn(crypto, 'B', br, 'L', 'call', at_a=336 + 120, at_b=232 + 24, mid=None, label='message · token', seg=1, lside='B'),
        Conn(br, 'R', cloud, 'B', 'http', at_a=232 + 24, at_b=840 + 76, label='https · MOD token', seg=0),
        Conn(uid, 'T', br, 'L', 'ref', at_a=48 + 88, at_b=232 + 56, label='prefills form', seg=1, lside='B'),
        Conn(pref, 'R', br, 'B', 'ref', at_b=624 + 88, label='terms · key', seg=1),
        Conn(br, 'R', t3k, 'T', 'http', at_a=232 + 56, at_b=840 + 76, label='oauth', seg=1),
    ]
    return dict(slug='identity-data', W=W, title='What identifies the device and what the user types',
                desc='The device is identified to the cloud by its tag, uid and RSA key through a signed nonce; a person appears only as a free-text name and email in the share form, which mod-ui keeps in user-id.json to prefill the form; TONE3000 has its own sign-in.',
                eyebrow='Data flow · identity', h1='The device has an identity; the user is a text field',
                ents=ents, conns=conns, zones='', kinds=['store', 'http', 'legacy', 'hot_broker', 'cloud'], lines=['call', 'http', 'ref'],
                line_labels={'call': 'Reads or signs', 'http': 'Goes to the Internet', 'ref': 'Prefills or configures'},
                callouts=[(336, 480, ['/tokens/get, /tokens/save and /tokens/delete store a user_id,', 'an access token and a refresh token in tokens.conf,', 'but no script in this repository calls them.'])],
                bottom=560)


# ------------------------------------------------------------------------------------------------------------------- canvases
def layers_topdown():
    W = 1040
    c = Canvas('layers-topdown', 'One call, top to bottom and back: adding a plugin',
               'A trace of adding a plugin through the layers: the browser calls the webserver, which calls the Session, which calls the Host; the Host asks libmod_utils for the description, sends add to mod-host, and the answer climbs back as a callback, a WebSocket frame to every browser and the HTTP response.',
               W, eyebrow='Layers · a real call, top down', h1='Adding a plugin: twelve steps through the layers',
               md='flowchart TB\n  L7["1 pedalboard.js GET /effect/add"] --> L6["2 EffectAdd.get"] --> L5["3 Session.web_add"] --> L4["4 Host.add_plugin"] --> L3["5 Host._queue to mod-host"] --> L1["6 mod-host add"]\n'
                  '  L4 -.-> L2["libmod_utils get_plugin_info_essentials"]\n  L1 --> R3["7 resp 12"] --> R4["8 plugins[12] and msg_callback"] --> R5["9 Session.msg_callback"] --> R6["10 write_message"] --> R7["11 host.js draws it"]')
    lx, lw = 140, 290
    mx, mw = 450, 170
    rx, rw = 640, 290
    rows = [('L7', 'Browser'), ('L6', 'Transport'), ('L5', 'Session'), ('L4', 'Host'), ('L3', 'Device link'), ('L1', 'Platform')]
    y0, pitch, bh = 128, 92, 64
    ys = [y0 + i * pitch for i in range(len(rows))]
    down = [
        ('pedalboard.js · pluginLoad()', 'GET /effect/add/<instance>?uri=…'),
        ('EffectAdd.get()', 'SESSION.web_add(instance, uri, x, y)'),
        ('Session.web_add()', 'screenshot_needed = True → host.add_plugin()'),
        ('Host.add_plugin()', 'InstanceIdMapper · send_modified("add …")'),
        ('Host._queue → writesock', 'add <uri> <id>  (one request in flight)'),
        ('mod-host: add', 'loads the LV2, creates JACK client effect_<id>'),
    ]
    up = [
        ('host.js: frame "add …"', 'GET /effect/get, then draws the plugin'),
        ('ServerWebSocket · EffectAdd', 'frame to every socket; HTTP answer: get_plugin_info()'),
        ('Session.msg_callback()', 'for ws in websockets: ws.write_message()'),
        ('host_callback(ok)', 'plugins[id] = {…} · msg_callback("add …")'),
        ('process_write_queue()', 'resp <id> → callback(ok), pops the next'),
        ('mod-host: resp <id>', 'instance exists'),
    ]
    # layer chips and bands
    for i, (num, name) in enumerate(rows):
        c.rect(40, ys[i], 84, bh, fill='rgba(46,31,51,0.04)', stroke='rgba(46,31,51,0.30)', sw=1, rx=6)
        c.text(82, ys[i] + 28, num, size=14, fill=INK, font='sans', weight=600, anchor='middle')
        c.text(82, ys[i] + 46, name, size=8.5, fill=MUTED, anchor='middle')
    c.heading(lx, y0 - 20, 'The request goes down')
    c.heading(rx, y0 - 20, 'The answer comes up')
    # arrows first
    for i in range(len(rows) - 1):
        c.line(lx + lw / 2, ys[i] + bh, lx + lw / 2, ys[i + 1], stroke=MUTED, sw=1.4, marker='arrow')
        c.line(rx + rw / 2, ys[i + 1], rx + rw / 2, ys[i] + bh, stroke=MUTED, sw=1.4, marker='arrow')
    c.line(lx + lw, ys[-1] + bh / 2, rx, ys[-1] + bh / 2, stroke=MUTED, sw=1.4, dash='5,4', marker='arrow')
    c.line(lx + lw, ys[3] + bh / 2, mx, ys[3] + bh / 2, stroke=LINK, sw=1.2, dash='5,4', marker='arrow-link')
    # boxes
    n = 0
    for i in range(len(rows)):
        n += 1
        c.rect(lx, ys[i], lw, bh, fill='#ffffff', stroke=INK, sw=1, rx=6)
        c.raw(f'<circle cx="{lx+16}" cy="{ys[i]+18}" r="9" fill="{INK}"/>')
        c.text(lx + 16, ys[i] + 22, str(n), size=9, fill='#ffffff', font='sans', weight=600, anchor='middle')
        c.text(lx + 32, ys[i] + 22, down[i][0], size=11, fill=INK, font='sans', weight=600)
        c.text(lx + 16, ys[i] + 44, down[i][1], size=8, fill=MUTED)
    for j in range(len(rows) - 1, -1, -1):
        n += 1
        hot = j == 3
        c.rect(rx, ys[j], rw, bh, fill=ACCENT_TINT if hot else '#ffffff', stroke=ACCENT if hot else INK, sw=1, rx=6)
        c.raw(f'<circle cx="{rx+16}" cy="{ys[j]+18}" r="9" fill="{ACCENT if hot else INK}"/>')
        c.text(rx + 16, ys[j] + 22, str(n), size=9, fill='#ffffff', font='sans', weight=600, anchor='middle')
        c.text(rx + 32, ys[j] + 22, up[j][0], size=11, fill=INK, font='sans', weight=600)
        c.text(rx + 16, ys[j] + 44, up[j][1], size=8, fill=MUTED)
    # L2, a side trip of L4
    c.rect(mx, ys[3] - 6, mw, bh + 12, fill='rgba(136,57,150,0.05)', stroke=LINK, sw=1, rx=6, dash='4,3')
    c.text(mx + mw / 2, ys[3] + 16, 'L2 libmod_utils', size=10, fill=INK, font='sans', weight=600, anchor='middle')
    c.text(mx + mw / 2, ys[3] + 32, 'get_plugin_info_', size=7.5, fill=MUTED, anchor='middle')
    c.text(mx + mw / 2, ys[3] + 43, 'essentials(uri)', size=7.5, fill=MUTED, anchor='middle')
    c.text(mx + mw / 2, ys[3] + 56, '(lilv reads the TTL)', size=7.5, fill=SOFT, anchor='middle')
    c.callout(40, ys[-1] + bh + 32, ['Steps 1 to 6 are the request. The callback chain starts at step 7, and the Host stores the plugin at step 9, only after mod-host confirms it.',
                                     'Two answers come back: the WebSocket frame (steps 10 and 11, to every browser) and the HTTP response that the handler writes after its own callback.'])
    c.legend([('box', '#ffffff', INK, None, 'A step in a layer'), ('box', ACCENT_TINT, ACCENT, None, 'Where the state is stored'), ('box', 'rgba(136,57,150,0.05)', LINK, '4,3', 'Side trip to the native bridge'),
              ('line', MUTED, '5,4', 'arrow', 'Turns around at mod-host')])
    return {'canvas': c}


def state_owners():
    W = 1040
    comps = ['Browser', 'webserver', 'session', 'host', 'mod-host', 'disk']
    rows = [  # group, what, where in code, cells (O = owns, c = copy or reads)
        ('THE CURRENT PEDALBOARD', 'Name, path, size, modified', 'Host.pedalboard_*', 'c c . O . c'),
        ('THE CURRENT PEDALBOARD', 'Plugins and port values', 'Host.plugins[id]', 'c . . O c .'),
        ('THE CURRENT PEDALBOARD', 'Connections', 'Host.connections', 'c . . O c .'),
        ('THE CURRENT PEDALBOARD', 'Snapshots', 'Host.pedalboard_snapshots', 'c . . O . c'),
        ('THE CURRENT PEDALBOARD', 'Addressings', 'Host.addressings', 'c . . O c c'),
        ('THE DEVICE', 'Tuner: input, mute, reference', 'Host.current_tuner_*', '. . . O . c'),
        ('THE DEVICE', 'Transport: tempo, beats, rolling', 'Host.transport_*', 'c . . O c .'),
        ('THE DEVICE', 'MIDI ports and devices', 'Host.midiports', 'c . . O c .'),
        ('THE DEVICE', 'Banks and pedalboard lists', 'Host.userbanks · BankSave', 'c O . O . c'),
        ('THE DEVICE', 'Profiles (4 slots)', 'Host.profile', '. . . O . c'),
        ('THE SESSION', 'Open browsers', 'Session.websockets', '. c O . . .'),
        ('THE SESSION', 'User preferences', 'Session.prefs', 'c c O c . c'),
        ('THE SESSION', 'Recording and playback', 'Session.recorder · player', '. c O . . c'),
        ('THE SESSION', 'Thumbnail queue', 'Session.screenshot_generator', '. . O . . c'),
        ('THE SESSION', 'Favourite plugins', 'gState.favorites', 'c O . . . c'),
        ('LINKS', 'Socket and queue to mod-host', 'Host.writesock · _queue', '. . . O c .'),
        ('LINKS', 'HMI object and its queue', 'Session.hmi', '. . O c . .'),
    ]
    c = Canvas('state-owners', 'Who owns what: Session, Host and the rest',
               'A matrix of seventeen pieces of state against the browser, webserver, session, host, mod-host and the disk: the Host owns the current pedalboard, the tuner, the transport, the MIDI ports, the profiles and the link to mod-host; the Session owns the browsers, the preferences, the recorder and the thumbnail queue.',
               W, eyebrow='Ownership matrix · Host and Session', h1='The Host owns the pedalboard and the tuner; the Session owns the browsers and the preferences',
               md='%% O = owns (source of truth), c = copy or reads\n%% ' + ' | '.join(['what'] + comps) + '\n' + '\n'.join('%% ' + ' | '.join([r[1]] + r[3].split()) for r in rows))
    lx, gx, cw, rh = 40, 400, 84, 34
    y = 100
    for j, name in enumerate(comps):
        hot = name in ('session', 'host')
        c.text(gx + j * cw + cw / 2, y, name, size=9, fill=ACCENT if hot else INK, anchor='middle', weight=600)
    y += 14
    last = None
    owners = collections.Counter()
    for g, what, where, cells in rows:
        if g != last:
            y += 10
            c.text(lx, y + 2, g, size=7.5, fill=SOFT, ls='0.14em')
            c.line(lx + tw(g, 7.5) + 14, y - 2, gx + len(comps) * cw, y - 2, stroke=HAIR, sw=0.8)
            y += 12
            last = g
        for j, ch in enumerate(cells.split()):
            cx_ = gx + j * cw + cw / 2
            cy = y + rh / 2 - 6
            if ch == 'O':
                c.rect(cx_ - 7, cy - 7, 14, 14, fill=ACCENT if comps[j] in ('session', 'host') else INK, rx=3)
                owners[comps[j]] += 1
            elif ch == 'c':
                c.rect(cx_ - 6, cy - 6, 12, 12, fill='none', stroke=INK, sw=1.2, rx=3)
        c.text(lx, y + 13, what, size=11, fill=INK, font='sans', weight=600)
        c.text(lx, y + 26, where, size=8, fill=SOFT)
        c.line(lx, y + rh - 2, gx + len(comps) * cw, y + rh - 2, stroke='rgba(46,31,51,0.05)', sw=0.8)
        y += rh
    for j in range(len(comps) + 1):
        c.line(gx + j * cw, 112, gx + j * cw, y, stroke='rgba(46,31,51,0.05)', sw=0.8)
    c.text(gx - 12, y + 16, 'pieces it owns', size=8, fill=MUTED, anchor='end', ls='0.06em')
    for j, name in enumerate(comps):
        c.text(gx + j * cw + cw / 2, y + 16, str(owners.get(name, 0)), size=11, fill=ACCENT if name in ('session', 'host') else INK, font='sans', weight=600, anchor='middle')
    c.callout(40, y + 44, ['Banks have two owners: the HMI edits them through the Host, the browser saves banks.json directly in BankSave, and the Host reloads its copy only when the last browser leaves.',
                           'mod-host holds the live instances, but it is not the source of truth: after a crash the Host rebuilds it from its own copy.'])
    c.legend([('box', ACCENT, ACCENT, None, 'Owns it (Host, Session)'), ('box', INK, INK, None, 'Owns it (other)'), ('box', 'none', INK, None, 'Keeps a copy or reads it')])
    return {'canvas': c}


def inside_host():
    W = 1200
    c = Canvas('inside-host', 'What the Host holds',
               'The state inside the Host object: the current pedalboard with its plugin records, connections, snapshots and addressings, the banks, the tuner, the transport, the profile and the links to mod-host and the HMI; next to it, what the Session and the webserver keep.',
               W, eyebrow='Nested view · the Host object', h1='Inside the Host: the pedalboard, the device and the two links',
               md='%% Host (host.py) holds: pedalboard identity, plugins{id -> record}, connections, snapshots, addressings, banks, tuner, transport, profile, mod-host link, HMI link, timers.\n%% Session holds: websockets, prefs, recorder, player, screenshot generator, hmi.\n%% Webserver holds: favourites.')
    tiles = [
        ('Pedalboard identity', ['pedalboard_name · _path', '_size · _version', '_modified · _empty'], 'hot'),
        ('Plugins {id → record}', ['instance · uri · bypassed · x · y', 'ports · parameters · ranges', 'midiCCs · addressings · outputs', 'preset · buildEnv'], 'ped'),
        ('Graph', ['connections [(from, to)]', 'audio · midi · cv ports', 'mapper: id ↔ /graph/<name>'], 'ped'),
        ('Snapshots', ['pedalboard_snapshots[]', 'current_pedalboard_snapshot_id', 'hmi_snapshots[3]'], 'ped'),
        ('Addressings (object)', ['actuator → parameter lists', 'pages and sub-pages', 'Control Chain listener'], 'ped'),
        ('Banks and lists', ['userbanks · factorybanks', 'alluserpedalboards', 'bank_id'], ''),
        ('Tuner', ['current_tuner_port', 'current_tuner_mute', 'current_tuner_ref_freq'], 'hot2'),
        ('Transport', ['transport_rolling', 'transport_bpm · _bpb', 'transport_sync'], ''),
        ('Profile (object)', ['4 user slots + intermediate', 'MIDI channels · volumes', 'applied to the ALSA mixer'], ''),
        ('Link to mod-host', ['writesock · readsock', '_queue · _idle', 'crashed · connected'], ''),
        ('Link to the HMI', ['hmi (HMI or FakeHMI)', 'next_hmi_* pending messages', 'hmi_ping_io'], ''),
        ('Timers', ['statstimer · every 1 s', 'memtimer · every 5 s', 'cpu freq · temperature'], ''),
    ]
    hx, hy, tw_, th, gap = 40, 96, 204, 108, 16
    hw = 4 * tw_ + 5 * gap
    hh = 40 + 3 * th + 4 * gap
    c.rect(hx, hy, hw, hh, fill='rgba(46,31,51,0.02)', stroke=INK, sw=1.2, rx=8)
    c.text(hx + 16, hy + 26, 'Host · mod/host.py', size=13, fill=INK, font='sans', weight=600)
    c.text(hx + hw - 16, hy + 26, '201 methods · one instance · created by Session', size=8.5, fill=MUTED, anchor='end')
    for i, (title, lines, kind) in enumerate(tiles):
        col, row = i % 4, i // 4
        x = hx + gap + col * (tw_ + gap)
        y = hy + 40 + gap + row * (th + gap)
        fill = 'rgba(46,31,51,0.07)' if kind in ('ped', 'hot') else '#ffffff'
        stroke = ACCENT if kind in ('hot', 'hot2') else 'rgba(46,31,51,0.35)'
        c.rect(x, y, tw_, th, fill=ACCENT_TINT if kind in ('hot', 'hot2') else fill, stroke=stroke, sw=1.2 if kind in ('hot', 'hot2') else 1, rx=6)
        c.text(x + 14, y + 24, title, size=11, fill=INK, font='sans', weight=600)
        for k, ln in enumerate(lines):
            c.text(x + 14, y + 44 + 15 * k, ln, size=8.5, fill=MUTED)
    ox = hx + hw + 64
    c.rect(ox, hy, 160, 168, fill='#ffffff', stroke=INK, sw=1, rx=6)
    c.text(ox + 12, hy + 24, 'Session', size=12, fill=INK, font='sans', weight=600)
    for k, ln in enumerate(['websockets[]', 'prefs (prefs.json)', 'recorder · player', 'screenshot queue', 'hmi (creates it)', 'screenshot_needed']):
        c.text(ox + 12, hy + 46 + 16 * k, ln, size=8.5, fill=MUTED)
    c.rect(ox, hy + 192, 160, 96, fill='#ffffff', stroke=INK, sw=1, rx=6)
    c.text(ox + 12, hy + 216, 'Webserver', size=12, fill=INK, font='sans', weight=600)
    for k, ln in enumerate(['gState.favorites', 'no pedalboard state']):
        c.text(ox + 12, hy + 238 + 16 * k, ln, size=8.5, fill=MUTED)
    c.line(hx + hw, hy + 84, ox, hy + 84, stroke=MUTED, sw=1.2, marker='arrow')
    c.label((hx + hw + ox) / 2, hy + 72, 'msg_callback', size=7)
    c.callout(40, hy + hh + 36, ['Tinted tiles are the current pedalboard; the tuner has its own tile. Everything the Host does not own is in the box on the right.',
                                 'The Session creates the Host and keeps a reference to the HMI; it does not hold a copy of any pedalboard data.'])
    c.legend([('box', ACCENT_TINT, ACCENT, None, 'What you asked about: the pedalboard identity and the tuner'), ('box', 'rgba(46,31,51,0.07)', 'rgba(46,31,51,0.35)', None, 'The rest of the current pedalboard'), ('box', '#ffffff', 'rgba(46,31,51,0.35)', None, 'Other state')])
    return {'canvas': c}


def persistence():
    W = 1040
    cols = ['host', 'session', 'webserver', 'libmod_utils', 'mod-host', 'subprocess', 'OS image']
    rows = [  # group, store, where, cells H S W L M P O, lifetime/format
        ('PEDALBOARD BUNDLE', 'Manifest and TTL', '~/.pedalboards/<name>.pedalboard/', 'W . W r . r W', 'LV2 TTL'),
        ('PEDALBOARD BUNDLE', 'addressings.json', 'in the bundle', 'W . . . . . .', 'JSON'),
        ('PEDALBOARD BUNDLE', 'snapshots.json', 'in the bundle', 'W . . . . . .', 'JSON'),
        ('PEDALBOARD BUNDLE', 'Plugin state', 'in the bundle (state_save)', '. . . . W . .', 'plugin files'),
        ('PEDALBOARD BUNDLE', 'Screenshot, thumbnail', 'in the bundle', '. . r . . W .', 'PNG'),
        ('PLUGINS', 'LV2 plugin bundles and presets', '~/.lv2/', 'W . W r W W .', 'LV2 bundle'),
        ('DEVICE DATA', 'banks.json', '<DATA_DIR>/', 'W . W . . . .', 'JSON'),
        ('DEVICE DATA', 'Factory banks', '/usr/share/mod/banks.json', 'r . . . . . W', 'JSON'),
        ('DEVICE DATA', 'last.json', '<DATA_DIR>/', 'W . . . . . .', 'JSON'),
        ('DEVICE DATA', 'prefs.json', '<DATA_DIR>/', 'W W W . . . .', 'JSON'),
        ('DEVICE DATA', 'profile1..5.json', '<DATA_DIR>/', 'W . . . . . .', 'JSON'),
        ('DEVICE DATA', 'favorites.json', '<DATA_DIR>/', '. . W . . . .', 'JSON'),
        ('DEVICE DATA', 'Thumbnail port cache', '<DATA_DIR>/.cache/', '. . . . . W .', 'JSON'),
        ('IDENTITY AND CLOUD', 'user-id.json', '<DATA_DIR>/', '. . W . . . .', 'JSON'),
        ('IDENTITY AND CLOUD', 'tokens.conf', '<DATA_DIR>/ (unused by the UI)', '. . W . . . .', 'JSON'),
        ('IDENTITY AND CLOUD', 'License keys', 'keys/<sha1 of the plugin URI>', '. . x r . . .', 'any file'),
        ('IDENTITY AND CLOUD', 'Tag, uid, RSA key, server key', 'DATA_DIR in development, image on a device', '. . r . . . W', 'text, PEM'),
        ('USER AND SYSTEM', 'User files (NAM, IR, audio)', '/data/user-files/', '. . W . r . .', 'files'),
        ('USER AND SYSTEM', 'Marker files and signals', '/data/*, /root/*', '. . W . . . W', 'empty or one line'),
        ('USER AND SYSTEM', 'Hardware descriptor, release', '/etc/mod-*', 'r . r . . . W', 'JSON, text'),
        ('TEMPORARY', 'Recording and playback', '/tmp/capture.ogg, playback.ogg', '. W . . . W .', 'OGG'),
        ('TEMPORARY', 'Plugin state while running', '<DATA_DIR>/pedalboard-tmp-data', 'x . . . W . .', 'plugin files'),
    ]
    c = Canvas('persistence', 'Where things are stored and who writes them',
               'A matrix of twenty-two stores against the code that writes them: the Host writes the pedalboard files, banks, last pedalboard and profiles; the Session owns the preferences and the recorder; the webserver writes favourites, user files, identity and settings; mod-host writes plugin state; the OS image writes identity and system files.',
               W, eyebrow='Persistence matrix · stores and writers', h1='Seven writers, no database: the Host persists the pedalboard, the Session the preferences',
               md='%% W = writes (and reads back), r = reads, x = only deletes\n%% ' + ' | '.join(['store', 'where'] + cols) + '\n' + '\n'.join('%% ' + ' | '.join([r[1], r[2]] + r[3].split()) for r in rows))
    lx, gx, cw, rh = 40, 440, 66, 32
    y = 100
    for j, name in enumerate(cols):
        c.text(gx + j * cw + cw / 2, y, name, size=8.5, fill=ACCENT if name in ('host', 'session') else INK, anchor='middle', weight=600)
    c.text(gx + len(cols) * cw + 14, y, 'FORMAT', size=7.5, fill=SOFT, ls='0.14em')
    y += 14
    last = None
    writers = collections.Counter()
    for g, store, where, cells, fmt in rows:
        if g != last:
            y += 10
            c.text(lx, y + 2, g, size=7.5, fill=SOFT, ls='0.14em')
            c.line(lx + tw(g, 7.5) + 14, y - 2, gx + len(cols) * cw + 90, y - 2, stroke=HAIR, sw=0.8)
            y += 12
            last = g
        for j, ch in enumerate(cells.split()):
            cx_ = gx + j * cw + cw / 2
            cy = y + rh / 2 - 6
            if ch == 'W':
                c.rect(cx_ - 7, cy - 7, 14, 14, fill=ACCENT if cols[j] in ('host', 'session') else INK, rx=3)
                writers[cols[j]] += 1
            elif ch == 'r':
                c.rect(cx_ - 6, cy - 6, 12, 12, fill='none', stroke=INK, sw=1.2, rx=3)
            elif ch == 'x':
                c.line(cx_ - 6, cy - 6, cx_ + 6, cy + 6, stroke=INK, sw=1.6)
                c.line(cx_ - 6, cy + 6, cx_ + 6, cy - 6, stroke=INK, sw=1.6)
        c.text(lx, y + 13, store, size=11, fill=INK, font='sans', weight=600)
        c.text(lx, y + 25, where, size=7.5, fill=SOFT)
        c.text(gx + len(cols) * cw + 14, y + 14, fmt, size=8, fill=MUTED)
        c.line(lx, y + rh - 2, gx + len(cols) * cw + 90, y + rh - 2, stroke='rgba(46,31,51,0.05)', sw=0.8)
        y += rh
    for j in range(len(cols) + 1):
        c.line(gx + j * cw, 112, gx + j * cw, y, stroke='rgba(46,31,51,0.05)', sw=0.8)
    c.text(gx - 12, y + 16, 'stores it writes', size=8, fill=MUTED, anchor='end', ls='0.06em')
    for j, name in enumerate(cols):
        c.text(gx + j * cw + cw / 2, y + 16, str(writers.get(name, 0)), size=11, fill=ACCENT if name in ('host', 'session') else INK, font='sans', weight=600, anchor='middle')
    c.callout(40, y + 44, ['Everything is a file. Most JSON goes through TextFileFlusher (write to .tmp, fsync, rename), but prefs.json can be saved without it and favorites.json is written both ways.',
                           'Nothing in this repository writes the license keys or the device identity: the OS image provides them (in development, server.py invents a dummy identity).'])
    c.legend([('box', ACCENT, ACCENT, None, 'Writes it (Host, Session)'), ('box', INK, INK, None, 'Writes it (other)'), ('box', 'none', INK, None, 'Reads it'), ('dot', INK, 'A cross in a cell: only deletes it')])
    return {'canvas': c}


DEEP = [startup, tuner_sequence, cloud_auth, share_flow, remote_load, architecture_detail, jack_graph, license_flow, identity_data,
        layers_topdown, state_owners, inside_host, persistence]
