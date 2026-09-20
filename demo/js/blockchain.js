/* Blockchain graph. The cursor always advances, including for orphan blocks. */
var nodes_block = new vis.DataSet([]);
var edges_block = new vis.DataSet([]);
var block_index = 0;
var block_node_ids = new Map();
var pending_block_edges = [];
var blockchain_network = null;

function reset_blockchain() {
    if (blockchain_network) {
        blockchain_network.destroy();
        blockchain_network = null;
    }
    nodes_block.clear();
    edges_block.clear();
    block_index = 0;
    block_node_ids = new Map();
    pending_block_edges = [];
    blockchain_network = new vis.Network(document.getElementById("blockchain_panel"), {
        nodes: nodes_block, edges: edges_block
    }, {
        nodes: { shape: "box", size: 26 },
        layout: { hierarchical: { sortMethod: "directed" } },
        interaction: { keyboard: { enabled: true, bindToWindow: false } }
    });
}

function next_block() {
    if (block_index >= blockchain_data.length) {
        return false;
    }
    var id = block_index++;
    var block = blockchain_data[id];
    var genesis = block.previousHash === "none";
    var group = genesis ? 0 : (simulation_color_mode === "1" ? id + 1 : Number(block.miner) + 1);
    nodes_block.add({
        id: id,
        label: genesis ? "0\ngenesis" : block.height + "\nnode" + block.miner,
        group: group,
        color: graph_color(group)
    });
    block_node_ids.set(block.hash, id);
    if (!genesis) {
        pending_block_edges.push({ previousHash: block.previousHash, to: id });
    }
    pending_block_edges = pending_block_edges.filter(function (edge) {
        if (!block_node_ids.has(edge.previousHash)) {
            return true;
        }
        var from = block_node_ids.get(edge.previousHash);
        if (from !== edge.to) {
            edges_block.add({ id: "block:" + edge.to, from: from, to: edge.to, arrows: "to", width: 3 });
        }
        return false;
    });
    return true;
}
