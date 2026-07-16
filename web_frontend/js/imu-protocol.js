/**
 * SEEKBCI IMU Protocol v1（控制设备：BMI270 @ ESP32）
 *
 * 与固件 reference/esp32_bmi270_ble_mouse/esp32_bmi270_ble_mouse.ino 对齐。
 *
 * BLE
 *   name: ESP32_BMI270_MOUSE
 *   service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e  (Nordic UART 风格)
 *   notify : 6e400003-b5a3-f393-e0a9-e50e24dcca9e  (TX)
 *
 * Notify 载荷（UTF-8 ASCII）
 *   正常: "ax,ay,az,gx,gy,gz"
 *     ax,ay,az — 加速度 m/s²
 *     gx,gy,gz — 角速度 rad/s
 *   异常: "ERR,<CODE>"  例: ERR,BMI270_NOT_READY
 *
 * 采样目标 ~250 Hz（固件 SAMPLE_INTERVAL_MS=4）
 *
 * 平台映射约定（光标 / 地球）
 *   - 静止校准：估计陀螺零偏 + 重力轴（佩戴姿态无关）
 *   - HEAD_MODE：yaw = gyro·gravity，pitch = gyro·pitch_axis
 *   - 二维光标：积分角速度 → 相对位移（可选驱动系统光标）
 *   - 三维地球：用积分姿态驱动球旋转
 */
(function (global) {
    const PROTOCOL = {
        id: 'seekbci_imu_v1',
        version: 1,
        deviceName: 'ESP32_BMI270_MOUSE',
        serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        notifyCharUuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
        sampleHzTarget: 250,
        units: { accel: 'm/s^2', gyro: 'rad/s' },
        payloadNormal: 'ax,ay,az,gx,gy,gz',
        payloadErrorPrefix: 'ERR,'
    };

    const G = 9.80665;

    function decodePayload(dataViewOrBuffer) {
        let bytes;
        if (dataViewOrBuffer instanceof DataView) {
            bytes = new Uint8Array(dataViewOrBuffer.buffer, dataViewOrBuffer.byteOffset, dataViewOrBuffer.byteLength);
        } else if (dataViewOrBuffer instanceof ArrayBuffer) {
            bytes = new Uint8Array(dataViewOrBuffer);
        } else if (dataViewOrBuffer && dataViewOrBuffer.buffer) {
            bytes = new Uint8Array(dataViewOrBuffer.buffer, dataViewOrBuffer.byteOffset || 0, dataViewOrBuffer.byteLength || dataViewOrBuffer.length);
        } else {
            return { kind: 'empty', raw: '' };
        }
        const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
        if (!raw) return { kind: 'empty', raw: '' };
        if (raw.startsWith(PROTOCOL.payloadErrorPrefix)) {
            return { kind: 'error', raw, code: raw.slice(PROTOCOL.payloadErrorPrefix.length) };
        }
        const parts = raw.split(',');
        if (parts.length !== 6) return { kind: 'invalid', raw };
        const nums = parts.map((p) => Number(p));
        if (nums.some((n) => !Number.isFinite(n))) return { kind: 'invalid', raw };
        return {
            kind: 'sample',
            raw,
            ax: nums[0],
            ay: nums[1],
            az: nums[2],
            gx: nums[3],
            gy: nums[4],
            gz: nums[5]
        };
    }

    global.SSVEP_IMU_PROTOCOL = {
        PROTOCOL,
        G,
        decodePayload
    };
})(typeof window !== 'undefined' ? window : globalThis);
