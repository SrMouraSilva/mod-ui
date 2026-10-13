#!/usr/bin/env python3
"""Regenerates every diagram of docs/modui-client.md: one SVG per diagram plus index.html (a gallery that shows them).

    python3 docs/modui-client/diagrams/src/build.py            # writes ../*.svg and ../index.html
    python3 docs/modui-client/diagrams/src/build.py --check    # only draws and prints geometry warnings, writes nothing

Needs only the Python 3 standard library. The diagrams themselves are defined in specs.py; see ../README.md.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import specs  # noqa: E402
from engine import run  # noqa: E402

if __name__ == '__main__':
    run(specs.SPECS, HERE.parent, 'modui-client diagrams', sys.argv, 'docs/modui-client/diagrams/src/build.py')
