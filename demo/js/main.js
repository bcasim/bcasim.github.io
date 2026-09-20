/* DOM controller. Dataset, playback state, and graph rendering have separate owners. */
(function (root) {
    "use strict";
    function Demo(document, window, fetchFile, vis, scheduler) {
        this.document = document;
        this.window = window;
        this.fetchFile = fetchFile;
        this.vis = vis;
        this.scheduler = scheduler;
        this.state = "loading";
        this.initialization = null;
        this.controlsBound = false;
        this.data = null;
        this.playback = null;
        this.renderer = null;
    }
    Demo.prototype.element = function (id) { return this.document.getElementById(id); };
    Demo.prototype.status = function (message, invalid) {
        var status = this.element("status_message");
        // Avoid repeating the same live-region announcement on every clock tick.
        if (status.textContent !== message) status.textContent = message;
        status.dataset.state = invalid ? "error" : this.state;
    };
    Demo.prototype.controls = function () {
        var loading = this.state === "loading";
        var error = this.state === "error";
        this.element("start_button").disabled = loading;
        this.element("start_button").textContent = error ? "Retry loading" :
            (this.state === "ready" || loading ? "Start simulation" : "Restart simulation");
        this.element("pause_button").disabled = this.state !== "running" && this.state !== "paused";
        this.element("pause_button").textContent = this.state === "paused" ? "Resume" : "Pause";
        this.element("reset_button").disabled = loading || error;
        this.element("speed").disabled = loading;
        this.element("start_point").disabled = loading;
        this.document.querySelectorAll('#node input[name="node"]').forEach(function (input) { input.disabled = loading; });
    };
    Demo.prototype.changed = function (playback) {
        this.state = playback.state;
        this.element("timestamp_area").textContent = "Simulation time: " +
            playback.time.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " s / " +
            this.data.duration.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " s";
        var messages = {
            ready: "Ready. " + this.data.matrix.length + " nodes, " + this.data.blocks.length + " blocks, " + this.data.events.length + " events loaded.",
            running: "Playing. Settings take effect when you restart.",
            paused: "Paused. Resume to continue from the current time.",
            completed: "Playback complete. All " + this.data.blocks.length + " blocks and " + this.data.events.length + " events have been shown."
        };
        this.status(messages[this.state]);
        this.controls();
    };
    Demo.prototype.settings = function () {
        var speedInput = this.element("speed");
        var startInput = this.element("start_point");
        speedInput.removeAttribute("aria-invalid");
        startInput.removeAttribute("aria-invalid");
        var speed = Number(speedInput.value);
        var startTime = Number(startInput.value);
        var invalid = null;
        var message = "";
        if (!speedInput.value.trim() || !Number.isFinite(speed) || speed < 0.1 || speed > 10000) {
            invalid = speedInput;
            message = "Enter a speed from 0.1 to 10,000 seconds per step.";
        } else if (!startInput.value.trim() || !Number.isFinite(startTime) || startTime < 0 || startTime > this.data.duration) {
            invalid = startInput;
            message = "Enter a start time from 0 to " + this.data.duration + " seconds.";
        }
        if (invalid) {
            invalid.setAttribute("aria-invalid", "true");
            this.element("setting_panel").open = true;
            invalid.focus();
            this.status(message, true);
            return null;
        }
        var selected = this.document.querySelector('#node input[name="node"]:checked');
        return { speed: speed, time: startTime, color: selected ? selected.value : "1" };
    };
    Demo.prototype.start = function () {
        if (this.state === "error") return this.init();
        if (this.state === "loading") return false;
        var settings = this.settings();
        if (!settings) return false;
        this.playback.start(settings);
        return true;
    };
    Demo.prototype.pause = function () {
        if (!this.playback) return;
        if (this.playback.state === "paused") this.playback.resume();
        else this.playback.pause();
    };
    Demo.prototype.reset = function () {
        if (this.state !== "loading" && this.state !== "error") this.playback.reset();
    };
    Demo.prototype.init = function () {
        if (this.initialization) return this.initialization;
        if (this.data) return Promise.resolve(true);
        var self = this;
        if (!this.controlsBound) {
            this.element("start_button").addEventListener("click", function () { self.start(); });
            this.element("pause_button").addEventListener("click", function () { self.pause(); });
            this.element("reset_button").addEventListener("click", function () { self.reset(); });
            this.window.addEventListener("pagehide", function () {
                // A restored back/forward cache entry remains paused and resumable.
                if (self.playback) self.playback.pause();
            });
            this.controlsBound = true;
        }
        this.state = "loading";
        this.status("Loading simulation data…");
        this.controls();
        this.initialization = root.BCASimData.load(this.fetchFile).then(function (data) {
            self.data = data;
            self.renderer = new root.BCASimRenderer(self.vis, self.element("network_panel"), self.element("blockchain_panel"));
            self.playback = new root.BCASimPlayback(data, self.renderer, self.scheduler, function (playback) { self.changed(playback); });
            self.element("start_point").max = String(data.duration);
            self.playback.reset();
            return true;
        }).catch(function (error) {
            if (self.playback) self.playback.dispose();
            self.data = null;
            self.playback = null;
            self.state = "error";
            self.status("Unable to load the simulation. " + error.message + " Select Retry loading to try again.");
            self.controls();
            return false;
        }).finally(function () { self.initialization = null; });
        return this.initialization;
    };
    root.BCASimDemo = Demo;
    root.demo = new Demo(document, window, function (url) { return fetch(url); }, vis,
        { setInterval: function (fn, delay) { return setInterval(fn, delay); }, clearInterval: function (id) { clearInterval(id); } });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { root.demo.init(); }, { once: true });
    else root.demo.init();
})(typeof globalThis !== "undefined" ? globalThis : this);
