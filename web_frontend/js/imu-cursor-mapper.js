/**
 * IMU → 光标 / 姿态映射（对齐 bmi270_ble_mouse_client.py HEAD_MODE）
 *
 * 流程：
 *   1. 静止校准 → 陀螺零偏 + 重力 yaw 轴 + pitch 参考轴
 *   2. 样本：去偏 → yaw/pitch 角速度 → 死区/翻转/平滑 → 相对像素位移
 *   3. 同步积分 orientation（供三维地球）
 */
(function (global) {
    const G = (global.SSVEP_IMU_PROTOCOL && global.SSVEP_IMU_PROTOCOL.G) || 9.80665;

    const DEFAULTS = {
        sensitivity: 42,
        deadzoneRadS: 0.045,
        smoothing: 0.72,
        stationaryGyroRadS: 0.095,
        stationaryAccelTol: 1.8,
        biasAdaptAlpha: 0.006,
        stopDecay: 0.45,
        orientationGain: 3.0,
        orientationLimit: 1.0,
        headMode: true,
        pitchReferenceAxis: 'x',
        invertX: true,
        invertY: true,
        calibrationSamples: 120
    };

    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    function norm(v) {
        return Math.sqrt(dot(v, v));
    }

    function normalize(v, fallback) {
        const length = norm(v);
        if (length < 1e-6) return fallback.slice();
        return [v[0] / length, v[1] / length, v[2] / length];
    }

    function subtractProjection(vector, axis) {
        const amount = dot(vector, axis);
        return [
            vector[0] - axis[0] * amount,
            vector[1] - axis[1] * amount,
            vector[2] - axis[2] * amount
        ];
    }

    function axisVector(name) {
        if (name === 'y') return [0, 1, 0];
        if (name === 'z') return [0, 0, 1];
        return [1, 0, 0];
    }

    class ImuCursorMapper {
        constructor(opts) {
            this.cfg = Object.assign({}, DEFAULTS, opts || {});
            this.resetRuntime();
        }

        resetRuntime() {
            this.hasStarted = false;
            this.isCalibrating = false;
            this.calibrationSamples = [];
            this.bias = [0, 0, 0];
            this.yawAxis = [0, 0, 1];
            this.pitchAxis = [1, 0, 0];
            this.filteredDx = 0;
            this.filteredDy = 0;
            this.remainderX = 0;
            this.remainderY = 0;
            this.orientationX = 0;
            this.orientationY = 0;
            this.rateX = 0;
            this.rateY = 0;
            this.isStationary = false;
            this.lastTime = performance.now() / 1000;
            this.sampleCount = 0;
            this.moveCount = 0;
            this.lastMove = [0, 0];
            this.lastSample = null;
        }

        startCalibration() {
            this.hasStarted = true;
            this.isCalibrating = true;
            this.calibrationSamples = [];
            this.filteredDx = 0;
            this.filteredDy = 0;
            this.remainderX = 0;
            this.remainderY = 0;
            this.orientationX = 0;
            this.orientationY = 0;
            this.rateX = 0;
            this.rateY = 0;
            this.lastTime = performance.now() / 1000;
        }

        finishCalibration() {
            const samples = this.calibrationSamples;
            const n = samples.length;
            if (n < 1) {
                this.isCalibrating = false;
                return;
            }
            let sx = 0;
            let sy = 0;
            let sz = 0;
            let ax = 0;
            let ay = 0;
            let az = 0;
            for (let i = 0; i < n; i++) {
                const s = samples[i];
                sx += s.gx;
                sy += s.gy;
                sz += s.gz;
                ax += s.ax;
                ay += s.ay;
                az += s.az;
            }
            this.bias = [sx / n, sy / n, sz / n];
            this.yawAxis = normalize([ax / n, ay / n, az / n], [0, 0, 1]);
            let projected = subtractProjection(axisVector(this.cfg.pitchReferenceAxis), this.yawAxis);
            if (norm(projected) < 0.2) {
                projected = subtractProjection(axisVector('y'), this.yawAxis);
            }
            this.pitchAxis = normalize(projected, [1, 0, 0]);
            this.orientationX = 0;
            this.orientationY = 0;
            this.filteredDx = 0;
            this.filteredDy = 0;
            this.remainderX = 0;
            this.remainderY = 0;
            this.isCalibrating = false;
            this.lastTime = performance.now() / 1000;
        }

        /**
         * @returns {{ moveX: number, moveY: number, calibrating: boolean, ready: boolean }}
         */
        onSample(sample) {
            this.sampleCount += 1;
            this.lastSample = sample;
            const empty = { moveX: 0, moveY: 0, calibrating: this.isCalibrating, ready: false };

            if (!this.hasStarted) return empty;

            if (this.isCalibrating) {
                this.calibrationSamples.push(sample);
                if (this.calibrationSamples.length >= this.cfg.calibrationSamples) {
                    this.finishCalibration();
                }
                return {
                    moveX: 0,
                    moveY: 0,
                    calibrating: this.isCalibrating,
                    ready: !this.isCalibrating
                };
            }

            const now = performance.now() / 1000;
            let dt = now - this.lastTime;
            this.lastTime = now;
            if (dt < 0.001) dt = 0.001;
            if (dt > 0.05) dt = 0.05;

            const rawGyro = [sample.gx, sample.gy, sample.gz];
            let gyro = [
                rawGyro[0] - this.bias[0],
                rawGyro[1] - this.bias[1],
                rawGyro[2] - this.bias[2]
            ];

            let vx;
            let vy;
            if (this.cfg.headMode) {
                vx = dot(gyro, this.yawAxis);
                vy = dot(gyro, this.pitchAxis);
            } else {
                vx = sample.gz - this.bias[2];
                vy = sample.gx - this.bias[0];
            }

            const accelMag = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az);
            const gyroMag = norm(gyro);
            this.isStationary =
                gyroMag < this.cfg.stationaryGyroRadS &&
                Math.abs(accelMag - G) < this.cfg.stationaryAccelTol;

            if (this.isStationary) {
                const a = this.cfg.biasAdaptAlpha;
                this.bias = [
                    this.bias[0] * (1 - a) + rawGyro[0] * a,
                    this.bias[1] * (1 - a) + rawGyro[1] * a,
                    this.bias[2] * (1 - a) + rawGyro[2] * a
                ];
            }

            if (Math.abs(vx) < this.cfg.deadzoneRadS) vx = 0;
            if (Math.abs(vy) < this.cfg.deadzoneRadS) vy = 0;
            if (this.cfg.invertX) vx = -vx;
            if (this.cfg.invertY) vy = -vy;

            this.rateX = vx;
            this.rateY = vy;
            const lim = this.cfg.orientationLimit;
            this.orientationX = Math.max(-lim, Math.min(lim, this.orientationX + vx * dt * this.cfg.orientationGain));
            this.orientationY = Math.max(-lim, Math.min(lim, this.orientationY + vy * dt * this.cfg.orientationGain));

            let dx = vx * this.cfg.sensitivity * dt * 60;
            let dy = vy * this.cfg.sensitivity * dt * 60;
            this.filteredDx = this.filteredDx * this.cfg.smoothing + dx * (1 - this.cfg.smoothing);
            this.filteredDy = this.filteredDy * this.cfg.smoothing + dy * (1 - this.cfg.smoothing);

            if (vx === 0 && vy === 0) {
                this.filteredDx *= this.cfg.stopDecay;
                this.filteredDy *= this.cfg.stopDecay;
                if (Math.abs(this.filteredDx) < 0.03) {
                    this.filteredDx = 0;
                    this.remainderX = 0;
                }
                if (Math.abs(this.filteredDy) < 0.03) {
                    this.filteredDy = 0;
                    this.remainderY = 0;
                }
            }

            this.remainderX += this.filteredDx;
            this.remainderY += this.filteredDy;
            const moveX = Math.trunc(this.remainderX);
            const moveY = Math.trunc(this.remainderY);
            this.remainderX -= moveX;
            this.remainderY -= moveY;

            if (moveX || moveY) {
                this.moveCount += 1;
                this.lastMove = [moveX, moveY];
            }

            return { moveX, moveY, calibrating: false, ready: true };
        }

        setSensitivity(value) {
            this.cfg.sensitivity = Math.max(1, Math.min(300, Number(value) || this.cfg.sensitivity));
        }

        snapshot() {
            const s = this.lastSample;
            return {
                sampleCount: this.sampleCount,
                moveCount: this.moveCount,
                sensitivity: this.cfg.sensitivity,
                hasStarted: this.hasStarted,
                isCalibrating: this.isCalibrating,
                calibrationLeft: this.isCalibrating
                    ? Math.max(0, this.cfg.calibrationSamples - this.calibrationSamples.length)
                    : 0,
                isStationary: this.isStationary,
                orientationX: this.orientationX,
                orientationY: this.orientationY,
                rateX: this.rateX,
                rateY: this.rateY,
                lastMove: this.lastMove.slice(),
                yawAxis: this.yawAxis.slice(),
                pitchAxis: this.pitchAxis.slice(),
                bias: this.bias.slice(),
                gyro: s ? [s.gx, s.gy, s.gz] : [0, 0, 0],
                accel: s ? [s.ax, s.ay, s.az] : [0, 0, 0]
            };
        }
    }

    global.SSVEP_IMU_MAPPER = {
        DEFAULTS,
        ImuCursorMapper
    };
})(typeof window !== 'undefined' ? window : globalThis);
