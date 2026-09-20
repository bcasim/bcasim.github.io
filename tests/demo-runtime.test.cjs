const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const assets = fs.existsSync(path.join(root, 'js/main.js')) ? root : path.join(root, 'demo');
const fixture = {
    'adjacencyMatrix.csv': '0,1\r\n1,0\r\n',
    'block.json': [
        { hash: 'genesis', previousHash: 'none', receiveTime: '0', height: '0', miner: 'Genesis' },
        { hash: 'one', previousHash: 'genesis', receiveTime: '3', height: '1', miner: '0' }
    ],
    'event.json': [
        { type: 'InitNode', time: '0', node: '0' },
        { type: 'FoundBlock', time: '3', node: '0', height: '1', hash: 'one' },
        { type: 'ReceiveBlock', time: '10', node: '1', from: '0', height: '1', hash: 'one' }
    ]
};

function harness(files = fixture, deferred = false) {
    const elements = new Map();
    function element(id, value = '') {
        const item = {
            id, value, textContent: '', disabled: false, dataset: {}, attributes: {}, listeners: {},
            addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            focus() { this.focused = true; }
        };
        elements.set(id, item);
        return item;
    }
    ['start_button', 'pause_button', 'reset_button', 'status_message', 'timestamp_area', 'setting_panel', 'network_panel', 'blockchain_panel', 'import_status'].forEach(id => element(id));
    element('speed', '2');
    element('start_point', '0');
    const radios = [element('color-block', '1'), element('color-miner', '2')];
    radios[0].checked = true;
    const timers = new Map();
    const windowListeners = {};
    const networks = [];
    let timerId = 0;
    class DataSet {
        constructor(items = []) { this.items = new Map(); this.add(items); }
        add(items) {
            for (const item of Array.isArray(items) ? items : [items]) {
                assert.ok(item.id !== undefined, 'Every graph item has an explicit ID');
                assert.ok(!this.items.has(item.id), 'No duplicate graph IDs');
                this.items.set(item.id, { ...item });
            }
        }
        update(items) {
            for (const item of Array.isArray(items) ? items : [items]) {
                assert.ok(this.items.has(item.id), 'Updates must refer to existing graph items');
                this.items.set(item.id, { ...this.items.get(item.id), ...item });
            }
        }
        get(id) { return this.items.get(id); }
        remove(id) { this.items.delete(id); }
        clear() { this.items.clear(); }
        get length() { return this.items.size; }
    }
    class Network {
        constructor(container, data, options) { this.data = data; this.options = options; networks.push(this); }
        destroy() { assert.ok(!this.destroyed, 'Destroy each network only once'); this.destroyed = true; }
        fit() { this.fitted = true; }
    }
    const requests = [];
    const context = vm.createContext({
        console, Map, Set, Promise,
        document: {
            readyState: 'loading',
            getElementById(id) { assert.ok(elements.has(id), 'Known DOM element: ' + id); return elements.get(id); },
            querySelectorAll() { return radios; },
            querySelector() { return radios.find(radio => radio.checked); },
            addEventListener() {}
        },
        window: { addEventListener(type, listener) { windowListeners[type] = listener; } },
        vis: { DataSet, Network },
        setInterval(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
        clearInterval(id) { timers.delete(id); },
        fetch(filename) {
            const name = filename.split('/').pop();
            return new Promise((resolve, reject) => {
                const request = {
                    name, reject,
                    resolve(status = Object.hasOwn(files, name) ? 200 : 404) {
                        resolve({ ok: status === 200, status,
                            text: async () => files[name],
                            json: async () => JSON.parse(JSON.stringify(files[name]))
                        });
                    }
                };
                requests.push(request);
                if (!deferred) request.resolve();
            });
        }
    });
    for (const script of ['read-file', 'playback', 'blockchain', 'network', 'main']) {
        vm.runInContext(fs.readFileSync(path.join(assets, 'js', script + '.js'), 'utf8'), context, { filename: script + '.js' });
    }
    return {
        ctx: context, elements, timers, networks, requests, radios, windowListeners,
        tick() { for (const timer of [...timers.values()]) if (timer.delay === 500) timer.fn(); },
        liveNetworks() { return networks.filter(network => !network.destroyed).length; }
    };
}

async function ready(files) {
    const h = harness(files);
    assert.equal(await h.ctx.demo.init(), true);
    return h;
}

test('all three files must finish before playback becomes available', async () => {
    const h = harness(fixture, true);
    const initializing = h.ctx.demo.init();
    assert.equal(h.ctx.demo.init(), initializing, 'Concurrent initialization shares a promise');
    assert.equal(h.elements.get('start_button').disabled, true);
    assert.equal(h.ctx.demo.start(), false);
    assert.equal(h.requests.length, 5);
    h.requests.find(r => r.name === 'block.json').resolve();
    h.requests.find(r => r.name === 'event.json').resolve();
    h.requests.filter(r => /metrics|initialAdjacency/.test(r.name)).forEach(r => r.resolve());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.ctx.demo.data, null, 'Publish the dataset atomically');
    assert.equal(h.liveNetworks(), 0);
    h.requests.find(r => r.name === 'adjacencyMatrix.csv').resolve();
    assert.equal(await initializing, true);
    assert.equal(h.ctx.demo.state, 'ready');
    assert.equal(h.ctx.demo.renderer.nodes.length, 2);
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 1);
    assert.equal(h.elements.get('start_button').disabled, false);
    assert.equal(h.timers.size, 0);
});

test('HTTP failures expose Retry loading and a retry does not duplicate listeners', async () => {
    const h = harness(fixture, true);
    const initializing = h.ctx.demo.init();
    h.requests[0].resolve(404);
    h.requests[1].resolve();
    h.requests.slice(2).forEach(request => request.resolve());
    assert.equal(await initializing, false);
    assert.equal(h.ctx.demo.state, 'error');
    assert.match(h.elements.get('status_message').textContent, /HTTP 404/);
    assert.equal(h.elements.get('start_button').textContent, 'Retry loading');
    assert.equal(h.elements.get('start_button').disabled, false);
    const retry = h.ctx.demo.start();
    h.requests.slice(5).forEach(request => request.resolve());
    assert.equal(await retry, true);
    assert.equal(h.elements.get('start_button').listeners.click.length, 1);
    assert.equal(h.liveNetworks(), 2);
});

test('CSV parsing accepts CRLF and trailing newlines but rejects malformed matrices', async () => {
    const h = await ready();
    assert.equal(h.ctx.BCASimData.parseMatrix('0,1\r\n1,0\r\n').length, 2);
    for (const csv of ['', '0,1\n1', '0,x\n1,0']) {
        assert.throws(() => h.ctx.BCASimData.parseMatrix(csv));
    }
    const malformed = await ready();
    assert.throws(() => malformed.ctx.BCASimData.validateTimeline([{ time: 'NaN' }], 'time', 'event.json', 2));
    assert.throws(() => malformed.ctx.BCASimData.validateTimeline([{ time: 0, type: 'ReceiveBlock', node: 99, from: 0, height: 1, hash: 'x' }], 'time', 'event.json', 2));
});

test('repeated starts reset cursors and graph data with exactly two playback timers', async () => {
    const h = await ready();
    assert.equal(h.ctx.demo.start(), true);
    h.tick(); h.tick();
    assert.equal(h.ctx.demo.playback.time, 4);
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 2);
    assert.equal(h.ctx.demo.start(), true);
    assert.equal(h.ctx.demo.playback.time, 0);
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 1);
    assert.equal(h.ctx.demo.playback.eventIndex, 1);
    assert.equal(h.ctx.demo.renderer.nodes.length, 2);
    assert.equal(h.ctx.demo.renderer.edges.length, 1);
    assert.equal(h.timers.size, 2);
    assert.equal(h.liveNetworks(), 2);
});

test('pause and resume retain progress and settings only apply on restart', async () => {
    const h = await ready();
    h.ctx.demo.start(); h.tick();
    h.ctx.demo.pause();
    assert.equal(h.ctx.demo.state, 'paused');
    assert.equal(h.timers.size, 0);
    h.elements.get('speed').value = '5';
    h.radios[0].checked = false; h.radios[1].checked = true;
    h.ctx.demo.playback.tick();
    assert.equal(h.ctx.demo.playback.time, 2);
    h.ctx.demo.pause(); h.tick();
    assert.equal(h.ctx.demo.playback.time, 4);
    assert.equal(h.ctx.demo.playback.speed, 2);
    assert.equal(h.ctx.demo.playback.color, '1');
    h.ctx.demo.start(); h.tick();
    assert.equal(h.ctx.demo.playback.time, 5);
    assert.equal(h.ctx.demo.playback.color, '2');
    assert.equal(h.ctx.demo.renderer.nodes.get(0).group, h.ctx.demo.renderer.blockchain.nodes.get(1).group, 'Miner groups match in both graphs');
    assert.equal(h.ctx.demo.renderer.nodes.get(0).color, h.ctx.demo.renderer.blockchain.nodes.get(1).color, 'Miner colors match in both graphs');
    h.ctx.demo.reset();
    assert.equal(h.ctx.demo.playback.time, 0);
    assert.equal(h.ctx.demo.state, 'ready');
    assert.equal(h.timers.size, 0);
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 1);
    assert.equal(h.liveNetworks(), 2);
});

test('playback continues after blocks end, then stops at the final event without out-of-bounds reads', async () => {
    const h = await ready();
    h.elements.get('speed').value = '4';
    h.ctx.demo.start(); h.tick();
    assert.equal(h.ctx.demo.playback.blockIndex, fixture['block.json'].length);
    assert.equal(h.ctx.demo.state, 'running');
    h.tick(); h.tick();
    assert.equal(h.ctx.demo.playback.time, 10);
    assert.equal(h.ctx.demo.playback.eventIndex, fixture['event.json'].length);
    assert.equal(h.ctx.demo.state, 'completed');
    assert.equal(h.timers.size, 0);
    h.ctx.demo.playback.tick();
    assert.equal(h.ctx.demo.playback.blockIndex, fixture['block.json'].length);
    assert.equal(h.ctx.demo.playback.eventIndex, fixture['event.json'].length);
    assert.equal(h.elements.get('pause_button').disabled, true);
    assert.equal(h.ctx.demo.renderer.nodes.get(1).group, h.ctx.demo.renderer.blockchain.nodes.get(1).group, 'Block groups match in both graphs');
    assert.equal(h.ctx.demo.renderer.nodes.get(1).color, h.ctx.demo.renderer.blockchain.nodes.get(1).color, 'Block colors match in both graphs');
});

test('blocks continue after events end and empty timelines complete safely', async () => {
    const h = await ready({ ...fixture, 'event.json': [] });
    h.ctx.demo.start(); h.tick();
    assert.equal(h.ctx.demo.state, 'running');
    h.tick();
    assert.equal(h.ctx.demo.playback.time, 3);
    assert.equal(h.ctx.demo.state, 'completed');
    const empty = await ready({ ...fixture, 'event.json': [], 'block.json': [] });
    empty.ctx.demo.start();
    assert.equal(empty.ctx.demo.state, 'completed');
    assert.equal(empty.timers.size, 0);
});

test('start time reconstructs prior state and the final timestamp immediately completes', async () => {
    const h = await ready();
    h.elements.get('start_point').value = '4';
    h.ctx.demo.start();
    assert.equal(h.ctx.demo.playback.time, 4);
    assert.equal(h.ctx.demo.playback.blockIndex, 2);
    assert.equal(h.ctx.demo.playback.eventIndex, 2);
    assert.equal(h.ctx.demo.renderer.nodes.get(0).group, h.ctx.demo.renderer.blockchain.nodes.get(1).group);
    h.elements.get('start_point').value = '10';
    h.ctx.demo.start();
    assert.equal(h.ctx.demo.state, 'completed');
    assert.equal(h.timers.size, 0);
});

test('invalid speed and start time are rejected before creating timers or changing graphs', async () => {
    const h = await ready();
    for (const value of ['', '-1', '0', 'NaN', 'Infinity', '0.01', '10001']) {
        h.elements.get('speed').value = value;
        assert.equal(h.ctx.demo.start(), false, value);
        assert.equal(h.elements.get('speed').attributes['aria-invalid'], 'true');
        assert.equal(h.elements.get('status_message').dataset.state, 'error');
        assert.equal(h.elements.get('setting_panel').open, true, 'Invalid fields are revealed before focus');
        assert.equal(h.timers.size, 0);
    }
    h.elements.get('speed').value = '2';
    for (const value of ['', '-1', 'NaN', 'Infinity', '11']) {
        h.elements.get('start_point').value = value;
        assert.equal(h.ctx.demo.start(), false, value);
        assert.equal(h.elements.get('start_point').attributes['aria-invalid'], 'true');
    }
    assert.equal(h.networks.length, 2);
});

test('missing or later parents never stall playback and late parent edges are connected', async () => {
    const h = await ready({ ...fixture, 'event.json': [], 'block.json': [
        fixture['block.json'][0],
        { hash: 'child', previousHash: 'parent', receiveTime: '1', height: '2', miner: '1' },
        { hash: 'orphan', previousHash: 'absent', receiveTime: '2', height: '1', miner: '0' },
        { hash: 'parent', previousHash: 'genesis', receiveTime: '3', height: '1', miner: '0' }
    ] });
    h.elements.get('speed').value = '10';
    h.ctx.demo.start(); h.tick();
    assert.equal(h.ctx.demo.state, 'completed');
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 4);
    assert.equal(h.ctx.demo.renderer.blockchain.edges.length, 2);
    assert.equal(h.ctx.demo.renderer.blockchain.edges.get('block:1').from, 3);
});

test('the bundled 100-node recording completes and resets without accumulated graph objects', async () => {
    const files = {};
    for (const name of Object.keys(fixture)) {
        const contents = fs.readFileSync(path.join(assets, 'output-file', name), 'utf8');
        files[name] = name.endsWith('.json') ? JSON.parse(contents) : contents;
    }
    const h = await ready(files);
    assert.equal(h.ctx.demo.renderer.nodes.length, 100);
    h.elements.get('speed').value = '10000';
    h.ctx.demo.start(); h.tick(); h.tick();
    assert.equal(h.ctx.demo.state, 'completed');
    assert.equal(h.ctx.demo.playback.blockIndex, files['block.json'].length);
    assert.equal(h.ctx.demo.playback.eventIndex, files['event.json'].length);
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 104);
    assert.equal(h.ctx.demo.renderer.blockchain.edges.length, 103);
    assert.equal(h.ctx.demo.renderer.blockchain.pending.size, 0);
    assert.equal(h.timers.size, 0);
    h.ctx.demo.reset();
    assert.equal(h.ctx.demo.renderer.nodes.length, 100);
    assert.equal(h.ctx.demo.renderer.blockchain.nodes.length, 1);
    assert.equal(h.liveNetworks(), 2);
});


test('leaving the page pauses playback so a cached Back navigation can resume safely', async () => {
    const h = await ready();
    h.ctx.demo.start(); h.tick();
    h.windowListeners.pagehide();
    assert.equal(h.timers.size, 0);
    assert.equal(h.ctx.demo.state, 'paused');
    assert.equal(h.elements.get('pause_button').textContent, 'Resume');
    h.ctx.demo.pause(); h.tick();
    assert.equal(h.ctx.demo.playback.time, 4);
    assert.equal(h.timers.size, 2);
});


test('data validation is atomic and rejects corrupt block identities and numeric values', async () => {
    for (const broken of [
        { ...fixture, 'block.json': [fixture['block.json'][0], fixture['block.json'][0]] },
        { ...fixture, 'block.json': [{ ...fixture['block.json'][1], miner: '' }] },
        { ...fixture, 'event.json': [{ ...fixture['event.json'][2], from: null }] },
        { ...fixture, 'event.json': [{ ...fixture['event.json'][2], time: false }] }
    ]) {
        const h = harness(broken);
        assert.equal(await h.ctx.demo.init(), false);
        assert.equal(h.ctx.demo.data, null);
        assert.equal(h.liveNetworks(), 0);
        assert.equal(h.ctx.demo.state, 'error');
    }
});

test('stable timeline sorting leaves source rows intact and preserves equal-time event ordering', async () => {
    const h = await ready();
    const source = [{ time: 5, label: 'last' }, { time: 1, label: 'first' }, { time: 1, label: 'second' }];
    const sorted = h.ctx.BCASimData.validateTimeline(source, 'time', 'event.json', 2);
    assert.deepEqual(Array.from(sorted, event => event.label), ['first', 'second', 'last']);
    assert.deepEqual(source.map(event => event.label), ['last', 'first', 'second']);
});

test('traffic animation touches only existing links and is cleared on each clock step', async () => {
    const h = await ready({ ...fixture, 'event.json': [...fixture['event.json'],
        { type: 'ReceiveBlock', time: 20, node: 0, from: 1, height: 1, hash: 'one' }] });
    h.elements.get('speed').value = '10';
    h.ctx.demo.start(); h.tick();
    const renderer = h.ctx.demo.renderer;
    assert.equal(renderer.traffic.size, 1);
    renderer.animateTraffic();
    assert.equal(renderer.edges.get('0:1').arrows.to.enabled, true);
    h.ctx.demo.pause();
    assert.equal(h.timers.size, 0);
    h.ctx.demo.pause(); h.tick();
    assert.equal(h.ctx.demo.state, 'completed');
    assert.equal(renderer.traffic.size, 0);
    assert.equal(renderer.edges.get('0:1').arrows.to.enabled, false);
    assert.equal(renderer.edges.get('0:1').arrows.from.enabled, false);
});

test('loading twice after readiness reuses the recording without leaking graph instances', async () => {
    const h = await ready();
    const renderer = h.ctx.demo.renderer;
    assert.equal(await h.ctx.demo.init(), true);
    assert.equal(h.requests.length, 5);
    assert.equal(h.ctx.demo.renderer, renderer);
    assert.equal(h.liveNetworks(), 2);
});

function localFiles(files = fixture) {
    return Object.entries(files).map(([name, data]) => ({ name, text: async () => typeof data === 'string' ? data : JSON.stringify(data) }));
}

test('invalid local imports preserve the running recording, clocks, graph and comparison', async () => {
    const h = await ready();
    h.ctx.demo.start(); h.tick();
    const player = h.ctx.demo.playback, graph = h.ctx.demo.renderer, timers = [...h.timers.keys()];
    assert.equal(await h.ctx.demo.importFiles(localFiles({ ...fixture, 'event.json': '{broken' })), false);
    assert.equal(h.ctx.demo.playback, player);
    assert.equal(h.ctx.demo.renderer, graph);
    assert.equal(player.time, 2);
    assert.equal(player.state, 'running');
    assert.deepEqual([...h.timers.keys()], timers);
    assert.match(h.elements.get('import_status').textContent, /previous recording is unchanged/);
    assert.equal(await h.ctx.demo.importFiles(localFiles().slice(0, 1)), false);
    assert.equal(h.liveNetworks(), 2);
});

test('valid local imports replace all data and dispose previous clocks exactly once after parsing', async () => {
    const h = await ready();
    h.ctx.demo.start(); h.tick();
    const old = h.ctx.demo.playback;
    let resolve;
    const files = localFiles();
    files[0].text = () => new Promise(done => { resolve = done; });
    const importing = h.ctx.demo.importFiles(files);
    assert.equal(old.state, 'running');
    assert.equal(h.timers.size, 2);
    resolve(fixture['adjacencyMatrix.csv']);
    assert.equal(await importing, true);
    assert.equal(old.state, 'disposed');
    assert.equal(h.ctx.demo.state, 'ready');
    assert.equal(h.ctx.demo.playback.time, 0);
    assert.equal(h.liveNetworks(), 2);
    assert.equal(h.timers.size, 0);
});

test('a newer import supersedes a slower import and comparison does not interrupt playback', async () => {
    const h = await ready();
    let resolve;
    const slow = localFiles();
    slow[0].text = () => new Promise(done => { resolve = done; });
    const first = h.ctx.demo.importFiles(slow);
    assert.equal(await h.ctx.demo.importFiles(localFiles({ ...fixture, 'block.json': [] })), true);
    resolve(fixture['adjacencyMatrix.csv']);
    assert.equal(await first, false);
    assert.equal(h.ctx.demo.data.blocks.length, 0);
    h.ctx.demo.start(); h.tick();
    const old = h.ctx.demo.playback;
    assert.equal(await h.ctx.demo.importFiles(localFiles({ ...fixture, 'metrics.json': { acceptedBlocks: 3 } }), true), true);
    assert.equal(h.ctx.demo.playback, old);
    assert.equal(old.state, 'running');
    assert.equal(h.ctx.demo.comparisonData.metrics.acceptedBlocks, 3);
    assert.equal(h.timers.size, 2);
});

test('network changes replay directed links from the initial topology and seek reconstructs them', async () => {
    const h = await ready({ ...fixture, 'adjacencyMatrix.csv': '0,0\n0,0', 'initialAdjacencyMatrix.csv': '0,1\n1,0',
        'event.json': [
            { type: 'NetworkChange', from: 0, to: 1, time: 1, action: 'disconnect' },
            { type: 'NetworkChange', from: 1, to: 0, time: 2, action: 'disconnect' },
            { type: 'NetworkChange', from: 0, to: 1, time: 3, action: 'connect' },
            { type: 'NetworkChange', from: 0, to: 1, time: 4, action: 'disconnect' }
        ] });
    assert.equal(h.ctx.demo.renderer.edges.length, 1);
    h.ctx.demo.playback.seek(1);
    assert.equal(h.ctx.demo.renderer.edges.length, 1, 'Reverse direction is still connected');
    h.ctx.demo.playback.seek(2);
    assert.equal(h.ctx.demo.renderer.edges.length, 0);
    h.ctx.demo.playback.step('event');
    assert.equal(h.ctx.demo.renderer.edges.length, 1);
    h.ctx.demo.playback.seek(4);
    assert.equal(h.ctx.demo.renderer.edges.length, 0);
    h.ctx.demo.playback.seek(0);
    assert.equal(h.ctx.demo.renderer.edges.length, 1);
});
