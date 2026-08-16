#ifndef EMG_MCU_H
#define EMG_MCU_H

#include <Arduino.h>
#include <math.h>

/**
 * MCU 端肌电 (EMG) 触发检测器。
 * 
 * 移植自 PC 端 emg-peak-trigger.js：
 * 计算滑动窗口内的 RMS 包络，当包络超过阈值达到一定比例时触发。
 * 
 * 使用方法：
 *   emg_detector_t det;
 *   emg_init(&det, params);
 *   bool fired = emg_process(&det, sample_uv, millis());
 */

#define EMG_RMS_BUF_SIZE 64

typedef struct {
    // 配置参数
    float threshold_uv;         // RMS 阈值，默认60
    float window_sec;           // 判定窗口长度，默认1.0s
    float bin_sec;              // 分段长度，默认0.2s
    float min_bin_fraction;     // 最小达标分段比例，默认0.4

    // 内部状态
    float rms_buf[EMG_RMS_BUF_SIZE];  // RMS 环形缓冲（每 bin 一个值）
    uint8_t buf_idx;
    uint8_t buf_count;                 // 有效元素数

    // 当前 bin 内累积
    float bin_sum_sq;           // 平方和
    uint32_t bin_sample_count;  // 当前 bin 采样数
    uint32_t bin_start_ms;      // 当前 bin 起始时间

    // 触发状态
    bool triggered;
    float strength;             // 0–1 归一化强度
    uint32_t last_fire_ms;
    uint32_t fire_count;
    uint32_t refractory_ms;     // 不应期，默认500ms

    // 采样
    uint32_t last_sample_ms;
    float sample_dt_sec;
} emg_detector_t;

static inline void emg_init(emg_detector_t* d, float threshold_uv,
                            float window_sec, float min_bin_fraction) {
    d->threshold_uv = threshold_uv;
    d->window_sec = window_sec;
    d->bin_sec = 0.2f;
    d->min_bin_fraction = min_bin_fraction;
    d->refractory_ms = 500;

    memset(d->rms_buf, 0, sizeof(d->rms_buf));
    d->buf_idx = 0;
    d->buf_count = 0;

    d->bin_sum_sq = 0;
    d->bin_sample_count = 0;
    d->bin_start_ms = 0;

    d->triggered = false;
    d->strength = 0;
    d->last_fire_ms = 0;
    d->fire_count = 0;

    d->last_sample_ms = 0;
    d->sample_dt_sec = 0.004f;
}

static inline void emg_init_default(emg_detector_t* d) {
    emg_init(d, 60.0f, 1.0f, 0.4f);
}

/**
 * 处理一个新采样点。
 * @param sample_uv 当前 EMG 通道值（微伏，建议已整流或取绝对值）
 * @param now_ms    当前时间 millis()
 * @return true 如果本次触发了 EMG 事件
 */
static inline bool emg_process(emg_detector_t* d, float sample_uv, uint32_t now_ms) {
    if (d->last_sample_ms > 0) {
        uint32_t dt = now_ms - d->last_sample_ms;
        if (dt > 0 && dt < 100) d->sample_dt_sec = dt * 0.001f;
    }
    d->last_sample_ms = now_ms;

    if (d->bin_start_ms == 0) d->bin_start_ms = now_ms;

    // 累积当前 bin
    d->bin_sum_sq += sample_uv * sample_uv;
    d->bin_sample_count++;

    // 检查是否到达 bin 边界
    uint32_t bin_ms = (uint32_t)(d->bin_sec * 1000.0f);
    if (now_ms - d->bin_start_ms < bin_ms) {
        d->triggered = false;
        return false;
    }

    // 计算本 bin 的 RMS
    float rms = 0;
    if (d->bin_sample_count > 0) {
        rms = sqrtf(d->bin_sum_sq / (float)d->bin_sample_count);
    }

    // 存入环形缓冲
    d->rms_buf[d->buf_idx] = rms;
    d->buf_idx = (d->buf_idx + 1) % EMG_RMS_BUF_SIZE;
    if (d->buf_count < EMG_RMS_BUF_SIZE) d->buf_count++;

    // 重置 bin 累积
    d->bin_sum_sq = 0;
    d->bin_sample_count = 0;
    d->bin_start_ms = now_ms;

    // 计算窗口内的达标 bin 数
    uint8_t bins_in_window = (uint8_t)(d->window_sec / d->bin_sec);
    if (bins_in_window > d->buf_count) bins_in_window = d->buf_count;
    if (bins_in_window == 0) { d->triggered = false; return false; }

    uint8_t bins_ok = 0;
    float max_rms = 0;
    for (uint8_t i = 0; i < bins_in_window; i++) {
        int idx = (int)d->buf_idx - 1 - (int)i;
        if (idx < 0) idx += EMG_RMS_BUF_SIZE;
        float val = d->rms_buf[idx];
        if (val >= d->threshold_uv) bins_ok++;
        if (val > max_rms) max_rms = val;
    }

    float fraction = (float)bins_ok / (float)bins_in_window;
    d->strength = (max_rms > d->threshold_uv) ?
        fminf(1.0f, (max_rms - d->threshold_uv) / d->threshold_uv) : 0;

    bool fire = false;
    if (fraction >= d->min_bin_fraction) {
        if (now_ms - d->last_fire_ms >= d->refractory_ms) {
            fire = true;
            d->last_fire_ms = now_ms;
            d->fire_count++;
        }
    }

    d->triggered = fire;
    return fire;
}

#endif // EMG_MCU_H
