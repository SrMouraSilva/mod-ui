#!/usr/bin/env python3
"""Regenerates every diagram of docs/mod-ui.md: one SVG per diagram plus index.html (a gallery that shows them).

    python3 docs/mod-ui/diagrams/src/build.py            # writes ../*.svg and ../index.html
    python3 docs/mod-ui/diagrams/src/build.py --check    # only draws and prints geometry warnings, writes nothing

Boxes-and-connectors diagrams use the shared engine of docs/modui-client/diagrams/src/engine.py; the other types (matrix, bars, treemap, lanes,
sequence, scatter, ...) use kit.py. The numbers come from measure.py (counted from the working tree). Needs only the Python 3 standard library.
The diagrams themselves are defined in specs.py; see ../README.md.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import specs  # noqa: E402
from kit import run  # noqa: E402

if __name__ == '__main__':
    run(specs.SPECS, HERE.parent, 'mod-ui diagrams', sys.argv, 'docs/mod-ui/diagrams/src/build.py')
