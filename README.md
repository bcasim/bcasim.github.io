# BCASim website

The English and Japanese homepages and interactive visualization demo for
[BCASim](https://github.com/bcasim/bcasim), a blockchain attack simulator.

- Website: <https://bcasim.github.io/>
- Japanese homepage: <https://bcasim.github.io/index-jp.html>
- Interactive demo: <https://bcasim.github.io/demo/>

## Local preview

No build step or package installation is required. From this directory, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/>. Use HTTP for the demo so the browser can load
its JSON and CSV sample data.

## Structure

- `index.html` / `index-jp.html`: English / Japanese introductions and quick start.
- `screen.css`: shared layout and site styles.
- `network-static.png`: still frame from the existing `network.gif`; used on the
  homepage to avoid downloading and autoplaying the full recording.
- `demo/index.html` / `demo/css/style.css`: playback controls and graph layout.
- `demo/js/`: vendored canonical dataset loader, playback engine, graph renderers, and DOM controller.
- `demo/js/dist/vis.js`: existing bundled graph library.
- `demo/output-file/`: recorded simulation data, not a live simulation engine.

## Demo controls

Wait for the sample to load, then select **Start simulation**. Use **Pause** and
**Resume** to inspect a particular moment, **Reset** to return to the beginning,
or **Restart simulation** to replay with new settings.

Playback settings select block/miner coloring, simulation seconds per 0.5-second
step, and the starting simulation time. Starting at a later time applies earlier
events first so the graphs reflect the full history at that moment.

Drag the graph to pan and scroll to zoom. On narrow screens, the graphs stack
vertically. The controls have keyboard focus indicators and the status message
announces loading, playback state, and errors. Text below each graph explains
its visual encoding. The recorded animation remains available from the homepage
and demo footer.

## Updating the shared runtime

The canonical source is the separate `bcasim-visualization` repository. Change
its `js/` runtime or tests, then copy the exact files with:

```sh
cd ../bcasim-visualization
node scripts/sync-demo.cjs ../bcasim.github.io
node scripts/sync-demo.cjs ../bcasim.github.io --check
```

The script vendors runtime files (including the graph library), shared regression
tests, and a deterministic `demo/runtime-manifest.json`. It leaves website HTML,
styles, analytics, and recordings untouched. Each repository serves and runs its
tests independently; no runtime link to a sibling checkout is required. Run tests
in both repositories after sync and commit the paired changes. Direct edits to
vendored code fail the manifest check. If a new script is added, update both entry
points and the explicit sync file list in the canonical repository.

## Validation

Run the dependency-free regression tests with Node.js 22 or newer:

```sh
node --test
```

Before publishing, preview both homepages and the demo at desktop and mobile
widths. Check language navigation, keyboard access to the command block, loading,
start/pause/resume/reset, invalid settings, and playback completion.

Changes are served as static files by GitHub Pages. Keep the English and
Japanese homepage content in sync when updating project links or setup commands.
