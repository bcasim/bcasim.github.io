/* Graph adapter: rendering and traffic effects are separate from the playback clock. */
(function (root) {
    "use strict";
    var palette = ["#97c2fc", "#fbd38d", "#9ae6b4", "#d6bcfa", "#feb2b2", "#81e6d9", "#fef08a", "#fbb6ce", "#b4d8a4", "#c4b5fd", "#a5f3fc", "#fed7aa"];
    function color(group) { return group === 0 ? "#e2e8f0" : palette[(group - 1) % palette.length]; }
    function edgeId(from, to) { return Math.min(from, to) + ":" + Math.max(from, to); }
    function Renderer(vis, networkContainer, blockchainContainer) {
        this.vis = vis;
        this.container = networkContainer;
        this.nodes = new vis.DataSet([]);
        this.edges = new vis.DataSet([]);
        this.network = null;
        this.blockchain = new root.BCASimBlockchainGraph(vis, blockchainContainer, color);
        this.traffic = new Map();
    }
    Renderer.prototype.destroy = function () {
        if (this.network) this.network.destroy();
        this.network = null;
        this.blockchain.destroy();
    };
    Renderer.prototype.reset = function (data, mode) {
        this.destroy();
        this.data = data;
        this.mode = mode;
        this.nodes.clear();
        this.edges.clear();
        this.heights = new Array(data.matrix.length).fill(0);
        this.hashColors = new Map();
        data.blocks.forEach(function (block, index) {
            this.hashColors.set(block.hash, block.previousHash === "none" ? 0 : index + 1);
        }, this);
        this.traffic.clear();
        this.trafficFlash = false;
        this.nodes.add(data.matrix.map(function (_, index) {
            var group = mode === "1" ? 1 : index + 1;
            return { id: index, label: "node" + index, group: group, color: color(group) };
        }));
        var additions = [];
        for (var i = 0; i < data.matrix.length; i++) {
            for (var j = i; j < data.matrix.length; j++) {
                if (data.matrix[i][j] === 1 || data.matrix[j][i] === 1) {
                    additions.push({ id: edgeId(i, j), from: i, to: j, color: "#848484", width: 2 });
                }
            }
        }
        this.edges.add(additions);
        this.network = new this.vis.Network(this.container, { nodes: this.nodes, edges: this.edges }, {
            nodes: { shape: "dot", size: 15 }, edges: { smooth: false },
            physics: {
                forceAtlas2Based: { gravitationalConstant: -26, centralGravity: 0.005, springLength: 230, springConstant: 0.18 },
                maxVelocity: 146, solver: "forceAtlas2Based", timestep: 0.35
            }
        });
        this.blockchain.reset(mode);
    };
    Renderer.prototype.block = function (block, index) { this.blockchain.add(block, index); };
    Renderer.prototype.fit = function () { this.blockchain.fit(); };
    Renderer.prototype.event = function (event) {
        if (event.type !== "FoundBlock" && event.type !== "ReceiveBlock") return;
        var node = Number(event.node);
        var from = Number(event.from);
        if (event.type === "ReceiveBlock" && this.edges.get(edgeId(from, node))) {
            this.traffic.set(edgeId(from, node), from <= node ? "to" : "from");
        }
        if (this.heights[node] < Number(event.height)) {
            this.heights[node] = Number(event.height);
            if (this.mode === "1") {
                if (!this.hashColors.has(event.hash)) this.hashColors.set(event.hash, this.hashColors.size + 1);
                var group = this.hashColors.get(event.hash);
                this.nodes.update({ id: node, group: group, color: color(group) });
            }
        }
    };
    Renderer.prototype.animateTraffic = function () {
        if (!this.network) return;
        this.trafficFlash = !this.trafficFlash;
        var flash = this.trafficFlash;
        var updates = [];
        this.traffic.forEach(function (direction, id) {
            updates.push({ id: id, color: flash ? "#e23c3c" : "#848484", width: flash ? 3 : 2,
                arrows: { to: { enabled: flash && direction === "to" }, from: { enabled: flash && direction === "from" } } });
        });
        if (updates.length) this.edges.update(updates);
    };
    Renderer.prototype.clearTraffic = function () {
        var updates = [];
        this.traffic.forEach(function (_, id) {
            updates.push({ id: id, color: "#848484", width: 2, arrows: { to: { enabled: false }, from: { enabled: false } } });
        });
        if (updates.length) this.edges.update(updates);
        this.traffic.clear();
    };
    root.BCASimRenderer = Renderer;
})(typeof globalThis !== "undefined" ? globalThis : this);
