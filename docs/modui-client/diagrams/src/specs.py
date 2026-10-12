"""Definitions of the diagrams of docs/modui-client.md (sections 2 and 4): the single place to edit them.

Each function returns one diagram as a dict:
  slug, title, desc          file name (<slug>.svg), <title> and <desc> of the SVG
  ents                       boxes: Ent(key, kind, name, fields=[...], ops=[...], sub=..., note=..., w=..., focal=...) placed with at(ent, x, y)
  conns                      lines: Conn(a, side, b, side, kind, at_a=, at_b=, mid=, ca=, cb=, label=, seg=, lside=)
  kinds, lines               what the legend shows
  callouts                   [(x, y, [line, ...])], at most two per diagram
Run `python3 docs/modui-client/diagrams/src/build.py`; it prints geometry warnings (a line behind a box, labels touching, ...).
See ../README.md for the rules.
"""
from engine import *

C = [40, 368, 696]   # x of the three columns of a 960-wide domain diagram (224 wide, 104 apart)



def zone(x, y, w, h, label):
    lw = len(label) * 6.2 + 16
    cx = x + w / 2
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="rgba(46,31,51,0.02)" stroke="rgba(46,31,51,0.10)" stroke-width="0.8"/>'
            f'<rect x="{cx-lw/2:g}" y="{y+4}" width="{lw:g}" height="12" rx="2" fill="{PAPER}"/>'
            f'<text x="{cx:g}" y="{y+13}" fill="{SOFT}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.14em">{label}</text>')


def architecture():
    W = 1040
    NW, NH = 160, 80
    z = [40, 296, 552, 808]           # zone x
    nx = [x + 16 for x in z]          # node x
    r = [112, 232, 352]               # row y
    classic = Node('classic', 'legacy', 'Classic UI', ['jQuery · host.js', '$.ajax + window.ws'], nx[0], r[0], NW, NH)
    app = Node('app', 'app', 'Application code', ['new UI · console · tests', 'browser or Node.js 22'], nx[0], r[1], NW, NH)
    http = Node('http', 'client', 'HttpTransport', ['fetch · JSON', 'non-2xx = HttpError'], nx[1], r[0], NW, NH)
    client = Node('client', 'client', 'ModUiClient', ['client.pedalboards', 'client.device · .banks'], nx[1], r[1], NW, NH, focal=True)
    chan = Node('chan', 'client', 'EventChannel', ['WebSocket · replay', 'waitFor() · reconnect'], nx[1], r[2], NW, NH)
    web = Node('web', 'http', 'Webserver', ['webserver.py · Tornado', 'handlers · /websocket'], nx[2], r[0], NW, NH)
    host = Node('host', 'backend', 'Session + Host', ['session.py · host.py', 'owns the running state'], nx[2], r[1], NW, NH)
    mh = Node('mh', 'ext', 'mod-host', ['audio engine · LV2', 'TCP :5555 / :5556'], nx[3], r[1] - 12, NW, NH)
    hmi = Node('hmi', 'ext', 'HMI · Control Chain', ['serial · pedals', 'knobs and screens'], nx[3], r[2], NW, NH)
    ents = [classic, app, http, client, chan, web, host, mh, hmi]

    zones = '\n'.join([
        zone(z[0], 72, 192, 240, 'BROWSER'),
        zone(z[1], 72, 192, 360, 'MODUI-CLIENT · TS'),
        zone(z[2], 72, 192, 240, 'MOD/ · PYTHON'),
        zone(z[3], 172, 192, 260, 'DEVICE'),
    ])

    conns = [
        Conn(app, 'R', client, 'L', 'call'),
        Conn(client, 'T', http, 'B', 'call', label='uses', lside='R'),
        Conn(client, 'B', chan, 'T', 'call', label='uses', lside='R'),
        Conn(http, 'R', web, 'L', 'http', at_a=r[0] + 36, at_b=r[0] + 36, label='fetch'),
        Conn(chan, 'R', web, 'L', 'ws', at_a=r[2] + 40, at_b=r[0] + 60, mid=520, seg=1, label='ws', lside='L'),
        Conn(classic, 'T', web, 'T', 'call', at_a=nx[0] + 136, at_b=nx[2] + 80, mid=52, label='ajax · ws'),
        Conn(web, 'B', host, 'T', 'call', at_a=nx[2] + 48, at_b=nx[2] + 48, label='calls', lside='L'),
        Conn(host, 'T', web, 'B', 'push', at_a=nx[2] + 112, at_b=nx[2] + 112, label='broadcast', lside='R'),
        Conn(host, 'R', mh, 'L', 'call', at_a=r[1] + 24, at_b=r[1] + 24, label='tcp'),
        Conn(host, 'R', hmi, 'L', 'call', at_a=r[1] + 56, at_b=r[2] + 40, mid=776, label='serial', seg=2, lside='R'),
    ]
    conns = [c for c in conns if c]
    groups = [('BROWSER', ['classic', 'app']), ('MODUI-CLIENT', ['http', 'client', 'chan']), ('MOD-UI SERVER', ['web', 'host']), ('DEVICE', ['mh', 'hmi'])]
    return dict(slug='architecture', title='modui-client architecture', eyebrow='Architecture · modui-client',
                h1='Where modui-client sits between your code and the audio device', W=W, ents=ents, conns=conns, zones=zones, bottom=432, groups=groups,
                desc='Application code uses ModUiClient, whose HttpTransport and EventChannel talk to the Tornado webserver; the webserver drives Session and Host, which control mod-host and the HMI, and Host broadcasts every change to all WebSocket clients, the classic UI included.',
                kinds=['app', 'client', 'legacy', 'backend', 'ext'], lines=['call', 'http', 'ws', 'push'],
                callouts=[(56, 372, ['The classic UI and this client', 'share one backend: every change', 'is broadcast to all sockets.'])])




def d_pedalboard():
    api = at(Ent('api', 'class', 'PedalboardsApi', ops=['list()'], sub='client.pedalboards', w=224), C[1], 48)
    ref = at(Ent('ref', 'class', 'PedalboardReference', focal=True, w=224,
                 fields=['bundlepath: string', 'title · uri: string', 'broken · factory: boolean', 'hasTrialPlugins: boolean', 'version: number', 'isDefault: boolean'],
                 ops=['info() · copy() · delete()']), C[1], api.b + 64)
    bank = at(Ent('bank', 'stub', 'Bank', note='banks diagram', w=224), C[0], ref.y)
    summary = at(Ent('summary', 'wire', 'PedalboardSummary', sub='GET /pedalboard/list', w=224,
                     fields=['broken · factory: boolean', 'hasTrialPlugins: boolean', 'uri · title: string', 'bundle: string', 'version: number']), C[2], ref.y)
    y3 = ref.b + 72
    images = at(Ent('images', 'class', 'PedalboardImages', sub='reference.images', w=224,
                    ops=['getThumbnailUrl()', 'getScreenshotUrl()', 'status() · generate()']), C[0], y3)
    info = at(Ent('info', 'wire', 'PedalboardInfo', sub='GET /pedalboard/info/', w=224,
                  fields=['bundlepath: string (client)', 'title: string', 'width · height: number', 'factory · version', 'plugins · connections', 'hardware · timeInfo']), C[2], y3)
    status = at(Ent('status', 'data', 'ImageStatus', fields=['Missing', 'Generating', 'Available'], w=224), C[0], images.b + 56)
    ents = [api, ref, bank, summary, images, info, status]
    conns = [
        Conn(api, 'B', ref, 'T', 'ref', at_a=480, at_b=480, ca='1', cb='0..*', label='list()', lside='R'),
        Conn(bank, 'R', ref, 'L', 'own', at_a=ref.y + 30, at_b=ref.y + 30, ca='0..*', cb='0..*', label='holds', lside='B'),
        Conn(ref, 'R', summary, 'L', 'own', at_a=ref.y + 30, at_b=ref.y + 30, ca='1', cb='1', label='summary', lside='B'),
        Conn(ref, 'B', images, 'R', 'own', at_a=432, at_b=images.y + 36, ca='1', cb='1', label='images'),
        Conn(ref, 'B', info, 'L', 'ref', at_a=528, at_b=info.y + 36, label='info()'),
        Conn(images, 'B', status, 'T', 'ref', at_a=152, at_b=152, label='status()', lside='R'),
    ]
    callouts = [(C[1], y3 + 70, ['A reference is a cheap handle built from', 'the list; the full bundle is read only', 'when you call info().'])]
    return dict(slug='domain-pedalboard', title='Pedalboard library', eyebrow='Data model · pedalboard',
                h1='Saved pedalboards: a handle, its summary and its content',
                desc='PedalboardsApi lists PedalboardReference handles; each handle holds a PedalboardSummary and PedalboardImages and can read the full PedalboardInfo; banks hold references.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'wire', 'data', 'stub', 'focal'], lines=['own', 'ref'])



def d_bundle():
    X = [40, 272, 504, 736]
    info = at(Ent('info', 'wire', 'PedalboardInfo', sub='GET /pedalboard/info/', focal=True, w=224,
                  fields=['bundlepath: string (client)', 'title: string', 'width · height: number', 'factory: boolean', 'midi_separated_mode', 'midi_loopback: boolean', 'version: number']), 368, 48)
    y2 = info.b + 104
    plugin = at(Ent('plugin', 'wire', 'PedalboardPlugin', w=184, fields=['instance: "/graph/Gain"', 'uri: string', 'bypassed: boolean', 'x · y: number', 'preset: string']), X[0], y2)
    conn = at(Ent('conn', 'wire', 'PedalboardInfoConnection', w=184, fields=['source: string', 'target: string'], sub='port ids'), X[1], y2)
    hw = at(Ent('hw', 'wire', 'PedalboardHardware', w=184, fields=['audio_ins · audio_outs', 'cv_ins · cv_outs', 'midi_ins · midi_outs', 'serial_midi_in · _out', 'midi_merger_out', 'midi_broadcaster_in']), X[2], y2)
    ti = at(Ent('ti', 'wire', 'PedalboardTimeInfo', w=184, fields=['available: bit mask', 'bpb · bpm: number', 'rolling: boolean', 'bpbCC · bpmCC · rollingCC']), X[3], y2)
    row2b = max(e.b for e in (plugin, conn, hw, ti))
    y3 = row2b + 104
    port = at(Ent('port', 'wire', 'PedalboardPluginPort', w=184, fields=['symbol: string', 'value: number']), X[0], y3)
    midi = at(Ent('midi', 'wire', 'MidiControl', w=184, fields=['channel · control: number', 'hasRanges: boolean', 'minimum · maximum'], sub='channel -1 = unmapped'), X[1], y3)
    ents = [info, plugin, conn, hw, ti, port, midi]
    ib = info.b
    conns = [
        Conn(info, 'B', plugin, 'T', 'own', at_a=396, at_b=plugin.cx, mid=ib + 28, ca='1', cb='0..*', label='plugins', seg=2, lside='R'),
        Conn(info, 'B', conn, 'T', 'own', at_a=452, at_b=conn.cx, mid=ib + 44, ca='1', cb='0..*', label='connections', seg=2, lside='R'),
        Conn(info, 'B', hw, 'T', 'own', at_a=508, at_b=hw.cx, mid=ib + 44, ca='1', cb='1', label='hardware', seg=2, lside='R'),
        Conn(info, 'B', ti, 'T', 'own', at_a=564, at_b=ti.cx, mid=ib + 28, ca='1', cb='1', label='timeInfo', seg=2, lside='R'),
        Conn(plugin, 'B', port, 'T', 'own', at_a=100, at_b=100, ca='1', cb='0..*', label='ports', lside='R'),
        Conn(plugin, 'B', midi, 'T', 'own', at_a=164, at_b=midi.cx, mid=row2b + 36, ca='1', cb='1', label='bypassCC', seg=2, lside='R'),
        Conn(port, 'R', midi, 'L', 'own', at_a=y3 + 40, at_b=y3 + 40, ca='1', cb='1', label='midiCC', lside='B'),
    ]
    callouts = [(X[2], y3 + 14, ['Every field ending in CC is a MidiControl:', 'bypassCC, midiCC, bpbCC, bpmCC, rollingCC.'])]
    return dict(slug='domain-pedalboard-bundle', title='Pedalboard bundle', eyebrow='Data model · pedalboard bundle',
                h1='What PedalboardInfo holds: plugins, connections, hardware and transport',
                desc='PedalboardInfo, read from GET /pedalboard/info/, contains plugins with their control port values, the connections, the hardware ports and the transport settings; MIDI assignments are MidiControl values.',
                ents=ents, conns=conns, callouts=callouts, kinds=['wire', 'focal'], lines=['own'], W=960)


def d_device():
    ref = at(Ent('ref', 'stub', 'PedalboardReference', note='pedalboard diagram', w=224), C[0], 48)
    dev = at(Ent('dev', 'class', 'Device', sub='client.device', focal=True, w=224,
                 fields=['stats · sysStats', 'transport · bufferSize', 'trueBypass · snapshot'],
                 ops=['load(target)', 'loadDefault() · reset()', 'on(event) · once(event)']), C[1], 48)
    cp = at(Ent('cp', 'stub', 'CurrentPedalboard', note='current pedalboard diagram', w=224), C[2], 48)
    y2 = dev.b + 88
    lr = at(Ent('lr', 'data', 'LoadResult', fields=['bundlepath: string', 'name: string', 'snapshotId: number'], w=224), C[0], y2)
    ds = at(Ent('ds', 'data', 'Device reports', sub='last value; null until reported', w=288,
                fields=['stats: cpuLoad, xruns', 'sysStats: memLoad, cpuFreqKhz, cpuTempMilli', 'transport: rolling, beatsPerBar, bpm, syncMode', 'bufferSize: frames', 'trueBypass: left, right', 'snapshot: index, name']), 336, y2)
    pa = at(Ent('pa', 'class', 'PluginsApi', sub='client.device.plugins', ops=['list()'], w=224), C[2], y2)
    pl = at(Ent('pl', 'stub', 'Plugin', note='plugin diagram', w=224), C[2], pa.b + 64)
    ents = [ref, dev, cp, lr, ds, pa, pl]
    ym = dev.b + 32
    conns = [
        Conn(dev, 'L', ref, 'R', 'ref', at_a=78, at_b=78, label='load(target)', lside='B'),
        Conn(dev, 'R', cp, 'L', 'own', at_a=78, at_b=78, ca='1', cb='1', label='running', lside='B'),
        Conn(dev, 'B', lr, 'T', 'ref', at_a=408, at_b=lr.cx, mid=ym, label='load()', seg=2, lside='R'),
        Conn(dev, 'B', ds, 'T', 'own', at_a=480, at_b=480, ca='1', cb='1', label='reports', lside='R'),
        Conn(dev, 'B', pa, 'T', 'own', at_a=552, at_b=pa.cx, mid=ym, ca='1', cb='1', label='plugins', seg=2, lside='R'),
        Conn(pa, 'B', pl, 'T', 'ref', at_a=pa.cx, at_b=pa.cx, ca='1', cb='0..*', label='list()', lside='R'),
    ]
    return dict(slug='domain-device', title='Device', eyebrow='Data model · device',
                h1='The device: what is running, what is installed, what it reports',
                desc='Device owns the running pedalboard and the plugin catalogue, loads pedalboards and returns a LoadResult, and keeps the last values the device reported, such as load, transport and buffer size.',
                ents=ents, conns=conns, callouts=[], kinds=['class', 'data', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_current():
    snaps = at(Ent('snaps', 'stub', 'PedalboardSnapshots', note='snapshots diagram', w=224), C[0], 48)
    cp = at(Ent('cp', 'class', 'CurrentPedalboard', sub='client.device.currentPedalboard', focal=True, w=256,
                ops=['plugins.list · add · remove', 'connections.list · connect · disconnect', 'ports.list · ports.audio.input()', 'get · save · saveAs', 'on · once · getSnapshot · subscribe']), 352, 48)
    st = at(Ent('st', 'data', 'PedalboardSnapshot', sub='currentPedalboard.getSnapshot()', w=224,
                fields=['version: number', 'ready · loading: boolean', 'plugins: PluginSnapshot[]', 'connections: ConnectionSnapshot[]', 'ports: PortSnapshot[]']), C[2], 48)
    y2 = cp.b + 88
    pi = at(Ent('pi', 'stub', 'PluginInstance', note='plugin diagram', w=224), C[0], y2)
    port = at(Ent('port', 'class', 'Port', w=224, fields=['id: "/graph/Gain/in"', 'symbol · name: string', 'type: audio | midi | cv', 'direction: input | output', 'owner: PluginInstance | null']), C[1], y2)
    conn = at(Ent('conn', 'class', 'PedalboardConnection', w=224, fields=['id: string', 'from: Port', 'to: Port']), C[2], y2)
    ents = [snaps, cp, st, pi, port, conn]
    ym = cp.b + 36
    conns = [
        Conn(cp, 'L', snaps, 'R', 'own', at_a=78, at_b=78, ca='1', cb='1', label='snapshots', lside='B'),
        Conn(cp, 'R', st, 'L', 'ref', at_a=78, at_b=78, label='getSnapshot()', lside='B'),
        Conn(cp, 'B', pi, 'T', 'own', at_a=388, at_b=pi.cx, mid=ym, ca='1', cb='0..*', label='plugins', seg=2, lside='R'),
        Conn(cp, 'B', port, 'T', 'own', at_a=480, at_b=480, ca='1', cb='0..*', label='ports', lside='R'),
        Conn(cp, 'B', conn, 'T', 'own', at_a=572, at_b=conn.cx, mid=ym, ca='1', cb='0..*', label='connections', seg=2, lside='R'),
        Conn(pi, 'R', port, 'L', 'own', at_a=y2 + 30, at_b=y2 + 30, ca='0..1', cb='0..*', label='ports', lside='B'),
        Conn(conn, 'L', port, 'R', 'own', at_a=y2 + 40, at_b=y2 + 40, ca='2', cb='0..*', label='from, to', lside='B'),
    ]
    callouts = [(C[0], y2 + 100, ['No endpoint lists the running plugins or', 'connections: the client rebuilds them from', 'the frames of the WebSocket.'])]
    return dict(slug='domain-current-pedalboard', title='Current pedalboard', eyebrow='Data model · current pedalboard',
                h1='The running pedalboard: plugins, ports and connections',
                desc='CurrentPedalboard holds the live plugin instances, the pedalboard own ports and the connections between ports, its snapshots, and an immutable state snapshot for UI frameworks.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'data', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_plugin():
    plugin = at(Ent('plugin', 'class', 'Plugin', sub='client.device.plugins.list()', w=224, fields=['uri · name: string', 'brand · label: string', 'category: string[]'], ops=['info()']), C[0], 48)
    pinfo = at(Ent('pinfo', 'wire', 'PluginInfo', sub='GET /effect/get?uri=', w=224,
                   fields=['…the PluginSummary fields', 'version · stability: string', 'ports: audio · midi · cv · control', 'parameters?: patch params', 'presets?: stale after a save']), C[1], 48)
    y2 = max(plugin.b, pinfo.b) + 88
    pi = at(Ent('pi', 'class', 'PluginInstance', focal=True, w=224, sub='one block of the running graph',
                fields=['instance: "/graph/Gain"', 'uri: string', 'x · y: number', 'alive: boolean', 'preset: string | null', 'info: PluginInfo | null'],
                ops=['isActive() · setActive(b)', 'toggle() · setPosition(p)', 'port(symbol) · remove()', 'on(event) · once(event)']), C[1], y2)
    patch = at(Ent('patch', 'stub', 'PluginPatchParams', note='patch params diagram', w=224), C[2], y2)
    y3 = pi.b + 88
    param = at(Ent('param', 'class', 'Param', w=224, fields=['symbol · name: string', 'default · minimum · maximum', 'designation: string', 'properties: string[]', 'value: number (live)'], ops=['setValue(v) · on("change")']), C[0], y3)
    port = at(Ent('port', 'class', 'Port', w=224, fields=['id: "/graph/Gain/in"', 'symbol · name: string', 'type: audio | midi | cv', 'direction: input | output', 'owner: PluginInstance']), C[1], y3)
    pres = at(Ent('pres', 'stub', 'PluginPresets', note='presets diagram', w=224), C[2], y3)
    ents = [plugin, pinfo, pi, patch, param, port, pres]
    ym = pi.b + 32
    conns = [
        Conn(plugin, 'R', pinfo, 'L', 'ref', at_a=88, at_b=88, label='info()', lside='B'),
        Conn(pi, 'T', pinfo, 'B', 'own', at_a=480, at_b=480, ca='0..*', cb='0..1', label='info', lside='R'),
        Conn(pi, 'L', plugin, 'B', 'ref', at_a=y2 + 40, at_b=plugin.cx, ca='0..*', cb='1', label='instance of'),
        Conn(pi, 'R', patch, 'L', 'own', at_a=y2 + 30, at_b=y2 + 30, ca='1', cb='0..*', label='patchParams', lside='B'),
        Conn(pi, 'B', param, 'T', 'own', at_a=412, at_b=param.cx, mid=ym, ca='1', cb='0..*', label='params', seg=2, lside='R'),
        Conn(pi, 'B', port, 'T', 'own', at_a=480, at_b=480, ca='1', cb='0..*', label='ports', lside='R'),
        Conn(pi, 'B', pres, 'T', 'own', at_a=548, at_b=pres.cx, mid=ym, ca='1', cb='1', label='presets', seg=2, lside='R'),
    ]
    callouts = [(C[2], 56, ['Params come from the control ports of', 'PluginInfo; Ports from audio, midi and cv.'])]
    return dict(slug='domain-plugin', title='Plugin', eyebrow='Data model · plugin',
                h1='A plugin and its instance: ports, parameters, patch parameters and presets',
                desc='A Plugin from the installed catalogue is described by PluginInfo; a PluginInstance in the running pedalboard has ports, control parameters, patch parameters and presets.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'wire', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_patch():
    pi = at(Ent('pi', 'stub', 'PluginInstance', note='plugin diagram', w=224), C[0], 48)
    ppp = at(Ent('ppp', 'class', 'PluginPatchParams', sub='instance.patchParams', ops=['list()', 'get(uri)'], w=224), C[1], 48)
    patch = at(Ent('patch', 'class', 'PatchParam', focal=True, w=224,
                   fields=['uri · label: string', 'type: PatchParamType', 'readable · writable: boolean', 'default: PatchValue', 'minimum · maximum: number', 'fileTypes: string[]', 'supportedExtensions: string[]', 'value: PatchValue (live)'],
                   ops=['refresh() · setValue(v)', 'on("change")']), C[2], 48)
    ptype = at(Ent('ptype', 'data', 'PatchParamType', fields=['bool · int · long', 'float · double', 'string · path · uri'], w=224), C[1], 200)
    pinfo = at(Ent('pinfo', 'wire', 'PluginParameterInfo', sub='PluginInfo.parameters[]', w=224,
                   fields=['uri · label: string', 'type: atom type URI', 'readable · writable: boolean', 'ranges?: min, max, default', 'fileTypes?: string[]', 'supportedExtensions?: string[]']), C[2], patch.b + 88)
    ents = [pi, ppp, patch, ptype, pinfo]
    conns = [
        Conn(pi, 'R', ppp, 'L', 'own', at_a=78, at_b=78, ca='1', cb='1', label='patchParams', lside='B'),
        Conn(ppp, 'R', patch, 'L', 'own', at_a=78, at_b=78, ca='1', cb='0..*', label='list()', lside='B'),
        Conn(patch, 'L', ptype, 'R', 'own', at_a=240, at_b=240, ca='0..*', cb='1', label='type', lside='B'),
        Conn(patch, 'B', pinfo, 'T', 'ref', at_a=808, at_b=808, ca='1', cb='1', label='built from', lside='R'),
    ]
    callouts = [(C[1], 340, ['Not control ports: the values are typed', '(string, path, URI, bool, ...) and travel', 'as patch_get and patch_set.'])]
    return dict(slug='domain-patch-params', title='Patch parameters', eyebrow='Data model · patch parameters',
                h1='Patch parameters: typed values that are not control ports',
                desc='A plugin instance exposes its patch parameters through PluginPatchParams; each PatchParam has a type and a live value and is built from the parameter description in PluginInfo.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'wire', 'data', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_presets():
    pi = at(Ent('pi', 'stub', 'PluginInstance', note='plugin diagram', w=224), C[0], 48)
    pp = at(Ent('pp', 'class', 'PluginPresets', sub='instance.presets', w=224, fields=['currentUri: string | null', 'current: Preset | null'],
                ops=['list() · get(uri)', 'load(preset | uri)', 'create(name)', 'save(preset, name?)', 'delete(preset)', 'on("list")']), C[1], 48)
    preset = at(Ent('preset', 'class', 'Preset', focal=True, w=224, fields=['uri · label: string', 'bundlepath: string | null', 'isUser · isCurrent: boolean', 'alive: boolean'], ops=['load() · save(name?)', 'delete()']), C[2], 48)
    y2 = max(pp.b, preset.b) + 88
    papi = at(Ent('papi', 'stub', 'PluginsApi', note='device diagram', w=224), C[0], y2)
    cat = at(Ent('cat', 'internal', 'PresetCatalog', sub='one per plugin URI', w=224, fields=['source: GET /effect/get_non_cached', 'presets: PluginPresetInfo[]'], ops=['update() after a save']), C[1], y2)
    pinfo = at(Ent('pinfo', 'wire', 'PluginPresetInfo', w=224, fields=['valid: boolean', 'uri · label: string', 'path: bundle dir, "" = factory']), C[2], y2)
    ents = [pi, pp, preset, papi, cat, pinfo]
    conns = [
        Conn(pi, 'R', pp, 'L', 'own', at_a=78, at_b=78, ca='1', cb='1', label='presets', lside='B'),
        Conn(pp, 'R', preset, 'L', 'own', at_a=78, at_b=78, ca='1', cb='0..*', label='list()', lside='B'),
        Conn(pp, 'B', cat, 'T', 'ref', at_a=480, at_b=480, ca='0..*', cb='1', label='shares', lside='R'),
        Conn(papi, 'R', cat, 'L', 'own', at_a=y2 + 30, at_b=y2 + 30, ca='1', cb='0..*', label='per uri', lside='B'),
        Conn(cat, 'R', pinfo, 'L', 'own', at_a=y2 + 30, at_b=y2 + 30, ca='1', cb='0..*', label='entries', lside='B'),
        Conn(preset, 'B', pinfo, 'T', 'ref', at_a=808, at_b=808, ca='0..*', cb='1', label='built from', lside='R'),
    ]
    callouts = [(C[0], y2 + 100, ['Two instances of the same plugin see', 'the same list: one catalogue per URI,', 'wrapped per instance.'])]
    return dict(slug='domain-presets', title='Plugin presets', eyebrow='Data model · presets',
                h1='Presets belong to the plugin, shared by all its instances',
                desc='PluginPresets of an instance wraps the entries of one PresetCatalog per plugin URI into Preset objects; the entries come from GET /effect/get_non_cached as PluginPresetInfo.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'wire', 'internal', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_snapshots():
    cp = at(Ent('cp', 'stub', 'CurrentPedalboard', note='current pedalboard diagram', w=224), C[0], 48)
    ps = at(Ent('ps', 'class', 'PedalboardSnapshots', sub='currentPedalboard.snapshots', w=224, fields=['currentIndex: number | null', 'current: Snapshot | null'],
                ops=['list() · get(index)', 'save() · create(name)', 'load(snapshot | index)', 'on("current" | "list")']), C[1], 48)
    snap = at(Ent('snap', 'class', 'Snapshot', focal=True, w=224, fields=['index: number', 'name: string', 'isCurrent · alive: boolean'], ops=['load() · rename(name)', 'delete()']), C[2], 48)
    y2 = ps.b + 88
    lst = at(Ent('lst', 'wire', 'SnapshotListResponse', sub='GET /snapshot/list', w=224, fields=['Record<string, string>', 'index (as text) → name']), C[1], y2)
    sv = at(Ent('sv', 'wire', 'SnapshotSaveAsResponse', sub='GET /snapshot/saveas', w=224, fields=['ok: boolean', 'id: number | null', 'title: string']), C[2], y2)
    ents = [cp, ps, snap, lst, sv]
    conns = [
        Conn(cp, 'R', ps, 'L', 'own', at_a=78, at_b=78, ca='1', cb='1', label='snapshots', lside='B'),
        Conn(ps, 'R', snap, 'L', 'own', at_a=78, at_b=78, ca='1', cb='1..*', label='list()', lside='B'),
        Conn(ps, 'B', lst, 'T', 'ref', at_a=460, at_b=460, label='reads', lside='L'),
        Conn(ps, 'B', sv, 'T', 'ref', at_a=556, at_b=sv.cx, mid=ps.b + 32, label='create()', seg=2, lside='R'),
    ]
    callouts = [(C[0], y2 + 8, ['A snapshot is its position in the list:', 'removing one renumbers the later ones.', 'Not the same as getSnapshot().'])]
    return dict(slug='domain-snapshots', title='Pedalboard snapshots', eyebrow='Data model · snapshots',
                h1='Snapshots: saved sets of plugin values inside one pedalboard',
                desc='The running pedalboard has PedalboardSnapshots, a list of Snapshot objects identified by position; the names come from GET /snapshot/list and new ones from GET /snapshot/saveas.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'wire', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_banks():
    cl = at(Ent('cl', 'stub', 'ModUiClient', note='architecture diagram', w=224), C[0], 48)
    ba = at(Ent('ba', 'class', 'BanksApi', sub='client.banks', w=224, ops=['list() · get(title)', 'create(title, pedalboards?)', 'move(bank, toIndex)', 'replaceAll(banks)']), C[1], 48)
    bank = at(Ent('bank', 'class', 'Bank', focal=True, w=224, fields=['title: string', 'index: number', 'pedalboards: PedalboardReference[]'],
                  ops=['rename(title) · delete()', 'add(ref, { at, copyFactory })', 'remove(ref | index)', 'move(from, to)', 'setPedalboards(refs)']), C[2], 48)
    y2 = max(ba.b, bank.b) + 88
    bi = at(Ent('bi', 'wire', 'BankInput', sub='POST /banks/save', w=224, fields=['title: string', 'pedalboards: { bundle, title }[]']), C[0], y2)
    bs = at(Ent('bs', 'wire', 'BankSummary', sub='GET /banks', w=224, fields=['title: string', 'pedalboards: PedalboardSummary[]', '…extra properties are kept']), C[1], y2)
    ref = at(Ent('ref', 'stub', 'PedalboardReference', note='pedalboard diagram', w=224), C[2], y2)
    ents = [cl, ba, bank, bi, bs, ref]
    conns = [
        Conn(cl, 'R', ba, 'L', 'own', at_a=78, at_b=78, ca='1', cb='1', label='banks', lside='B'),
        Conn(ba, 'R', bank, 'L', 'ref', at_a=78, at_b=78, ca='1', cb='0..*', label='creates', lside='B'),
        Conn(bank, 'B', ref, 'T', 'own', at_a=808, at_b=808, ca='1', cb='0..*', label='pedalboards', lside='R'),
        Conn(ba, 'B', bs, 'T', 'ref', at_a=480, at_b=480, label='reads', lside='R'),
        Conn(ba, 'B', bi, 'T', 'ref', at_a=404, at_b=bi.cx, mid=ba.b + 32, label='writes', seg=2, lside='R'),
    ]
    callouts = [(C[1], bs.b + 44, ['Every edit reads the whole list, changes the', 'copy and writes it back: last write wins.'])]
    return dict(slug='domain-banks', title='Banks', eyebrow='Data model · banks',
                h1='Banks: ordered lists of pedalboards, edited as a whole',
                desc='BanksApi reads banks as BankSummary and writes the whole list as BankInput; a Bank holds an ordered list of pedalboard references.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'wire', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_overview():
    X = [36, 276, 516, 756]
    Y = [48 + k * 144 for k in range(4)]
    def box(key, name, sub, c, r, focal=False):
        return at(Ent(key, 'class', name, sub=sub, w=168, focal=focal), X[c], Y[r])
    bank = box('bank', 'Bank', 'client.banks', 0, 0)
    pb = box('pb', 'Pedalboard', 'saved in the library', 1, 0)
    dev = box('dev', 'Device', 'client.device', 2, 0)
    plug = box('plug', 'Plugin', 'installed on the device', 3, 0)
    snap = box('snap', 'Snapshot', 'values of the pedalboard', 1, 1)
    cp = box('cp', 'CurrentPedalboard', 'the one that is running', 2, 1)
    conn = box('conn', 'Connection', 'output to input', 1, 2)
    pi = box('pi', 'PluginInstance', 'one block of the graph', 2, 2, focal=True)
    param = box('param', 'Param', 'control port, a number', 1, 3)
    patch = box('patch', 'PatchParam', 'typed value, no port', 2, 3)
    pres = box('pres', 'Preset', 'named set of values', 3, 3)
    ents = [bank, pb, dev, plug, snap, cp, conn, pi, param, patch, pres]
    ym2 = pi.b + 28
    conns = [
        Conn(bank, 'R', pb, 'L', 'own', ca='0..*', cb='0..*', label='holds', lside='B'),
        Conn(dev, 'L', pb, 'R', 'ref', label='load()', lside='B'),
        Conn(dev, 'R', plug, 'L', 'own', ca='1', cb='0..*', label='catalogue', lside='B'),
        Conn(dev, 'B', cp, 'T', 'own', ca='1', cb='1', label='runs', lside='R'),
        Conn(cp, 'L', snap, 'R', 'own', ca='1', cb='1..*', label='snapshots', lside='B'),
        Conn(cp, 'B', conn, 'T', 'own', at_a=cp.x + 56, at_b=conn.cx, mid=cp.b + 28, ca='1', cb='0..*', label='connections', seg=2, lside='R'),
        Conn(cp, 'B', pi, 'T', 'own', at_a=cp.cx, at_b=pi.cx, ca='1', cb='0..*', label='plugins', lside='R'),
        Conn(pi, 'R', plug, 'B', 'ref', at_a=pi.y + 28, at_b=plug.cx, ca='0..*', cb='1', label='instance of'),
        Conn(pi, 'B', param, 'T', 'own', at_a=pi.x + 40, at_b=param.cx, mid=ym2, ca='1', cb='0..*', label='params', seg=2, lside='R'),
        Conn(pi, 'B', patch, 'T', 'own', at_a=pi.cx, at_b=patch.cx, ca='1', cb='0..*', label='patchParams', lside='R'),
        Conn(pi, 'B', pres, 'T', 'own', at_a=pi.x + 128, at_b=pres.cx, mid=ym2, ca='1', cb='0..*', label='presets', seg=2, lside='R'),
    ]
    callouts = [(36, 330, ['Each box has its own diagram', 'below, with fields and operations.'])]
    return dict(slug='domain-overview', title='Data model overview', eyebrow='Data model · overview',
                h1='How the objects of modui-client relate to each other',
                desc='A bank holds pedalboards; the device loads a pedalboard, lists the installed plugins and runs the current pedalboard, which has snapshots, connections and plugin instances; an instance has params, patch params and presets.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'focal'], lines=['own', 'ref'], W=960)


# order = order of the gallery (index.html)
SPECS = [architecture, d_overview, d_pedalboard, d_bundle, d_device, d_current, d_plugin, d_patch, d_presets, d_snapshots, d_banks]
