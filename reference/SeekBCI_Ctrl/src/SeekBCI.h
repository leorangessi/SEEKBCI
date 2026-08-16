#ifndef SEEKBCI_H
#define SEEKBCI_H

/**
 * SeekBCI 控制板统一头文件。
 * 
 * 用户只需 #include <SeekBCI.h> 即可使用全部功能：
 *   - SeekBCI_Ctrl: 核心控制板类（BLE/GPIO/ADC/PWM/DAC/Servo/NVS/规则）
 *   - SeekBCI_OTA:  固件 OTA 升级
 *   - seekbci_led:  LED 状态指示
 *   - eog_mcu:      MCU 端眼电检测
 *   - emg_mcu:      MCU 端肌电检测
 *   - focus_mcu:    MCU 端专注度估计
 */

#include "SeekBCI_Ctrl.h"
#include "seekbci_ota.h"
#include "seekbci_led.h"
#include "eog_mcu.h"
#include "emg_mcu.h"
#include "focus_mcu.h"

#endif // SEEKBCI_H
