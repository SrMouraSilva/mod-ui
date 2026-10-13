# Diagrams of modui-plugin-view

The architecture and data-model diagrams of [`docs/modui-plugin-view.md`](../../modui-plugin-view.md) (sections 3 and 6). They are made like the ones of
modui-client, with the same drawing code, so **read [`docs/modui-client/diagrams/README.md`](../../modui-client/diagrams/README.md) first**: what the files are,
how to change a diagram, the notation and the layout rules.

| File | What it is |
|---|---|
| `*.svg` | One diagram each. **Generated, never edited by hand.** Each has a Mermaid summary of its content in `<metadata>`. |
| `index.html` | A gallery that shows every SVG. Generated too. |
| `src/specs.py` | **The source** of these diagrams: one function per diagram. |
| `src/build.py` | Regenerates the SVGs and `index.html` (`--check` only looks for problems). It imports the drawing code from `docs/modui-client/diagrams/src/engine.py`. |

To change a diagram: edit its function in `src/specs.py`, run `python3 docs/modui-plugin-view/diagrams/src/build.py`, fix the warnings, look at `index.html`, and commit
the `.svg` files with `specs.py`. Keep the diagrams in step with `modui-plugin-view/src/` (`types.ts`, `view.ts`, `views.ts`, `binding.ts`, `widgets.ts`, `template-data.ts`, `script.ts`).
