const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const assets = fs.existsSync(path.join(root, 'js/studio.js')) ? root : path.join(root, 'demo');
const { buildConfig, comparison } = require(path.join(assets, 'js/studio.js'));
const Data = require(path.join(assets, 'js/read-file.js'));
const fields = { nodes: '5', scenario: 'selfish', seed: '9223372036854775807', duration: '1000', interval: '10', share: '0.3', delay: '2', topology: 'ring' };
function properties(text) { return Object.fromEntries(text.split('\n').filter(line => line.includes('=')).map(line => line.split('='))); }

test('configuration builder exports consistent node weights, strategies and a symmetric connected ring', () => {
    const config = properties(buildConfig(fields));
    assert.equal(config.seed, fields.seed, '64-bit seed must not lose precision in JavaScript');
    assert.equal(config['nodes.strategies'], 'selfish,honest,honest,honest,honest');
    const weights = config['nodes.weights'].split(',').map(Number);
    assert.equal(weights[0], 0.3);
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    const matrix = config['network.matrix'].split(';').map(row => row.split(',').map(Number));
    assert.equal(matrix.length, 5);
    matrix.forEach((row, i) => {
        assert.equal(row.length, 5); assert.equal(row[i], 0); assert.equal(row.reduce((a, b) => a + b, 0), 2);
        row.forEach((value, j) => assert.equal(value, matrix[j][i]));
    });
    assert.equal(config['transaction.generate'], 'false');
    assert.equal(config['network.blockDelay'], '2');
});

test('honest single-node and double-spend configurations remain valid and mesh has no self links', () => {
    const one = properties(buildConfig({ ...fields, nodes: '1', scenario: 'honest' }));
    assert.equal(one['network.matrix'], '0'); assert.equal(one['nodes.weights'], '1');
    const two = properties(buildConfig({ ...fields, nodes: '2', scenario: 'double-spend', topology: 'mesh' }));
    assert.equal(two['network.matrix'], '0,1;1,0');
    assert.equal(two['nodes.strategies'], 'double-spend,honest');
});

test('configuration rejects invalid parameters and property injection', () => {
    for (const patch of [{ nodes: '' }, { nodes: '201' }, { nodes: '1' }, { nodes: '2.5' }, { share: '1.1' },
        { share: '' }, { duration: '-1' }, { duration: 'Infinity' }, { delay: '-0.5' }, { interval: '0' },
        { interval: '1e309' }, { interval: '1e308' }, { seed: '9223372036854775808' }, { seed: '1\nconsensus=evil' },
        { seed: '1.5' }, { scenario: 'evil' }, { topology: 'evil' }]) {
        assert.throws(() => buildConfig({ ...fields, ...patch }), JSON.stringify(patch));
    }
});

test('comparison distinguishes missing metrics from zero and uses percentage points without inventing successes', () => {
    const a = Data.parse('0', [], [], { metrics: { acceptedBlocks: 0, staleFraction: 0.1, attackSuccessRate: null, observerNode: 0 } });
    const b = Data.parse('0', [], [], { metrics: { acceptedBlocks: 3, staleFraction: 0.15, observerNode: 0 } });
    const rows = Object.fromEntries(comparison(a, b).map(row => [row.key, row]));
    assert.equal(rows.acceptedBlocks.a, '0'); assert.equal(rows.acceptedBlocks.delta, '+3');
    assert.equal(rows.staleFraction.delta, '+5 pp');
    assert.equal(rows.attackSuccessRate.a, 'Not recorded'); assert.equal(rows.attackSuccessRate.delta, '—');
    assert.equal(rows.observerNode.delta, '—');
    assert.equal(comparison(a, null).find(row => row.key === 'nodes').b, 'Not recorded');
});

test('local selection validates duplicate names, optional metrics, topology size and required initial state', async () => {
    const files = [
        { name: 'adjacencyMatrix.csv', text: async () => '0,1\n1,0' },
        { name: 'block.json', text: async () => '[]' },
        { name: 'event.json', text: async () => '[]' }
    ];
    const data = await Data.fromFiles(files);
    assert.equal(data.metrics, null);
    assert.throws(() => Data.fromFiles(files.concat(files[0])), /duplicate/);
    await assert.rejects(Data.fromFiles(files.concat({ name: 'metrics.json', text: async () => '{"staleFraction":2}' })), /staleFraction/);
    await assert.rejects(Data.fromFiles(files.concat({ name: 'initialAdjacencyMatrix.csv', text: async () => '0' })), /sizes differ/);
    assert.throws(() => Data.parse('0,1\n1,0', [], [{ type: 'NetworkChange', from: 0, to: 1, action: 'disconnect', time: 1 }]), /initialAdjacencyMatrix/);
    for (const patch of [{ from: -1 }, { to: 2 }, { action: 'drop' }, { from: 1 }]) {
        assert.throws(() => Data.parse('0,1\n1,0', [], [{ type: 'NetworkChange', from: 0, to: 1, action: 'disconnect', time: 1, ...patch }], { initialMatrix: '0,1\n1,0' }), /invalid network/);
    }
});


test('initial topology and change log must reproduce the final matrix', () => {
    assert.throws(() => Data.parse('0,1\n1,0', [], [
        { type: 'NetworkChange', from: 0, to: 1, action: 'disconnect', time: 1 }
    ], { initialMatrix: '0,1\n1,0' }), /do not match/);
    assert.throws(() => Data.parse('0', [], [], { metrics: { attackerNode: 2 } }), /attackerNode/);
});
