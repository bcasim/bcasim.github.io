/* Timeline and timer ownership. No browser, graph library, or DOM dependency. */
(function (root) {
    "use strict";
    function Playback(data, renderer, scheduler, onChange) {
        this.data = data;
        this.renderer = renderer;
        this.scheduler = scheduler;
        this.onChange = onChange || function () {};
        this.state = "ready";
        this.time = 0;
        this.speed = 10;
        this.color = "1";
        this.blockIndex = 0;
        this.eventIndex = 0;
        this.timers = [];
    }

    Playback.prototype.stopTimers = function () {
        var scheduler = this.scheduler;
        this.timers.forEach(function (id) { scheduler.clearInterval(id); });
        this.timers = [];
    };
    Playback.prototype.startTimers = function () {
        var self = this;
        this.stopTimers();
        this.timers = [this.scheduler.setInterval(function () { self.tick(); }, 500),
            this.scheduler.setInterval(function () { self.renderer.animateTraffic(); }, 100)];
    };
    Playback.prototype.process = function () {
        // Preserve existing replay semantics: blocks first, then events in each step.
        while (this.blockIndex < this.data.blocks.length && Number(this.data.blocks[this.blockIndex].receiveTime) <= this.time) {
            this.renderer.block(this.data.blocks[this.blockIndex], this.blockIndex++);
        }
        while (this.eventIndex < this.data.events.length && Number(this.data.events[this.eventIndex].time) <= this.time) {
            this.renderer.event(this.data.events[this.eventIndex++]);
        }
    };
    Playback.prototype.finish = function () {
        if (this.blockIndex < this.data.blocks.length || this.eventIndex < this.data.events.length) return false;
        this.stopTimers();
        this.renderer.clearTraffic();
        this.renderer.fit();
        this.state = "completed";
        return true;
    };
    Playback.prototype.reconstruct = function (time) {
        this.stopTimers();
        this.time = time;
        this.blockIndex = 0;
        this.eventIndex = 0;
        this.renderer.reset(this.data, this.color);
        this.process();
        this.renderer.clearTraffic();
        this.renderer.fit();
    };
    Playback.prototype.start = function (settings) {
        if (!settings || !Number.isFinite(settings.speed) || settings.speed < 0.1 || settings.speed > 10000 ||
            !Number.isFinite(settings.time) || settings.time < 0 || settings.time > this.data.duration ||
            (settings.color !== "1" && settings.color !== "2")) {
            throw new Error("Invalid playback settings.");
        }
        this.speed = settings.speed;
        this.color = settings.color;
        this.reconstruct(settings.time);
        this.state = "running";
        if (!this.finish()) this.startTimers();
        this.onChange(this);
    };
    Playback.prototype.tick = function () {
        if (this.state !== "running") return;
        this.renderer.clearTraffic();
        this.time = Math.min(this.data.duration, this.time + this.speed);
        this.process();
        this.finish();
        this.onChange(this);
    };
    Playback.prototype.pause = function () {
        if (this.state !== "running") return;
        this.stopTimers();
        this.state = "paused";
        this.onChange(this);
    };
    Playback.prototype.resume = function () {
        if (this.state !== "paused") return;
        this.state = "running";
        this.startTimers();
        this.onChange(this);
    };
    Playback.prototype.seek = function (time) {
        if (!Number.isFinite(time) || time < 0 || time > this.data.duration) throw new Error("Invalid seek time.");
        this.reconstruct(time);
        this.state = "paused";
        this.finish();
        this.onChange(this);
    };
    // Advance to the next timestamp, including all events at that timestamp in export order.
    Playback.prototype.step = function (kind) {
        if (kind !== "event" && kind !== "block") throw new Error("Step kind must be event or block.");
        var rows = kind === "block" ? this.data.blocks : this.data.events;
        var key = kind === "block" ? "receiveTime" : "time";
        var next = rows.find(function (row) { return Number(row[key]) > this.time; }, this);
        this.seek(next ? Number(next[key]) : this.data.duration);
    };
    Playback.prototype.reset = function () {
        this.reconstruct(0);
        this.state = "ready";
        this.onChange(this);
    };
    Playback.prototype.dispose = function () {
        this.stopTimers();
        this.state = "disposed";
        this.renderer.destroy();
    };
    root.BCASimPlayback = Playback;
    if (typeof module !== "undefined" && module.exports) module.exports = Playback;
})(typeof globalThis !== "undefined" ? globalThis : this);
