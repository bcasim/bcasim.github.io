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

    function parse(matrixText, blockRows, eventRows) {
        var matrix = parseMatrix(matrixText);
        var blocks = validateTimeline(blockRows, "receiveTime", "block.json", matrix.length);
        var events = validateTimeline(eventRows, "time", "event.json", matrix.length);
        return {
            matrix: matrix, blocks: blocks, events: events,
            duration: Math.max(blocks.length ? Number(blocks[blocks.length - 1].receiveTime) : 0,
                events.length ? Number(events[events.length - 1].time) : 0)
        };
    }

    function load(fetchFile, directory) {
        directory = (directory || "./output-file").replace(/\/$/, "");
        function read(name, format) {
            return fetchFile(directory + "/" + name).then(function (response) {
                if (!response.ok) throw new Error("Could not load " + name + " (HTTP " + response.status + ").");
                return response[format]();
            });
        }
        return Promise.all([read("adjacencyMatrix.csv", "text"), read("block.json", "json"), read("event.json", "json")])
            .then(function (files) { return parse(files[0], files[1], files[2]); });
    }

    root.BCASimData = { parseMatrix: parseMatrix, validateTimeline: validateTimeline, parse: parse, load: load };
    if (typeof module !== "undefined" && module.exports) module.exports = root.BCASimData;
})(typeof globalThis !== "undefined" ? globalThis : this);
