/**
 * SeekBCI_Ctrl 示例：基础输出（被控板）
 * 
 * 将 ESP32 配置为被控端，接收平台或控制板的指令，
 * 驱动 LED、舵机、DAC 输出。
 * 
 * 接线：
 *   GPIO2  → LED（板载或外接）
 *   GPIO18 → 舵机信号线（棕=GND，红=5V，橙=信号）
 *   GPIO25 → DAC 输出（可接LED调光或电压表观察）
 *   GPIO5  → 风扇/电机（通过 MOSFET 驱动）
 */

#include <SeekBCI.h>

SeekBCI_Ctrl ctrl;

void onCommand(ctrl_command_t cmd) {
    Serial.printf("Command received: action=%02X pin=%d param1=%d param2=%d\n",
                  cmd.action_type, cmd.target_pin, cmd.param1, cmd.param2);

    // 用户可在此添加自定义复杂逻辑
    // 标准动作（GPIO/PWM/DAC/Servo）已由库自动执行
}

void onConnected() {
    Serial.println("Controller connected!");
}

void onDisconnected() {
    Serial.println("Controller disconnected.");
}

void setup() {
    Serial.begin(115200);
    Serial.println("SeekBCI_Ctrl BasicOutput Example");

    ctrl.setRole(SEEKBCI_ROLE_OUTPUT);
    ctrl.onCommand(onCommand);
    ctrl.onConnect(onConnected);
    ctrl.onDisconnect(onDisconnected);

    // LED 开关输出
    ctrl.addDigitalOutput(2);

    // 舵机输出（50Hz PWM，16bit 分辨率）
    ctrl.addServoOutput(18);

    // DAC 模拟电压输出（GPIO25）
    ctrl.addDacOutput(25);

    // PWM 输出（风扇调速：5kHz, 8bit）
    ctrl.addPwmOutput(5, 5000, 8);

    ctrl.begin("MyOutput_01");

    Serial.println("Ready. Waiting for commands...");
}

void loop() {
    ctrl.update();
}
