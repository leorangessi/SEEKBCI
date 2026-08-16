#ifndef FOCUS_MCU_H
#define FOCUS_MCU_H

#include <Arduino.h>
#include <math.h>

/**
 * MCU 端专注度 (Focus) 估计器。
 * 
 * 移植自 PC 端 focus_monitor.py：
 * 使用 128 点 FFT 计算 Alpha/Beta/Theta 频带功率，
 * 通过 TBR (Theta/Beta Ratio) 或 Engagement (Beta/(Alpha+Theta)) 指标
 * 估计专注度 0–100。
 * 
 * 注意：ESP32 上使用简化 FFT（实数 DFT），精度足够用于阈值判定。
 * 
 * 使用方法：
 *   focus_detector_t det;
 *   focus_init(&det, params);
 *   // 每个采样点喂入：
 *   focus_feed(&det, sample_uv);
 *   // 缓冲满后自动计算，查询结果：
 *   float val = det.focus_value;  // 0–100
 *   bool fired = det.above_threshold;
 */

#define FOCUS_FFT_SIZE 128
#define FOCUS_METRIC_TBR        0  // 专注度高 = TBR低
#define FOCUS_METRIC_ENGAGEMENT 1  // 专注度高 = engagement高

typedef struct {
    // 配置
    uint8_t threshold;           // 触发阈值 0–100，默认70
    uint8_t metric;              // FOCUS_METRIC_TBR / FOCUS_METRIC_ENGAGEMENT
    float sampling_rate;         // 采样率 Hz，默认250

    // FFT 缓冲
    float buffer[FOCUS_FFT_SIZE];
    uint16_t buf_idx;
    bool buf_full;

    // 频带功率结果
    float theta_power;           // 4–8 Hz
    float alpha_power;           // 8–13 Hz
    float beta_power;            // 13–30 Hz

    // 输出
    float focus_value;           // 0–100
    float raw_metric;            // TBR 或 engagement 原始值
    bool above_threshold;
    uint32_t last_compute_ms;
    uint32_t compute_count;

    // EMA 平滑
    float ema_focus;
    float ema_alpha_coeff;       // EMA 系数，默认0.3
} focus_detector_t;

static inline void focus_init(focus_detector_t* d, uint8_t threshold,
                              uint8_t metric, float sampling_rate) {
    d->threshold = threshold;
    d->metric = metric;
    d->sampling_rate = sampling_rate;

    memset(d->buffer, 0, sizeof(d->buffer));
    d->buf_idx = 0;
    d->buf_full = false;

    d->theta_power = 0;
    d->alpha_power = 0;
    d->beta_power = 0;

    d->focus_value = 50.0f;
    d->raw_metric = 0;
    d->above_threshold = false;
    d->last_compute_ms = 0;
    d->compute_count = 0;

    d->ema_focus = 50.0f;
    d->ema_alpha_coeff = 0.3f;
}

static inline void focus_init_default(focus_detector_t* d) {
    focus_init(d, 70, FOCUS_METRIC_TBR, 250.0f);
}

/**
 * 简化实数 DFT：只计算指定频率 bin 的功率。
 * 比完整 FFT 更节省内存，ESP32 上足够快。
 */
static inline float _focus_goertzel(const float* x, uint16_t N, uint16_t k) {
    float omega = 2.0f * M_PI * (float)k / (float)N;
    float coeff = 2.0f * cosf(omega);
    float s0 = 0, s1 = 0, s2 = 0;
    for (uint16_t i = 0; i < N; i++) {
        s0 = x[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    float power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return power / (float)(N * N);
}

/**
 * 计算指定频带的平均功率（使用 Goertzel 算法）。
 */
static inline float _focus_band_power(const float* x, uint16_t N,
                                       float sr, float f_lo, float f_hi) {
    float freq_res = sr / (float)N;
    uint16_t k_lo = (uint16_t)(f_lo / freq_res + 0.5f);
    uint16_t k_hi = (uint16_t)(f_hi / freq_res + 0.5f);
    if (k_lo < 1) k_lo = 1;
    if (k_hi >= N / 2) k_hi = N / 2 - 1;
    if (k_hi < k_lo) return 0;

    float sum = 0;
    for (uint16_t k = k_lo; k <= k_hi; k++) {
        sum += _focus_goertzel(x, N, k);
    }
    return sum / (float)(k_hi - k_lo + 1);
}

/**
 * 内部：执行频谱计算并更新专注度值。
 */
static inline void _focus_compute(focus_detector_t* d) {
    // 去均值
    float mean = 0;
    for (uint16_t i = 0; i < FOCUS_FFT_SIZE; i++) mean += d->buffer[i];
    mean /= FOCUS_FFT_SIZE;
    float centered[FOCUS_FFT_SIZE];
    for (uint16_t i = 0; i < FOCUS_FFT_SIZE; i++) centered[i] = d->buffer[i] - mean;

    // 计算频带功率
    d->theta_power = _focus_band_power(centered, FOCUS_FFT_SIZE, d->sampling_rate, 4.0f, 8.0f);
    d->alpha_power = _focus_band_power(centered, FOCUS_FFT_SIZE, d->sampling_rate, 8.0f, 13.0f);
    d->beta_power  = _focus_band_power(centered, FOCUS_FFT_SIZE, d->sampling_rate, 13.0f, 30.0f);

    // 计算指标
    float focus_raw = 50.0f;
    if (d->metric == FOCUS_METRIC_TBR) {
        // TBR = theta/beta，TBR越低专注度越高
        float tbr = (d->beta_power > 1e-10f) ? (d->theta_power / d->beta_power) : 10.0f;
        d->raw_metric = tbr;
        // 映射：TBR 3.0 → 0%, TBR 0.5 → 100%
        focus_raw = (3.0f - tbr) / 2.5f * 100.0f;
    } else {
        // Engagement = beta / (alpha + theta)
        float denom = d->alpha_power + d->theta_power;
        float eng = (denom > 1e-10f) ? (d->beta_power / denom) : 0;
        d->raw_metric = eng;
        // 映射：eng 0 → 0%, eng 1.0 → 100%
        focus_raw = eng * 100.0f;
    }

    // 裁剪
    if (focus_raw < 0) focus_raw = 0;
    if (focus_raw > 100.0f) focus_raw = 100.0f;

    // EMA 平滑
    d->ema_focus += d->ema_alpha_coeff * (focus_raw - d->ema_focus);
    d->focus_value = d->ema_focus;
    d->above_threshold = (d->focus_value >= (float)d->threshold);

    d->last_compute_ms = millis();
    d->compute_count++;
}

/**
 * 喂入一个新采样点。缓冲区满后自动触发计算。
 * @param sample_uv 当前 EEG 通道值（微伏）
 * @return true 如果本次调用触发了一次新的专注度计算
 */
static inline bool focus_feed(focus_detector_t* d, float sample_uv) {
    d->buffer[d->buf_idx++] = sample_uv;

    if (d->buf_idx >= FOCUS_FFT_SIZE) {
        d->buf_idx = 0;
        d->buf_full = true;
        _focus_compute(d);
        return true;
    }
    return false;
}

#endif // FOCUS_MCU_H
