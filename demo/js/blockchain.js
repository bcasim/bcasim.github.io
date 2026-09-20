/* Blockchain renderer: owns graph data and resolves parents without blocking replay. */
(function (root) {
    "use strict";
    function BlockchainGraph(vis, container, color) {
        this.vis = vis;
        this.container = container;
        this.color = color;
        this.nodes = new vis.DataSet([]);
        this.edges = new vis.DataSet([]);
        this.network = null;
    }
    BlockchainGraph.prototype.destroy = function () {
        if (this.network) this.network.destroy();
        this.network = null;
    };
    BlockchainGraph.prototype.reset = function (mode) {
        this.destroy();
        this.mode = mode;
        this.nodes.clear();
        this.edges.clear();
        this.ids = new Map();
        this.pending = new Map();
        this.network = new this.vis.Network(this.container, { nodes: this.nodes, edges: this.edges }, {
            nodes: { shape: "box", size: 26 },
            layout: { hierarchical: { sortMethod: "directed" } },
            interaction: { keyboard: { enabled: true, bindToWindow: false } }
        });
    };
    BlockchainGraph.prototype.connect = function (from, to) {
        if (from !== to) this.edges.add({ id: "block:" + to, from: from, to: to, arrows: "to", width: 3 });
    };
    BlockchainGraph.prototype.add = function (block, id) {
        var genesis = block.previousHash === "none";
        var group = genesis ? 0 : (this.mode === "1" ? id + 1 : Number(block.miner) + 1);
        this.nodes.add({ id: id, label: genesis ? "0\ngenesis" : block.height + "\nnode" + block.miner,
            group: group, color: this.color(group) });
        this.ids.set(block.hash, id);
        if (!genesis) {
            if (this.ids.has(block.previousHash)) this.connect(this.ids.get(block.previousHash), id);
            else {
                if (!this.pending.has(block.previousHash)) this.pending.set(block.previousHash, []);
                this.pending.get(block.previousHash).push(id);
            }
        }
        var children = this.pending.get(block.hash) || [];
        children.forEach(function (child) { this.connect(id, child); }, this);
        this.pending.delete(block.hash);
    };
    BlockchainGraph.prototype.fit = function () {
        if (this.network) this.network.fit({ animation: false });
    };
    root.BCASimBlockchainGraph = BlockchainGraph;
})(typeof globalThis !== "undefined" ? globalThis : this);
