/* Local analysis controls and configuration export. No network writes or server dependency. */
(function (root) {
    "use strict";
    var metrics = [
        ["observerNode", "Observer node"], ["attackerNode", "Tracked node"], ["acceptedBlocks", "Accepted blocks"],
        ["totalPublishedBlocks", "Published blocks"], ["staleFraction", "Stale fraction", "%"],
        ["attackerRevenueShare", "Tracked node revenue share", "%"], ["forkPoints", "Fork points"],
        ["reorgCount", "Reorganizations"], ["maxReorgDepth", "Maximum reorganization depth"],
        ["meanPropagationDelay", "Mean propagation delay", "s"], ["attackSuccesses", "Attack successes"],
        ["attackFailures", "Attack failures"], ["attackSuccessRate", "Attack success rate", "%"],
        ["transactionsConfirmed", "Transactions confirmed"]
    ];
    function numeric(value, name, min, max, integer) {
        var n = Number(value);
        if (String(value).trim() === "" || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
            throw new Error(name + " must be " + (integer ? "an integer " : "a number ") + "from " + min + " to " + max + ".");
        }
        return n;
    }
    function buildConfig(fields) {
        var count = numeric(fields.nodes, "Nodes", 1, 200, true);
        var scenario = fields.scenario;
        if (!["honest", "selfish", "double-spend"].includes(scenario)) throw new Error("Choose a supported scenario.");
        if (scenario !== "honest" && count < 2) throw new Error("Attack scenarios need at least two nodes.");
        var seed = String(fields.seed).trim();
        if (!/^-?\d+$/.test(seed) || BigInt(seed) < -9223372036854775808n || BigInt(seed) > 9223372036854775807n) {
            throw new Error("Seed must be a signed 64-bit integer.");
        }
        var duration = numeric(fields.duration, "Duration", 0, Number.MAX_VALUE);
        var interval = numeric(fields.interval, "Block interval", Number.MIN_VALUE, Number.MAX_VALUE);
        var share = numeric(fields.share, "Attacker share", 0, 1);
        var delay = numeric(fields.delay, "Block delay", 0, Number.MAX_VALUE);
        if (!["mesh", "ring"].includes(fields.topology)) throw new Error("Choose mesh or ring topology.");
        var weights = Array.from({ length: count }, function (_, i) {
            return scenario === "honest" ? 1 / count : (i === 0 ? share : (1 - share) / (count - 1));
        });
        if (weights.some(function (weight) { return weight > 0 && (!Number.isFinite(interval / weight) || interval / weight <= 0); })) {
            throw new Error("Block interval divided by node weight must be finite and positive.");
        }
        var strategies = weights.map(function (_, i) { return i === 0 ? scenario : "honest"; });
        var matrix = weights.map(function (_, i) { return weights.map(function (_, j) {
            return i === j ? 0 : (fields.topology === "mesh" || (i + 1) % count === j || (j + 1) % count === i ? 1 : 0);
        }).join(","); }).join(";");
        return ["# BCASim configuration. Time and delays are in seconds.", "seed=" + seed,
            "simulation.time=" + duration, "consensus=PoW", "block.interval=" + interval,
            "block.size=8", "block.reward=10", "transaction.size=1", "transaction.generate=false",
            "nodes.weights=" + weights.join(","), "nodes.strategies=" + strategies.join(","),
            "network.matrix=" + matrix, "network.blockDelay=" + delay, "network.transactionDelay=15", ""].join("\n");
    }
    function comparison(a, b) {
        var definitions = [["nodes", "Nodes"], ["blocks", "Recorded blocks (including Genesis)"],
            ["events", "Recorded events"], ["duration", "Last recorded time", "s"]].concat(metrics);
        function value(data, key) {
            if (!data) return null;
            if (key === "nodes") return data.matrix.length;
            if (key === "blocks" || key === "events") return data[key].length;
            if (key === "duration") return data.duration;
            return data.metrics && data.metrics[key] != null ? Number(data.metrics[key]) : null;
        }
        function format(number, unit, delta) {
            if (number == null) return "Not recorded";
            var adjusted = unit === "%" ? number * 100 : number;
            return (delta && adjusted > 0 ? "+" : "") + adjusted.toLocaleString(undefined, { maximumFractionDigits: 4 }) +
                (unit === "%" ? (delta ? " pp" : "%") : unit === "s" ? " s" : "");
        }
        return definitions.map(function (definition) {
            var key = definition[0], av = value(a, key), bv = value(b, key);
            return { key: key, label: definition[1], a: format(av, definition[2]), b: format(bv, definition[2]),
                delta: (key === "observerNode" || key === "attackerNode") || av == null || bv == null ? "—" : format(bv - av, definition[2], true) };
        });
    }
    function Studio(demo) { this.demo = demo; this.url = null; }
    Studio.prototype.el = function (id) { return this.demo.element(id); };
    Studio.prototype.bind = function () {
        var self = this;
        ["a", "b"].forEach(function (slot) {
            var input = self.el("files_" + slot), zone = self.el("drop_" + slot);
            input.addEventListener("change", function () {
                self.demo.importFiles(input.files, slot === "b");
                input.value = "";
            });
            zone.addEventListener("dragover", function (event) { event.preventDefault(); zone.dataset.dragging = "true"; });
            zone.addEventListener("dragleave", function () { zone.dataset.dragging = "false"; });
            zone.addEventListener("drop", function (event) {
                event.preventDefault(); zone.dataset.dragging = "false";
                self.demo.importFiles(event.dataTransfer.files, slot === "b");
            });
        });
        self.el("clear_comparison").addEventListener("click", function () {
            self.demo.comparisonGeneration++; self.demo.comparisonData = null; self.renderComparison();
        });
        self.el("timeline").addEventListener("change", function () {
            if (self.demo.playback) self.demo.playback.seek(Number(this.value));
        });
        ["event", "block"].forEach(function (kind) {
            self.el("next_" + kind).addEventListener("click", function () { if (self.demo.playback) self.demo.playback.step(kind); });
        });
        ["nodes", "scenario", "seed", "duration", "interval", "share", "delay", "topology"].forEach(function (key) {
            function invalidate() {
                if (!self.url) return;
                root.URL.revokeObjectURL(self.url); self.url = null;
                self.el("config_download").hidden = true;
                self.el("config_preview").textContent = "";
                self.el("config_status").textContent = "Settings changed. Generate the configuration again before downloading.";
            }
            self.el("config_" + key).addEventListener("input", invalidate);
            self.el("config_" + key).addEventListener("change", invalidate);
        });
        self.el("config_form").addEventListener("submit", function (event) {
            event.preventDefault();
            try {
                var fields = {};
                ["nodes", "scenario", "seed", "duration", "interval", "share", "delay", "topology"].forEach(function (key) { fields[key] = self.el("config_" + key).value; });
                var text = buildConfig(fields);
                if (self.url) root.URL.revokeObjectURL(self.url);
                self.url = root.URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
                self.el("config_download").href = self.url;
                self.el("config_download").hidden = false;
                self.el("config_preview").textContent = text;
                self.el("config_status").textContent = "Configuration ready. Download the file and run the command below from your BCASim directory.";
            } catch (error) {
                self.el("config_download").hidden = true;
                self.el("config_preview").textContent = "";
                self.el("config_status").textContent = error.message;
            }
        });
    };
    Studio.prototype.changed = function (playback) {
        var timeline = this.el("timeline");
        timeline.disabled = false; timeline.max = this.demo.data.duration; timeline.value = playback.time;
        this.el("next_event").disabled = playback.state === "completed";
        this.el("next_block").disabled = playback.state === "completed";
        var lastEvent = this.demo.data.events[playback.eventIndex - 1];
        var lastBlock = this.demo.data.blocks[playback.blockIndex - 1];
        this.el("event_detail").textContent = lastEvent ? JSON.stringify(lastEvent, null, 2) : "No events at this time.";
        this.el("block_detail").textContent = lastBlock ? JSON.stringify(lastBlock, null, 2) : "No blocks at this time.";
    };
    Studio.prototype.renderComparison = function () {
        var self = this;
        comparison(this.demo.data, this.demo.comparisonData).forEach(function (row) {
            ["a", "b", "delta"].forEach(function (column) { self.el("metric_" + row.key + "_" + column).textContent = row[column]; });
        });
        this.el("clear_comparison").disabled = !this.demo.comparisonData;
    };
    root.BCASimStudio = Studio;
    root.BCASimAnalysis = { buildConfig: buildConfig, comparison: comparison };
    if (typeof module !== "undefined" && module.exports) module.exports = root.BCASimAnalysis;
})(typeof globalThis !== "undefined" ? globalThis : this);
