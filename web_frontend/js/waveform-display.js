/**
 * 实时波形显示组件（Canvas）
 * Y 轴 Auto 模式对齐 OpenBCI GUI：按当前窗 min/max 自动缩放并居中
 */
class WaveformDisplay {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element ${canvasId} not found`);
        }

        this.ctx = this.canvas.getContext('2d');

        this.options = {
            channelCount: options.channelCount || 8,
            samplingRate: options.samplingRate || 250,
            displayDuration: options.displayDuration || 5.0,
            backgroundColor: options.backgroundColor || '#1a1a2e',
            gridColor: options.gridColor || '#2a2a3e',
            channelColors: options.channelColors || [
                '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24',
                '#6c5ce7', '#a29bfe', '#fd79a8', '#fdcb6e'
            ],
            lineWidth: options.lineWidth || 1.5,
            showGrid: options.showGrid !== false,
            showLabels: options.showLabels !== false,
            autoScale: options.autoScale !== false,
            yScale: options.yScale || 100
        };

        this.dataBuffer = [];
        this.maxBufferSize = Math.floor(this.options.samplingRate * this.options.displayDuration);

        this.channelScales = new Array(this.options.channelCount).fill(25);
        this.channelMids = new Array(this.options.channelCount).fill(0);
        this.autoScaleMinHalfUv = 4;
        this.autoScaleMaxHalfUv = 450;
        this.autoScaleAttack = 0.42;
        this.autoScaleRelease = 0.1;

        this.animationId = null;
        this.isRunning = false;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        this.width = rect.width;
        this.height = rect.height;
        this.channelHeight = this.height / this.options.channelCount;
    }

    addData(data) {
        for (const sample of data) {
            this.dataBuffer.push(sample);
        }
        if (this.dataBuffer.length > this.maxBufferSize) {
            this.dataBuffer = this.dataBuffer.slice(-this.maxBufferSize);
        }
    }

    /**
     * OpenBCI 式 Auto：用当前显示窗 min/max，半幅快速放大、缓慢缩小，并跟踪直流中心
     */
    updateChannelScalesAutoObci() {
        const n = this.dataBuffer.length;
        if (n < 4) return;

        const visible = this.dataBuffer;

        for (let ch = 0; ch < this.options.channelCount; ch++) {
            let min = Infinity;
            let max = -Infinity;
            for (let i = 0; i < visible.length; i++) {
                const v = Number(visible[i][ch]) || 0;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

            const span = Math.max(max - min, 0.5);
            let half = Math.max(span * 0.55, this.autoScaleMinHalfUv);
            half = Math.min(this.autoScaleMaxHalfUv, half);
            const mid = (max + min) * 0.5;

            const prevHalf = this.channelScales[ch] || half;
            const prevMid = this.channelMids[ch] || 0;
            const alpha = half > prevHalf ? this.autoScaleAttack : this.autoScaleRelease;

            this.channelScales[ch] = prevHalf * (1 - alpha) + half * alpha;
            this.channelMids[ch] = prevMid * (1 - alpha) + mid * alpha;
        }
    }

    clearData() {
        this.dataBuffer = [];
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.animate();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    animate() {
        if (!this.isRunning) return;
        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    draw() {
        if (this.options.autoScale) {
            this.updateChannelScalesAutoObci();
        }

        this.ctx.fillStyle = this.options.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);

        if (this.options.showGrid) {
            this.drawGrid();
        }
        if (this.options.showLabels) {
            this.drawLabels();
        }
        if (this.dataBuffer.length > 0) {
            this.drawWaveforms();
        }
        this.drawScaleLabels();
    }

    drawGrid() {
        this.ctx.strokeStyle = this.options.gridColor;
        this.ctx.lineWidth = 1;

        for (let i = 0; i <= this.options.channelCount; i++) {
            const y = i * this.channelHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }

        const pixelsPerSecond = this.width / this.options.displayDuration;
        for (let t = 0; t <= this.options.displayDuration; t += 1) {
            const x = t * pixelsPerSecond;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }

        for (let ch = 0; ch < this.options.channelCount; ch++) {
            const centerY = (ch + 0.5) * this.channelHeight;
            this.ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, centerY);
            this.ctx.lineTo(this.width, centerY);
            this.ctx.stroke();
            this.ctx.strokeStyle = this.options.gridColor;
        }
    }

    drawLabels() {
        this.ctx.font = '12px "Segoe UI", sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';

        for (let ch = 0; ch < this.options.channelCount; ch++) {
            this.ctx.fillStyle = this.options.channelColors[ch];
            const y = ch * this.channelHeight + 5;
            this.ctx.fillText(`CH${ch + 1}`, 5, y);
        }
    }

    drawScaleLabels() {
        this.ctx.font = '10px "Segoe UI", sans-serif';
        this.ctx.textAlign = 'right';

        for (let ch = 0; ch < this.options.channelCount; ch++) {
            const scale = this.channelScales[ch];
            const topY = ch * this.channelHeight + 2;
            const bottomY = (ch + 1) * this.channelHeight - 2;

            this.ctx.fillStyle = this.options.channelColors[ch];
            const label = scale >= 10 ? `${Math.round(scale)}` : scale.toFixed(1);
            this.ctx.textBaseline = 'top';
            this.ctx.fillText(`+${label}μV`, this.width - 5, topY);
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText(`-${label}μV`, this.width - 5, bottomY);
        }

        if (this.options.autoScale) {
            this.ctx.fillStyle = 'rgba(0,217,255,0.75)';
            this.ctx.textBaseline = 'top';
            this.ctx.textAlign = 'left';
            this.ctx.font = '10px "Segoe UI", sans-serif';
            this.ctx.fillText('Y: Auto', 42, 4);
        }
    }

    drawWaveforms() {
        const numSamples = this.dataBuffer.length;
        if (numSamples < 2) return;

        const xStep = this.width / this.maxBufferSize;

        for (let ch = 0; ch < this.options.channelCount; ch++) {
            this.ctx.strokeStyle = this.options.channelColors[ch];
            this.ctx.lineWidth = this.options.lineWidth;
            this.ctx.beginPath();

            const centerY = (ch + 0.5) * this.channelHeight;
            const half = Math.max(this.autoScaleMinHalfUv, this.channelScales[ch] || 25);
            const mid = this.channelMids[ch] || 0;
            const yScaleFactor = (this.channelHeight * 0.46) / half;

            for (let i = 0; i < numSamples; i++) {
                const x = i * xStep;
                const value = Number(this.dataBuffer[i][ch]) || 0;
                const y = centerY - (value - mid) * yScaleFactor;

                if (i === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }

            this.ctx.stroke();
        }
    }

    updateOptions(options) {
        Object.assign(this.options, options);

        if (options.channelCount || options.samplingRate || options.displayDuration) {
            this.maxBufferSize = Math.floor(this.options.samplingRate * this.options.displayDuration);
            this.channelHeight = this.height / this.options.channelCount;
            this.channelScales = new Array(this.options.channelCount).fill(25);
            this.channelMids = new Array(this.options.channelCount).fill(0);
        }
    }

    setAutoScale(enabled) {
        this.options.autoScale = !!enabled;
    }

    getStats() {
        if (this.dataBuffer.length === 0) return null;

        const stats = [];
        for (let ch = 0; ch < this.options.channelCount; ch++) {
            const values = this.dataBuffer.map((sample) => sample[ch] || 0);
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
            const std = Math.sqrt(variance);
            const min = Math.min(...values);
            const max = Math.max(...values);

            stats.push({
                channel: ch + 1,
                mean: mean.toFixed(2),
                std: std.toFixed(2),
                min: min.toFixed(2),
                max: max.toFixed(2),
                scale: this.channelScales[ch].toFixed(1)
            });
        }

        return stats;
    }
}

window.WaveformDisplay = WaveformDisplay;
