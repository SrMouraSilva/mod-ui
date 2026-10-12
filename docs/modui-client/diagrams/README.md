# Diagrams of modui-client

The architecture and data-model diagrams of [`docs/modui-client.md`](../../modui-client.md) (sections 2 and 4).

| File | What it is |
|---|---|
| `*.svg` | One diagram each. **Generated, never edited by hand.** Each SVG carries `<title>`, `<desc>` and a `<metadata>` block with the content of the diagram as Mermaid (entities, fields, relations, notes), for readers and AI tools that only see the SVG. |
| `index.html` | A gallery that shows every SVG (through `<object>`, so the web fonts load). Generated too. |
| `src/specs.py` | **The source.** One function per diagram: boxes, lines, positions, legend. |
| `src/engine.py` | The drawing code (boxes, orthogonal connectors, label masks, legend, geometry checks, Mermaid summary). |
| `src/build.py` | Regenerates the SVGs and `index.html`. Python 3 standard library only. |

## Changing a diagram

1. Edit the function of the diagram in `src/specs.py`.
2. Run `python3 docs/modui-client/diagrams/src/build.py` (add `--check` to only look for problems).
3. Fix every warning it prints (a line passing behind a box, a label touching a line, attach points closer than 12px, boxes too close) and open
   `diagrams/index.html` to look at the result.
4. Commit the changed `.svg` files together with `specs.py`.

Common edits: a **field** is a string in `fields=[...]` (`name: type`, at most about 30 characters), an **operation** one in `ops=[...]`; a **relation** is a `Conn(...)`
(`ca` / `cb` are the cardinalities at the first and second box, `label` the name of the relation, `at_a` / `at_b` the exact position along the edge, `mid` where an elbow
turns); a **new domain** is a new `d_<name>()` function added to `SPECS` (in the order of the gallery) and a section in `docs/modui-client.md` that links the SVG.
Keep the diagrams in step with `src/types.ts` and the classes of `modui-client/src/`.

## Rules

- Notation (also in section 4 of the guide): purple box = class of the client, white = wire type (JSON of the backend), grey = plain data or enum,
  dashed = defined in another diagram, terracotta = the aggregate root of that domain (one per diagram). Solid line = owns / contains with cardinalities,
  dashed arrow = creates / reads / refers to.
- Lines are **orthogonal** (rounded elbows, no diagonals), never pass behind a box that is not their end, and never share a stroke or an attach point.
  Labels are uppercase, at most 14 characters, on a mask with a visible gap from their line. `build.py` checks all of this.
- At most 8 boxes per domain diagram (the overview and the architecture are the exceptions) and two callouts. More than that: split the domain.
- The style is the one of `docs/architecture-diagram-detailed.html` (the `diagram-design` skill); fonts are Geist, Geist Mono and Instrument Serif, with system fallbacks
  because GitHub does not load web fonts inside an `<img>`.
