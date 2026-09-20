/* Network nodes, links, and the traffic visible during the current tick. */
var nodes = new vis.DataSet([]);
var edges = new vis.DataSet([]);
var network = null;
var traffic_count = true;
var traffic_edge = [];
var traffic_arrow = [];
var event_id = 0;
var node_index = [];
var hash_colors = new Map();
// Explicit colors keep both vis instances consistent regardless of group creation order.
var graph_palette = ["#97c2fc", "#fbd38d", "#9ae6b4", "#d6bcfa", "#feb2b2", "#81e6d9", "#fef08a", "#fbb6ce", "#b4d8a4", "#c4b5fd", "#a5f3fc", "#fed7aa"];

function graph_color(group) {
    return group === 0 ? "#e2e8f0" : graph_palette[(group - 1) % graph_palette.length];
}

function network_edge_id(from, to) {
    return Math.min(from, to) + ":" + Math.max(from, to);
}

function reset_network() {
    if (network) {
        network.destroy();
        network = null;
    }
    nodes.clear();
    edges.clear();
    event_id = 0;
    node_index = new Array(matrix_data.length).fill(0);
    hash_colors = new Map();
    blockchain_data.forEach(function (block, index) {
        hash_colors.set(block.hash, index === 0 ? 0 : index + 1);
    });
    traffic_count = true;
    init_traffic_list();
    add_node();
    add_edge();
    init_network();
}

function add_node() {
    var additions = matrix_data.map(function (_, index) {
        var group = simulation_color_mode === "1" ? 1 : index + 1;
        return { id: index, label: "node" + index, group: group, color: graph_color(group) };
    });
    nodes.add(additions);
}

function add_edge() {
    var additions = [];
    for (var i = 0; i < matrix_data.length; i++) {
        for (var j = i; j < matrix_data.length; j++) {
            if (matrix_data[i][j] === 1 || matrix_data[j][i] === 1) {
                additions.push({ id: network_edge_id(i, j), from: i, to: j, color: "#848484", width: 2 });
            }
        }
    }
    edges.add(additions);
}

function update_node_found(node_id, height, hash) {
    update_node_receive(node_id, height, hash);
}

function update_node_receive(node_id, height, hash) {
    if (node_index[node_id] < height) {
        node_index[node_id] = height;
        if (simulation_color_mode === "1") {
            if (!hash_colors.has(hash)) {
                hash_colors.set(hash, hash_colors.size + 1);
            }
            var group = hash_colors.get(hash);
            nodes.update({ id: node_id, group: group, color: graph_color(group) });
        }
    }
}

function play_traffic() {
    if (!network) {
        return;
    }
    traffic_count = !traffic_count;
    var updates = [];
    for (var i = 0; i < traffic_edge.length; i++) {
        for (var j = i; j < traffic_edge.length; j++) {
            if (traffic_edge[i][j]) {
                updates.push({
                    id: network_edge_id(i, j),
                    color: traffic_count ? "#848484" : "#e23c3c",
                    width: traffic_count ? 2 : 3,
                    arrows: {
                        to: { enabled: !traffic_count && traffic_arrow[i][j] === 0 },
                        from: { enabled: !traffic_count && traffic_arrow[i][j] === 1 }
                    }
                });
            }
        }
    }
    if (updates.length) {
        edges.update(updates);
    }
}

function init_traffic_list() {
    traffic_edge = matrix_data.map(function () { return new Array(matrix_data.length).fill(0); });
    traffic_arrow = matrix_data.map(function () { return new Array(matrix_data.length).fill(0); });
}

function add_traffic_list(from, to) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 ||
        from >= matrix_data.length || to >= matrix_data.length) {
        return;
    }
    var lower = Math.min(from, to);
    var upper = Math.max(from, to);
    // Only highlight links that exist in the supplied topology.
    if (!edges.get(network_edge_id(lower, upper))) {
        return;
    }
    traffic_edge[lower][upper] = 1;
    traffic_arrow[lower][upper] = from <= to ? 0 : 1;
}

function remove_traffic() {
    var updates = [];
    for (var i = 0; i < traffic_edge.length; i++) {
        for (var j = i; j < traffic_edge.length; j++) {
            if (traffic_edge[i][j]) {
                traffic_edge[i][j] = 0;
                updates.push({
                    id: network_edge_id(i, j), color: "#848484", width: 2,
                    arrows: { to: { enabled: false }, from: { enabled: false } }
                });
            }
        }
    }
    if (updates.length) {
        edges.update(updates);
    }
}

function init_network() {
    network = new vis.Network(document.getElementById("network_panel"), { nodes: nodes, edges: edges }, {
        nodes: { shape: "dot", size: 15 },
        edges: { smooth: false },
        physics: {
            forceAtlas2Based: {
                gravitationalConstant: -26, centralGravity: 0.005,
                springLength: 230, springConstant: 0.18
            },
            maxVelocity: 146, solver: "forceAtlas2Based", timestep: 0.35
        }
    });
}

function block_event() {
    if (event_id >= event_data.length) {
        return false;
    }
    var event = event_data[event_id++];
    if (event.type === "FoundBlock") {
        update_node_found(Number(event.node), Number(event.height), event.hash);
    } else if (event.type === "ReceiveBlock") {
        add_traffic_list(Number(event.from), Number(event.node));
        update_node_receive(Number(event.node), Number(event.height), event.hash);
    }
    return true;
}
