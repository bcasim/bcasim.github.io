/* Load and validate the three files as one dataset before enabling playback. */
var matrix_filename = "./output-file/adjacencyMatrix.csv";
var blockchain_filename = "./output-file/block.json";
var event_filename = "./output-file/event.json";
var blockchain_data;
var event_data;
var matrix_data;
var data_request = null;

function createArray(csvData) {
    var lines = csvData.trim().split(/\r?\n/);
    var matrix = lines.map(function (line) {
        return line.split(",").map(function (value) {
            if (!/^[01]$/.test(value.trim())) {
                throw new Error("The network matrix must contain only 0 and 1.");
            }
            return Number(value);
        });
    });
    if (!csvData.trim() || matrix.some(function (row) { return row.length !== matrix.length; })) {
        throw new Error("The network matrix must be a non-empty square.");
    }
    return matrix;
}

function read_data_file(filename, format) {
    return fetch(filename).then(function (response) {
        if (!response.ok) {
            throw new Error("Could not load " + filename.split("/").pop() + " (HTTP " + response.status + ").");
        }
        return format === "json" ? response.json() : response.text();
    });
}

function validate_timeline(data, timeKey, filename, nodeCount) {
    if (!Array.isArray(data)) {
        throw new Error(filename + " must contain a list.");
    }
    data.forEach(function (item) {
        if (!item || typeof item !== "object" || item[timeKey] === undefined ||
            String(item[timeKey]).trim() === "" || !Number.isFinite(Number(item[timeKey])) || Number(item[timeKey]) < 0) {
            throw new Error(filename + " contains an invalid time.");
        }
        if (timeKey === "receiveTime" && (typeof item.hash !== "string" || typeof item.previousHash !== "string")) {
            throw new Error(filename + " contains an invalid block.");
        }
        if (item.type === "FoundBlock" || item.type === "ReceiveBlock") {
            var node = Number(item.node);
            var from = Number(item.from);
            if (item.node === undefined || !Number.isInteger(node) || node < 0 || node >= nodeCount ||
                !Number.isFinite(Number(item.height)) || Number(item.height) < 0 || typeof item.hash !== "string" ||
                (item.type === "ReceiveBlock" && (item.from === undefined || !Number.isInteger(from) || from < 0 || from >= nodeCount))) {
                throw new Error(filename + " contains an invalid node or block event.");
            }
        }
    });
    // Some simulator exports are not in chronological order.
    return data.slice().sort(function (a, b) { return Number(a[timeKey]) - Number(b[timeKey]); });
}

function input_data() {
    if (data_request) {
        return data_request;
    }
    data_request = Promise.all([
        read_data_file(matrix_filename, "text"),
        read_data_file(blockchain_filename, "json"),
        read_data_file(event_filename, "json")
    ]).then(function (files) {
        var matrix = createArray(files[0]);
        var blocks = validate_timeline(files[1], "receiveTime", "block.json", matrix.length);
        var events = validate_timeline(files[2], "time", "event.json", matrix.length);
        // Publish together, so no consumer can see a partially loaded dataset.
        matrix_data = matrix;
        blockchain_data = blocks;
        event_data = events;
    }).catch(function (error) {
        data_request = null;
        throw error;
    });
    return data_request;
}
