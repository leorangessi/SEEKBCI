/*!
 * IMU 测试页：控制设备 BMI270 ↔ 被控设备光标 / 三维地球 / 倾斜 WASD
 */
(function () {
    const { ImuClient, PROTOCOL } = window.SSVEP_IMU_BLE;
    const { ImuCursorMapper } = window.SSVEP_IMU_MAPPER;
    const Loco = window.SSVEP_IMU_LOCOMOTION || {};
    const ImuTiltLocomotionMapper = Loco.ImuTiltLocomotionMapper;

    const el = {
        mode2d: document.getElementById('mode-2d'),
        mode3d: document.getElementById('mode-3d'),
        panel2d: document.getElementById('panel-2d'),
        panel3d: document.getElementById('panel-3d'),
        connStatus: document.getElementById('conn-status'),
        connDetail: document.getElementById('conn-detail'),
        btnConnect: document.getElementById('btn-connect'),
        btnConnectWeb: document.getElementById('btn-connect-web'),
        btnDisconnect: document.getElementById('btn-disconnect'),
        btnCalibrate: document.getElementById('btn-calibrate'),
        sensitivity: document.getElementById('cfg-sensitivity'),
        invertX: document.getElementById('cfg-invert-x'),
        invertY: document.getElementById('cfg-invert-y'),
        systemMouse: document.getElementById('cfg-system-mouse'),
        locoEnable: document.getElementById('cfg-loco-enable'),
        locoSens: document.getElementById('cfg-loco-sens'),
        locoPitch: document.getElementById('cfg-loco-pitch'),
        locoRoll: document.getElementById('cfg-loco-roll'),
        locoInvertFwd: document.getElementById('cfg-loco-invert-fwd'),
        locoInvertStrafe: document.getElementById('cfg-loco-invert-strafe'),
        locoSystem: document.getElementById('cfg-loco-system'),
        btnAxisCalib: document.getElementById('btn-axis-calib'),
        btnAxisCancel: document.getElementById('btn-axis-cancel'),
        btnAxisClear: document.getElementById('btn-axis-clear'),
        axisPrompt: document.getElementById('axis-prompt'),
        axisOverlay: document.getElementById('axis-overlay'),
        axisOverlayMsg: document.getElementById('axis-overlay-msg'),
        axisOverlayFill: document.getElementById('axis-overlay-fill'),
        axisOverlayHint: document.getElementById('axis-overlay-hint'),
        wasdPad: document.getElementById('wasd-pad'),
        locoLive: document.getElementById('loco-live'),
        locoLog: document.getElementById('loco-log'),
        payload: document.getElementById('payload-raw'),
        stats: document.getElementById('stats-text'),
        cursorCanvas: document.getElementById('cursor-canvas'),
        earthCanvas: document.getElementById('earth-canvas')
    };

    const client = new ImuClient();
    const mapper = new ImuCursorMapper();
    const locoMapper = ImuTiltLocomotionMapper ? new ImuTiltLocomotionMapper() : null;
    const earthRenderer =
        window.SSVEP_IMU_EARTH && window.SSVEP_IMU_EARTH.ImuEarthRenderer
            ? new window.SSVEP_IMU_EARTH.ImuEarthRenderer()
            : null;
    let viewMode = '3d';
    let cursorPos = { x: 0.5, y: 0.5 };
    let earthYaw = 0.35;
    let earthPitch = 0.18;
    let hzCounter = 0;
    let hzShown = 0;
    let hzWindowStart = performance.now();
    let mouseMoveQueue = { x: 0, y: 0 };
    let mouseFlushTimer = null;
    let lastPayload = '';
    let lastLocoKeysJson = '';
    let lastLocoOut = null;
    const locoLogLines = [];
    const LOCO_LOG_MAX = 40;
    let holdSyncTimer = null;
    let pendingHold = null;

    function apiOrigin() {
        if (typeof window.ssvepResolveApiOrigin === 'function') {
            return window.ssvepResolveApiOrigin();
        }
        return window.SSVEP_API_ORIGIN || 'http://127.0.0.1:8765';
    }

    function setStatus(ok, wait, text, detail) {
        el.connStatus.className = 'status-pill ' + (ok ? 'status-ok' : wait ? 'status-wait' : 'status-bad');
        el.connStatus.textContent = text;
        el.connDetail.textContent = detail || '';
    }

    function applyMapperCfg() {
        mapper.setSensitivity(Number(el.sensitivity.value) || 42);
        mapper.cfg.invertX = !!el.invertX.checked;
        mapper.cfg.invertY = !!el.invertY.checked;
    }

    const AXIS_MAP_KEY = 'ssvep_imu_axis_map';

    function loadSavedAxisMap() {
        try {
            const raw = localStorage.getItem(AXIS_MAP_KEY);
            if (!raw) return null;
            const o = JSON.parse(raw);
            if (o && o.calibrated && o.forward && o.right && o.up) return o;
        } catch (_) {
            /* ignore */
        }
        return null;
    }

    function saveAxisMap(map) {
        try {
            if (map && map.calibrated) {
                localStorage.setItem(AXIS_MAP_KEY, JSON.stringify(map));
            } else {
                localStorage.removeItem(AXIS_MAP_KEY);
            }
        } catch (_) {
            /* ignore */
        }
    }

    function refreshAxisPromptUi(meta) {
        const overlayOn = !!(meta && meta.axisCalibrating);
        if (el.axisOverlay) {
            el.axisOverlay.hidden = !overlayOn;
        }
        if (overlayOn) {
            const msg = meta.axisPrompt || '方向校准中…';
            const hint = meta.axisHint || '';
            const progress = Math.max(0, Math.min(1, Number(meta.axisProgress) || 0));
            if (el.axisPrompt) {
                el.axisPrompt.textContent = msg + (hint ? ' · ' + hint : '');
                el.axisPrompt.style.color = '#ffc107';
            }
            if (el.axisOverlayMsg) el.axisOverlayMsg.textContent = msg;
            if (el.axisOverlayHint) el.axisOverlayHint.textContent = hint;
            if (el.axisOverlayFill) el.axisOverlayFill.style.width = Math.round(progress * 100) + '%';
            if (el.btnAxisCancel) el.btnAxisCancel.hidden = false;
            return;
        }
        if (el.axisOverlayFill) el.axisOverlayFill.style.width = '0%';
        if (el.axisOverlayMsg) el.axisOverlayMsg.textContent = '—';
        if (el.axisOverlayHint) el.axisOverlayHint.textContent = '';
        if (locoMapper && locoMapper.userAxisCalibrated) {
            if (el.axisPrompt) {
                el.axisPrompt.textContent = '方向：已校准（与设备关联）';
                el.axisPrompt.style.color = '#4caf70';
            }
        } else if (el.axisPrompt) {
            el.axisPrompt.textContent = '方向：默认（不对时再校准）';
            el.axisPrompt.style.color = '#5cd6ff';
        }
        if (el.btnAxisCancel) el.btnAxisCancel.hidden = true;
    }

    function applyLocoCfg() {
        if (!locoMapper) return;
        locoMapper.cfg.mode = 'lean';
        locoMapper.cfg.accelSensitivity = Math.max(
            0.2,
            Math.min(12, Number(el.locoSens && el.locoSens.value) || 2.5)
        );
        locoMapper.cfg.accelForwardTh = Math.max(0.2, Math.min(6, Number(el.locoPitch && el.locoPitch.value) || 1.0));
        locoMapper.cfg.accelStrafeTh = Math.max(0.2, Math.min(6, Number(el.locoRoll && el.locoRoll.value) || 1.0));
        locoMapper.cfg.invertForward = !!(el.locoInvertFwd && el.locoInvertFwd.checked);
        locoMapper.cfg.invertStrafe = !!(el.locoInvertStrafe && el.locoInvertStrafe.checked);
        locoMapper.cfg.adaptNeutral = true;
    }

    function formatHeldKeys(keys) {
        if (!keys) return '—';
        const parts = [];
        if (keys.KeyW) parts.push('W');
        if (keys.KeyA) parts.push('A');
        if (keys.KeyS) parts.push('S');
        if (keys.KeyD) parts.push('D');
        return parts.length ? parts.join('+') : '—';
    }

    function appendLocoLog(line) {
        const ts = new Date();
        const stamp =
            String(ts.getHours()).padStart(2, '0') +
            ':' +
            String(ts.getMinutes()).padStart(2, '0') +
            ':' +
            String(ts.getSeconds()).padStart(2, '0');
        const full = `[${stamp}] ${line}`;
        locoLogLines.push(full);
        while (locoLogLines.length > LOCO_LOG_MAX) locoLogLines.shift();
        if (el.locoLog) el.locoLog.textContent = locoLogLines.join('\n');
        console.log('[IMU WASD]', line);
    }

    function updateWasdUi(keys, meta) {
        const label = formatHeldKeys(keys);
        if (el.locoLive) {
            let extra = '';
            if (meta) {
                if (meta.axisCalibrating) {
                    extra = ' · 方向校准中';
                } else if (meta.calibrating) extra = ' · 校准中';
                else if (meta.ready) {
                    const fwdTh = Number(meta.fwdTh || 1);
                    const strTh = Number(meta.strTh || 1);
                    extra =
                        ` · fwd ${Number(meta.fwdScaled || 0).toFixed(2)}/${fwdTh.toFixed(1)}` +
                        ` str ${Number(meta.strScaled || 0).toFixed(2)}/${strTh.toFixed(1)}` +
                        ` · sens ${Number(meta.sensitivity || 0).toFixed(1)}`;
                }
            }
            el.locoLive.textContent = 'WASD: ' + label + extra;
        }
        if (el.wasdPad) {
            el.wasdPad.querySelectorAll('.wasd-key').forEach((node) => {
                const k = node.getAttribute('data-key');
                const code = 'Key' + k;
                node.classList.toggle('on', !!(keys && keys[code]));
            });
        }
    }

    function queueHoldSync(keys) {
        if (!el.locoSystem || !el.locoSystem.checked) return;
        pendingHold = keys;
        if (holdSyncTimer) return;
        holdSyncTimer = setTimeout(async () => {
            holdSyncTimer = null;
            const k = pendingHold;
            pendingHold = null;
            if (!k) return;
            try {
                await fetch(`${apiOrigin()}/api/system/keyboard/hold-sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ held: k })
                });
            } catch (_) {
                /* ignore */
            }
        }, 40);
    }

    async function releaseSystemWasd() {
        pendingHold = null;
        if (holdSyncTimer) {
            clearTimeout(holdSyncTimer);
            holdSyncTimer = null;
        }
        try {
            await fetch(`${apiOrigin()}/api/system/keyboard/hold-release-all`, { method: 'POST' });
        } catch (_) {
            /* ignore */
        }
    }

    function handleLocoSample(sample) {
        if (!locoMapper || !el.locoEnable || !el.locoEnable.checked) {
            if (lastLocoKeysJson) {
                lastLocoKeysJson = '';
                updateWasdUi(null, null);
                void releaseSystemWasd();
            }
            return;
        }
        const out = locoMapper.onSample(sample);
        lastLocoOut = out;
        if (out && out.axisCalibrating) {
            refreshAxisPromptUi(out);
            updateWasdUi(null, out);
            return;
        }
        if (out && out.axisPhase === 'done' && out.axisCalibrated) {
            const map = locoMapper.exportAxisMap();
            if (map) {
                saveAxisMap(map);
                appendLocoLog('方向校准完成，轴向已与设备关联');
            }
            locoMapper.axisPhase = 'idle';
            refreshAxisPromptUi(out);
        }
        if (!out || !out.ready) {
            updateWasdUi(null, out);
            refreshAxisPromptUi(out);
            return;
        }
        const json = JSON.stringify(out.keys);
        if (json !== lastLocoKeysJson) {
            lastLocoKeysJson = json;
            const label = formatHeldKeys(out.keys);
            appendLocoLog(
                label === '—'
                    ? '松开全部'
                    : `触发 ${label}` +
                          ` (fwd ${Number(out.fwdScaled || 0).toFixed(2)} / str ${Number(out.strScaled || 0).toFixed(2)})`
            );
            updateWasdUi(out.keys, out);
            queueHoldSync(out.keys);
        } else {
            updateWasdUi(out.keys, out);
        }
        refreshAxisPromptUi(out);
    }

    function setViewMode(mode) {
        viewMode = mode;
        el.mode2d.classList.toggle('active', mode === '2d');
        el.mode3d.classList.toggle('active', mode === '3d');
        el.panel2d.hidden = mode !== '2d';
        el.panel3d.hidden = mode !== '3d';
        resizeCanvases();
    }

    function resizeCanvases() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        [el.cursorCanvas, el.earthCanvas].forEach((canvas) => {
            if (!canvas || canvas.hidden) return;
            const parent = canvas.parentElement;
            const w = Math.max(320, parent.clientWidth - 24);
            const h = Math.max(320, parent.clientHeight - 24);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        });
    }

    function queueSystemMouse(dx, dy) {
        if (!el.systemMouse.checked || (!dx && !dy)) return;
        mouseMoveQueue.x += dx;
        mouseMoveQueue.y += dy;
        if (mouseFlushTimer) return;
        mouseFlushTimer = setTimeout(flushSystemMouse, 16);
    }

    async function flushSystemMouse() {
        mouseFlushTimer = null;
        const dx = Math.trunc(mouseMoveQueue.x);
        const dy = Math.trunc(mouseMoveQueue.y);
        mouseMoveQueue.x -= dx;
        mouseMoveQueue.y -= dy;
        if (!dx && !dy) return;
        try {
            await fetch(`${apiOrigin()}/api/system/mouse/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dx, dy })
            });
        } catch (_) {
            /* ignore network blips during continuous streaming */
        }
    }

    client.onStatus = (status, detail) => {
        const via = client.transport === 'backend' ? '后端 Bleak' : 'Web Bluetooth';
        if (status === 'connected') setStatus(true, false, `已连接 · ${via}`, detail);
        else if (status === 'scanning' || status === 'requesting' || status === 'connecting') {
            setStatus(false, true, '连接中…', detail);
        } else {
            setStatus(false, false, '未连接', detail || '请上电 SEEKBCI / ESP32_BMI270_MOUSE 后点「连接 IMU」');
            void releaseSystemWasd();
            lastLocoKeysJson = '';
            updateWasdUi(null, null);
        }
    };

    client.onError = (decoded) => {
        el.payload.textContent = decoded.raw || 'ERR';
        setStatus(false, true, '设备报错', decoded.code || decoded.raw);
    };

    client.onSample = (sample) => {
        lastPayload = sample.raw;
        hzCounter += 1;
        const result = mapper.onSample(sample);
        if (result.ready) {
            if (result.moveX || result.moveY) {
                cursorPos.x = Math.max(0.02, Math.min(0.98, cursorPos.x + result.moveX / 900));
                cursorPos.y = Math.max(0.02, Math.min(0.98, cursorPos.y + result.moveY / 900));
                queueSystemMouse(result.moveX, result.moveY);
            }
            const snap = mapper.snapshot();
            earthYaw += snap.rateX * 0.055;
            earthPitch = Math.max(-1.15, Math.min(1.15, earthPitch - snap.rateY * 0.045));
        }
        handleLocoSample(sample);
    };

    async function doConnect(mode) {
        el.btnConnect.disabled = true;
        if (el.btnConnectWeb) el.btnConnectWeb.disabled = true;
        try {
            applyMapperCfg();
            applyLocoCfg();
            await client.connect(mode);
            mapper.startCalibration();
            if (locoMapper) {
                const saved = loadSavedAxisMap();
                if (saved) locoMapper.applyAxisMap(saved);
                locoMapper.startCalibration();
                refreshAxisPromptUi({ axisCalibrated: locoMapper.userAxisCalibrated });
            }
            appendLocoLog('已连接，开始静止校准（请保持静止）');
        } catch (err) {
            setStatus(false, false, '连接失败', err.message || String(err));
        } finally {
            el.btnConnect.disabled = false;
            if (el.btnConnectWeb) el.btnConnectWeb.disabled = false;
        }
    }

    el.btnConnect.addEventListener('click', () => doConnect('backend'));
    if (el.btnConnectWeb) {
        el.btnConnectWeb.addEventListener('click', () => doConnect('web'));
    }
    el.btnDisconnect.addEventListener('click', async () => {
        await releaseSystemWasd();
        await client.disconnect();
    });
    el.btnCalibrate.addEventListener('click', () => {
        applyMapperCfg();
        applyLocoCfg();
        mapper.startCalibration();
        if (locoMapper) locoMapper.startCalibration();
        cursorPos = { x: 0.5, y: 0.5 };
        lastLocoKeysJson = '';
        updateWasdUi(null, { calibrating: true });
        appendLocoLog('重新静止校准（请保持静止）');
        void releaseSystemWasd();
    });
    if (el.btnAxisCalib) {
        el.btnAxisCalib.addEventListener('click', () => {
            if (!locoMapper) return;
            if (client.status !== 'connected') {
                appendLocoLog('请先连接 IMU');
                return;
            }
            const res = locoMapper.startAxisCalibration();
            if (!res.ok) {
                appendLocoLog(res.detail || '无法开始方向校准');
                refreshAxisPromptUi(null);
                return;
            }
            lastLocoKeysJson = '';
            void releaseSystemWasd();
            appendLocoLog(res.detail);
            refreshAxisPromptUi({
                axisCalibrating: true,
                axisPrompt: '准备开始',
                axisHint: '请先保持中立，随后按屏幕中央提示操作',
                axisProgress: 0
            });
        });
    }
    if (el.btnAxisCancel) {
        el.btnAxisCancel.addEventListener('click', () => {
            if (!locoMapper) return;
            locoMapper.cancelAxisCalibration();
            appendLocoLog('已取消方向校准');
            refreshAxisPromptUi(null);
        });
    }
    if (el.btnAxisClear) {
        el.btnAxisClear.addEventListener('click', () => {
            if (!locoMapper) return;
            locoMapper.clearAxisMap();
            saveAxisMap(null);
            appendLocoLog('已清除方向校准，恢复默认轴向');
            refreshAxisPromptUi(null);
        });
    }
    el.sensitivity.addEventListener('change', applyMapperCfg);
    el.invertX.addEventListener('change', applyMapperCfg);
    el.invertY.addEventListener('change', applyMapperCfg);
    [el.locoSens, el.locoPitch, el.locoRoll, el.locoInvertFwd, el.locoInvertStrafe].forEach((node) => {
        if (node) node.addEventListener('change', applyLocoCfg);
    });
    if (el.locoSens) {
        el.locoSens.addEventListener('input', applyLocoCfg);
    }
    if (el.locoPitch) el.locoPitch.addEventListener('input', applyLocoCfg);
    if (el.locoRoll) el.locoRoll.addEventListener('input', applyLocoCfg);
    if (el.locoEnable) {
        el.locoEnable.addEventListener('change', () => {
            if (!el.locoEnable.checked) {
                lastLocoKeysJson = '';
                updateWasdUi(null, null);
                void releaseSystemWasd();
                appendLocoLog('已关闭倾斜行走预览');
            } else {
                applyLocoCfg();
                if (locoMapper && client.status === 'connected') {
                    locoMapper.startCalibration();
                    appendLocoLog('已开启倾斜行走，重新校准…');
                }
            }
        });
    }
    if (el.locoSystem) {
        el.locoSystem.addEventListener('change', () => {
            if (!el.locoSystem.checked) void releaseSystemWasd();
            else appendLocoLog('已开启系统 WASD 驱动（请先聚焦目标窗口）');
        });
    }
    el.mode2d.addEventListener('click', () => setViewMode('2d'));
    el.mode3d.addEventListener('click', () => setViewMode('3d'));

    function drawCursor(ctx, w, h) {
        ctx.clearRect(0, 0, w, h);
        const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
        g.addColorStop(0, '#122038');
        g.addColorStop(1, '#07080e');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(80,160,220,0.18)';
        ctx.lineWidth = 1;
        const step = 40;
        for (let x = 0; x < w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y < h; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const cx = cursorPos.x * w;
        const cy = cursorPos.y * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 220, 255, 0.12)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy);
        ctx.lineTo(cx + 16, cy);
        ctx.moveTo(cx, cy - 16);
        ctx.lineTo(cx, cy + 16);
        ctx.stroke();

        ctx.fillStyle = '#8ab0c8';
        ctx.font = '12px Consolas, monospace';
        ctx.fillText(`cursor ${(cursorPos.x * 100).toFixed(0)}%, ${(cursorPos.y * 100).toFixed(0)}%`, 14, 22);
        if (lastLocoOut && lastLocoOut.ready) {
            ctx.fillText('WASD ' + formatHeldKeys(lastLocoOut.keys), 14, 40);
        }
    }

    function updateHud() {
        const now = performance.now();
        if (now - hzWindowStart >= 1000) {
            hzShown = hzCounter;
            hzCounter = 0;
            hzWindowStart = now;
        }
        const snap = mapper.snapshot();
        el.payload.textContent = lastPayload || client.lastError || '—';
        const cal = snap.isCalibrating
            ? `校准中… 剩余 ${snap.calibrationLeft}`
            : snap.hasStarted
              ? snap.isStationary
                  ? '静止 · 零偏自适应'
                  : '跟踪中'
              : '未校准';
        let locoLine = '';
        if (lastLocoOut) {
            locoLine =
                `\nWASD ${formatHeldKeys(lastLocoOut.keys)}` +
                (lastLocoOut.ready
                    ? lastLocoOut.mode === 'displace'
                        ? ` · s ${lastLocoOut.sFwd.toFixed(3)}, ${lastLocoOut.sStrafe.toFixed(3)}`
                        : ` · fwd/str ${lastLocoOut.forwardMs2.toFixed(2)}, ${lastLocoOut.strafeMs2.toFixed(2)}`
                    : lastLocoOut.calibrating
                      ? ' · 加速度校准中'
                      : '');
        }
        el.stats.textContent =
            `协议 ${PROTOCOL.id} · ${hzShown} Hz · 样本 ${snap.sampleCount} · ` +
            `位移 ${snap.lastMove[0]},${snap.lastMove[1]} · ${cal}\n` +
            `gyro ${snap.gyro.map((v) => v.toFixed(3)).join(', ')} · ` +
            `rate ${snap.rateX.toFixed(3)}, ${snap.rateY.toFixed(3)}` +
            locoLine;
    }

    function frame() {
        const c2 = el.cursorCanvas;
        const c3 = el.earthCanvas;
        if (viewMode === '2d' && c2) {
            drawCursor(c2.getContext('2d'), c2.clientWidth, c2.clientHeight);
        } else if (c3 && earthRenderer) {
            earthRenderer.draw(c3.getContext('2d'), c3.clientWidth, c3.clientHeight, earthYaw, earthPitch);
        }
        if (client.status !== 'connected') {
            earthYaw += 0.0022;
        }
        updateHud();
        requestAnimationFrame(frame);
    }

    window.addEventListener('beforeunload', () => {
        void releaseSystemWasd();
    });

    setStatus(false, false, '未连接', `目标 ${PROTOCOL.deviceName} · 推荐「连接 IMU」(后端 Bleak)`);

    applyMapperCfg();
    applyLocoCfg();
    refreshAxisPromptUi(null);
    setViewMode('3d');
    updateWasdUi(null, null);
    window.addEventListener('resize', resizeCanvases);
    resizeCanvases();
    requestAnimationFrame(frame);
})();
