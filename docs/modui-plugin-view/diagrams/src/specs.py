"""Definitions of the diagrams of docs/modui-plugin-view.md (sections 2 and 4): the single place to edit them.

Same format as docs/modui-client/diagrams/src/specs.py (see ../../../modui-client/diagrams/README.md): each function returns one diagram as a dict
(slug, title, desc, ents, conns, kinds, lines, callouts; an architecture diagram also has zones, groups and bottom).
Run `python3 docs/modui-plugin-view/diagrams/src/build.py`; it prints geometry warnings.
"""
from engine import *

C = [40, 368, 696]   # x of the three columns of a 960-wide domain diagram (224 wide, 104 apart)


def architecture():
    W, NW, NH = 1040, 160, 80
    z = [40, 296, 552, 808]
    nx = [x + 16 for x in z]
    r = [112, 232, 352]
    app = Node('app', 'app', 'Your application', ['React · Vue · vanilla JS', 'places icon and settings'], nx[0], r[1], NW, NH)
    views = Node('views', 'client', 'PluginViews', ['once per client', 'files · styles · outputs'], nx[1], r[0], NW, NH)
    view = Node('view', 'client', 'PluginView', ['icon · settings', 'widgets · plugin script'], nx[1], r[1], NW, NH, focal=True)
    backend = Node('backend', 'client', 'ViewBackend', ['LiveBackend: client', 'PreviewBackend: memory'], nx[1], r[2], NW, NH)
    client = Node('client', 'client', 'ModUiClient', ['client.events', 'client.device'], nx[2], r[0], NW, NH)
    inst = Node('inst', 'client', 'PluginInstance', ['params · patch · presets', 'setValue() · setActive()'], nx[2], r[2], NW, NH)
    files = Node('files', 'http', 'Modgui files', ['/effect/file · /resources', 'templates · css · script'], nx[3], r[1], NW, NH)
    web = Node('web', 'http', 'Webserver', ['/websocket · HTTP', 'param_set · patch_set'], nx[3], r[2], NW, NH)
    ents = [app, views, view, backend, client, inst, files, web]
    zones = '\n'.join([
        zone(z[0], r[1] - 40, 192, 160, 'APPLICATION'),
        zone(z[1], 72, 192, 376, 'MODUI-PLUGIN-VIEW'),
        zone(z[2], 72, 192, 376, 'MODUI-CLIENT'),
        zone(z[3], r[1] - 40, 192, 256, 'MOD-UI SERVER'),
    ])
    conns = [
        Conn(app, 'R', views, 'L', 'call', at_a=r[1] + 24, at_b=r[0] + 40, mid=264, label='create()', seg=1, lside='L'),
        Conn(app, 'R', view, 'L', 'call', at_a=r[1] + 56, at_b=r[1] + 56, label='on()'),
        Conn(views, 'B', view, 'T', 'call', label='creates', lside='R'),
        Conn(view, 'B', backend, 'T', 'call', label='uses', lside='R'),
        Conn(views, 'R', client, 'L', 'call', at_a=r[0] + 24, at_b=r[0] + 24, label='output_set', lside='B'),
        Conn(views, 'R', files, 'L', 'http', at_a=r[0] + 56, at_b=r[1] + 40, mid=520, seg=1, label='fetch', lside='L'),
        Conn(backend, 'R', inst, 'L', 'call', at_a=r[2] + 24, at_b=r[2] + 24, label='writes'),
        Conn(inst, 'L', backend, 'R', 'push', at_a=r[2] + 56, at_b=r[2] + 56, label='events', lside='B'),
        Conn(inst, 'R', web, 'L', 'ws', at_a=r[2] + 40, at_b=r[2] + 40, label='ws'),
    ]
    groups = [('APPLICATION', ['app']), ('MODUI-PLUGIN-VIEW', ['views', 'view', 'backend']), ('MODUI-CLIENT', ['client', 'inst']), ('MOD-UI SERVER', ['files', 'web'])]
    return dict(slug='architecture', title='modui-plugin-view architecture', eyebrow='Architecture · modui-plugin-view',
                h1='Where modui-plugin-view sits between your application and mod-ui', W=W, ents=ents, conns=conns, zones=zones, bottom=448, groups=groups,
                desc='Your application creates views with PluginViews, which fetches the modgui files from mod-ui; a PluginView writes through a ViewBackend to a PluginInstance of modui-client and receives its events back; modui-plugin-view imports only types from modui-client.',
                kinds=['app', 'client', 'http'], lines=['call', 'http', 'push', 'ws'], line_labels={'push': 'Events pushed back to the view'},
                callouts=[(56, 372, ['modui-plugin-view imports only types', 'from modui-client: your client is the', 'only copy, so there is one socket.'])])


def d_overview():
    W = 960
    X = [36, 276, 516, 756]
    Y = [48 + k * 144 for k in range(3)]

    def box(key, name, sub, c, r, focal=False, kind='class'):
        return at(Ent(key, kind, name, sub=sub, w=168, focal=focal), X[c], Y[r])
    views = box('views', 'PluginViews', 'once per client', 1, 0, focal=True)
    assets = box('assets', 'PluginGui', 'plugin.gui, from modui-client', 0, 0, kind='stub')
    styles = box('styles', 'StyleManager', 'global stylesheets', 2, 0)
    view = box('view', 'PluginView', 'icon and settings', 1, 1)
    prep = box('prep', 'PreparedPlugin', 'the template data', 0, 1)
    widget = box('widget', 'Widget', 'knob, switch, select...', 2, 1)
    backend = box('backend', 'ViewBackend', 'live or preview', 1, 2)
    runner = box('runner', 'ScriptRunner', 'the plugin script', 0, 2)
    inst = box('inst', 'PluginInstance', 'from modui-client', 2, 2, kind='stub')
    ents = [views, assets, styles, view, prep, widget, backend, runner, inst]
    ym = view.b + 28
    conns = [
        Conn(views, 'L', assets, 'R', 'ref', label='reads', lside='B'),
        Conn(views, 'R', styles, 'L', 'ref', label='links', lside='B'),
        Conn(views, 'B', view, 'T', 'own', ca='1', cb='0..*', label='creates', lside='R'),
        Conn(view, 'L', prep, 'R', 'own', ca='1', cb='1', label='renders', lside='B'),
        Conn(view, 'R', widget, 'L', 'own', ca='1', cb='0..*', label='widgets', lside='B'),
        Conn(view, 'B', backend, 'T', 'own', at_a=view.cx + 28, at_b=backend.cx + 28, ca='1', cb='1', label='backend', lside='R'),
        Conn(view, 'B', runner, 'T', 'own', at_a=view.x + 40, at_b=runner.cx, mid=ym, ca='1', cb='0..1', label='script', seg=2, lside='R'),
        Conn(backend, 'R', inst, 'L', 'ref', at_a=backend.y + 28, at_b=backend.y + 28, ca='1', cb='0..1', label='live only', lside='B'),
    ]
    callouts = [(756, 76, ['A view owns its widgets,', 'its backend and its script;', 'you only hold the view.'])]
    return dict(slug='domain-overview', title='modui-plugin-view overview', eyebrow='Data model · overview',
                h1='How the objects of modui-plugin-view relate to each other',
                desc='PluginViews reads the modgui files through the client\'s PluginGui, links stylesheets and creates PluginViews; a PluginView owns its rendered template data, widgets, a backend that is live or a preview, and the plugin script.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'stub', 'focal'], lines=['own', 'ref'], W=W)


def d_views():
    opts = at(Ent('opts', 'data', 'PluginViewsOptions', w=224, sub='all optional',
                  fields=['jQuery?: function', 'mustache?: render function', 'fetch?: function', 'styles?: boolean | StyleOptions', 'document?: Document', 'promptName?: function', 'scripts?: boolean']), C[0], 48)
    views = at(Ent('views', 'class', 'PluginViews', focal=True, w=224, sub='new PluginViews(client, options?)',
                   ops=['create(target, options?)', 'list() · clearCache()', 'on("error") · destroy()']), C[1], 48)
    copts = at(Ent('copts', 'data', 'CreateViewOptions', w=224, sub='per view', fields=['bypassed?: boolean', 'values?: { symbol: number }', 'scripts?: boolean']), C[2], 48)
    y2 = max(opts.b, views.b, copts.b) + 88
    assets = at(Ent('assets', 'stub', 'PluginGui', note='modui-client: plugin.gui', w=224), C[0], y2)
    view = at(Ent('view', 'stub', 'PluginView', note='view diagram', w=224), C[1], y2)
    styles = at(Ent('styles', 'internal', 'StyleManager', w=224, ops=['ensureGlobals(options)', 'ensurePlugin(key, css)']), C[2], y2)
    ents = [opts, views, copts, assets, view, styles]
    ym = max(opts.b, views.b, copts.b) + 32
    conns = [
        Conn(views, 'L', opts, 'R', 'ref', at_a=78, at_b=78, label='options', lside='B'),
        Conn(views, 'R', copts, 'L', 'ref', at_a=78, at_b=78, label='create()', lside='B'),
        Conn(views, 'B', assets, 'T', 'ref', at_a=412, at_b=assets.cx, mid=ym, label='reads files', seg=2, lside='R'),
        Conn(views, 'B', view, 'T', 'own', at_a=480, at_b=480, ca='1', cb='0..*', label='creates', lside='R'),
        Conn(views, 'B', styles, 'T', 'own', at_a=548, at_b=styles.cx, mid=ym, ca='1', cb='0..1', label='styles', seg=2, lside='R'),
    ]
    callouts = [(C[1], y2 + 80, ['target: a PluginInstance gives a live view;', 'a Plugin, a PluginInfo or a URI gives a preview.'])]
    return dict(slug='domain-views', title='PluginViews', eyebrow='Data model · PluginViews',
                h1='PluginViews: the factory, its options and where its files come from',
                desc='PluginViews, configured by PluginViewsOptions, creates PluginView objects from CreateViewOptions; it reads the modgui files through the client\'s PluginGui and links the global stylesheets through a StyleManager.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'data', 'internal', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_view():
    views = at(Ent('views', 'stub', 'PluginViews', note='PluginViews diagram', w=224), C[0], 48)
    view = at(Ent('view', 'class', 'PluginView', focal=True, w=224,
                  fields=['icon: HTMLElement', 'settings: HTMLElement', 'uri: string', 'info: PluginInfo', 'instance: PluginInstance | null', 'live · alive: boolean', 'active: boolean', 'preset: string | null'],
                  ops=['getValue · setValue(symbol, v)', 'getPatchValue · setPatchValue', 'setActive(active) · getOutput', 'on(event) · destroy()']), C[1], 48)
    events = at(Ent('events', 'data', 'ViewEvents', w=224, sub='first four carry an origin',
                    fields=['change: symbol, value', 'patch: uri, value', 'active: active', 'preset: preset', 'output: symbol, value', 'close: settings Close button', 'error: error, context, uri', 'destroyed: reason']), C[2], 48)
    y2 = view.b + 88
    widget = at(Ent('widget', 'stub', 'Widget', note='widgets diagram', w=224), C[0], y2)
    backend = at(Ent('backend', 'stub', 'ViewBackend', note='backend diagram', w=224), C[1], y2)
    origin = at(Ent('origin', 'data', 'ViewOrigin', w=224, fields=['user: a gesture on this view', 'script: the plugin script', 'api: a call to the view', 'external: anything else']), C[2], max(events.b, y2) + 56)
    ents = [views, view, events, widget, backend, origin]
    ym = view.b + 32
    conns = [
        Conn(views, 'R', view, 'L', 'own', at_a=78, at_b=78, ca='1', cb='0..*', label='creates', lside='B'),
        Conn(view, 'R', events, 'L', 'ref', at_a=78, at_b=78, label='emits', lside='B'),
        Conn(view, 'B', widget, 'T', 'own', at_a=412, at_b=widget.cx, mid=ym, ca='1', cb='0..*', label='widgets', seg=2, lside='R'),
        Conn(view, 'B', backend, 'T', 'own', at_a=480, at_b=480, ca='1', cb='1', label='backend', lside='R'),
        Conn(events, 'B', origin, 'T', 'ref', at_a=808, at_b=808, label='origin', lside='R'),
    ]
    callouts = [(C[0], y2 + 100, ['Every change says who caused it, so', 'your UI can ignore its own gestures.'])]
    return dict(slug='domain-view', title='PluginView', eyebrow='Data model · PluginView',
                h1='PluginView: the two elements you place, and the events it emits',
                desc='A PluginView exposes the icon and settings elements, reads and writes values, and emits change, patch, active, preset, output, close, error and destroyed events; four of them carry a ViewOrigin.',
                ents=ents, conns=conns, callouts=callouts, kinds=['class', 'data', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_backend():
    view = at(Ent('view', 'stub', 'PluginView', note='view diagram', w=224), C[1], 48)
    y1 = view.b + 72
    live = at(Ent('live', 'class', 'LiveBackend', w=224, fields=['wraps a PluginInstance', 'writes through the client', 'follows instance.on(...)']), C[0], y1)
    vb = at(Ent('vb', 'class', 'ViewBackend', focal=True, w=224, sub='interface',
                fields=['live: boolean', 'instance: PluginInstance | null', 'presets: PresetBackend | null'],
                ops=['portValue(symbol, fallback)', 'patchValue(uri) · preset()', 'active() · setPort(symbol, v)', 'setActive · setPatch · refreshPatch', 'subscribe(listener)']), C[1], y1)
    prev = at(Ent('prev', 'class', 'PreviewBackend', w=224, fields=['values kept in memory', 'nothing is sent', 'no presets']), C[2], y1)
    y2 = vb.b + 88
    inst = at(Ent('inst', 'stub', 'PluginInstance', note='modui-client', w=224), C[0], y2)
    listener = at(Ent('listener', 'data', 'BackendListener', w=224, fields=['param(symbol, value)', 'active(active)', 'patch(uri, value)', 'preset(uri)', 'presetList(presets)', 'removed(reason)']), C[1], y2)
    pb = at(Ent('pb', 'data', 'PresetBackend', w=224, fields=['list()', 'load(uri) · create(name)', 'save(uri, name?)', 'delete(uri)']), C[2], y2)
    ents = [view, live, vb, prev, inst, listener, pb]
    conns = [
        Conn(view, 'B', vb, 'T', 'own', at_a=480, at_b=480, ca='1', cb='1', label='backend', lside='R'),
        Conn(live, 'R', vb, 'L', 'ref', at_a=y1 + 40, at_b=y1 + 40, label='implements', lside='B'),
        Conn(prev, 'L', vb, 'R', 'ref', at_a=y1 + 40, at_b=y1 + 40, label='implements', lside='B'),
        Conn(live, 'B', inst, 'T', 'ref', at_a=152, at_b=152, ca='1', cb='1', label='wraps', lside='R'),
        Conn(vb, 'B', listener, 'T', 'ref', at_a=412, at_b=412, label='subscribe', lside='R'),
        Conn(vb, 'B', pb, 'T', 'own', at_a=548, at_b=pb.cx, mid=vb.b + 32, ca='1', cb='0..1', label='presets', seg=2, lside='R'),
    ]
    return dict(slug='domain-backend', title='ViewBackend', eyebrow='Data model · backends',
                h1='One interface, two backends: a live instance or local values',
                desc='A PluginView talks to a ViewBackend; LiveBackend wraps a PluginInstance of modui-client and PreviewBackend keeps the values in memory; the backend notifies a BackendListener and may offer a PresetBackend.',
                ents=ents, conns=conns, callouts=[], kinds=['class', 'data', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_widgets():
    view = at(Ent('view', 'stub', 'PluginView', note='view diagram', w=224), C[0], 48)
    widget = at(Ent('widget', 'class', 'Widget', focal=True, w=224, sub='interface', fields=['element: HTMLElement'], ops=['setValue(value, onlyGui?)', 'enable() · disable()', 'destroy()']), C[1], 48)
    host = at(Ent('host', 'data', 'WidgetHost', w=224, sub='what the view gives a widget', fields=['change(value)', 'imageSize(url)', 'specialUri?(value)']), C[2], 48)
    y2 = max(widget.b, host.b) + 88
    step = at(Ent('step', 'class', 'StepModel', w=224, sub='the step arithmetic', fields=['minimum · maximum: number', 'enumeration · integer: boolean', 'logarithmic · toggled: boolean', 'scalePoints · portSteps']), C[0], y2)
    widgets = at(Ent('widgets', 'class', 'Widgets', w=224, sub='createWidget(element, spec, host)',
                     fields=['film: filmstrip or rotation', 'switch: footswitch, momentary', 'bypass: the bypass switch', 'select: scale points', 'custom-select: list drawn by pedal', 'custom-select-path: files', 'string: text field']), C[1], y2)
    spec = at(Ent('spec', 'data', 'ControlSpec', w=224, sub='one control of the template data',
                  fields=['kind: port | parameter | ...', 'key · name · comment', 'ranges: min, max, default', 'properties: string[]', 'scalePoints · units · format']), C[2], y2)
    ents = [view, widget, host, step, widgets, spec]
    conns = [
        Conn(view, 'R', widget, 'L', 'own', at_a=78, at_b=78, ca='1', cb='0..*', label='widgets', lside='B'),
        Conn(widget, 'R', host, 'L', 'ref', at_a=78, at_b=78, label='calls', lside='B'),
        Conn(widgets, 'T', widget, 'B', 'ref', at_a=480, at_b=480, label='implements', lside='R'),
        Conn(widgets, 'L', step, 'R', 'ref', at_a=y2 + 40, at_b=y2 + 40, label='film uses', lside='B'),
        Conn(widgets, 'R', spec, 'L', 'ref', at_a=y2 + 40, at_b=y2 + 40, label='built from', lside='B'),
    ]
    return dict(slug='domain-widgets', title='Widgets', eyebrow='Data model · widgets',
                h1='Widgets: how a control of the template becomes something you can move',
                desc='Widgets implement the Widget interface, are built from a ControlSpec and a WidgetHost, and the film and select widgets use a StepModel for the step arithmetic.',
                ents=ents, conns=conns, callouts=[], kinds=['class', 'data', 'stub', 'focal'], lines=['own', 'ref'], W=960)


def d_template():
    inputs = at(Ent('inputs', 'data', 'TemplateInputs', w=224, sub='buildTemplateData(inputs)', fields=['info: PluginInfo', 'version: string', 'presets?: PluginPresetInfo[]', 'files?: Map<string, FileList>']), C[1], 48)
    prep = at(Ent('prep', 'data', 'PreparedPlugin', focal=True, w=224, fields=['data: the Mustache view', 'effect: PreparedEffect', 'controls: Map<symbol, ControlSpec>', 'parameters: Map<uri, ControlSpec>']), C[1], inputs.b + 72)
    gui = at(Ent('gui', 'data', 'GuiFiles', w=224, sub='PluginGui.getAll() (client)', fields=['iconTemplate: string | null', 'settingsTemplate: string | null', 'stylesheet · javascript', 'errors: file, error']), C[0], prep.y)
    eff = at(Ent('eff', 'data', 'PreparedEffect', w=224, fields=['uri · name: string', 'ports: audio, control, cv, midi', 'all_control_in_ports', 'parameters: WireParameter[]', 'gui · renderedVersion', 'presets: PluginPresetInfo[]']), C[2], prep.y)
    spec = at(Ent('spec', 'data', 'ControlSpec', w=224, fields=['kind · key · name', 'ranges · units · format', 'scalePoints · properties', 'files?: FileEntry[]']), C[1], max(prep.b, eff.b, gui.b) + 72)
    files = at(Ent('files', 'data', 'FileEntry', w=224, sub='GET /files/list', fields=['fullname · basename: string', 'dirname: string', 'basepath? · filetype?', 'icon?: HTML']), C[2], spec.y)
    ents = [inputs, prep, gui, eff, spec, files]
    conns = [
        Conn(inputs, 'B', prep, 'T', 'ref', at_a=480, at_b=480, label='builds', lside='R'),
        Conn(prep, 'R', eff, 'L', 'own', at_a=prep.y + 40, at_b=prep.y + 40, ca='1', cb='1', label='effect', lside='B'),
        Conn(prep, 'B', spec, 'T', 'own', at_a=480, at_b=480, ca='1', cb='0..*', label='controls', lside='R'),
        Conn(spec, 'R', files, 'L', 'own', at_a=spec.y + 40, at_b=spec.y + 40, ca='1', cb='0..*', label='files', lside='B'),
        Conn(gui, 'R', prep, 'L', 'ref', at_a=prep.y + 40, at_b=prep.y + 40, label='rendered with', lside='B'),
    ]
    callouts = [(C[0], spec.y + 8, ['The icon and settings templates (the', "plugin's own or the default ones) are", 'rendered with prepared.data (Mustache).'])]
    return dict(slug='domain-template-data', title='Template data', eyebrow='Data model · template data',
                h1='From the plugin description to the data its templates are rendered with',
                desc='buildTemplateData turns TemplateInputs into a PreparedPlugin with the Mustache data, a PreparedEffect and one ControlSpec per control; the GuiFiles templates are rendered with it.',
                ents=ents, conns=conns, callouts=callouts, kinds=['data', 'focal'], lines=['own', 'ref'], W=960)


def d_script():
    view = at(Ent('view', 'stub', 'PluginView', note='view diagram', w=224), C[0], 48)
    runner = at(Ent('runner', 'internal', 'ScriptRunner', focal=True, w=224, fields=['active: boolean', 'icon · settings: jQuery objects'], ops=['start(values)', 'change(change)', 'end()']), C[1], 48)
    cb = at(Ent('cb', 'data', 'ScriptCallback', w=224, sub='compileScript(code)', fields=['(event, funcs) => void', 'event: start | change | end', 'event.icon · event.settings']), C[2], 48)
    y2 = max(runner.b, cb.b) + 88
    funcs = at(Ent('funcs', 'data', 'ScriptFuncs', w=224, fields=['set_port_value(symbol, v)', 'patch_get(uri)', 'patch_set(uri, type, v)', 'get_custom_resource_filename', 'get_port_index_for_symbol', 'get_port_symbol_for_index']), C[1], y2)
    start = at(Ent('start', 'data', 'ScriptStart', w=224, fields=['ports: { symbol, value }[]', 'parameters: { uri, value }[]']), C[2], y2)
    ents = [view, runner, cb, funcs, start]
    conns = [
        Conn(view, 'R', runner, 'L', 'own', at_a=78, at_b=78, ca='1', cb='0..1', label='script', lside='B'),
        Conn(runner, 'R', cb, 'L', 'ref', at_a=78, at_b=78, label='calls', lside='B'),
        Conn(runner, 'B', funcs, 'T', 'ref', at_a=480, at_b=480, label='passes', lside='R'),
        Conn(runner, 'B', start, 'T', 'ref', at_a=556, at_b=start.cx, mid=runner.b + 32, label='start', seg=2, lside='R'),
    ]
    callouts = [(C[0], y2 + 8, ['The script needs jQuery. One that throws', 'is switched off for that view and', 'view.on("error") says so.'])]
    return dict(slug='domain-script', title='Plugin script', eyebrow='Data model · plugin script',
                h1='The plugin script: what it receives and what it can call',
                desc='A ScriptRunner compiles the modgui JavaScript into a ScriptCallback and calls it with start, change and end events and with ScriptFuncs to write values; start carries the current values as ScriptStart.',
                ents=ents, conns=conns, callouts=callouts, kinds=['data', 'internal', 'stub', 'focal'], lines=['own', 'ref'], W=960)


# order = order of the gallery (index.html)
SPECS = [architecture, d_overview, d_views, d_view, d_backend, d_widgets, d_template, d_script]
