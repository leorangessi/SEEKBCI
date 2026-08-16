/**
 * SEEKBCI IMU（优先 SEEKBCI 扩展 Cyton 包；也可回退独立 BMI270 板）
 *
 * 主路径：设备管理连接 SEEKBCI BLE → /api/imu/stream 收 ax..gz
 * 回退：广播名 ESP32_BMI270_MOUSE + Nordic UART ASCII CSV
 */
(function (global) {
    const PROTOCOL = {
        id: 'seekbci_eeg_v2',
        version: 2,
        deviceName: 'SEEKBCI',
        altDeviceName: 'ESP32_BMI270_MOUSE',
        serviceUuid: '7f520001-1b15-4a0b-9f7f-8f54f8d7a001',
        notifyCharUuid: '7f520003-1b15-4a0b-9f7f-8f54f8d7a001',
        otaCharUuid: '7f520004-1b15-4a0b-9f7f-8f54f8d7a001',
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
