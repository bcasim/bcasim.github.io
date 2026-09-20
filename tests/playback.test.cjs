const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const assets = fs.existsSync(path.join(root, 'js/playback.js')) ? root : path.join(root, 'demo');
const Playback = require(path.join(assets, 'js/playback.js'));
const Data = require(path.join(assets, 'js/read-file.js'));

function recording() {
    return Data.parse('0,1\n1,0', [
        { hash: 'zero', previousHash: 'none', height: 0, miner: 'Genesis', receiveTime: 0 },
        { hash: 'one', previousHash: 'zero', height: 1, miner: 0, receiveTime: 1 }
    ], [{ type: 'FoundBlock', node: 0, hash: 'one', height: 1, time: 1 },
        { type: 'ReceiveBlock', node: 1, from: 0, hash: 'one', height: 1, time: 2 }]);
}
function harness(data = recording()) {
    let timerId = 0;
    const timers = new Map();
    const calls = [];
    const renderer = Object.fromEntries(['reset', 'block', 'event', 'fit', 'clearTraffic', 'animateTraffic', 'destroy']
        .map(name => [name, (...args) => { calls.push([name, ...args]); }]));
    const scheduler = {
        setInterval(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
        clearInterval(id) { timers.delete(id); }
    };
    return { player: new Playback(data, renderer, scheduler), timers, calls };
}

test('playback works without a browser and preserves block-before-event ordering', () => {
    const h = harness();
    h.player.start({ time: 0, speed: 1, color: '1' });
    h.calls.length = 0;
    h.player.tick();
    assert.deepEqual(h.calls.filter(call => ['block', 'event'].includes(call[0])).map(call => call[0]), ['block', 'event']);
    assert.equal(h.player.state, 'running');
    h.player.tick();
    assert.equal(h.player.state, 'completed');
    assert.equal(h.player.time, 2);
    assert.equal(h.timers.size, 0);
});

test('two playback instances have independent cursors, state, and timers', () => {
    const one = harness();
    const two = harness();
    one.player.start({ time: 0, speed: 0.5, color: '1' });
    two.player.start({ time: 1, speed: 1, color: '2' });
    one.player.tick();
    one.player.pause();
    assert.equal(one.player.time, 0.5);
    assert.equal(two.player.time, 1);
    assert.equal(one.timers.size, 0);
    assert.equal(two.timers.size, 2);
    two.player.dispose();
    assert.equal(two.timers.size, 0);
    assert.equal(two.player.state, 'disposed');
    assert.ok(two.calls.some(call => call[0] === 'destroy'));
});

test('invalid restart leaves the running experiment and timers untouched', () => {
    const h = harness();
    h.player.start({ time: 0, speed: 1, color: '1' });
    h.player.tick();
    const before = [...h.timers.keys()];
    for (const invalid of [null, { time: -1, speed: 1, color: '1' }, { time: 0, speed: NaN, color: '1' },
        { time: 0, speed: 1, color: 'missing' }]) assert.throws(() => h.player.start(invalid), /Invalid playback settings/);
    assert.equal(h.player.time, 1);
    assert.equal(h.player.state, 'running');
    assert.deepEqual([...h.timers.keys()], before);
});

test('fractional steps clamp to duration and repeated completed ticks are inert', () => {
    const h = harness();
    h.player.start({ time: 0, speed: 0.3, color: '1' });
    for (let i = 0; i < 20; i++) h.player.tick();
    assert.equal(h.player.time, 2);
    assert.equal(h.player.state, 'completed');
    assert.equal(h.player.blockIndex, 2);
    assert.equal(h.player.eventIndex, 2);
    assert.equal(h.calls.filter(call => call[0] === 'event').length, 2);
});
