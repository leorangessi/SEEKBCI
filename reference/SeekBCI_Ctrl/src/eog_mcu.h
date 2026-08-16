#ifndef EOG_MCU_H
#define EOG_MCU_H

#include <Arduino.h>
#include <math.h>

/**
 * MCU 端眼电 (EOG) 脉冲检测器。
 * 
 * 移植自 PC 端 eog-pulse-detector.js 的 pulse 模式：
 * 检测相对基线的显著幅度上升后回落（眨眼特征）。
 * 
 * 使用方法：
 *   eog_detector_t det;
 *   eog_init(&det, params);    // 初始化
 *   // 每个采样点调用：
 *   bool fired = eog_process(&det, sample_uv, millis());
 */

typedef struct {
    // 配置参数
    float threshold_uv;        // 脉冲起始阈值（相对基线），默认45
    uint32_t refractory_ms;    // 不应期，默认350ms
    float baseline_tau_sec;    // 基线EMA时间常数，默认1.5s
    float recover_ratio;       // 回落比例，默认0.35
    uint32_t pulse_max_ms;     // 脉冲最大持续时间，默认420ms
    uint32_t pulse_min_ms;     // 脉冲最小持续时间，默认40ms

    // 内部状态
    float baseline;            // EMA基线
    bool baseline_inited;
    uint32_t last_fire_ms;     // 上次触发时间
    uint32_t fire_count;

    // pulse FSM
    enum { EOG_IDLE, EOG_RISING } phase;
    uint32_t onset_ms;
    float peak;
    float peak_sign;

    // 采样率估计
    uint32_t last_sample_ms;
    float sample_dt_sec;
} eog_detector_t;

static inline void eog_init(eog_detector_t* d, float threshold_uv,
                            uint32_t refractory_ms, float baseline_tau) {
    d->threshold_uv = threshold_uv;
    d->refractory_ms = refractory_ms;
    d->baseline_tau_sec = baseline_tau;
    d->recover_ratio = 0.35f;
    d->pulse_max_ms = 420;
    d->pulse_min_ms = 40;

    d->baseline = 0;
    d->baseline_inited = false;
    d->last_fire_ms = 0;
    d->fire_count = 0;
    d->phase = eog_detector_t::EOG_IDLE;
    d->onset_ms = 0;
    d->peak = 0;
    d->peak_sign = 1.0f;
    d->last_sample_ms = 0;
    d->sample_dt_sec = 0.004f; // 默认250Hz
}

static inline void eog_init_default(eog_detector_t* d) {
    eog_init(d, 45.0f, 350, 1.5f);
}

/**
 * 处理一个新采样点。
 * @param sample_uv 当前通道值（微伏）
 * @param now_ms    当前时间 millis()
 * @return true 如果检测到一次眨眼事件
 */
static inline bool eog_process(eog_detector_t* d, float sample_uv, uint32_t now_ms) {
    // 更新采样间隔估计
    if (d->last_sample_ms > 0) {
        uint32_t dt = now_ms - d->last_sample_ms;
        if (dt > 0 && dt < 100) d->sample_dt_sec = dt * 0.001f;
    }
    d->last_sample_ms = now_ms;

    // 更新基线 EMA
    if (!d->baseline_inited) {
        d->baseline = sample_uv;
        d->baseline_inited = true;
        return false;
    }
    float alpha = 1.0f - expf(-d->sample_dt_sec / d->baseline_tau_sec);
    d->baseline += alpha * (sample_uv - d->baseline);

    float deviation = sample_uv - d->baseline;
    float abs_dev = fabsf(deviation);

    bool fired = false;

    switch (d->phase) {
        case eog_detector_t::EOG_IDLE:
            // 检测上升超过阈值
            if (abs_dev >= d->threshold_uv) {
                // 不应期检查
                if (now_ms - d->last_fire_ms < d->refractory_ms) break;
                d->phase = eog_detector_t::EOG_RISING;
                d->onset_ms = now_ms;
                d->peak = abs_dev;
                d->peak_sign = (deviation > 0) ? 1.0f : -1.0f;
            }
            break;

        case eog_detector_t::EOG_RISING:
            // 更新峰值
            if (abs_dev > d->peak) d->peak = abs_dev;

            uint32_t elapsed = now_ms - d->onset_ms;

            // 超时回到idle
            if (elapsed > d->pulse_max_ms) {
                d->phase = eog_detector_t::EOG_IDLE;
                break;
            }

            // 检测回落
            if (elapsed >= d->pulse_min_ms) {
                if (abs_dev < d->peak * d->recover_ratio) {
                    // 触发！
                    d->phase = eog_detector_t::EOG_IDLE;
                    d->last_fire_ms = now_ms;
                    d->fire_count++;
                    fired = true;
                }
            }
            break;
    }

    return fired;
}

#endif // EOG_MCU_H
