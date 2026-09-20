const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const canonical = fs.existsSync(path.join(root, 'js/main.js'));
const assets = canonical ? root : path.join(root, 'demo');
const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'runtime-manifest.json'), 'utf8'));

test('vendored runtime and regression tests match the canonical manifest', () => {
    for (const file of manifest.files) {
        const filename = path.join(root, canonical ? file.source : file.demo);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), file.sha256,
            'Runtime drift in ' + filename + '. Update bcasim-visualization and run scripts/sync-demo.cjs.');
    }
    const peer = path.join(root, canonical ? '../bcasim.github.io/demo/runtime-manifest.json' : '../bcasim-visualization/runtime-manifest.json');
    if (fs.existsSync(peer)) assert.deepEqual(JSON.parse(fs.readFileSync(peer, 'utf8')), manifest, 'Sibling checkout has a different runtime version.');
});

test('each independently served page loads the shared runtime in dependency order and exposes its controls', () => {
    const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
    const scripts = Array.from(html.matchAll(/<script defer src="(\.\/js\/[^" ]+)"/g), match => match[1]);
    assert.deepEqual(scripts, ['./js/dist/vis.js', './js/read-file.js', './js/playback.js', './js/blockchain.js', './js/network.js', './js/main.js']);
    scripts.forEach(script => assert.ok(fs.existsSync(path.join(assets, script)), 'Runtime asset must exist locally: ' + script));
    for (const id of ['start_button', 'pause_button', 'reset_button', 'status_message', 'timestamp_area',
        'setting_panel', 'speed', 'start_point', 'node', 'network_panel', 'blockchain_panel']) {
        assert.match(html, new RegExp('id="' + id + '"'), 'Missing control: ' + id);
    }
    assert.doesNotMatch(html, /onclick=/, 'Controls use the shared controller rather than inline handlers.');
});
