/**
 * 专注度监测测试 — 眼电通道 Welch 频段 → /api/focus/analyze
 */
(function () {
    const BAND_ORDER = [
        { key: 'delta', label: 'δ Delta 1–4', color: '#78909c' },
        { key: 'theta', label: 'θ Theta 4–8', color: '#7e57c2' },
        { key: 'alpha', label: 'α Alpha 8–13', color: '#42a5f5' },
        { key: 'beta', label: 'β Beta 13–30', color: '#26a69a' },
        { key: 'gamma', label: 'γ Gamma 30–45', color: '#ff7043' }
    ];

    let running = false;
    let pollTimer = null;
    let deviceConnected = false;
    let listenerAttached = false;
    let scoreHistory = [];
    let lastScore = 0;
    const HISTORY_MAX = 180;

    function getApiOrigin() {
        return typeof window.ssvepResolveApiOrigin === 'function'
            ? window.ssvepResolveApiOrigin()
            : 'http://127.0.0.1:8000';
    }

    function getDevicesApiBase() {
        return typeof window.ssvepGetDevicesApiBase === 'function'
            ? window.ssvepGetDevicesApiBase()
            : `${getApiOrigin()}/api/devices`;
    }

    function getFocusApiBase() {
        return `${getApiOrigin()}/api/focus`;
    }

    function getEogChannelIndices() {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
            return CFG.getPhysicalChannelsForRole('eog');
        }
        const gdm = window.globalDeviceManager;
        const roles = gdm && typeof gdm.getChannelRoles === 'function' ? gdm.getChannelRoles() : null;
        if (!Array.isArray(roles)) return [];
        const out = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === 'eog') out.push(i);
        }
        return out;
    }

    function getSsvepChannelIndices() {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
            return CFG.getPhysicalChannelsForRole('ssvep');
        }
        const gdm = window.globalDeviceManager;
        const roles = gdm && typeof gdm.getChannelRoles === 'function' ? gdm.getChannelRoles() : null;
        if (!Array.isArray(roles)) return [];
        const out = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === 'ssvep') out.push(i);
        }
        return out;
    }

    function selectedChannels() {
        const boxes = document.querySelectorAll('#channel-list input[type=checkbox]:checked');
        return Array.from(boxes).map((el) => parseInt(el.value, 10)).filter((n) => Number.isFinite(n));
    }

    function renderChannelList() {
        const wrap = document.getElementById('channel-list');
        if (!wrap) return;
        const eog = getEogChannelIndices();
        const gdm = window.globalDeviceManager;
        const nCh =
            (gdm && gdm.deviceInfo && gdm.deviceInfo.channel_count) ||
            (gdm && Array.isArray(gdm.getChannelRoles?.()) && gdm.getChannelRoles().length) ||
            8;
        if (!eog.length) {
            wrap.innerHTML =
                '<p class="form-hint" style="color:#f80;">未配置眼电通道。可临时勾选下方通道做试验：</p>';
        } else {
            wrap.innerHTML = '';
        }
        const prefer = new Set(eog.length ? eog : [0]);
        for (let i = 0; i < nCh; i++) {
            const label = document.createElement('label');
            label.className = 'ch-check';
            const checked = prefer.has(i) ? 'checked' : '';
            const tag = eog.includes(i) ? '（眼电）' : '';
            label.innerHTML = `<input type="checkbox" value="${i}" ${checked}> Ch${i + 1} ${tag}`;
            wrap.appendChild(label);
        }
    }

    function updateConnUi() {
        const pill = document.getElementById('conn-status');
        const detail = document.getElementById('conn-detail');
        const gdm = window.globalDeviceManager;
        const live = !!(deviceConnected || (gdm && gdm.isConnected));
        if (pill) {
            pill.className = 'status-pill ' + (live ? 'status-ok' : 'status-bad');
            pill.textContent = live ? '已连接' : '未连接';
        }
        const eog = getEogChannelIndices();
        if (detail) {
            if (!live) detail.textContent = '请先在设备管理连接 EEG';
            else if (!eog.length) detail.textContent = '已连接；建议将额区通道标为「眼电」';
            else detail.textContent = `眼电通道：${eog.map((c) => 'Ch' + (c + 1)).join('、')}`;
        }
        const srEl = document.getElementById('sr-label');
        if (srEl) {
            const sr = gdm && gdm.deviceInfo ? gdm.deviceInfo.sampling_rate : null;
            srEl.textContent = sr ? `采样率 ${sr} Hz` : '采样率 — Hz';
        }
    }

    function drawGauge(score) {
        const canvas = document.getElementById('gauge-canvas');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const css = canvas.clientWidth || 320;
        canvas.width = Math.floor(css * dpr);
        canvas.height = Math.floor(css * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cx = css / 2;
        const cy = css / 2;
        const r = css * 0.38;
        ctx.clearRect(0, 0, css, css);

        // track
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
        ctx.strokeStyle = '#1e1e2a';
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.stroke();

        const t = Math.max(0, Math.min(1, (Number(score) || 0) / 100));
        const end = Math.PI * 0.75 + t * Math.PI * 1.5;
        const grad = ctx.createLinearGradient(0, css, css, 0);
        grad.addColorStop(0, '#26a69a');
        grad.addColorStop(0.5, '#4fc3f7');
        grad.addColorStop(1, '#7e57c2');
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 0.75, end);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    function drawHistory() {
        const canvas = document.getElementById('history-canvas');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 520;
        const h = canvas.clientHeight || 100;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#080810';
        ctx.fillRect(0, 0, w, h);
        // grid
        ctx.strokeStyle = '#1a1a28';
        ctx.lineWidth = 1;
        for (let y = 0; y <= 100; y += 25) {
            const yy = h - (y / 100) * (h - 8) - 4;
            ctx.beginPath();
            ctx.moveTo(0, yy);
            ctx.lineTo(w, yy);
            ctx.stroke();
        }
        if (scoreHistory.length < 2) return;
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        scoreHistory.forEach((s, i) => {
            const x = (i / Math.max(1, HISTORY_MAX - 1)) * w;
            const y = h - (s / 100) * (h - 8) - 4;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    function renderBands(bands, metrics) {
        const wrap = document.getElementById('band-bars');
        if (!wrap || !bands) return;
        const relKeys = ['delta_rel', 'theta_rel', 'alpha_rel', 'beta_rel', 'gamma_rel'];
        const rels = relKeys.map((k) => (metrics && metrics[k] != null ? Number(metrics[k]) : 0));
        const maxRel = Math.max(0.01, ...rels);
        wrap.innerHTML = BAND_ORDER.map((b, i) => {
            const rel = rels[i] || 0;
            const pct = Math.min(100, (rel / maxRel) * 100);
            const abs = bands[b.key] != null ? Number(bands[b.key]) : 0;
            return `
            <div class="band-row">
                <div class="lab"><span>${b.label}</span><span>${(rel * 100).toFixed(1)}% · ${abs.toExponential(2)}</span></div>
                <div class="band-bar"><div class="band-fill" style="width:${pct}%;background:${b.color}"></div></div>
            </div>`;
        }).join('');

        const card = document.getElementById('metric-card');
        if (card && metrics) {
            card.innerHTML =
                `Engagement <b>${Number(metrics.engagement || 0).toFixed(3)}</b><br>` +
                `β/θ <b>${Number(metrics.beta_theta || 0).toFixed(3)}</b><br>` +
                `TBR (θ/β) <b>${Number(metrics.theta_beta_ratio || 0).toFixed(3)}</b>`;
        }
    }

    function renderPreprocess(prep) {
        const el = document.getElementById('preprocess-status');
        if (!el) return;
        if (!prep) {
            el.textContent = '预处理：—';
            return;
        }
        const parts = [];
        if (prep.filtered) parts.push('5–50 Hz + 陷波');
        if (prep.ssvep_ref_subtracted) parts.push('SSVEP 去共模');
        if (prep.eog_removed) parts.push('眼电回归剔除');
        if (prep.blink_heavy) {
            el.style.color = '#ffc107';
            parts.push(`眨眼干扰 VEOG ${Number(prep.veog_ptp_uv || 0).toFixed(0)} µV`);
        } else {
            el.style.color = '#666';
        }
        el.textContent = parts.length ? parts.join(' · ') : '预处理：—';
    }

    function applyResult(res) {
        if (!res || !res.success) return;
        lastScore = Number(res.focus_score) || 0;
        scoreHistory.push(lastScore);
        if (scoreHistory.length > HISTORY_MAX) scoreHistory.shift();
        const scoreEl = document.getElementById('focus-score');
        const levelEl = document.getElementById('focus-level');
        const instEl = document.getElementById('focus-instant');
        if (scoreEl) scoreEl.textContent = lastScore.toFixed(0);
        if (levelEl) levelEl.textContent = res.level || '';
        if (instEl) instEl.textContent = `即时 ${Number(res.focus_instant || 0).toFixed(0)}`;
        drawGauge(lastScore);
        drawHistory();
        renderBands(res.bands, res.metrics);
        renderPreprocess(res.preprocess);
    }

    async function pullRowsFromBuffer(windowSec, sr) {
        const gdm = window.globalDeviceManager;
        const n = Math.max(16, Math.floor((sr || 250) * windowSec));
        // 优先原始缓冲，由后端统一做带通 + 眼电剔除
        const rawBuf = gdm && Array.isArray(gdm.dataBuffer) ? gdm.dataBuffer : null;
        if (rawBuf && rawBuf.length) {
            return rawBuf.slice(-n);
        }
        const dispBuf = gdm && Array.isArray(gdm.dataDisplayBuffer) ? gdm.dataDisplayBuffer : null;
        if (dispBuf && dispBuf.length) {
            return dispBuf.slice(-n);
        }
        try {
            const resp = await fetch(
                `${getDevicesApiBase()}/data?duration=${encodeURIComponent(windowSec)}&for_display=false`
            );
            const json = await resp.json();
            if (resp.ok && json.success && Array.isArray(json.data)) return json.data;
        } catch (_e) {
            /* ignore */
        }
        try {
            const resp = await fetch(
                `${getDevicesApiBase()}/data?duration=${encodeURIComponent(windowSec)}&for_display=true`
            );
            const json = await resp.json();
            if (resp.ok && json.success && Array.isArray(json.data)) return json.data;
        } catch (_e) {
            /* ignore */
        }
        return null;
    }

    async function analyzeOnce() {
        const chs = selectedChannels();
        if (!chs.length) {
            document.getElementById('focus-level').textContent = '请选择通道';
            return;
        }
        const windowSec = parseFloat(document.getElementById('cfg-window')?.value) || 2;
        const gdm = window.globalDeviceManager;
        const sr =
            (gdm && gdm.deviceInfo && Number(gdm.deviceInfo.sampling_rate)) ||
            250;
        const rows = await pullRowsFromBuffer(windowSec, sr);
        const eogRef = getEogChannelIndices();
        const ssvepRef = getSsvepChannelIndices();
        const body = {
            channel_indices: chs,
            eog_reference_indices: eogRef.length ? eogRef : chs,
            ssvep_reference_indices: ssvepRef.length ? ssvepRef : undefined,
            remove_eog: true,
            sampling_rate: sr,
            window_sec: windowSec
        };
        if (rows && rows.length) body.samples = rows;

        try {
            const resp = await fetch(`${getFocusApiBase()}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                document.getElementById('focus-level').textContent =
                    typeof json.detail === 'string' ? json.detail : '分析失败';
                return;
            }
            applyResult(json);
        } catch (e) {
            document.getElementById('focus-level').textContent = 'API 不可用，请重启后端';
            console.warn('[focus-test]', e);
        }
    }

    function setRunning(on) {
        running = !!on;
        const btn = document.getElementById('btn-toggle');
        const runLabel = document.getElementById('run-label');
        if (btn) btn.textContent = running ? '停止监测' : '开始监测';
        if (runLabel) runLabel.textContent = running ? '监测中…' : '已停止';
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (running) {
            const ms = parseInt(document.getElementById('cfg-poll')?.value, 10) || 400;
            void analyzeOnce();
            pollTimer = setInterval(() => void analyzeOnce(), Math.max(200, ms));
        }
    }

    async function resetSession() {
        try {
            await fetch(`${getFocusApiBase()}/reset`, { method: 'POST' });
        } catch (_e) {
            /* ignore */
        }
        scoreHistory = [];
        lastScore = 0;
        document.getElementById('focus-score').textContent = '—';
        document.getElementById('focus-level').textContent = '已重置';
        document.getElementById('focus-instant').textContent = '即时 —';
        drawGauge(0);
        drawHistory();
    }

    async function syncDevice() {
        const gdm = window.globalDeviceManager;
        try {
            const resp = await fetch(`${getDevicesApiBase()}/status`);
            const json = await resp.json();
            if (json.success && json.status && json.status.connected) {
                deviceConnected = true;
                if (gdm) {
                    gdm.isConnected = true;
                    gdm.deviceInfo = json.status.device_info;
                    gdm.saveState();
                    gdm.loadChannelConfig();
                    gdm.connectWebSocket(true);
                }
            } else {
                deviceConnected = false;
            }
        } catch (_e) {
            deviceConnected = false;
        }
        renderChannelList();
        updateConnUi();
    }

    function onDeviceEvent(event) {
        if (event === 'connected' || event === 'wsConnected') {
            deviceConnected = true;
            updateConnUi();
        } else if (event === 'disconnected') {
            deviceConnected = false;
            updateConnUi();
        } else if (event === 'statusChange') {
            updateConnUi();
        }
    }

    function bind() {
        document.getElementById('btn-toggle')?.addEventListener('click', () => setRunning(!running));
        document.getElementById('btn-reset')?.addEventListener('click', () => void resetSession());
        window.addEventListener('resize', () => {
            drawGauge(lastScore);
            drawHistory();
        });
        const gdm = window.globalDeviceManager;
        if (gdm && !listenerAttached) {
            gdm.addEventListener(onDeviceEvent);
            listenerAttached = true;
        }
    }

    async function init() {
        bind();
        await syncDevice();
        drawGauge(0);
        drawHistory();
        renderBands(
            { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
            { delta_rel: 0.2, theta_rel: 0.2, alpha_rel: 0.2, beta_rel: 0.2, gamma_rel: 0.2 }
        );
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
