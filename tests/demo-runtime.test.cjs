const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
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
    ['start_button', 'pause_button', 'reset_button', 'status_message', 'timestamp_area', 'setting_panel', 'network_panel', 'blockchain_panel'].forEach(id => element(id));
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
                    resolve(status = 200) {
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
    for (const script of ['read-file', 'blockchain', 'network', 'main']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'demo/js', script + '.js'), 'utf8'), context, { filename: script + '.js' });
    }
    return {
        ctx: context, elements, timers, networks, requests, radios, windowListeners,
        tick() { for (const timer of [...timers.values()]) if (timer.delay === 500) timer.fn(); },
        liveNetworks() { return networks.filter(network => !network.destroyed).length; }
    };
}

async function ready(files) {
    const h = harness(files);
    assert.equal(await h.ctx.init(), true);
    return h;
}

test('all three files must finish before playback becomes available', async () => {
    const h = harness(fixture, true);
    const initializing = h.ctx.init();
    assert.equal(h.ctx.init(), initializing, 'Concurrent initialization shares a promise');
    assert.equal(h.elements.get('start_button').disabled, true);
    assert.equal(h.ctx.start_simulation(), false);
    assert.equal(h.requests.length, 3);
    h.requests.find(r => r.name === 'block.json').resolve();
    h.requests.find(r => r.name === 'event.json').resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.ctx.blockchain_data, undefined, 'Publish the dataset atomically');
    assert.equal(h.liveNetworks(), 0);
    h.requests.find(r => r.name === 'adjacencyMatrix.csv').resolve();
    assert.equal(await initializing, true);
    assert.equal(h.ctx.simulation_state, 'ready');
    assert.equal(h.ctx.nodes.length, 2);
    assert.equal(h.ctx.nodes_block.length, 1);
    assert.equal(h.elements.get('start_button').disabled, false);
    assert.equal(h.timers.size, 0);
});

test('HTTP failures expose Retry loading and a retry does not duplicate listeners', async () => {
    const h = harness(fixture, true);
    const initializing = h.ctx.init();
    h.requests[0].resolve(404);
    h.requests[1].resolve();
    h.requests[2].resolve();
    assert.equal(await initializing, false);
    assert.equal(h.ctx.simulation_state, 'error');
    assert.match(h.elements.get('status_message').textContent, /HTTP 404/);
    assert.equal(h.elements.get('start_button').textContent, 'Retry loading');
    assert.equal(h.elements.get('start_button').disabled, false);
    const retry = h.ctx.start_simulation();
    h.requests.slice(3).forEach(request => request.resolve());
    assert.equal(await retry, true);
    assert.equal(h.elements.get('start_button').listeners.click.length, 1);
    assert.equal(h.liveNetworks(), 2);
});

test('CSV parsing accepts CRLF and trailing newlines but rejects malformed matrices', async () => {
    const h = await ready();
    assert.equal(h.ctx.createArray('0,1\r\n1,0\r\n').length, 2);
    for (const csv of ['', '0,1\n1', '0,x\n1,0']) {
        assert.throws(() => h.ctx.createArray(csv));
    }
    const malformed = await ready();
    assert.throws(() => malformed.ctx.validate_timeline([{ time: 'NaN' }], 'time', 'event.json', 2));
    assert.throws(() => malformed.ctx.validate_timeline([{ time: 0, type: 'ReceiveBlock', node: 99, from: 0, height: 1, hash: 'x' }], 'time', 'event.json', 2));
});

test('repeated starts reset cursors and graph data with exactly two playback timers', async () => {
    const h = await ready();
    assert.equal(h.ctx.start_simulation(), true);
    h.tick(); h.tick();
    assert.equal(h.ctx.time, 4);
    assert.equal(h.ctx.nodes_block.length, 2);
    assert.equal(h.ctx.start_simulation(), true);
    assert.equal(h.ctx.time, 0);
    assert.equal(h.ctx.nodes_block.length, 1);
    assert.equal(h.ctx.event_id, 1);
    assert.equal(h.ctx.nodes.length, 2);
    assert.equal(h.ctx.edges.length, 1);
    assert.equal(h.timers.size, 2);
    assert.equal(h.liveNetworks(), 2);
});

test('pause and resume retain progress and settings only apply on restart', async () => {
    const h = await ready();
    h.ctx.start_simulation(); h.tick();
    h.ctx.pause_simulation();
    assert.equal(h.ctx.simulation_state, 'paused');
    assert.equal(h.timers.size, 0);
    h.elements.get('speed').value = '5';
    h.radios[0].checked = false; h.radios[1].checked = true;
    h.ctx.showClock();
    assert.equal(h.ctx.time, 2);
    h.ctx.pause_simulation(); h.tick();
    assert.equal(h.ctx.time, 4);
    assert.equal(h.ctx.simulation_speed, 2);
    assert.equal(h.ctx.simulation_color_mode, '1');
    h.ctx.start_simulation(); h.tick();
    assert.equal(h.ctx.time, 5);
    assert.equal(h.ctx.simulation_color_mode, '2');
    assert.equal(h.ctx.nodes.get(0).group, h.ctx.nodes_block.get(1).group, 'Miner groups match in both graphs');
    assert.equal(h.ctx.nodes.get(0).color, h.ctx.nodes_block.get(1).color, 'Miner colors match in both graphs');
    h.ctx.reset_simulation();
    assert.equal(h.ctx.time, 0);
    assert.equal(h.ctx.simulation_state, 'ready');
    assert.equal(h.timers.size, 0);
    assert.equal(h.ctx.nodes_block.length, 1);
    assert.equal(h.liveNetworks(), 2);
});

test('playback continues after blocks end, then stops at the final event without out-of-bounds reads', async () => {
    const h = await ready();
    h.elements.get('speed').value = '4';
    h.ctx.start_simulation(); h.tick();
    assert.equal(h.ctx.block_index, fixture['block.json'].length);
    assert.equal(h.ctx.simulation_state, 'running');
    h.tick(); h.tick();
    assert.equal(h.ctx.time, 10);
    assert.equal(h.ctx.event_id, fixture['event.json'].length);
    assert.equal(h.ctx.simulation_state, 'completed');
    assert.equal(h.timers.size, 0);
    assert.equal(h.ctx.next_block(), false);
    assert.equal(h.ctx.block_event(), false);
    assert.equal(h.elements.get('pause_button').disabled, true);
    assert.equal(h.ctx.nodes.get(1).group, h.ctx.nodes_block.get(1).group, 'Block groups match in both graphs');
    assert.equal(h.ctx.nodes.get(1).color, h.ctx.nodes_block.get(1).color, 'Block colors match in both graphs');
});

test('blocks continue after events end and empty timelines complete safely', async () => {
    const h = await ready({ ...fixture, 'event.json': [] });
    h.ctx.start_simulation(); h.tick();
    assert.equal(h.ctx.simulation_state, 'running');
    h.tick();
    assert.equal(h.ctx.time, 3);
    assert.equal(h.ctx.simulation_state, 'completed');
    const empty = await ready({ ...fixture, 'event.json': [], 'block.json': [] });
    empty.ctx.start_simulation();
    assert.equal(empty.ctx.simulation_state, 'completed');
    assert.equal(empty.timers.size, 0);
});

test('start time reconstructs prior state and the final timestamp immediately completes', async () => {
    const h = await ready();
    h.elements.get('start_point').value = '4';
    h.ctx.start_simulation();
    assert.equal(h.ctx.time, 4);
    assert.equal(h.ctx.block_index, 2);
    assert.equal(h.ctx.event_id, 2);
    assert.equal(h.ctx.nodes.get(0).group, h.ctx.nodes_block.get(1).group);
    h.elements.get('start_point').value = '10';
    h.ctx.start_simulation();
    assert.equal(h.ctx.simulation_state, 'completed');
    assert.equal(h.timers.size, 0);
});

test('invalid speed and start time are rejected before creating timers or changing graphs', async () => {
    const h = await ready();
    for (const value of ['', '-1', '0', 'NaN', 'Infinity', '0.01', '10001']) {
        h.elements.get('speed').value = value;
        assert.equal(h.ctx.start_simulation(), false, value);
        assert.equal(h.elements.get('speed').attributes['aria-invalid'], 'true');
        assert.equal(h.elements.get('status_message').dataset.state, 'error');
        assert.equal(h.elements.get('setting_panel').open, true, 'Invalid fields are revealed before focus');
        assert.equal(h.timers.size, 0);
    }
    h.elements.get('speed').value = '2';
    for (const value of ['', '-1', 'NaN', 'Infinity', '11']) {
        h.elements.get('start_point').value = value;
        assert.equal(h.ctx.start_simulation(), false, value);
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
    h.ctx.start_simulation(); h.tick();
    assert.equal(h.ctx.simulation_state, 'completed');
    assert.equal(h.ctx.nodes_block.length, 4);
    assert.equal(h.ctx.edges_block.length, 2);
    assert.equal(h.ctx.edges_block.get('block:1').from, 3);
});

test('the bundled 100-node recording completes and resets without accumulated graph objects', async () => {
    const files = {};
    for (const name of Object.keys(fixture)) {
        const contents = fs.readFileSync(path.join(root, 'demo/output-file', name), 'utf8');
        files[name] = name.endsWith('.json') ? JSON.parse(contents) : contents;
    }
    const h = await ready(files);
    assert.equal(h.ctx.nodes.length, 100);
    h.elements.get('speed').value = '10000';
    h.ctx.start_simulation(); h.tick(); h.tick();
    assert.equal(h.ctx.simulation_state, 'completed');
    assert.equal(h.ctx.block_index, files['block.json'].length);
    assert.equal(h.ctx.event_id, files['event.json'].length);
    assert.equal(h.ctx.nodes_block.length, 104);
    assert.equal(h.ctx.edges_block.length, 103);
    assert.equal(h.ctx.pending_block_edges.length, 0);
    assert.equal(h.timers.size, 0);
    h.ctx.reset_simulation();
    assert.equal(h.ctx.nodes.length, 100);
    assert.equal(h.ctx.nodes_block.length, 1);
    assert.equal(h.liveNetworks(), 2);
});


test('leaving the page pauses playback so a cached Back navigation can resume safely', async () => {
    const h = await ready();
    h.ctx.start_simulation(); h.tick();
    h.windowListeners.pagehide();
    assert.equal(h.timers.size, 0);
    assert.equal(h.ctx.simulation_state, 'paused');
    assert.equal(h.elements.get('pause_button').textContent, 'Resume');
    h.ctx.pause_simulation(); h.tick();
    assert.equal(h.ctx.time, 4);
    assert.equal(h.timers.size, 2);
});
