/* Data boundary: parse, validate, and load a complete recording without a DOM. */
(function (root) {
    "use strict";
    function parseMatrix(csv) {
        if (typeof csv !== "string" || !csv.trim()) {
            throw new Error("The network matrix must be a non-empty square.");
        }
        var matrix = csv.trim().split(/\r?\n/).map(function (line) {
            return line.split(",").map(function (value) {
                if (!/^[01]$/.test(value.trim())) {
                    throw new Error("The network matrix must contain only 0 and 1.");
                }
                return Number(value);
            });
        });
        if (matrix.some(function (row) { return row.length !== matrix.length; })) {
            throw new Error("The network matrix must be a non-empty square.");
        }
        return matrix;
    }

    function number(value) {
        return value !== null && value !== undefined && String(value).trim() !== "" &&
            (typeof value === "number" || typeof value === "string") && Number.isFinite(Number(value));
    }

    function validNode(value, count) {
        return number(value) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) < count;
    }

    function validateTimeline(data, timeKey, filename, nodeCount) {
        if (!Array.isArray(data)) throw new Error(filename + " must contain a list.");
        var hashes = new Set();
        data.forEach(function (item) {
            if (!item || typeof item !== "object" || !number(item[timeKey]) || Number(item[timeKey]) < 0) {
                throw new Error(filename + " contains an invalid time.");
            }
            if (timeKey === "receiveTime") {
                if (typeof item.hash !== "string" || !item.hash || typeof item.previousHash !== "string" ||
                    !item.previousHash || hashes.has(item.hash) || !number(item.height) ||
                    !Number.isInteger(Number(item.height)) || Number(item.height) < 0 ||
                    (item.previousHash !== "none" && !validNode(item.miner, nodeCount))) {
                    throw new Error(filename + " contains an invalid or duplicate block.");
                }
                hashes.add(item.hash);
            }
            if (item.type === "NetworkChange" && (!validNode(item.from, nodeCount) || !validNode(item.to, nodeCount) ||
                Number(item.from) === Number(item.to) || (item.action !== "connect" && item.action !== "disconnect"))) {
                throw new Error(filename + " contains an invalid network change.");
            }
            if (item.type === "FoundBlock" || item.type === "ReceiveBlock") {
                if (!validNode(item.node, nodeCount) || !number(item.height) ||
                    !Number.isInteger(Number(item.height)) || Number(item.height) < 0 ||
                    typeof item.hash !== "string" || !item.hash ||
                    (item.type === "ReceiveBlock" && !validNode(item.from, nodeCount))) {
                    throw new Error(filename + " contains an invalid node or block event.");
                }
            }
        });
        // Stable sort preserves export order among events with the same timestamp.
        return data.slice().sort(function (a, b) { return Number(a[timeKey]) - Number(b[timeKey]); });
    }

    function validateMetrics(metrics, count) {
        if (metrics == null) return null;
        if (typeof metrics !== "object" || Array.isArray(metrics)) throw new Error("metrics.json must contain an object.");
        ["acceptedBlocks", "totalPublishedBlocks", "staleFraction", "attackerRevenueShare", "forkPoints", "reorgCount",
            "maxReorgDepth", "meanPropagationDelay", "attackSuccesses", "attackFailures", "attackSuccessRate", "transactionsConfirmed"].forEach(function (key) {
            if (metrics[key] != null && (!number(metrics[key]) || Number(metrics[key]) < 0)) {
                throw new Error("metrics.json contains an invalid " + key + ".");
            }
        });
        ["staleFraction", "attackerRevenueShare", "attackSuccessRate"].forEach(function (key) {
            if (metrics[key] != null && Number(metrics[key]) > 1) throw new Error("metrics.json contains an invalid " + key + ".");
        });
        ["observerNode", "attackerNode"].forEach(function (key) {
            if (metrics[key] != null && !validNode(metrics[key], count)) throw new Error("metrics.json contains an invalid " + key + ".");
        });
        return metrics;
    }

    function parse(matrixText, blockRows, eventRows, options) {
        options = options || {};
        var matrix = parseMatrix(matrixText);
        var blocks = validateTimeline(blockRows, "receiveTime", "block.json", matrix.length);
        var events = validateTimeline(eventRows, "time", "event.json", matrix.length);
        var initial = options.initialMatrix == null ? null : parseMatrix(options.initialMatrix);
        if (initial && initial.length !== matrix.length) throw new Error("Initial and final network sizes differ.");
        if (!initial && events.some(function (event) { return event.type === "NetworkChange"; })) {
            throw new Error("Include initialAdjacencyMatrix.csv to replay network changes correctly.");
        }
        if (initial) {
            var replayed = initial.map(function (row) { return row.slice(); });
            events.forEach(function (event) {
                if (event.type === "NetworkChange") replayed[Number(event.from)][Number(event.to)] = event.action === "connect" ? 1 : 0;
            });
            if (replayed.some(function (row, i) { return row.some(function (value, j) { return value !== matrix[i][j]; }); })) {
                throw new Error("Network changes do not match the final matrix. Select files from the same complete run.");
            }
        }
        return {
            matrix: matrix, initialMatrix: initial, blocks: blocks, events: events,
            metrics: validateMetrics(options.metrics, matrix.length),
            duration: Math.max(blocks.length ? Number(blocks[blocks.length - 1].receiveTime) : 0,
                events.length ? Number(events[events.length - 1].time) : 0)
        };
    }

    function load(fetchFile, directory) {
        directory = (directory || "./output-file").replace(/\/$/, "");
        function read(name, format, optional) {
            return fetchFile(directory + "/" + name).then(function (response) {
                if (optional && response.status === 404) return null;
                if (!response.ok) throw new Error("Could not load " + name + " (HTTP " + response.status + ").");
                return response[format]();
            });
        }
        return Promise.all([read("adjacencyMatrix.csv", "text"), read("block.json", "json"), read("event.json", "json"),
            read("initialAdjacencyMatrix.csv", "text", true), read("metrics.json", "json", true)])
            .then(function (files) { return parse(files[0], files[1], files[2], { initialMatrix: files[3], metrics: files[4] }); });
    }

    // Local File objects never leave this browser. Parse the complete selection before publishing anything.
    function fromFiles(selection) {
        var files = new Map();
        Array.from(selection).forEach(function (file) {
            if (files.has(file.name)) throw new Error("Select files from one run only: duplicate " + file.name + ".");
            files.set(file.name, file);
        });
        var required = ["adjacencyMatrix.csv", "block.json", "event.json"];
        required.forEach(function (name) {
            if (!files.has(name)) throw new Error("Select all three required files from one run. Missing " + name + ".");
        });
        function read(name) { return files.has(name) ? files.get(name).text() : Promise.resolve(null); }
        return Promise.all(required.concat(["initialAdjacencyMatrix.csv", "metrics.json"]).map(read)).then(function (texts) {
            try {
                return parse(texts[0], JSON.parse(texts[1]), JSON.parse(texts[2]), {
                    initialMatrix: texts[3], metrics: texts[4] == null ? null : JSON.parse(texts[4])
                });
            } catch (error) { throw new Error("Invalid recording: " + error.message); }
        });
    }

    root.BCASimData = { parseMatrix: parseMatrix, validateTimeline: validateTimeline, parse: parse, load: load, fromFiles: fromFiles };
    if (typeof module !== "undefined" && module.exports) module.exports = root.BCASimData;
})(typeof globalThis !== "undefined" ? globalThis : this);
