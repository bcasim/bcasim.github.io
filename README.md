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

## Local results and experiment setup

**Open and compare recordings** accepts a local selection or drop of
`adjacencyMatrix.csv`, `block.json` and `event.json` from one run. Include
`metrics.json` for recorded metrics; runs with connection changes also require
`initialAdjacencyMatrix.csv`. Files stay in the browser. A failed import preserves
the previous recording. Recording A drives playback, and Recording B supplies
comparison metrics. The timeline slider and next-event/next-block controls seek to
recorded timestamps, and the inspector exposes the latest event/block details.

**Build an experiment configuration** exports a validated `.properties` file.
Execute the shown Java command in a BCASim checkout, then import the resulting
files. The static website does not execute Java. The builder uses PoW, with
transaction generation disabled; advanced settings are in the simulator guide.

日本語：**Open and compare recordings**で、同じ実験の`adjacencyMatrix.csv`・`block.json`・`event.json`をまとめて選択・ドロップします。指標には`metrics.json`、接続変更がある場合は`initialAdjacencyMatrix.csv`も含めてください。Aを再生し、Bと最終指標を比較します。時刻スライダー・ステップ操作・詳細表示を利用できます。設定作成画面では`.properties`ファイルを保存し、Javaで実行した結果を読み戻します。

操作の詳細は[可視化ツールの日本語ガイド](https://github.com/bcasim/bcasim-visualization/blob/main/README_JP.md)、設定と指標の定義は[シミュレータの日本語ガイド](https://github.com/bcasim/bcasim/blob/main/docs/japanese/doc.md)を参照してください。

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
start/pause/resume/reset, seek/step, local imports and import errors, comparison,
configuration download, invalid settings and playback completion.

Changes are served as static files by GitHub Pages. Keep the English and
Japanese homepage content in sync when updating project links or setup commands.
