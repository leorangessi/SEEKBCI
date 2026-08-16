/**
 * 刺激运行时：项目 settings.cursorControl → IMU 映射系统光标 + 点击方式
 *
 * clickMethod:
 *   none  — 仅移动
 *   dwell — 光标相对静止 dwellMs 后在当前位置点击
 *   space — 按空格在当前位置点击
 *
 * 采样经 SSVEP_IMU_SAMPLE_HUB 共享（可与倾斜行走并行）。
 */
(function (global) {
    const DEFAULT_CONTROL = {
        enabled: false,
        mapping: {
            sensitivity: 42,
            invertX: true,
            invertY: true,
            headMode: true
        },
        clickMethod: 'none',
        clickType: 'single',
        dwellMs: 900,
        dwellStillPx: 14,
        dwellCooldownMs: 700
    };

    function resolveOrigin() {
        if (typeof global.ssvepResolveApiOrigin === 'function') {
            return global.ssvepResolveApiOrigin();
        }
        return 'http://127.0.0.1:8000';
    }

    function mergeControl(raw) {
        const base = JSON.parse(JSON.stringify(DEFAULT_CONTROL));
        if (!raw || typeof raw !== 'object') return base;
        const dwellCooldownMs =
            raw.dwellCooldownMs != null
                ? Number(raw.dwellCooldownMs)
                : raw.dwellCooldownoldownMs != null
                  ? Number(raw.dwellCooldownoldownMs)
                  : base.dwellCooldownMs;
        return {
            ...base,
            ...raw,
            mapping: { ...base.mapping, ...(raw.mapping || {}) },
            dwellCooldownMs: Number.isFinite(dwellCooldownMs) ? dwellCooldownMs : base.dwellCooldownMs
        };
    }

    class ImuCursorRuntime {
        constructor() {
            this.cfg = mergeControl(null);
            this.running = false;
            this.mapper = null;
            this._unsub = null;
            this._acquired = false;
            this._onKey = null;
            this._dwellAccumMs = 0;
            this._lastSampleTs = 0;
            this._lastClickTs = 0;
            this._moveQueue = { dx: 0, dy: 0 };
            this._moveTimer = null;
            this._status = 'idle';
            /** 项目配置中的基准灵敏度 */
            this._baseSensitivity = 42;
            /** 多模态切换：首次→0.5×，再→1×，再→2×，再→0.5×… */
            this._sensMultIndex = 1;
            this._sensMults = [0.5, 1, 2];
            this._sensHasCycled = false;
        }

        getStatus() {
            return this._status;
        }

        getSensitivityState() {
            const mult = this._sensMults[this._sensMultIndex] || 1;
            return {
                base: this._baseSensitivity,
                mult,
                effective: Math.max(1, Math.min(300, this._baseSensitivity * mult)),
                label: mult === 1 ? '1×' : `${mult}×`
            };
        }

        _applySensitivityMult() {
            if (!this.mapper || typeof this.mapper.setSensitivity !== 'function') return this.getSensitivityState();
            const st = this.getSensitivityState();
            this.mapper.setSensitivity(st.effective);
            return st;
        }

        /** 默认 1×；首次触发→0.5×，再→1×，再→2×，循环 */
        cycleSensitivityMultiplier() {
            if (!this._sensHasCycled && this._sensMultIndex === 1) {
                this._sensHasCycled = true;
                this._sensMultIndex = 0;
            } else {
                this._sensHasCycled = true;
                this._sensMultIndex = (this._sensMultIndex + 1) % this._sensMults.length;
            }
            return this._applySensitivityMult();
        }

        async moveCursorToScreenCenter() {
            const origin = resolveOrigin();
            const res = await fetch(`${origin}/api/system/mouse/move-center`, { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    (typeof body.detail === 'string' && body.detail) || `HTTP ${res.status}`
                );
            }
            return body;
        }

        async start(projectSettings) {
            await this.stop();
            this.cfg = mergeControl(projectSettings && projectSettings.cursorControl);
            if (!this.cfg.enabled) {
                this._status = 'disabled';
                return { ok: true, detail: '未启用 IMU 光标' };
            }

            const Mapper = global.SSVEP_IMU_MAPPER && global.SSVEP_IMU_MAPPER.ImuCursorMapper;
            const hub = global.SSVEP_IMU_SAMPLE_HUB && global.SSVEP_IMU_SAMPLE_HUB.shared;
            if (!Mapper || !hub) {
                this._status = 'error';
                return { ok: false, detail: '缺少 IMU 光标/Hub 脚本' };
            }

            const origin = resolveOrigin();
            try {
                const st = await fetch(`${origin}/api/system/keyboard/status`).then((r) => r.json());
                if (!st.available) {
                    this._status = 'error';
                    return {
                        ok: false,
                        detail: '系统键鼠不可用，请在编辑器启用「系统选项」并安装 pynput：' + (st.detail || '')
                    };
                }
            } catch (e) {
                this._status = 'error';
                return { ok: false, detail: '无法连接后端：' + (e.message || e) };
            }

            // 再确认鼠标移动接口可用
            try {
                const mr = await fetch(`${origin}/api/system/mouse/move`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dx: 0, dy: 0 })
                });
                if (!mr.ok) {
                    const body = await mr.json().catch(() => ({}));
                    this._status = 'error';
                    return {
                        ok: false,
                        detail:
                            (typeof body.detail === 'string' && body.detail) ||
                            '鼠标移动接口不可用（请安装 pynput 并重启后端）'
                    };
                }
            } catch (e) {
                this._status = 'error';
                return { ok: false, detail: '鼠标接口探测失败：' + (e.message || e) };
            }

            const acq = await hub.acquire();
            if (!acq.ok) {
                this._status = 'error';
                return acq;
            }
            this._acquired = true;

            this.mapper = new Mapper(this.cfg.mapping || {});
            this._baseSensitivity = Math.max(
                1,
                Math.min(300, Number(this.cfg.mapping && this.cfg.mapping.sensitivity) || 42)
            );
            this._sensMultIndex = 1; // 默认 1×
            this._sensHasCycled = false;
            this.mapper.startCalibration();
            this._applySensitivityMult();
            this._unsub = hub.subscribe((sample) => this._handleSample(sample));

            this.running = true;
            this._status = 'calibrating';
            this._dwellAccumMs = 0;
            this._lastSampleTs = performance.now();
            this._sampleSeen = false;

            if (this.cfg.clickMethod === 'space') {
                this._onKey = (ev) => {
                    if (!this.running) return;
                    if (ev.code === 'Space' || ev.key === ' ') {
                        ev.preventDefault();
                        this._fireClick();
                    }
                };
                window.addEventListener('keydown', this._onKey, true);
            }

            console.log('[ImuCursorRuntime] started', this.cfg.clickMethod, this.cfg.clickType);
            return { ok: true, detail: '已启动，静止约 0.5s 完成校准…' };
        }

        async stop() {
            this.running = false;
            this._status = 'idle';
            if (this._onKey) {
                window.removeEventListener('keydown', this._onKey, true);
                this._onKey = null;
            }
            if (this._moveTimer) {
                clearTimeout(this._moveTimer);
                this._moveTimer = null;
            }
            this._moveQueue = { dx: 0, dy: 0 };
            if (this._unsub) {
                this._unsub();
                this._unsub = null;
            }
            this.mapper = null;
            if (this._acquired) {
                const hub = global.SSVEP_IMU_SAMPLE_HUB && global.SSVEP_IMU_SAMPLE_HUB.shared;
                if (hub) await hub.release();
                this._acquired = false;
            }
        }

        _handleSample(sample) {
            if (!this.running || !this.mapper || !sample) return;
            this._sampleSeen = true;
            const now = performance.now();
            const dtMs = Math.max(0, Math.min(80, now - this._lastSampleTs));
            this._lastSampleTs = now;

            const out = this.mapper.onSample(sample);
            if (!out || !out.ready) {
                this._status = 'calibrating';
                return;
            }
            this._status = 'running';

            const dx = out.moveX | 0;
            const dy = out.moveY | 0;
            if (dx || dy) {
                this._queueMove(dx, dy);
            }

            if (this.cfg.clickMethod === 'dwell') {
                const still = Math.abs(dx) + Math.abs(dy) < (this.cfg.dwellStillPx || 14);
                if (still) {
                    this._dwellAccumMs += dtMs;
                    if (this._dwellAccumMs >= (this.cfg.dwellMs || 900)) {
                        this._dwellAccumMs = 0;
                        this._fireClick();
                    }
                } else {
                    this._dwellAccumMs = 0;
                }
            }
        }

        _queueMove(dx, dy) {
            this._moveQueue.dx += dx;
            this._moveQueue.dy += dy;
            if (this._moveTimer) return;
            this._moveTimer = setTimeout(() => {
                this._moveTimer = null;
                const q = this._moveQueue;
                this._moveQueue = { dx: 0, dy: 0 };
                if (!q.dx && !q.dy) return;
                const origin = resolveOrigin();
                fetch(`${origin}/api/system/mouse/move`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dx: q.dx, dy: q.dy })
                }).catch(() => {});
            }, 8);
        }

        _fireClick() {
            const now = performance.now();
            if (now - this._lastClickTs < (this.cfg.dwellCooldownMs || 700)) return;
            this._lastClickTs = now;
            const clicks = this.cfg.clickType === 'double' ? 2 : 1;
            const origin = resolveOrigin();
            fetch(`${origin}/api/system/mouse/click-current`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clicks })
            }).catch((e) => console.warn('[ImuCursorRuntime] click failed', e));
        }
    }

    global.SSVEP_IMU_CURSOR_RUNTIME = {
        DEFAULT_CONTROL,
        mergeControl,
        ImuCursorRuntime,
        shared: new ImuCursorRuntime()
    };
})(typeof window !== 'undefined' ? window : globalThis);
