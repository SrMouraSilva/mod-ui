# Diagrams of mod-ui

The diagrams of [`docs/mod-ui.md`](../../mod-ui.md), the architecture guide of the mod-ui application itself (`mod/`, `modtools/`, `utils/`, `html/`).
They are about the application, not about the TypeScript packages: for those see [`docs/modui-client/diagrams/`](../../modui-client/diagrams/README.md).

| File | What it is |
|---|---|
| `*.svg` | One diagram each. **Generated, never edited by hand.** Each SVG carries `<title>`, `<desc>` and a `<metadata>` block with the content of the diagram as Mermaid or as plain data, for readers and AI tools that only see the SVG. |
| `index.html` | A gallery that shows every SVG (through `<object>`, so the web fonts load). Generated too. |
| `src/specs.py`, `src/specs_deep.py` | **The source of the layout.** One function per diagram (`specs.py`: sections 1 to 12 of the guide; `specs_deep.py`: sections 13 to 17). Boxes-and-connectors diagrams return an engine spec; the others return a `Canvas`. |
| `src/measure.py` | **The source of every number**: lines of code, imports, branch counts, coupling counts, dependency usage. Counted from the working tree each time the diagrams are built. |
| `src/data.py` | The feature matrix, shared by the diagram and by section 6 of the guide (`python3 data.py` prints it as a Markdown table). |
| `src/kit.py` | The drawing kit for the types that are not boxes and connectors (matrix, bars, treemap, lanes, sequence, scatter, quadrant); `kit.sequence()` draws every sequence diagram. |
| `src/build.py` | Regenerates the SVGs and `index.html`. Python 3 standard library only. |

The boxes-and-connectors diagrams (`context`, `host-link`, `frontend`, `architecture-detail`, `jack-graph`, `license-flow`, `identity-data`) reuse the engine of the client diagrams
([`docs/modui-client/diagrams/src/engine.py`](../../modui-client/diagrams/src/engine.py)): nodes, orthogonal connectors, label masks and geometry checks.

## Changing a diagram

1. Edit the function of the diagram in `src/specs.py` (or the numbers behind it in `src/measure.py`, or the matrix in `src/data.py`).
2. Run `python3 docs/mod-ui/diagrams/src/build.py` (add `--check` to only look for problems).
3. Fix every warning it prints (a line passing behind a box, a label touching a line, attach points closer than 12px) and open `diagrams/index.html`.
4. Commit the changed `.svg` files together with the sources, and re-read the paragraph of the guide that quotes a number.

`python3 docs/mod-ui/diagrams/src/measure.py` prints every measurement, which is the quickest way to refresh the numbers quoted in the guide.

## The diagrams

| Slug | Type | Question it answers |
|---|---|---|
| `context` | Architecture | What does mod-ui talk to, and who starts each conversation? |
| `layers` | Layer stack | What are the layers, how big, and which ones are skipped? |
| `imports` | Dependency matrix | Who imports whom among the Python modules? |
| `load-pedalboard` | Sequence | What happens during one pedalboard load? |
| `event-loop` | Data flow | How does one thread serve four peers, and what blocks it? |
| `host-link` | State machine | What happens to the Host when mod-host dies? |
| `modes` | Matrix | What is real, fake or absent on a device, in MOD Desktop and in development? |
| `devices` | Heat map | Where does the code name a device? |
| `features` | Traceability matrix | Which parts does each feature touch? |
| `coupling` | Bar chart | What is the code tied to? |
| `code-map` | Treemap | Where do the lines of code live? |
| `dependency-age` | Scatter | How old are the dependencies, and how much leans on them? |
| `frontend` | Architecture | How is the classic browser code put together? |
| `improvements` | Quadrant | What to improve first? |
| `architecture-detail` | Architecture | What runs inside the device and over which protocol does each link talk? |
| `jack-graph` | Signal path | Which JACK clients surround a pedalboard, and how does mod-ui name their ports? |
| `startup` | Sequence | What happens from `server.py` to a loaded pedalboard? |
| `layers-topdown` | Trace | How does one real call travel down the layers and back? (a second reading of `layers`, which stays) |
| `state-owners` | Ownership matrix | Who owns each piece of state: Session, Host, webserver, mod-host, disk? |
| `inside-host` | Nested view | What does the Host object hold, and what does the Session keep? |
| `tuner-sequence` | Sequence | How does the tuner work, and who manages it? |
| `persistence` | Matrix | Where is each thing stored and who writes it? |
| `license-flow` | Flow | How does mod-ui classify a paid plugin? |
| `cloud-auth` | Sequence | How does the device prove who it is to the cloud? |
| `share-flow` | Sequence | How is a pedalboard shared? |
| `remote-load` | Sequence | How does a pedalboard from the website reach the device? |
| `identity-data` | Data flow | What identifies the device, and what does the user type? |

## Rules

- Same style as the client diagrams (the `diagram-design` skill): paper background, ink strokes, one terracotta accent used on one or two elements,
  Geist / Geist Mono / Instrument Serif with system fallbacks (GitHub does not load web fonts inside an `<img>`).
- Lines are **orthogonal**, never pass behind a box that is not their end, and never share a stroke or an attach point; labels sit on a mask with a visible gap.
  `build.py --check` verifies this for the engine diagrams; the canvas diagrams are drawn on a grid and checked by eye.
- Per-type budgets of the skill apply (for example five lifelines and twelve messages in a sequence, eight cells in a treemap, nine nodes in a graph).
  Where a diagram leaves something out to stay inside them, the guide says so next to the figure.
- A number never appears in `specs.py` as a literal: it comes from `measure.py`. A judgement (the effort and impact of an improvement, the year of an old library)
  is the exception and is labelled as an estimate in the diagram.
