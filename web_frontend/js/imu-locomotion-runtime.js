/**
 * 加速度 → WASD（人物移动 / 坦克底盘）
 *
 * 相对中立的前后/左右 Δa（经灵敏度放大）超过阈值即按住对应键。
 * 仅用 ax/ay/az；视角仍由陀螺→鼠标；点击留给 EMG。
 */
(function (global) {
    const DEFAULT_LOCOMOTION = {
        enabled: false,
        mode: 'lean',
        /** 前进/后退阈值 (m/s²)，对滤波后 Δa × 灵敏度 比较 */
        accelForwardTh: 1.0,
        /** 左右阈值 (m/s²) */
        accelStrafeTh: 1.0,
        /** 加速度增益（乘到前后/左右分量上） */
        accelSensitivity: 2.5,
        invertForward: false,
        invertStrafe: false,
        smoothing: 0.78,
        adaptNeutral: true,
        adaptAlpha: 0.025,
        keys: {
            forward: 'KeyW',
            back: 'KeyS',
            left: 'KeyA',
            right: 'KeyD'
        },
        /** 用户方向校准结果（往前/左/上姿态学习轴向） */
        axisMap: null
    };

    function resolveOrigin() {
        if (typeof global.ssvepResolveApiOrigin === 'function') {
            return global.ssvepResolveApiOrigin();
        }
        return 'http://127.0.0.1:8000';
    }

    function mergeLocomotion(raw) {
        const base = JSON.parse(JSON.stringify(DEFAULT_LOCOMOTION));
        if (!raw || typeof raw !== 'object') return base;
        const merged = {
            ...base,
            ...raw,
            keys: { ...base.keys, ...(raw.keys || {}) }
        };
        // 统一为加速度阈值触发；旧项目的 displace 自动迁到 lean
        merged.mode = 'lean';
        if (raw.axisMap && raw.axisMap.calibrated && raw.axisMap.forward && raw.axisMap.right && raw.axisMap.up) {
            merged.axisMap = {
                calibrated: true,
                forward: raw.axisMap.forward.slice(),
                right: raw.axisMap.right.slice(),
                up: raw.axisMap.up.slice()
            };
        } else {
            merged.axisMap = null;
        }
        if (raw.accelForwardTh == null && raw.pitchThresholdDeg != null) {
            const deg = Number(raw.pitchThresholdDeg);
            if (Number.isFinite(deg)) {
                merged.accelForwardTh = Math.max(0.6, Math.sin((deg * Math.PI) / 180) * 9.80665);
            }
        }
        if (raw.accelStrafeTh == null && raw.rollThresholdDeg != null) {
            const deg = Number(raw.rollThresholdDeg);
            if (Number.isFinite(deg)) {
                merged.accelStrafeTh = Math.max(0.6, Math.sin((deg * Math.PI) / 180) * 9.80665);
            }
        }
        return merged;
    }

    function norm3(v) {
        return Math.hypot(v[0], v[1], v[2]) || 1;
    }

    function normalize3(v, fallback) {
        const n = norm3(v);
        if (n < 1e-6) return fallback.slice();
        return [v[0] / n, v[1] / n, v[2] / n];
    }

    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    function buildBasis(g0) {
        const up = normalize3(g0, [0, 0, 1]);
        let right = cross(up, [0, 1, 0]);
        if (norm3(right) < 0.2) right = cross(up, [1, 0, 0]);
        right = normalize3(right, [1, 0, 0]);
        const forward = normalize3(cross(right, up), [0, 1, 0]);
        return { up, right, forward };
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    const AXIS_PROMPTS = {
        forward: '① 请往前倾 / 往前移动，并保持…',
        return_back: '请往后移动，回到原点…',
        left: '② 请往左倾 / 往左移动，并保持…',
        return_right: '请往右移动，回到原点…',
        done: '方向校准完成'
    };

    const AXIS_CAPTURE_PHASES = { forward: true, left: true };
    const AXIS_RETURN_NEXT = {
        return_back: 'left',
        return_right: 'done'
    };

    const AXIS_CAPTURE_NEED = 55;
    const AXIS_MIN_MAG = 0.55;
    /** 回到原点：差分低于此值视为接近中立（放宽，避免卡死） */
    const AXIS_RETURN_MAG = 0.95;
    const AXIS_RETURN_STABLE_NEED = 20;
    /** 回原点阶段至少显示多久（ms） */
    const AXIS_RETURN_MIN_MS = 800;
    /** 回原点最长等待；超时仍进入下一步，避免一直卡住 */
    const AXIS_RETURN_MAX_MS = 3500;
    /** 开始 / 进入下一采集方向前的准备时间（ms） */
    const AXIS_PAUSE_PREPARE_MS = 1000;

    class ImuTiltLocomotionMapper {
        constructor(opts) {
            this.cfg = mergeLocomotion(opts);
            this.hasStarted = false;
            this.isCalibrating = false;
            this.calibrationSamples = [];
            this.a0 = [0, 0, 9.80665];
            this.up0 = [0, 0, 1];
            this.right0 = [1, 0, 0];
            this.forward0 = [0, 1, 0];
            this.userAxisCalibrated = false;
            this.filtFwd = 0;
            this.filtStrafe = 0;
            this.sFwd = 0;
            this.sStrafe = 0;
            this._lastTs = 0;
            this.calibrationSamplesTarget = 120;
            this.axisPhase = 'idle';
            this.axisCapture = [];
            this.axisRaw = { forward: null, left: null, up: null };
            this.axisPromptReadyAt = 0;
            this.axisPauseKind = null; // 'prepare'
            this.axisReturnStable = 0;
            this.axisReturnEnteredAt = 0;
            this.axisReturnStartMag = 0;
            if (this.cfg.axisMap && this.cfg.axisMap.calibrated) {
                this.applyAxisMap(this.cfg.axisMap);
            }
        }

        applyAxisMap(map) {
            if (!map || !map.calibrated || !map.forward || !map.right || !map.up) return false;
            this.forward0 = normalize3(map.forward, [0, 1, 0]);
            this.right0 = normalize3(map.right, [1, 0, 0]);
            this.up0 = normalize3(map.up, [0, 0, 1]);
            this.userAxisCalibrated = true;
            this.cfg.axisMap = {
                calibrated: true,
                forward: this.forward0.slice(),
                right: this.right0.slice(),
                up: this.up0.slice()
            };
            return true;
        }

        exportAxisMap() {
            if (!this.userAxisCalibrated) return null;
            return {
                calibrated: true,
                forward: this.forward0.slice(),
                right: this.right0.slice(),
                up: this.up0.slice()
            };
        }

        clearAxisMap() {
            this.userAxisCalibrated = false;
            this.cfg.axisMap = null;
            this.axisPhase = 'idle';
            const basis = buildBasis(this.a0);
            this.up0 = basis.up;
            this.right0 = basis.right;
            this.forward0 = basis.forward;
        }

        /**
         * 方向校准：依次采集「往前 / 往左」，中间提示回原点。
         * 上轴由前×左叉积得到。需已完成静止中立校准。
         */
        startAxisCalibration() {
            if (this.isCalibrating || !this.hasStarted) {
                return { ok: false, detail: '请先连接并完成静止校准' };
            }
            this.axisPhase = 'forward';
            this.axisCapture = [];
            this.axisRaw = { forward: null, left: null, up: null };
            this.axisPauseKind = 'prepare';
            this.axisReturnStable = 0;
            this.axisReturnEnteredAt = 0;
            this.axisReturnStartMag = 0;
            this.axisPromptReadyAt = performance.now() + AXIS_PAUSE_PREPARE_MS;
            this.sFwd = 0;
            this.sStrafe = 0;
            return { ok: true, detail: '准备开始：请先保持中立，随后按屏幕提示操作' };
        }

        cancelAxisCalibration() {
            this.axisPhase = 'idle';
            this.axisCapture = [];
            this.axisPauseKind = null;
            this.axisReturnStable = 0;
            this.axisReturnEnteredAt = 0;
            this.axisReturnStartMag = 0;
            return { ok: true, detail: '已取消方向校准' };
        }

        getAxisCalibrationStatus() {
            const phase = this.axisPhase;
            const need = AXIS_CAPTURE_NEED;
            const capturing = !!AXIS_CAPTURE_PHASES[phase];
            const progress = capturing ? this.axisCapture.length / need : 0;
            return {
                phase,
                active: phase !== 'idle' && phase !== 'done',
                progress: Math.max(0, Math.min(1, progress)),
                prompt: AXIS_PROMPTS[phase] || '',
                calibrated: this.userAxisCalibrated,
                samples: this.axisCapture.length,
                need
            };
        }

        _meanVec(list) {
            const n = list.length || 1;
            let x = 0;
            let y = 0;
            let z = 0;
            for (const v of list) {
                x += v[0];
                y += v[1];
                z += v[2];
            }
            return [x / n, y / n, z / n];
        }

        _finalizeUserAxes() {
            const F = normalize3(this.axisRaw.forward, [0, 1, 0]);
            const L = normalize3(this.axisRaw.left, [-1, 0, 0]);

            // 上轴：由前进 × 左 推导（不再单独校准上下）
            let up = cross(F, L);
            if (norm3(up) < 0.2) {
                up = buildBasis(this.a0).up;
            }
            up = normalize3(up, [0, 0, 1]);
            // 与重力大致同向，避免上下颠倒
            if (dot(up, normalize3(this.a0, [0, 0, 1])) < 0) {
                up = [-up[0], -up[1], -up[2]];
            }

            let right = cross(up, F);
            if (norm3(right) < 0.2) right = cross([0, 0, 1], F);
            right = normalize3(right, [1, 0, 0]);
            // 「往左」应对准 -right；若同向则翻转
            if (dot(right, L) > 0) {
                right = [-right[0], -right[1], -right[2]];
            }
            let forward = cross(right, up);
            forward = normalize3(forward, F);
            if (dot(forward, F) < 0) {
                forward = [-forward[0], -forward[1], -forward[2]];
            }

            this.forward0 = forward;
            this.right0 = right;
            this.up0 = up;
            this.userAxisCalibrated = true;
            this.cfg.axisMap = this.exportAxisMap();
            this.axisPhase = 'done';
            this.axisCapture = [];
            this.filtFwd = 0;
            this.filtStrafe = 0;
            this.sFwd = 0;
            this.sStrafe = 0;
        }

        _handleAxisCalibrationSample(sample) {
            const emptyKeys = {
                [this.cfg.keys.forward]: false,
                [this.cfg.keys.back]: false,
                [this.cfg.keys.left]: false,
                [this.cfg.keys.right]: false
            };
            const now = performance.now();
            const out = {
                ...this._emptyOut(emptyKeys),
                ready: false,
                axisCalibrating: true,
                axisPhase: this.axisPhase,
                axisProgress: 0,
                axisPrompt: AXIS_PROMPTS[this.axisPhase] || '方向校准中…',
                axisHint: '',
                axisCalibrated: this.userAxisCalibrated
            };

            const delta = [sample.ax - this.a0[0], sample.ay - this.a0[1], sample.az - this.a0[2]];
            const mag = norm3(delta);

            // —— 回原点阶段：提示反方向回到中立 ——
            if (AXIS_RETURN_NEXT[this.axisPhase]) {
                if (!this.axisReturnEnteredAt) {
                    this.axisReturnEnteredAt = now;
                    this.axisReturnStartMag = Math.max(mag, AXIS_RETURN_MAG);
                    this.axisReturnStable = 0;
                }
                out.axisPrompt = AXIS_PROMPTS[this.axisPhase];
                const elapsed = now - this.axisReturnEnteredAt;
                const startMag = Math.max(this.axisReturnStartMag || mag, AXIS_RETURN_MAG);
                // 相对回落：比刚进入回原点时小很多，或绝对值已够低
                const recovered =
                    mag <= AXIS_RETURN_MAG || mag <= startMag * 0.45;
                if (recovered) {
                    this.axisReturnStable += 1;
                } else {
                    this.axisReturnStable = Math.max(0, this.axisReturnStable - 2);
                }
                const stableProgress = this.axisReturnStable / AXIS_RETURN_STABLE_NEED;
                const timeProgress = elapsed / AXIS_RETURN_MAX_MS;
                out.axisProgress = Math.max(0, Math.min(1, Math.max(stableProgress, timeProgress)));

                const remainMax = Math.max(0, (AXIS_RETURN_MAX_MS - elapsed) / 1000);
                if (!recovered) {
                    out.axisHint =
                        `请沿提示方向回到原点（当前偏差 ${mag.toFixed(2)}）· ${remainMax.toFixed(1)}s 后自动继续`;
                } else {
                    out.axisHint = `已接近原点，保持… ${Math.min(100, Math.round(stableProgress * 100))}%`;
                }

                const minOk = elapsed >= AXIS_RETURN_MIN_MS;
                const stableOk = this.axisReturnStable >= AXIS_RETURN_STABLE_NEED;
                const timeoutOk = elapsed >= AXIS_RETURN_MAX_MS;
                if ((minOk && stableOk) || timeoutOk) {
                    const next = AXIS_RETURN_NEXT[this.axisPhase];
                    this.axisReturnStable = 0;
                    this.axisReturnEnteredAt = 0;
                    this.axisReturnStartMag = 0;
                    this.axisCapture = [];
                    if (next === 'done') {
                        this._finalizeUserAxes();
                        out.axisPhase = 'done';
                        out.axisProgress = 1;
                        out.axisPrompt = AXIS_PROMPTS.done;
                        out.axisHint = timeoutOk && !stableOk ? '已超时继续（可再校准一次）' : '可以开始用 WASD 测试了';
                        out.axisCalibrating = false;
                        out.axisCalibrated = true;
                        out.ready = true;
                        out.keys = emptyKeys;
                        return out;
                    }
                    this.axisPhase = next;
                    this.axisPauseKind = 'prepare';
                    this.axisPromptReadyAt = now + AXIS_PAUSE_PREPARE_MS;
                    out.axisPhase = next;
                    out.axisPrompt = timeoutOk && !stableOk
                        ? `已超时进入下一步：${AXIS_PROMPTS[next]}`
                        : `✓ 已回正。下一步：${AXIS_PROMPTS[next]}`;
                    out.axisHint = '请先保持中立，稍后开始采集';
                    out.axisProgress = 0;
                }
                return out;
            }

            // —— 准备停顿：不采集 ——
            if (this.axisPauseKind === 'prepare' && now < this.axisPromptReadyAt) {
                const remainSec = Math.max(0.1, (this.axisPromptReadyAt - now) / 1000);
                out.axisPrompt = AXIS_PROMPTS[this.axisPhase] || '准备中…';
                out.axisHint = `请先保持中立，${remainSec.toFixed(1)}s 后开始采集`;
                out.axisProgress = 0;
                return out;
            }
            this.axisPauseKind = null;

            // —— 采集前/左/上 ——
            if (!AXIS_CAPTURE_PHASES[this.axisPhase]) {
                return out;
            }
            if (mag >= AXIS_MIN_MAG) {
                this.axisCapture.push(delta);
            }
            const progress = this.axisCapture.length / AXIS_CAPTURE_NEED;
            out.axisProgress = Math.max(0, Math.min(1, progress));
            out.axisPrompt = AXIS_PROMPTS[this.axisPhase];
            out.axisHint =
                mag < AXIS_MIN_MAG
                    ? '动作再大一点，并保持…'
                    : `采集中 ${Math.min(100, Math.round(progress * 100))}%`;

            if (this.axisCapture.length >= AXIS_CAPTURE_NEED) {
                const mean = this._meanVec(this.axisCapture);
                if (norm3(mean) < AXIS_MIN_MAG * 0.7) {
                    this.axisCapture = [];
                    out.axisHint = '信号太弱，请加大动作再试';
                    return out;
                }
                this.axisRaw[this.axisPhase] = mean;
                this.axisCapture = [];
                this.axisReturnStable = 0;
                this.axisReturnEnteredAt = now;
                this.axisReturnStartMag = Math.max(norm3(mean), mag, AXIS_RETURN_MAG);

                if (this.axisPhase === 'forward') {
                    this.axisPhase = 'return_back';
                } else if (this.axisPhase === 'left') {
                    this.axisPhase = 'return_right';
                }
                out.axisPhase = this.axisPhase;
                out.axisPrompt = AXIS_PROMPTS[this.axisPhase];
                out.axisHint = '沿提示方向回到原点；约 3.5 秒内会自动继续';
                out.axisProgress = 0;
            }
            return out;
        }

        startCalibration() {
            this.hasStarted = true;
            this.isCalibrating = true;
            this.calibrationSamples = [];
            this.filtFwd = 0;
            this.filtStrafe = 0;
            this.sFwd = 0;
            this.sStrafe = 0;
            this._lastTs = 0;
            // 不清除用户方向轴；仅重采中立点
        }

        finishCalibration() {
            const n = this.calibrationSamples.length;
            if (n < 1) {
                this.isCalibrating = false;
                return;
            }
            let sx = 0;
            let sy = 0;
            let sz = 0;
            for (const s of this.calibrationSamples) {
                sx += s.ax;
                sy += s.ay;
                sz += s.az;
            }
            this.a0 = [sx / n, sy / n, sz / n];
            if (!this.userAxisCalibrated) {
                const basis = buildBasis(this.a0);
                this.up0 = basis.up;
                this.right0 = basis.right;
                this.forward0 = basis.forward;
            }
            this.filtFwd = 0;
            this.filtStrafe = 0;
            this.sFwd = 0;
            this.sStrafe = 0;
            this._lastTs = 0;
            this.isCalibrating = false;
        }

        _projectDelta(ax, ay, az) {
            const delta = [ax - this.a0[0], ay - this.a0[1], az - this.a0[2]];
            const alongG = dot(delta, this.up0);
            const horiz = [
                delta[0] - this.up0[0] * alongG,
                delta[1] - this.up0[1] * alongG,
                delta[2] - this.up0[2] * alongG
            ];
            return {
                forward: dot(horiz, this.forward0),
                strafe: dot(horiz, this.right0),
                dax: delta[0],
                day: delta[1],
                daz: delta[2]
            };
        }

        _emptyOut(keys) {
            return {
                ready: false,
                calibrating: this.isCalibrating,
                mode: 'lean',
                keys,
                forwardMs2: 0,
                strafeMs2: 0,
                fwdScaled: 0,
                strScaled: 0,
                sFwd: 0,
                sStrafe: 0,
                sensitivity: Number(this.cfg.accelSensitivity) || 2.5,
                fwdTh: this.cfg.accelForwardTh || 1.0,
                strTh: this.cfg.accelStrafeTh || 1.0,
                dax: 0,
                day: 0,
                daz: 0,
                pitchDeg: 0,
                rollDeg: 0,
                gated: false,
                axisCalibrating: false,
                axisPhase: this.axisPhase,
                axisProgress: 0,
                axisPrompt: '',
                axisCalibrated: this.userAxisCalibrated
            };
        }

        _keysFromAxes(fwd, str, fwdTh, strTh) {
            let forward = false;
            let back = false;
            let left = false;
            let right = false;
            if (fwd > fwdTh) forward = true;
            else if (fwd < -fwdTh) back = true;
            if (str > strTh) right = true;
            else if (str < -strTh) left = true;
            return {
                [this.cfg.keys.forward]: forward,
                [this.cfg.keys.back]: back,
                [this.cfg.keys.left]: left,
                [this.cfg.keys.right]: right
            };
        }

        _onSampleLean(proj, gain) {
            const sm = this.cfg.smoothing;
            this.filtFwd = this.filtFwd * sm + proj.forward * (1 - sm);
            this.filtStrafe = this.filtStrafe * sm + proj.strafe * (1 - sm);

            const fwdTh = this.cfg.accelForwardTh || 1.0;
            const strTh = this.cfg.accelStrafeTh || 1.0;

            if (
                this.cfg.adaptNeutral &&
                Math.abs(this.filtFwd) * gain < fwdTh * 0.45 &&
                Math.abs(this.filtStrafe) * gain < strTh * 0.45
            ) {
                return { adapt: true, fwdTh, strTh };
            }

            let fwd = this.filtFwd * gain;
            let str = this.filtStrafe * gain;
            if (this.cfg.invertForward) fwd = -fwd;
            if (this.cfg.invertStrafe) str = -str;

            return {
                adapt: false,
                fwdTh,
                strTh,
                keys: this._keysFromAxes(fwd, str, fwdTh, strTh),
                fwdScaled: fwd,
                strScaled: str
            };
        }

        onSample(sample) {
            const emptyKeys = {
                [this.cfg.keys.forward]: false,
                [this.cfg.keys.back]: false,
                [this.cfg.keys.left]: false,
                [this.cfg.keys.right]: false
            };
            const empty = this._emptyOut(emptyKeys);
            if (!this.hasStarted || !sample) return empty;

            if (this.isCalibrating) {
                this.calibrationSamples.push(sample);
                if (this.calibrationSamples.length >= this.calibrationSamplesTarget) {
                    this.finishCalibration();
                }
                return {
                    ...empty,
                    calibrating: this.isCalibrating,
                    ready: !this.isCalibrating
                };
            }

            if (
                AXIS_CAPTURE_PHASES[this.axisPhase] ||
                AXIS_RETURN_NEXT[this.axisPhase] ||
                this.axisPauseKind === 'prepare'
            ) {
                return this._handleAxisCalibrationSample(sample);
            }

            const proj = this._projectDelta(sample.ax, sample.ay, sample.az);
            const gain = Math.max(0.2, Math.min(12, Number(this.cfg.accelSensitivity) || 2.5));
            let result = this._onSampleLean(proj, gain);

            if (result.adapt) {
                const a = this.cfg.adaptAlpha || 0.025;
                this.a0 = [
                    this.a0[0] * (1 - a) + sample.ax * a,
                    this.a0[1] * (1 - a) + sample.ay * a,
                    this.a0[2] * (1 - a) + sample.az * a
                ];
                // 用户方向校准后只跟中立点，不改轴向
                if (!this.userAxisCalibrated) {
                    const basis = buildBasis(this.a0);
                    this.up0 = basis.up;
                    this.right0 = basis.right;
                    this.forward0 = basis.forward;
                }
                let fwd = this.filtFwd * gain;
                let str = this.filtStrafe * gain;
                if (this.cfg.invertForward) fwd = -fwd;
                if (this.cfg.invertStrafe) str = -str;
                result = {
                    adapt: false,
                    fwdTh: result.fwdTh,
                    strTh: result.strTh,
                    keys: this._keysFromAxes(fwd, str, result.fwdTh, result.strTh),
                    fwdScaled: fwd,
                    strScaled: str
                };
            }

            return {
                ready: true,
                calibrating: false,
                mode: 'lean',
                keys: result.keys,
                forwardMs2: this.filtFwd,
                strafeMs2: this.filtStrafe,
                fwdScaled: result.fwdScaled,
                strScaled: result.strScaled,
                sFwd: this.sFwd,
                sStrafe: this.sStrafe,
                sensitivity: gain,
                fwdTh: result.fwdTh || this.cfg.accelForwardTh || 1.0,
                strTh: result.strTh || this.cfg.accelStrafeTh || 1.0,
                dax: proj.dax,
                day: proj.day,
                daz: proj.daz,
                pitchDeg: (this.filtFwd / 9.80665) * (180 / Math.PI),
                rollDeg: (this.filtStrafe / 9.80665) * (180 / Math.PI),
                gated: false,
                axisCalibrating: false,
                axisPhase: this.axisPhase,
                axisProgress: this.userAxisCalibrated ? 1 : 0,
                axisPrompt: '',
                axisCalibrated: this.userAxisCalibrated
            };
        }
    }

    class ImuLocomotionRuntime {
        constructor() {
            this.cfg = mergeLocomotion(null);
            this.running = false;
            this.mapper = null;
            this._unsub = null;
            this._acquired = false;
            this._lastHeldJson = '';
            this._syncTimer = null;
            this._pendingKeys = null;
            this._status = 'idle';
        }

        getStatus() {
            return this._status;
        }

        async start(projectSettings) {
            await this.stop();
            this.cfg = mergeLocomotion(projectSettings && projectSettings.locomotionControl);
            if (!this.cfg.enabled) {
                this._status = 'disabled';
                return { ok: true, detail: '未启用倾斜行走' };
            }

            const hub = global.SSVEP_IMU_SAMPLE_HUB && global.SSVEP_IMU_SAMPLE_HUB.shared;
            if (!hub) {
                this._status = 'error';
                return { ok: false, detail: '缺少 IMU Sample Hub' };
            }

            const origin = resolveOrigin();
            try {
                const st = await fetch(`${origin}/api/system/keyboard/status`).then((r) => r.json());
                if (!st.available) {
                    this._status = 'error';
                    return {
                        ok: false,
                        detail: '系统键鼠不可用，请启用「系统选项」并安装 pynput：' + (st.detail || '')
                    };
                }
            } catch (e) {
                this._status = 'error';
                return { ok: false, detail: '无法连接后端：' + (e.message || e) };
            }

            const acq = await hub.acquire();
            if (!acq.ok) {
                this._status = 'error';
                return acq;
            }
            this._acquired = true;

            this.mapper = new ImuTiltLocomotionMapper(this.cfg);
            if (this.cfg.axisMap && this.cfg.axisMap.calibrated) {
                this.mapper.applyAxisMap(this.cfg.axisMap);
            }
            this.mapper.startCalibration();
            this._unsub = hub.subscribe((s) => this._handleSample(s));
            this.running = true;
            this._status = 'running';
            this._lastHeldJson = '';
            console.log('[ImuLocomotion] started', this.cfg.mode, '→WASD');
            return {
                ok: true,
                detail: '加速度阈值行走已启动（校准中…）'
            };
        }

        async stop() {
            this.running = false;
            this._status = 'idle';
            if (this._syncTimer) {
                clearTimeout(this._syncTimer);
                this._syncTimer = null;
            }
            this._pendingKeys = null;
            if (this._unsub) {
                this._unsub();
                this._unsub = null;
            }
            this.mapper = null;
            await this._releaseAllKeys();
            if (this._acquired) {
                const hub = global.SSVEP_IMU_SAMPLE_HUB && global.SSVEP_IMU_SAMPLE_HUB.shared;
                if (hub) await hub.release();
                this._acquired = false;
            }
        }

        _handleSample(sample) {
            if (!this.running || !this.mapper) return;
            const out = this.mapper.onSample(sample);
            if (!out || !out.ready) return;
            this._queueHoldSync(out.keys);
        }

        _queueHoldSync(keys) {
            this._pendingKeys = keys;
            if (this._syncTimer) return;
            this._syncTimer = setTimeout(() => {
                this._syncTimer = null;
                const k = this._pendingKeys;
                this._pendingKeys = null;
                if (!k) return;
                const json = JSON.stringify(k);
                if (json === this._lastHeldJson) return;
                this._lastHeldJson = json;
                const origin = resolveOrigin();
                fetch(`${origin}/api/system/keyboard/hold-sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ held: k })
                }).catch(() => {});
            }, 40);
        }

        async _releaseAllKeys() {
            this._lastHeldJson = '';
            const origin = resolveOrigin();
            try {
                await fetch(`${origin}/api/system/keyboard/hold-release-all`, { method: 'POST' });
            } catch (_) {
                /* ignore */
            }
        }
    }

    global.SSVEP_IMU_LOCOMOTION = {
        DEFAULT_LOCOMOTION,
        mergeLocomotion,
        ImuTiltLocomotionMapper,
        ImuLocomotionRuntime,
        shared: new ImuLocomotionRuntime()
    };
})(typeof window !== 'undefined' ? window : globalThis);
