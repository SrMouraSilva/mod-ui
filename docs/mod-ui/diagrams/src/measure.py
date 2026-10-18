"""Measurements behind the diagrams of docs/mod-ui.md: everything that is a number is counted here, from the working tree.

Standard library only. `python3 docs/mod-ui/diagrams/src/measure.py` prints every figure (so the guide can quote them).
The method of each count is the regular expression or the file list in this file; docs/mod-ui.md section 18 repeats it in words.
"""
import ast
import collections
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[4]


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8', errors='ignore')


def lines(rel):
    return read(rel).count('\n')


def tracked(*patterns):
    """Tracked files that match the shell-style patterns, directly inside the directory of the pattern (a pattern never goes into sub-folders)."""
    out = subprocess.run(['git', 'ls-files', *patterns], cwd=ROOT, capture_output=True, text=True).stdout.split()
    dirs = {os.path.dirname(pat) for pat in patterns}
    return [p for p in out if (ROOT / p).exists() and os.path.dirname(p) in dirs]


# ------------------------------------------------------------------------------------------------------------------- size
def loc():
    """Lines per source file, grouped by layer. Libraries, generated code, tests and docs are left out."""
    groups = collections.OrderedDict()
    groups['py'] = [p for p in tracked('mod/*.py', 'modtools/*.py', 'server.py')]
    groups['cpp'] = [p for p in tracked('utils/*.cpp', 'utils/*.h') if not p.endswith('test.cpp')]
    groups['js'] = [p for p in tracked('html/js/*.js')]
    groups['html'] = [p for p in tracked('html/*.html', 'html/include/*.html') if not p.endswith(('country_list.html', 'desktop-pp.html', 'desktop-tou.html'))]
    return {g: {p: lines(p) for p in ps} for g, ps in groups.items()}


# ------------------------------------------------------------------------------------------------------------------- imports
def import_edges():
    """Module-level imports between the Python modules of mod/ and modtools/ (and server.py): {module: {imported module}}."""
    files = {}
    for p in tracked('mod/*.py', 'modtools/*.py', 'server.py'):
        name = p[:-3]
        files[name] = read(p)
    names = set(files) | {'mod/communication'}
    edges = collections.defaultdict(set)
    for name, src in files.items():
        for n in ast.walk(ast.parse(src)):
            targets = []
            if isinstance(n, ast.ImportFrom) and n.module:
                if n.module in ('mod', 'modtools'):
                    # `from mod import hostinfo` names a module; `from mod import safe_json_load` names a helper of mod/__init__.py
                    for a in n.names:
                        targets.append(n.module + '/' + a.name if n.module + '/' + a.name in names else n.module + '/__init__')
                else:
                    targets.append(n.module.replace('.', '/'))
            elif isinstance(n, ast.Import):
                targets += [a.name.replace('.', '/') for a in n.names]
            for t in targets:
                if not t.startswith(('mod', 'modtools')):
                    continue
                if t.startswith('mod/communication'):
                    t = 'mod/communication'
                if t in names and t != name:
                    edges[name].add(t)
    return edges


# ------------------------------------------------------------------------------------------------------------------- device branches
DEVICE_PATTERNS = collections.OrderedDict([   # name -> (regular expression, flags): a line that matches counts once
    ('Duo', (r"\bduo\b|modduo|_MOD_DEVICE_DUO\b|CMD_DUO_", re.I)),
    ('Duo X', (r"duox|duo x\b", re.I)),
    ('Dwarf', (r"dwarf", re.I)),
    ('x86-64', (r"_MOD_DEVICE_X86_64", 0)),
    ('Desktop', (r"\bDESKTOP\b|_MOD_DESKTOP|desktop_app|using_desktop|USING_MOD_DESKTOP|DesktopApp|desktop-app", 0)),
])
DEVICE_LAYERS = collections.OrderedDict([
    ('libmod_utils (C++)', ['utils/utils_jack.cpp', 'utils/utils_lilv.cpp', 'utils/utils.h']),
    ('HMI schema · mod_protocol.py', ['mod/mod_protocol.py']),
    ('Host · host.py', ['mod/host.py']),
    ('HMI driver · hmi.py', ['mod/hmi.py']),
    ('Audio profile · profile.py', ['mod/profile.py']),
    ('Webserver · session', ['mod/webserver.py', 'mod/session.py', 'mod/screenshot.py', 'mod/settings.py']),
    ('Browser · html/', ['html/js/desktop-app.js', 'html/js/hardware.js', 'html/js/desktop.js', 'html/index.html', 'html/settings.html', 'html/store.html']),
])


def device_branches():
    """Lines that name a device or the Desktop build, per layer and device. {layer: {device: count}}."""
    out = collections.OrderedDict()
    for layer, files in DEVICE_LAYERS.items():
        row = collections.OrderedDict()
        for dev, (pat, flags) in DEVICE_PATTERNS.items():
            n = 0
            for f in files:
                n += sum(1 for line in read(f).splitlines() if re.search(pat, line, flags))
            row[dev] = n
        out[layer] = row
    return out


# ------------------------------------------------------------------------------------------------------------------- hardware descriptor
def descriptor_flags():
    """Keys of the hardware descriptor JSON that the Python code reads, with the number of reads and the files."""
    pat = re.compile(r"(?:descriptor|hwdesc|hw_desc|desc|get_hardware_descriptor\(\))\.get\(\s*['\"]([A-Za-z_\-]+)['\"]")
    flags = collections.defaultdict(lambda: [0, set()])
    for p in tracked('mod/*.py'):
        for m in pat.finditer(read(p)):
            flags[m.group(1)][0] += 1
            flags[m.group(1)][1].add(os.path.basename(p))
    return dict(flags)


# ------------------------------------------------------------------------------------------------------------------- coupling to the OS image
PY = ['mod/addressings.py', 'mod/bank.py', 'mod/control_chain.py', 'mod/hmi.py', 'mod/host.py', 'mod/profile.py', 'mod/protocol.py',
      'mod/recorder.py', 'mod/screenshot.py', 'mod/session.py', 'mod/settings.py', 'mod/webserver.py', 'mod/__init__.py', 'mod/development.py',
      'mod/hostinfo.py', 'mod/tuner.py', 'modtools/utils.py', 'modtools/pedalboard.py', 'modtools/tempo.py', 'mod/communication/device.py']

COUPLING = collections.OrderedDict([
    ('Shell-outs (mod-amixer, systemctl, tar, reboot, ...)', (PY, r"\b(os\.system|subprocess\.(Popen|run|getoutput|check_output)|getoutput|run_command)\(", 'call sites')),
    ('Fixed paths of the OS image (/data /root /etc/mod /usr/bin /usr/share /sys /proc)', (PY, r"[\"'](/data/|/root/|/etc/mod|/usr/(bin|share)/|/sys/|/proc/)", 'string literals')),
    ('Fixed JACK client names (mod-monitor, mod-host, ttymidi, ...)', (['mod/host.py', 'utils/utils_jack.cpp'], r"[\"'](mod-monitor|mod-host|mod-peakmeter|mod-midi-merger|mod-midi-broadcaster|mod-spi2jack|mod-jack2spi|mod-external|mod-usbgadget|ttymidi|nooice|fake-input|system:(capture|playback)|mod-peakmeter)", 'string literals')),
    ('Hardware-descriptor reads (what the device is allowed to do)', (['mod/addressings.py', 'mod/host.py', 'mod/hmi.py', 'mod/session.py', 'mod/webserver.py'], r"(descriptor|hwdesc|hw_desc|desc)\.get\(\s*['\"][A-Za-z_\-]+['\"]", 'reads')),
    ('Device or build names (DUO, DUOX, DWARF, DESKTOP, ...)', (PY + ['utils/utils_jack.cpp', 'utils/utils_lilv.cpp'], r"\bDESKTOP\b|\"(MODDUO|DUOX|DWARF|dwarf)\"|'(DUO|DUOX|DWARF)'|_MOD_DEVICE_[A-Z0-9_]+|_MOD_DESKTOP", 'mentions')),
])


def coupling():
    out = collections.OrderedDict()
    for name, (files, pat, unit) in COUPLING.items():
        n = 0
        for f in files:
            if not (ROOT / f).exists():
                continue
            for line in read(f).splitlines():
                if line.lstrip().startswith(('def ', '#', '//')):
                    continue
                n += len(re.findall(pat, line))
        out[name] = (n, unit)
    reads = sum(n for n, _ in descriptor_flags().values())
    out['Hardware-descriptor reads (what the device is allowed to do)'] = (reads, 'reads')
    return out


# ------------------------------------------------------------------------------------------------------------------- dependencies
def dependency_usage():
    """How many source files use each third-party piece (Python files that import it; JS files that mention it)."""
    py = {p: read(p) for p in tracked('mod/*.py', 'modtools/*.py', 'server.py')}
    js = {p: read(p) for p in tracked('html/js/*.js')}
    html = {p: read(p) for p in tracked('html/*.html')}

    def pyuse(mod):
        return sum(1 for s in py.values() if re.search(r'^\s*(from|import)\s+%s\b' % mod, s, re.M))

    def jsuse(pat):
        return sum(1 for s in list(js.values()) + list(html.values()) if re.search(pat, s))

    def loaded(name):
        return any(name in s for s in html.values())

    return collections.OrderedDict([
        ('tornado 4.3', pyuse('tornado')),
        ('pyserial 3.0', pyuse('serial')),
        ('Pillow', pyuse('PIL')),
        ('pycryptodomex 3.18', pyuse('Cryptodome')),
        ('jQuery 1.9.1', jsuse(r'\$\(|jQuery')),
        ('jQuery UI 1.10.1', jsuse(r'\.(draggable|droppable|sortable|slider|resizable|dialog|tabs|accordion)\(')),
        ('Mustache 0.5.0-dev', jsuse(r'Mustache')),
        ('Lunr 0.7', jsuse(r'lunr')),
        ('Knockout 2.1.0 (not loaded)', 0 if not loaded('knockout') else 1),
        ('LESS 1.3.0 (not loaded)', 0 if not loaded('less-1.3.0') else 1),
    ])


def route_stats():
    s = read('mod/webserver.py')
    i = s.index('application = web.Application(')
    block = s[i:s.index('def signal_hmi_screenshot')]
    routes = re.findall(r'^\s+\(r"([^"]+)", (\w+)', block, re.M)
    tree = ast.parse(s)
    verbs = {n.name: [f.name for f in n.body if isinstance(f, ast.FunctionDef)] for n in tree.body if isinstance(n, ast.ClassDef)}
    get_only = [c for _, c in routes if verbs.get(c) == ['get'] or (verbs.get(c) and 'get' in verbs[c] and 'post' not in verbs[c])]
    return {'routes': len(routes), 'get_only': len(get_only), 'handlers_with_post': sum(1 for _, c in routes if 'post' in verbs.get(c, []))}


def dead_vendored():
    """Third-party files under html/js/lib that no html page or script loads."""
    cands = ['knockout.js', 'less-1.3.0.min.js', 'n3-browser.min.js', 'json2.js', 'jquery.mCustomScrollbar.js', 'jquery-datatables-editable', 'development-bundle']
    pages = ''.join(read(p) for p in tracked('html/*.html', 'html/js/*.js'))
    dead = []
    size = 0
    for c in cands:
        if (ROOT / 'html/js/lib' / c).exists() and c not in pages:
            dead.append(c)
            for dp, _, fs in os.walk(ROOT / 'html/js/lib' / c):
                size += sum(os.path.getsize(os.path.join(dp, f)) for f in fs)
            if (ROOT / 'html/js/lib' / c).is_file():
                size += (ROOT / 'html/js/lib' / c).stat().st_size
    return dead, size


# ------------------------------------------------------------------------------------------------------------------- the Host class
HMI_EXTRA = {'initialize_hmi', 'reconnect_hmi', 'ping_hmi', 'ping_hmi_start', 'ping_hmi_stop', 'wait_hmi_initialized', 'send_hmi_boot',
             'setNavigateWithFootswitches', 'isBankFootswitchNavigationOn', 'bank_config_enabled_callback', 'load_different_callback', 'set_tuner_value'}


def host_methods():
    """Methods of class Host (mod/host.py) by what they are about, decided by name: hmi_*, addr_*, pedalboard files / snapshots / presets,
    the socket to mod-host, JACK / MIDI / transport, and the rest (plugin graph, session, stats). Returns (counts, total)."""
    tree = ast.parse(read('mod/host.py'))
    host = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Host')
    names = [f.name for f in host.body if isinstance(f, ast.FunctionDef)]

    def cat(n):
        if n.startswith('hmi_') or n in HMI_EXTRA:
            return 'HMI handlers and display'
        if n.startswith('addr_') or 'address' in n or n.startswith('cv_addressing'):
            return 'Addressing'
        if n.startswith(('snapshot', 'preset', 'load_pb', 'save_state', 'save_snapshots', 'load', 'save')):
            return 'Pedalboard files, snapshots, presets'
        if n.startswith(('send_', 'process_', 'open_connection', 'writer_', 'reader_', 'report_current')):
            return 'Socket to mod-host'
        if 'midi' in n or 'jack' in n or n.startswith(('set_transport', 'set_link', 'set_sync', 'set_internal', 'mute', 'unmute')):
            return 'JACK, MIDI, transport'
        return 'Plugin graph, session, stats'
    counts = collections.Counter(cat(n) for n in names)
    return counts, len(names)


def webserver_reach():
    """How much the Tornado handlers reach past the Session: calls of SESSION.host.* and SESSION.hmi.*, names imported from modtools.utils."""
    s = read('mod/webserver.py')
    tree = ast.parse(s)
    utils_names = 0
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module == 'modtools.utils':
            utils_names += len(n.names)
    return {'host_calls': len(re.findall(r'SESSION\.host\.', s)), 'hmi_calls': len(re.findall(r'SESSION\.hmi\.', s)),
            'session_calls': len(re.findall(r'SESSION\.(?!host|hmi|prefs|websockets)', s)), 'utils_names': utils_names}


# ------------------------------------------------------------------------------------------------------------------- what blocks the event loop
BLOCKING = collections.OrderedDict([
    ('os.system()', (r"\bos\.system\(", 'mod/*.py')),
    ('getoutput()', (r"\bgetoutput\(", 'mod/*.py')),
    ('wait() / communicate()', (r"\.(wait|communicate)\(\)", 'mod/*.py')),
    ('os.sync()', (r"\bos_sync\(\)|\bos\.sync\(\)", 'mod/*.py')),
    ('ctypes calls to libmod_utils', (r"\butils\.[a-z_]+\(", 'modtools/utils.py')),
])


def blocking_calls():
    """Call sites that stop the single Tornado thread until they return (the loop cannot serve anyone meanwhile)."""
    out = collections.OrderedDict()
    for name, (pat, where) in BLOCKING.items():
        n = 0
        for f in tracked(where):
            for line in read(f).splitlines():
                if line.lstrip().startswith(('def ', '#')):
                    continue
                n += len(re.findall(pat, line))
        out[name] = n
    return out


def gen_task_sites():
    """Uses of the callback-style Tornado helpers (gen.Task, gen.engine, gen.coroutine, web.asynchronous), the style of Tornado 4.3."""
    n = 0
    for f in tracked('mod/*.py', 'modtools/*.py'):
        n += len(re.findall(r"gen\.Task\(|@gen\.engine|@gen\.coroutine|@web\.asynchronous", read(f)))
    return n


if __name__ == '__main__':
    L = loc()
    for g, d in L.items():
        print(g, sum(d.values()), 'lines in', len(d), 'files')
        for p, n in sorted(d.items(), key=lambda kv: -kv[1])[:8]:
            print('   ', n, p)
    E = import_edges()
    print('imports:', {k: sorted(v) for k, v in E.items()})
    print('device branches:')
    for k, v in device_branches().items():
        print('   ', k, dict(v))
    print('descriptor flags:', len(descriptor_flags()), {k: v[0] for k, v in sorted(descriptor_flags().items())})
    print('coupling:')
    for k, v in coupling().items():
        print('   ', v, k)
    print('deps:', dict(dependency_usage()))
    print('routes:', route_stats())
    print('dead vendored:', dead_vendored())
    print('blocking:', dict(blocking_calls()), 'gen sites', gen_task_sites())
    print('host methods:', host_methods())
    print('webserver reach:', webserver_reach())
