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
        this.importGeneration = 0;
        this.comparisonGeneration = 0;
        this.comparisonData = null;
        this.studio = root.BCASimStudio ? new root.BCASimStudio(this) : null;
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
        if (this.studio) this.studio.changed(playback);
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
    Demo.prototype.useData = function (data) {
        // The caller has parsed every file successfully before stopping the previous recording.
        if (this.playback) this.playback.dispose();
        this.data = data;
        this.renderer = new root.BCASimRenderer(this.vis, this.element("network_panel"), this.element("blockchain_panel"));
        var self = this;
        this.playback = new root.BCASimPlayback(data, this.renderer, this.scheduler, function (playback) { self.changed(playback); });
        this.element("start_point").max = String(data.duration);
        this.element("start_point").value = "0";
        this.playback.reset();
        if (this.studio) this.studio.renderComparison();
    };
    Demo.prototype.importFiles = async function (files, compare) {
        var generationKey = compare ? "comparisonGeneration" : "importGeneration";
        var ticket = ++this[generationKey];
        var message = this.element("import_status");
        message.textContent = "Reading local recording…";
        try {
            var data = await root.BCASimData.fromFiles(files);
            if (this.initialization) await this.initialization;
            if (ticket !== this[generationKey]) return false;
            if (compare) {
                this.comparisonData = data;
                if (this.studio) this.studio.renderComparison();
            } else this.useData(data);
            message.textContent = (compare ? "Comparison B" : "Recording A") + " loaded locally: " + data.matrix.length + " nodes, " + data.events.length + " events. " +
                (data.metrics ? "Recorded metrics included." : "No metrics.json selected; unrecorded metrics are marked unavailable.");
            return true;
        } catch (error) {
            if (ticket === this[generationKey]) message.textContent = "Import failed. " + error.message + " The previous recording is unchanged.";
            return false;
        }
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
            if (this.studio) this.studio.bind();
            this.controlsBound = true;
        }
        this.state = "loading";
        this.status("Loading simulation data…");
        this.controls();
        this.initialization = root.BCASimData.load(this.fetchFile).then(function (data) {
            self.useData(data);
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
