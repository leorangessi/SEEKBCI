// 刺激测试 JavaScript

// 全局变量
let isRunning = false;
let startTime = 0;
let animationFrameId = null;
let frameCount = 0;
let totalFrames = 0;
let lastFpsUpdate = 0;
let currentFPS = 0;

// 刺激参数
let frequency = 10.0;
let phase = 0;
let blockSize = 200;
let blockShape = 'rectangle';
let blockLabel = '测试方块';

// 四圆球 + FBCCA（与后端 preset 顺序一致）
let fourBallRunning = false;
let fourBallEngine = null;
let fourBallDecodeIntervalId = null;
let fourBallDecodeInFlight = false;
let eegDataBuffer = [];
let eegSamplingRate = 250;
let isDeviceConnected = false;

const STIM_REF_HZ = 60;

const FOUR_BALL_PRESETS_LOW = [
    { label: '方案 A：8 / 10 / 12 / 14 Hz', freqs: [8.0, 10.0, 12.0, 14.0] },
    { label: '方案 B：8.8 / 10.8 / 12.8 / 14.8 Hz', freqs: [8.8, 10.8, 12.8, 14.8] },
    { label: '方案 C：9.2 / 11.2 / 13.2 / 15 Hz', freqs: [9.2, 11.2, 13.2, 15.0] }
];
const FOUR_BALL_PRESETS_HIGH = [
    { label: '方案 A：16 / 19 / 22 / 25 Hz', freqs: [16.0, 19.0, 22.0, 25.0] },
    { label: '方案 B：17 / 20 / 23 / 26 Hz', freqs: [17.0, 20.0, 23.0, 26.0] },
    { label: '方案 C：18 / 21 / 24 / 27 Hz', freqs: [18.0, 21.0, 24.0, 27.0] }
];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    updateBlockStyle();
    drawWaveform();
    setupKeyboardShortcuts();
    setupFourBallUI();
    setupFourBallDeviceListener();
    initStimulusExperimentSyncUi();
    initDisplayRefreshHint();
});

function initDisplayRefreshHint() {
    const hint = document.getElementById('refresh-hint');
    const D = window.SEEKBCI_DISPLAY;
    if (!hint || !D) return;
    D.measureDisplayRefreshRate((hz) => {
        const maxF = D.suggestMaxFlickerHz(hz);
        hint.textContent = `屏幕约 ${hz} Hz · 正弦闪烁建议 ≤ ${maxF} Hz`;
        hint.title =
            '闪烁由时间相位驱动，会随显示器刷新率自适应；频率过高时可能出现 aliasing，SSVEP 项目频率通常 8–15 Hz。';
    });
}

// 更新频率
function updateFrequency(value) {
    frequency = parseFloat(value);
    document.getElementById('frequency-value').textContent = frequency.toFixed(1) + ' Hz';
    drawWaveform();
}

// 更新相位
function updatePhase(value) {
    phase = parseFloat(value);
    document.getElementById('phase-value').textContent = phase.toFixed(2);
    drawWaveform();
}

// 更新大小
function updateSize(value) {
    blockSize = parseInt(value);
    document.getElementById('size-value').textContent = blockSize + ' px';
    updateBlockStyle();
}

// 更新形状
function updateShape(value) {
    blockShape = value;
    updateBlockStyle();
}

// 更新标签
function updateLabel(value) {
    blockLabel = value;
    document.getElementById('stimulus-block').textContent = value;
}

// 更新方块样式
function updateBlockStyle() {
    const block = document.getElementById('stimulus-block');
    block.style.width = blockSize + 'px';
    block.style.height = blockSize + 'px';
    
    if (blockShape === 'circle') {
        block.style.borderRadius = '50%';
        block.style.clipPath = 'none';
    } else if (blockShape === 'triangle') {
        block.style.borderRadius = '0';
        block.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    } else {
        block.style.borderRadius = '12px';
        block.style.clipPath = 'none';
    }
}

// 开始测试
function startTest() {
    if (isRunning) return;
    if (getStimulusMode() === 'four_ball') {
        alert('当前为「四圆球」模式，请使用左侧「开始实时解码」，或切换回「单目标闪烁」。');
        return;
    }

    // 显示倒计时（倒计时期间显示对象但不闪烁）
    showCountdown(3, () => {
        isRunning = true;
        startTime = performance.now();
        frameCount = 0;
        totalFrames = 0;
        lastFpsUpdate = startTime;
        
        // 更新UI
        document.getElementById('start-btn').style.display = 'none';
        document.getElementById('stop-btn').style.display = 'block';
        
        // 开始渲染
        renderLoop();
        
        console.log('测试开始');
    });
}

// 显示倒计时
function showCountdown(seconds, callback) {
    let count = seconds;
    
    // 倒计时期间显示对象（不闪烁）
    const block = document.getElementById('stimulus-block');
    block.style.backgroundColor = '#888'; // 中等灰度
    
    const countdownEl = document.createElement('div');
    countdownEl.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 120px;
        color: #00D9FF;
        font-weight: bold;
        z-index: 2000;
        text-shadow: 0 0 30px rgba(0, 217, 255, 0.5);
        animation: pulse 1s ease-in-out;
    `;
    countdownEl.textContent = count;
    document.body.appendChild(countdownEl);
    
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.textContent = count;
        } else {
            clearInterval(interval);
            countdownEl.remove();
            if (callback) callback();
        }
    }, 1000);
}

// 停止测试
function stopTest() {
    if (!isRunning) return;
    
    isRunning = false;
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // 重置方块颜色
    const block = document.getElementById('stimulus-block');
    block.style.backgroundColor = '#888';
    
    // 更新UI
    document.getElementById('start-btn').style.display = 'block';
    document.getElementById('stop-btn').style.display = 'none';
    
    console.log('测试停止');
}

// 渲染循环
function renderLoop() {
    if (!isRunning) return;
    
    const currentTime = performance.now();
    const elapsedTime = (currentTime - startTime) / 1000; // 秒
    
    // 计算当前相位
    const currentPhase = 2 * Math.PI * frequency * elapsedTime + phase;
    
    // 计算亮度 (正弦波: -1 到 1)
    const amplitude = Math.sin(currentPhase);
    
    // 映射到 0-255 的灰度值
    const brightness = Math.round((amplitude + 1) * 127.5);
    
    // 设置颜色
    const block = document.getElementById('stimulus-block');
    block.style.backgroundColor = `rgb(${brightness}, ${brightness}, ${brightness})`;
    
    // 更新统计
    frameCount++;
    totalFrames++;
    
    // 更新FPS (每秒更新一次)
    if (currentTime - lastFpsUpdate >= 1000) {
        currentFPS = Math.round(frameCount * 1000 / (currentTime - lastFpsUpdate));
        document.getElementById('fps-value').textContent = currentFPS;
        
        // FPS颜色指示
        const fpsEl = document.getElementById('fps-value');
        if (currentFPS >= 55) {
            fpsEl.style.color = '#4CAF50';
        } else if (currentFPS >= 45) {
            fpsEl.style.color = '#FFC107';
        } else {
            fpsEl.style.color = '#FF5252';
        }
        
        frameCount = 0;
        lastFpsUpdate = currentTime;
    }
    
    // 更新运行时间
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.floor(elapsedTime % 60);
    document.getElementById('runtime').textContent = 
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    // 更新帧数
    document.getElementById('framecount').textContent = totalFrames;
    
    // 更新平均FPS
    const avgFPS = Math.round(totalFrames / elapsedTime);
    document.getElementById('avgfps').textContent = avgFPS;
    
    // 继续下一帧
    animationFrameId = requestAnimationFrame(renderLoop);
}

// 绘制波形图
function drawWaveform() {
    const canvas = document.getElementById('waveform');
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;
    
    // 清空画布
    ctx.fillStyle = '#2A2A2A';
    ctx.fillRect(0, 0, width, height);
    
    // 绘制网格
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    
    // 水平网格线
    for (let i = 0; i <= 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    
    // 垂直网格线
    for (let i = 0; i <= 10; i++) {
        const x = (width / 10) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    
    // 绘制波形
    ctx.strokeStyle = '#00D9FF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const cycles = 2; // 显示2个周期
    const points = 200;
    
    for (let i = 0; i <= points; i++) {
        const t = (i / points) * cycles / frequency;
        const x = (i / points) * width;
        const currentPhase = 2 * Math.PI * frequency * t + phase;
        const amplitude = Math.sin(currentPhase);
        const y = height / 2 - (amplitude * height / 2.5);
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.stroke();
    
    // 绘制标签
    ctx.fillStyle = '#888';
    ctx.font = '12px Arial';
    ctx.fillText(`${frequency.toFixed(1)} Hz`, 10, 20);
    ctx.fillText(`相位: ${phase.toFixed(2)}`, 10, 35);
}

// 切换全屏
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// 键盘快捷键
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        switch(e.key.toLowerCase()) {
            case 'f':
                toggleFullscreen();
                break;
            case ' ':
                e.preventDefault();
                if (getStimulusMode() === 'four_ball') {
                    break;
                }
                if (isRunning) {
                    stopTest();
                } else {
                    startTest();
                }
                break;
            case 'escape':
                if (fourBallRunning) {
                    stopFourBallRealtime();
                } else if (isRunning) {
                    stopTest();
                }
                break;
        }
    });
}

// 监听参数变化，实时更新波形
document.getElementById('frequency-slider').addEventListener('input', drawWaveform);
document.getElementById('phase-slider').addEventListener('input', drawWaveform);

// ---------- 模式切换 & 四圆球实时解码 ----------

function getStimulusMode() {
    const el = document.getElementById('stimulus-mode');
    return el ? el.value : 'single';
}

function onStimulusModeChange() {
    const m = getStimulusMode();
    teardownFourBallPollingAndEngine();

    const singleWrap = document.getElementById('single-stimulus-wrap');
    const singleControls = document.getElementById('single-target-controls');
    const fourControls = document.getElementById('four-ball-controls');
    const fourStage = document.getElementById('four-ball-stage');
    const fps = document.querySelector('.fps-display');
    const strip = document.getElementById('four-ball-decode-strip');
    const stripTitle = document.querySelector('#four-ball-decode-strip .strip-title');
    const sb = document.getElementById('four-ball-start-btn');
    const stb = document.getElementById('four-ball-stop-btn');
    if (sb) sb.disabled = false;
    if (stb) stb.disabled = true;

    if (m === 'four_ball') {
        stopTest();
        if (singleWrap) singleWrap.style.display = 'none';
        if (singleControls) singleControls.style.display = 'none';
        if (fourControls) fourControls.style.display = 'block';
        if (fourStage) fourStage.style.display = 'flex';
        if (fps) fps.style.display = 'none';
        if (strip) strip.style.display = 'block';
        if (stripTitle) stripTitle.textContent = FOUR_BALL_STRIP_TITLE_DEFAULT;
        paintFourBallIdleChart();
        setFourBallDecodeStatus('点击「开始实时解码」以拉取 EEG 并刷新柱状图（未开始时柱高与 p 均为 0）。');
    } else {
        if (singleWrap) singleWrap.style.display = 'flex';
        if (singleControls) singleControls.style.display = 'block';
        if (fourControls) fourControls.style.display = 'none';
        if (fourStage) fourStage.style.display = 'none';
        if (strip) strip.style.display = 'none';
        if (fps) fps.style.display = 'block';
        if (stripTitle) stripTitle.textContent = FOUR_BALL_STRIP_TITLE_DEFAULT;
        setFourBallDecodeStatus('');
    }
}

function setupFourBallUI() {
    refreshFourBallPresetSelect();
    const onBandChange = () => {
        refreshFourBallPresetSelect();
        if (getStimulusMode() === 'four_ball' && !fourBallRunning) {
            paintFourBallIdleChart();
            setFourBallDecodeStatus(
                '点击「开始实时解码」以拉取 EEG 并刷新柱状图（未开始时柱高与 p 均为 0）。'
            );
        }
    };
    document.querySelectorAll('input[name="four-ball-band"]').forEach((r) => {
        r.addEventListener('change', onBandChange);
    });
    const fourControls = document.getElementById('four-ball-controls');
    if (fourControls) {
        fourControls.addEventListener('change', (e) => {
            const t = e.target;
            if (t && t.id === 'four-ball-preset') {
                if (getStimulusMode() === 'four_ball' && !fourBallRunning) {
                    paintFourBallIdleChart();
                    setFourBallDecodeStatus(
                        '点击「开始实时解码」以拉取 EEG 并刷新柱状图（未开始时柱高与 p 均为 0）。'
                    );
                }
            }
        });
    }
}

function setupFourBallDeviceListener() {
    if (!window.globalDeviceManager) return;
    window.globalDeviceManager.addEventListener((event, data) => {
        if (event === 'data') {
            handleFourBallEEG(data);
        } else if (event === 'connected') {
            updateFourBallDeviceUI(true);
        } else if (event === 'disconnected') {
            updateFourBallDeviceUI(false);
        }
    });
    const st = window.globalDeviceManager.getStatus();
    updateFourBallDeviceUI(!!st.isConnected);
}

function handleFourBallEEG(message) {
    if (!message.data || message.data.length === 0) return;
    if (typeof message.sampling_rate === 'number' && message.sampling_rate > 0) {
        eegSamplingRate = message.sampling_rate;
    }
    eegDataBuffer.push(...message.data);
    const sr = message.sampling_rate || eegSamplingRate || 250;
    const maxSamples = Math.ceil(sr * 6);
    if (eegDataBuffer.length > maxSamples) {
        eegDataBuffer = eegDataBuffer.slice(-maxSamples);
    }
}

function updateFourBallDeviceUI(connected) {
    isDeviceConnected = connected;
    const span = document.getElementById('four-ball-device-text');
    const line = document.getElementById('four-ball-device-line');
    if (span) {
        span.textContent = connected ? '已连接（WebSocket 推流中）' : '未连接';
    }
    if (line) {
        line.classList.toggle('ok', connected);
    }
    if (!connected) {
        eegDataBuffer = [];
    }
}

function getFourBallBand() {
    const r = document.querySelector('input[name="four-ball-band"]:checked');
    return r ? r.value : 'low';
}

function refreshFourBallPresetSelect() {
    const sel = document.getElementById('four-ball-preset');
    if (!sel) return;
    const band = getFourBallBand();
    const list = band === 'high' ? FOUR_BALL_PRESETS_HIGH : FOUR_BALL_PRESETS_LOW;
    sel.innerHTML = '';
    list.forEach((p, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = p.label;
        sel.appendChild(o);
    });
}

function getFourBallPresetFreqs() {
    const band = getFourBallBand();
    const idx = parseInt(document.getElementById('four-ball-preset').value, 10) || 0;
    const list = band === 'high' ? FOUR_BALL_PRESETS_HIGH : FOUR_BALL_PRESETS_LOW;
    const preset = list[Math.min(idx, list.length - 1)];
    return preset ? preset.freqs.slice() : [8.0, 10.0, 12.0, 14.0];
}

function setFourBallDecodeStatus(msg) {
    const el = document.getElementById('four-ball-decode-status');
    if (el) el.textContent = msg || '';
}

function formatApiDetail(detail) {
    if (detail == null) return '';
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        return detail
            .map((x) => (typeof x === 'object' && x.msg ? x.msg : JSON.stringify(x)))
            .join('; ');
    }
    return String(detail);
}

function teardownFourBallPollingAndEngine() {
    fourBallRunning = false;
    fourBallDecodeInFlight = false;
    if (fourBallDecodeIntervalId !== null) {
        clearInterval(fourBallDecodeIntervalId);
        fourBallDecodeIntervalId = null;
    }
    if (fourBallEngine) {
        fourBallEngine.stop();
        fourBallEngine = null;
    }
    const sb = document.getElementById('four-ball-start-btn');
    const stb = document.getElementById('four-ball-stop-btn');
    if (sb) sb.disabled = false;
    if (stb) stb.disabled = true;
}

const FOUR_BALL_STRIP_TITLE_DEFAULT =
    '柱高 = 得分相对强度（幂映射，易区分）；标注 p = softmax 概率';

function paintFourBallIdleChart() {
    const freqs = getFourBallPresetFreqs();
    const z = [0, 0, 0, 0];
    drawFourBallProbChart(freqs, z, z, null);
    renderFourBallRankList(null);
}

function stopFourBallRealtime() {
    teardownFourBallPollingAndEngine();
    const strip = document.getElementById('four-ball-decode-strip');
    const stripTitle = document.querySelector('#four-ball-decode-strip .strip-title');
    if (getStimulusMode() === 'four_ball') {
        if (strip) strip.style.display = 'block';
        if (stripTitle) stripTitle.textContent = FOUR_BALL_STRIP_TITLE_DEFAULT;
        paintFourBallIdleChart();
        setFourBallDecodeStatus('已停止。点击「开始实时解码」继续拉取 EEG。');
    } else {
        if (strip) strip.style.display = 'none';
        if (stripTitle) stripTitle.textContent = FOUR_BALL_STRIP_TITLE_DEFAULT;
        setFourBallDecodeStatus('');
    }
}

function initFourBallEngine() {
    const canvas = document.getElementById('four-ball-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = 880;
    const ch = 520;
    canvas.width = cw;
    canvas.height = ch;

    /* 四角分布，纵向间距远大于直径，避免重叠（原 0.38/0.62 在 480px 高度下不足） */
    const positions = [
        { nx: 0.17, ny: 0.18 },
        { nx: 0.83, ny: 0.18 },
        { nx: 0.17, ny: 0.82 },
        { nx: 0.83, ny: 0.82 }
    ];
    const phases = [0, 0.15, 0.3, 0.45];
    const radius = 54;

    fourBallEngine = {
        running: false,
        animationId: null,
        stimStartMs: 0,
        freqs: getFourBallPresetFreqs(),

        start: function () {
            this.running = true;
            this.stimStartMs = performance.now();
            this.animate();
        },

        stop: function () {
            this.running = false;
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
            }
        },

        animate: function () {
            if (!this.running) return;
            this.freqs = getFourBallPresetFreqs();
            const elapsedSec = (performance.now() - this.stimStartMs) / 1000;
            const frameN = Math.floor(elapsedSec * STIM_REF_HZ);

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, cw, ch);

            for (let i = 0; i < 4; i++) {
                const freq = this.freqs[i];
                const ph = phases[i];
                const amp = (Math.sin((2 * Math.PI * freq * frameN) / STIM_REF_HZ + ph) - 0.5) * 2;
                const brightness01 = Math.max(0, Math.min(1, (amp + 1) / 2));
                const gray = Math.floor(brightness01 * 255);

                const px = positions[i].nx * cw;
                const py = positions[i].ny * ch;

                ctx.beginPath();
                ctx.arc(px, py, radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
                ctx.fill();
                ctx.strokeStyle = '#444';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.fillStyle = brightness01 > 0.5 ? '#111' : '#fff';
                ctx.font = 'bold 15px Segoe UI';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${freq.toFixed(1)} Hz`, px, py);
            }

            this.animationId = requestAnimationFrame(() => this.animate());
        }
    };
}

function startFourBallRealtime() {
    if (getStimulusMode() !== 'four_ball') {
        alert('请先在「测试类型」中选择「四圆球 + EEG 实时解码」。');
        return;
    }
    if (!isDeviceConnected) {
        alert('请先连接 EEG 设备（主页连接设备并保持 Python API / WebSocket）。');
        return;
    }

    stopFourBallRealtime();
    fourBallRunning = true;

    document.getElementById('four-ball-start-btn').disabled = true;
    document.getElementById('four-ball-stop-btn').disabled = false;
    document.getElementById('four-ball-decode-strip').style.display = 'block';

    initFourBallEngine();
    fourBallEngine.start();

    requestAnimationFrame(() => {
        const freqs = getFourBallPresetFreqs();
        const z = [0, 0, 0, 0];
        drawFourBallProbChart(freqs, z, z, null);
        renderFourBallRankList(null);
        setFourBallDecodeStatus('等待 EEG 缓冲（约 0.8 s）…');
    });

    fourBallDecodeIntervalId = setInterval(() => {
        fourBallDecodeTick();
    }, 300);
}

/** 与后端 scores_to_bar_heights 一致，旧 API 无 chart_bar_heights 时回退 */
function fallbackBarHeightsFromScores(scores) {
    if (!scores || scores.length === 0) return [0.25, 0.25, 0.25, 0.25];
    const s = scores.map((x) => Math.max(0, Number(x)));
    const mx = Math.max(...s, 1e-12);
    const gamma = 2.6;
    const floor = 0.07;
    const h = s.map((si) => floor + (1 - floor) * Math.pow(si / mx, gamma));
    const mh = Math.max(...h, 1e-12);
    return h.map((x) => x / mh);
}

function resolveProbChartWidth() {
    const strip = document.getElementById('four-ball-decode-strip');
    const stage = document.getElementById('four-ball-stage');
    let w = strip ? strip.getBoundingClientRect().width : 0;
    if (!w || w < 120) w = stage ? stage.getBoundingClientRect().width - 48 : 0;
    if (!w || w < 120) w = 640;
    return Math.floor(Math.max(320, w - 24));
}

/**
 * @param {number[]} frequencies_hz
 * @param {number[]} barHeights 0～1，柱高（相对得分映射）
 * @param {number[]|null} softmaxProbs softmax 概率，用于标注
 * @param {number[]|null} scores 原始 FBCCA 得分，可选显示
 */
function drawFourBallProbChart(frequencies_hz, barHeights, softmaxProbs, scores) {
    const canvas = document.getElementById('four-ball-prob-canvas');
    if (!canvas || !frequencies_hz || frequencies_hz.length === 0) return;

    const k = frequencies_hz.length;
    const probs =
        softmaxProbs && softmaxProbs.length === k
            ? softmaxProbs
            : frequencies_hz.map(() => 1 / k);
    const bars =
        barHeights && barHeights.length === k ? barHeights : fallbackBarHeightsFromScores(scores || []);

    const w = resolveProbChartWidth();
    const h = 310;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    const pad = 28;
    const bottomLab = 52;
    const topLab = 22;
    const maxBarPx = h - bottomLab - topLab;
    const barW = (w - pad * 2) / k;

    for (let i = 0; i < k; i++) {
        const bh = Math.max(0, (bars[i] ?? 0) * maxBarPx);
        const x = pad + i * barW + barW * 0.1;
        const y = h - bottomLab - bh;
        const bw = barW * 0.8;
        if (bh > 0.5) {
            const grad = ctx.createLinearGradient(x, y, x, y + bh);
            grad.addColorStop(0, '#00D9FF');
            grad.addColorStop(1, '#006680');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, bw, bh);
        }

        ctx.fillStyle = '#e0e0e0';
        ctx.font = 'bold 11px Segoe UI';
        ctx.textAlign = 'center';
        if (scores && scores.length === k) {
            ctx.fillText(`s=${Number(scores[i]).toFixed(3)}`, x + bw / 2, Math.max(y - 4, topLab));
        }

        ctx.fillStyle = '#aaa';
        ctx.font = '10px Segoe UI';
        ctx.fillText(`p ${(probs[i] * 100).toFixed(1)}%`, x + bw / 2, h - bottomLab + 14);

        ctx.fillStyle = '#888';
        ctx.font = '12px Segoe UI';
        ctx.fillText(`${Number(frequencies_hz[i]).toFixed(1)} Hz`, x + bw / 2, h - 6);
    }

    ctx.fillStyle = '#666';
    ctx.font = '11px Segoe UI';
    ctx.textAlign = 'left';
    ctx.fillText('柱高 ∝ 得分（γ=2.6）', 8, 16);
}

function renderFourBallRankList(ranked) {
    const el = document.getElementById('four-ball-rank-list');
    if (!el) return;
    if (!ranked || ranked.length === 0) {
        el.innerHTML =
            '<div class="rank-line" style="color:#666;border-bottom:none;">未解码（开始实时解码后显示排序）</div>';
        return;
    }
    el.innerHTML = ranked
        .map((r, i) => {
            const star = i === 0 ? ' ★ (argmax)' : '';
            return `<div class="rank-line">${i + 1}. ${Number(r.frequency_hz).toFixed(2)} Hz　score=${Number(r.score).toFixed(4)}　p=${(Number(r.probability) * 100).toFixed(2)}%${star}</div>`;
        })
        .join('');
}

async function fourBallDecodeTick() {
    if (!fourBallRunning || fourBallDecodeInFlight) return;

    const sr = eegSamplingRate || 250;
    const windowSec = 0.8;
    const n = Math.max(50, Math.round(sr * windowSec));
    if (eegDataBuffer.length < n) {
        setFourBallDecodeStatus(`缓冲 EEG：${eegDataBuffer.length} / ${n} 采样帧`);
        return;
    }

    const slice = eegDataBuffer.slice(-n);
    if (!Array.isArray(slice[0])) {
        setFourBallDecodeStatus('数据格式异常：需要每行多通道 → 请确认 WebSocket 推送为 (帧×通道)');
        return;
    }

    fourBallDecodeInFlight = true;
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';

    try {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG || window.SSVEP_FBCCA_CHANNELS;
        const chIdx =
            CFG && typeof CFG.getGlobalSsvepChannelIndices === 'function'
                ? CFG.getGlobalSsvepChannelIndices()
                : null;
        const decodeBody = {
            samples: slice,
            sampling_rate: sr,
            band: getFourBallBand(),
            preset_index: parseInt(document.getElementById('four-ball-preset').value, 10) || 0,
            window_sec: windowSec
        };
        if (chIdx && chIdx.length) decodeBody.channel_indices = chIdx;
        const resp = await fetch(`${origin}/api/ssvep/fbcca/decode_window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(decodeBody)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const msg = formatApiDetail(data.detail) || `HTTP ${resp.status}`;
            console.warn('decode_window:', msg, data);
            setFourBallDecodeStatus(`解码失败：${msg}`);
            return;
        }
        const k = (data.frequencies_hz || []).length;
        const chartBars =
            data.chart_bar_heights && data.chart_bar_heights.length === k
                ? data.chart_bar_heights
                : fallbackBarHeightsFromScores(data.scores || []);
        requestAnimationFrame(() => {
            drawFourBallProbChart(data.frequencies_hz, chartBars, data.probabilities, data.scores);
        });
        renderFourBallRankList(data.ranked_by_probability);

        const stripTitle = document.querySelector('#four-ball-decode-strip .strip-title');
        if (stripTitle && data.predicted_frequency_hz != null) {
            stripTitle.textContent = `当前最可能：${Number(data.predicted_frequency_hz).toFixed(2)} Hz · 柱高=得分强度 · 列表 p=softmax`;
        }
        const chLabel =
            CFG && typeof CFG.formatRolesSummary === 'function'
                ? CFG.formatRolesSummary(CFG.getGlobalChannelRoles ? CFG.getGlobalChannelRoles() : [])
                : 'Ch1–8';
        setFourBallDecodeStatus(
            `上次解码 OK · ${chLabel} · n=${slice.length}×${slice[0].length}ch · fs=${sr}Hz · ${windowSec}s窗`
        );
    } catch (e) {
        console.warn('decode_window 请求失败:', e);
        setFourBallDecodeStatus(`网络/请求异常：${e.message || e}`);
    } finally {
        fourBallDecodeInFlight = false;
    }
}

function initStimulusExperimentSyncUi() {
    const E = window.SEEKBCI_EXPERIMENT;
    if (!E) return;
    E.populateProjectSelect('exp-sync-project');
    const saved = E.loadExperimentConfig();
    const hint = document.getElementById('exp-sync-hint');
    if (saved && saved.stimulusRun) {
        E.applyStimulusRunToDom(saved.stimulusRun);
        if (hint && saved.updatedAt) {
            hint.textContent = `已加载上次保存的实验参数（${new Date(saved.updatedAt).toLocaleString('zh-CN')}）`;
        }
        return;
    }
    try {
        const cur = JSON.parse(localStorage.getItem('ssvep_project') || 'null');
        if (cur && cur.runConfig) {
            E.applyStimulusRunToDom({
                flickerHighBlank: cur.runConfig.flickerHighBlank,
                flickerOnDutyPercent: cur.runConfig.flickerOnDutyPercent,
                flickerBlockOpacityPercent: cur.runConfig.flickerBlockOpacityPercent
            });
            if (hint) {
                hint.textContent = `已从当前项目「${cur.name || cur.id}」加载运行配置中的闪烁参数`;
            }
        }
    } catch (_) {
        /* ignore */
    }
}

function saveStimulusExperimentOnly() {
    const E = window.SEEKBCI_EXPERIMENT;
    if (!E) {
        alert('实验配置模块未加载');
        return;
    }
    const saved = E.saveCurrentStimulusExperiment();
    const hint = document.getElementById('exp-sync-hint');
    if (hint) {
        hint.textContent = `已保存实验参数（${new Date(saved.updatedAt).toLocaleString('zh-CN')}）`;
    }
    alert('刺激实验参数已保存到本机，可在下方选择项目后同步。');
}

function syncStimulusToProjectUi() {
    const E = window.SEEKBCI_EXPERIMENT;
    if (!E) {
        alert('实验配置模块未加载');
        return;
    }
    const projectId = document.getElementById('exp-sync-project')?.value;
    if (!projectId) {
        alert('请选择要同步到的项目');
        return;
    }
    try {
        const { project, runConfig } = E.syncStimulusToProject(projectId);
        const hint = document.getElementById('exp-sync-hint');
        if (hint) {
            hint.textContent =
                `已同步到「${project.name}」：占空比 ${runConfig.flickerOnDutyPercent}% · 透明度 ${runConfig.flickerBlockOpacityPercent}%` +
                (runConfig.flickerHighBlank ? ' · 高亮透明' : '');
        }
        alert(
            `已将刺激参数写入「${project.name}」的运行配置。\n\n` +
                `占空比 ${runConfig.flickerOnDutyPercent}% · 方块透明度 ${runConfig.flickerBlockOpacityPercent}%` +
                (runConfig.flickerHighBlank ? '\n高亮时方块透明：是' : '') +
                '\n\n可在项目管理器中运行该项目验证效果。'
        );
    } catch (err) {
        alert('同步失败：' + (err.message || err));
    }
}
