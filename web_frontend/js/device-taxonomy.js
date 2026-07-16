/**
 * SEEKBCI 设备分类常量
 *
 * 控制设备（Control）：提供意图/感知输入
 * 被控设备（Actuator）：被动作驱动的输出目标
 */
(function (global) {
    const CONTROL_DEVICES = [
        {
            id: 'eeg_headset',
            label: '脑电头环 / 放大器',
            kind: 'control',
            modality: 'eeg',
            connect: 'lsl_serial_wifi',
            testPage: 'device-manager.html'
        },
        {
            id: 'imu_bmi270',
            label: 'IMU（BMI270）',
            kind: 'control',
            modality: 'imu',
            connect: 'ble_nordic_uart',
            testPage: 'imu-test.html',
            protocolId: 'seekbci_imu_v1'
        },
        {
            id: 'eog_channel',
            label: '眼电通道',
            kind: 'control',
            modality: 'eog',
            connect: 'via_eeg_amp',
            testPage: 'device-manager.html'
        },
        {
            id: 'emg_mi_channel',
            label: '运动 / EMG 通道',
            kind: 'control',
            modality: 'emg',
            connect: 'via_eeg_amp',
            testPage: 'emg-test.html'
        }
    ];

    const ACTUATOR_DEVICES = [
        {
            id: 'cursor',
            label: '光标',
            kind: 'actuator',
            controlBy: ['imu_bmi270', 'eeg_headset'],
            testPage: 'imu-test.html'
        },
        {
            id: 'vehicle',
            label: '小车',
            kind: 'actuator',
            controlBy: ['imu_bmi270', 'eeg_headset'],
            testPage: 'physical-world.html'
        },
        {
            id: 'drone',
            label: '无人机',
            kind: 'actuator',
            controlBy: ['imu_bmi270', 'eeg_headset'],
            testPage: null
        },
        {
            id: 'seekphy_switch',
            label: 'SEEKPHY 开关 / 灯 / 锁',
            kind: 'actuator',
            controlBy: ['eeg_headset'],
            testPage: 'physical-world.html'
        }
    ];

    global.SSVEP_DEVICE_TAXONOMY = {
        CONTROL_DEVICES,
        ACTUATOR_DEVICES,
        controlById: Object.fromEntries(CONTROL_DEVICES.map((d) => [d.id, d])),
        actuatorById: Object.fromEntries(ACTUATOR_DEVICES.map((d) => [d.id, d]))
    };
})(typeof window !== 'undefined' ? window : globalThis);
