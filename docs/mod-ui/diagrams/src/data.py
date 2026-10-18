"""Hand-made tables that feed both the diagrams and docs/mod-ui.md (so they cannot drift apart).

`python3 data.py` prints the feature matrix as a Markdown table, ready to paste into docs/mod-ui.md section 6.
Cells: P = the component carries the feature, s = it supports it, . = not involved.
"""

COMPONENTS = ['Browser UI', 'webserver', 'session', 'host', 'addr · hmi · cc', 'libmod_utils', 'mod-host', 'files']

# group, feature, entry points (kept short), cells in the order of COMPONENTS
FEATURES = [
    ('PLUGINS', 'Plugin catalogue and GUI files', 'effects.js · modgui.js · /effect/list, get, image, file', 'PP...P.s'),
    ('PLUGINS', 'Install and remove plugins', 'cloudplugin.js · /effect/install · /sdk/* · /rplsocket', 'PP.s.PsP'),
    ('PLUGINS', 'Plugin presets', 'snapshot.js · /effect/preset/* · preset_*()', 'PP.PssPs'),
    ('PEDALBOARDS', 'Edit the running pedalboard', 'pedalboard.js · /effect/add, connect · ws param_set', 'PPPP.sP.'),
    ('PEDALBOARDS', 'Save, load and pack', 'pedalboards.js · /pedalboard/* · save_state_*()', 'PPPP.PsP'),
    ('PEDALBOARDS', 'Thumbnails and screenshots', 'screenshot.py · modtools/pedalboard.py', 'ssP..P.P'),
    ('PEDALBOARDS', 'Snapshots', 'snapshot.js · /snapshot/* · HMI ss / sl', 'PP.PP.sP'),
    ('PEDALBOARDS', 'Banks', 'banks.js · /banks · bank.py · HMI b*', 'PP.PP..P'),
    ('CONTROL', 'Addressing: knobs, pedals, MIDI, CV, BPM', 'hardware.js · /effect/parameter/address · addressings.py', 'PPsPP.Ps'),
    ('CONTROL', 'MIDI devices and program change', 'mididevices.js · /jack/*_midi_devices · profile.py', 'PPsPsPPs'),
    ('CONTROL', 'Tuner', 'HMI only · tuner.py · no page in html/', '...PP.P.'),
    ('CONTROL', 'Transport, tempo, Link, MIDI clock', 'transport.js · ws transport-* · set_sync_mode', 'PssPssP.'),
    ('AUDIO AND SYSTEM', 'Audio I/O and device settings', 'settings.html · /truebypass · /set_buffersize · profile.py', 'PP.ssP.P'),
    ('AUDIO AND SYSTEM', 'Live stats and meters', 'host.js · ws stats, output_set · statstimer', 'Ps.P.sP.'),
    ('AUDIO AND SYSTEM', 'Recording and playback', '/recording/* · recorder.py · jack_capture', 'PPPs..ss'),
    ('AUDIO AND SYSTEM', 'Update, backup, services, firmware', 'upgrade.js · /system/* · /update/* · /controlchain/*', 'PPs.s..P'),
    ('FILES AND CLOUD', 'User files, NAM and IR models, Tone3000', 'file_manager.js · /files/* · /effect/t3k/select', 'PP.s..sP'),
    ('FILES AND CLOUD', 'Cloud store, account, sharing', 'cloudplugin.js · share.js · /auth/* · /tokens/*', 'PP.....s'),
]


def markdown_table():
    head = '| Group | Feature | Entry points | ' + ' | '.join(COMPONENTS) + ' |'
    sep = '|---|---|---|' + '|'.join(['---'] * len(COMPONENTS)) + '|'
    rows = []
    for g, name, entry, cells in FEATURES:
        rows.append(f'| {g.capitalize()} | {name} | `{entry}` | ' + ' | '.join({'P': '●', 's': '○', '.': ''}[x] for x in cells) + ' |')
    return '\n'.join([head, sep] + rows)


if __name__ == '__main__':
    print(markdown_table())
