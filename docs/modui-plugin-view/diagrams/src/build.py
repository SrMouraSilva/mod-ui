#!/usr/bin/env python3
"""Regenerates every diagram of docs/modui-plugin-view.md: one SVG per diagram plus index.html (a gallery that shows them).

    python3 docs/modui-plugin-view/diagrams/src/build.py            # writes ../*.svg and ../index.html
    python3 docs/modui-plugin-view/diagrams/src/build.py --check    # only draws and prints geometry warnings, writes nothing

The drawing code is shared with the diagrams of modui-client (docs/modui-client/diagrams/src/engine.py); only the definitions (specs.py) are
specific. Needs only the Python 3 standard library. See ../README.md.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ENGINE = HERE.parents[2] / 'modui-client' / 'diagrams' / 'src'
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(HERE))
import specs  # noqa: E402
from engine import run  # noqa: E402

if __name__ == '__main__':
    run(specs.SPECS, HERE.parent, 'modui-plugin-view diagrams', sys.argv, 'docs/modui-plugin-view/diagrams/src/build.py')
