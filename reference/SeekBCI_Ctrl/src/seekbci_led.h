#ifndef SEEKBCI_LED_H
#define SEEKBCI_LED_H

#include <Arduino.h>

/**
 * LED 指示灯驱动模块。
 * 
 * 支持多种闪烁模式，用于指示控制板当前状态。
 * 可独立使用，也可由 SeekBCI_Ctrl 内部调用。
 */

typedef enum {
    SLED_OFF,
    SLED_SOLID,           // 常亮
    SLED_SLOW_BLINK,      // 1Hz 慢闪
    SLED_FAST_BLINK,      // 3Hz 快闪
    SLED_DOUBLE_BLINK,    // 双闪（闪2下停1下）
    SLED_BREATHING        // 呼吸灯（需要 PWM 引脚）
} sled_mode_t;

typedef struct {
    uint8_t pin;
    sled_mode_t mode;
    bool use_pwm;
    uint8_t ledc_channel;

    // 内部状态
    bool on;
    unsigned long last_toggle;
    uint8_t blink_phase;
    uint8_t breath_value;
    bool breath_rising;
} seekbci_led_t;

static inline void sled_init(seekbci_led_t* led, uint8_t pin, bool use_pwm = false, uint8_t ledc_ch = 15) {
    led->pin = pin;
    led->mode = SLED_OFF;
    led->use_pwm = use_pwm;
    led->ledc_channel = ledc_ch;
    led->on = false;
    led->last_toggle = 0;
    led->blink_phase = 0;
    led->breath_value = 0;
    led->breath_rising = true;

    if (use_pwm) {
        ledcSetup(ledc_ch, 5000, 8);
        ledcAttachPin(pin, ledc_ch);
        ledcWrite(ledc_ch, 0);
    } else {
        pinMode(pin, OUTPUT);
        digitalWrite(pin, LOW);
    }
}

static inline void sled_set_mode(seekbci_led_t* led, sled_mode_t mode) {
    led->mode = mode;
    led->blink_phase = 0;
    if (mode == SLED_OFF) {
        if (led->use_pwm) ledcWrite(led->ledc_channel, 0);
        else digitalWrite(led->pin, LOW);
        led->on = false;
    } else if (mode == SLED_SOLID) {
        if (led->use_pwm) ledcWrite(led->ledc_channel, 255);
        else digitalWrite(led->pin, HIGH);
        led->on = true;
    }
}

static inline void sled_update(seekbci_led_t* led) {
    unsigned long now = millis();

    switch (led->mode) {
        case SLED_OFF:
        case SLED_SOLID:
            break;

        case SLED_SLOW_BLINK:
            if (now - led->last_toggle >= 500) {
                led->last_toggle = now;
                led->on = !led->on;
                if (led->use_pwm) ledcWrite(led->ledc_channel, led->on ? 255 : 0);
                else digitalWrite(led->pin, led->on);
            }
            break;

        case SLED_FAST_BLINK:
            if (now - led->last_toggle >= 166) {
                led->last_toggle = now;
                led->on = !led->on;
                if (led->use_pwm) ledcWrite(led->ledc_channel, led->on ? 255 : 0);
                else digitalWrite(led->pin, led->on);
            }
            break;

        case SLED_DOUBLE_BLINK: {
            // 模式: ON-OFF-ON-OFF-OFF-OFF (每段200ms，总1200ms)
            uint8_t phase = (uint8_t)((now / 200) % 6);
            bool target = (phase == 0 || phase == 2);
            if (target != led->on) {
                led->on = target;
                if (led->use_pwm) ledcWrite(led->ledc_channel, led->on ? 255 : 0);
                else digitalWrite(led->pin, led->on);
            }
            break;
        }

        case SLED_BREATHING:
            if (!led->use_pwm) {
                // 非PWM引脚降级为慢闪
                if (now - led->last_toggle >= 500) {
                    led->last_toggle = now;
                    led->on = !led->on;
                    digitalWrite(led->pin, led->on);
                }
                break;
            }
            if (now - led->last_toggle >= 10) {
                led->last_toggle = now;
                if (led->breath_rising) {
                    led->breath_value += 3;
                    if (led->breath_value >= 250) led->breath_rising = false;
                } else {
                    led->breath_value -= 3;
                    if (led->breath_value <= 5) led->breath_rising = true;
                }
                ledcWrite(led->ledc_channel, led->breath_value);
            }
            break;
    }
}

#endif // SEEKBCI_LED_H
