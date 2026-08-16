/**
 * SeekBCI_Ctrl 示例：基础输入（控制板）
 * 
 * 将 ESP32 配置为控制端，读取按钮和压力传感器，
 * 通过 BLE 上报给 SEEKBCI_PLAT 平台。
 * 
 * 接线：
 *   GPIO4  ← 按钮（另一端接 GND，使用内部上拉）
 *   GPIO34 ← 压力传感器模拟输出（0–3.3V）
 */

#include <SeekBCI.h>

SeekBCI_Ctrl ctrl;

void onInput(uint8_t channel, uint16_t value) {
    Serial.printf("Input triggered: ch=%d value=%d\n", channel, value);
}

void setup() {
    Serial.begin(115200);
    Serial.println("SeekBCI_Ctrl BasicInput Example");

    ctrl.setRole(SEEKBCI_ROLE_INPUT);
    ctrl.onInputTrigger(onInput);

    // 按钮：上拉输入，上升沿触发（松开时触发）
    ctrl.addDigitalInput(4, GPIO_PULLUP, EDGE_RISING, 50);

    // 压力传感器：ADC输入，变化超过100才上报
    ctrl.addAnalogInput(34, 3, 100);

    ctrl.begin("MyInput_01");

    Serial.println("Ready. Waiting for platform connection...");
}

void loop() {
    ctrl.update();
}
