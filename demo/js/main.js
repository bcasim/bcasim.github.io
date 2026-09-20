/* Playback has exactly one clock and one traffic timer. */
var time = 0;
var simulation_speed = 10;
var simulation_color_mode = "1";
var simulation_duration = 0;
var simulation_state = "loading";
var clock_timer = null;
var traffic_timer = null;
var initialization = null;
var controls_bound = false;

function set_status(message, invalid) {
    var status = document.getElementById("status_message");
    status.textContent = message;
    status.dataset.state = invalid ? "error" : simulation_state;
}

function update_controls() {
    var loading = simulation_state === "loading";
    var error = simulation_state === "error";
    var startButton = document.getElementById("start_button");
    var pauseButton = document.getElementById("pause_button");
    startButton.disabled = loading;
    startButton.textContent = error ? "Retry loading" :
        (simulation_state === "ready" || loading ? "Start simulation" : "Restart simulation");
    pauseButton.disabled = simulation_state !== "running" && simulation_state !== "paused";
    pauseButton.textContent = simulation_state === "paused" ? "Resume" : "Pause";
    document.getElementById("reset_button").disabled = loading || error;
    document.getElementById("speed").disabled = loading;
    document.getElementById("start_point").disabled = loading;
    document.querySelectorAll('#node input[name="node"]').forEach(function (input) {
        input.disabled = loading;
    });
}

function update_timestamp() {
    document.getElementById("timestamp_area").textContent =
        "Simulation time: " + time.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " s / " +
        simulation_duration.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " s";
}

function stop_timers() {
    if (clock_timer !== null) {
        clearInterval(clock_timer);
        clock_timer = null;
    }
    if (traffic_timer !== null) {
        clearInterval(traffic_timer);
        traffic_timer = null;
    }
}

function start_timers() {
    stop_timers();
    clock_timer = setInterval(showClock, 500);
    traffic_timer = setInterval(play_traffic, 100);
}

function process_to_time() {
    while (block_index < blockchain_data.length && Number(blockchain_data[block_index].receiveTime) <= time) {
        next_block();
    }
    while (event_id < event_data.length && Number(event_data[event_id].time) <= time) {
        block_event();
    }
    update_timestamp();
}

function finish_if_complete() {
    if (block_index < blockchain_data.length || event_id < event_data.length) {
        return false;
    }
    stop_timers();
    remove_traffic();
    blockchain_network.fit({ animation: false });
    simulation_state = "completed";
    set_status("Playback complete. All " + blockchain_data.length + " blocks and " + event_data.length + " events have been shown.");
    update_controls();
    return true;
}

function showClock() {
    if (simulation_state !== "running") {
        return;
    }
    remove_traffic();
    time = Math.min(simulation_duration, time + simulation_speed);
    process_to_time();
    finish_if_complete();
}

function main() {
    reset_network();
    reset_blockchain();
}

function read_settings() {
    var speedInput = document.getElementById("speed");
    var startInput = document.getElementById("start_point");
    speedInput.removeAttribute("aria-invalid");
    startInput.removeAttribute("aria-invalid");
    var speed = Number(speedInput.value);
    var startTime = Number(startInput.value);
    if (!speedInput.value.trim() || !Number.isFinite(speed) || speed < 0.1 || speed > 10000) {
        speedInput.setAttribute("aria-invalid", "true");
        document.getElementById("setting_panel").open = true;
        speedInput.focus();
        set_status("Enter a speed from 0.1 to 10,000 seconds per step.", true);
        return null;
    }
    if (!startInput.value.trim() || !Number.isFinite(startTime) || startTime < 0 || startTime > simulation_duration) {
        startInput.setAttribute("aria-invalid", "true");
        document.getElementById("setting_panel").open = true;
        startInput.focus();
        set_status("Enter a start time from 0 to " + simulation_duration + " seconds.", true);
        return null;
    }
    var selectedColor = document.querySelector('#node input[name="node"]:checked');
    return { speed: speed, time: startTime, color: selectedColor ? selectedColor.value : "1" };
}

function start_simulation() {
    if (simulation_state === "error") {
        return init();
    }
    if (simulation_state === "loading") {
        return false;
    }
    var settings = read_settings();
    if (!settings) {
        return false;
    }
    stop_timers();
    simulation_speed = settings.speed;
    simulation_color_mode = settings.color;
    time = settings.time;
    main();
    // Reconstruct state at the chosen time without animating the skipped traffic.
    process_to_time();
    remove_traffic();
    blockchain_network.fit();
    simulation_state = "running";
    if (!finish_if_complete()) {
        set_status("Playing. Settings take effect when you restart.");
        update_controls();
        start_timers();
    }
    return true;
}

function pause_simulation() {
    if (simulation_state === "running") {
        stop_timers();
        simulation_state = "paused";
        set_status("Paused. Resume to continue from the current time.");
    } else if (simulation_state === "paused") {
        simulation_state = "running";
        set_status("Playing. Settings take effect when you restart.");
        start_timers();
    }
    update_controls();
}

function reset_simulation() {
    if (simulation_state === "loading" || simulation_state === "error") {
        return;
    }
    stop_timers();
    time = 0;
    main();
    process_to_time();
    remove_traffic();
    blockchain_network.fit();
    simulation_state = "ready";
    set_status("Ready. " + matrix_data.length + " nodes, " + blockchain_data.length + " blocks, " + event_data.length + " events loaded.");
    update_controls();
}

function init() {
    if (initialization) {
        return initialization;
    }
    if (!controls_bound) {
        document.getElementById("start_button").addEventListener("click", start_simulation);
        document.getElementById("pause_button").addEventListener("click", pause_simulation);
        document.getElementById("reset_button").addEventListener("click", reset_simulation);
        window.addEventListener("pagehide", function () {
            // The back/forward cache restores a resumable state with no stale timers.
            if (simulation_state === "running") {
                pause_simulation();
            } else {
                stop_timers();
            }
        });
        controls_bound = true;
    }
    simulation_state = "loading";
    stop_timers();
    set_status("Loading simulation data…");
    update_controls();
    initialization = input_data().then(function () {
        simulation_duration = Math.max(
            blockchain_data.length ? Number(blockchain_data[blockchain_data.length - 1].receiveTime) : 0,
            event_data.length ? Number(event_data[event_data.length - 1].time) : 0
        );
        document.getElementById("start_point").max = String(simulation_duration);
        simulation_state = "ready";
        reset_simulation();
        return true;
    }).catch(function (error) {
        simulation_state = "error";
        set_status("Unable to load the demo. " + error.message + " Select Retry loading to try again.");
        update_controls();
        return false;
    }).finally(function () {
        initialization = null;
    });
    return initialization;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}
