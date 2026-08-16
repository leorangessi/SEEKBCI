/**
 * SEEKBCI 控制板出厂固件
 * 
 * 此固件烧录到我司出品的 ESP32 控制板上，用户无需编程即可通过
 * SEEKBCI_PLAT 平台进行可视化配置（选择引脚、角色、映射规则）。
 * 
 * 功能：
 * - 上电后进入配对模式（BLE Peripheral），等待平台连接
 * - 平台可配置为控制板(INPUT)或被控板(OUTPUT)
 * - 支持通过 CONFIG 特征值写入规则和算法参数
 * - 支持独立模式（NVS 有规则时自动进入）
 * - 支持 OTA 固件升级
 * - 默认暴露常用 GPIO/ADC 引脚供平台选择
 * 
 * 硬件要求：
 * - ESP32 (WROOM 或 WROVER 均可)
 * - LED 指示灯接 GPIO2（板载）
 * - BOOT 按键接 GPIO0（用于退出独立模式）
 */

#include <SeekBCI.h>

// ============================================================
// 引脚定义（出厂默认，平台可重新配置）
// ============================================================

// 可用数字输入引脚
static const uint8_t FACTORY_DIN_PINS[] = {4, 5, 13, 14, 16, 17, 27};
#define FACTORY_DIN_COUNT 7

// 可用 ADC 输入引脚（ADC1 only，ADC2 与 WiFi 冲突）
static const uint8_t FACTORY_ADC_PINS[] = {32, 33, 34, 35, 36, 39};
#define FACTORY_ADC_COUNT 6

// 可用数字输出引脚
static const uint8_t FACTORY_DOUT_PINS[] = {2, 4, 5, 13, 14, 16, 17, 27};
#define FACTORY_DOUT_COUNT 8

// 可用 PWM/Servo 输出引脚
static const uint8_t FACTORY_PWM_PINS[] = {4, 5, 13, 14, 16, 17, 18, 19};
#define FACTORY_PWM_COUNT 8

// DAC 输出引脚（ESP32 固定）
static const uint8_t FACTORY_DAC_PINS[] = {25, 26};
#define FACTORY_DAC_COUNT 2

// ============================================================
// 全局对象
// ============================================================

SeekBCI_Ctrl ctrl;
SeekBCI_OTA ota;

// 设备名（包含 MAC 后4位作为唯一标识）
char deviceName[24] = "SEEKBCI_CTRL_0000";

// ============================================================
// 回调函数
// ============================================================

void onConnected() {
    Serial.println("[Factory] Platform connected");
}

void onDisconnected() {
    Serial.println("[Factory] Platform disconnected");
}

void onCommand(ctrl_command_t cmd) {
    Serial.printf("[Factory] CMD: action=%02X pin=%d p1=%d p2=%d\n",
                  cmd.action_type, cmd.target_pin, cmd.param1, cmd.param2);
}

void onInput(uint8_t channel, uint16_t value) {
    Serial.printf("[Factory] Input ch=%d val=%d\n", channel, value);
}

// ============================================================
// 设备名生成（使用 MAC 地址后缀）
// ============================================================

void generateDeviceName() {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_BT);
    snprintf(deviceName, sizeof(deviceName), "SEEKBCI_CTRL_%02X%02X",
             mac[4], mac[5]);
}

// ============================================================
// 根据平台配置初始化引脚
// ============================================================

void setupFactoryPins() {
    seekbci_role_t role = ctrl.getRole();

    if (role == SEEKBCI_ROLE_INPUT) {
        // 默认注册所有可用输入引脚
        for (uint8_t i = 0; i < FACTORY_DIN_COUNT; i++) {
            ctrl.addDigitalInput(FACTORY_DIN_PINS[i], GPIO_PULLUP, EDGE_BOTH, 50);
        }
        for (uint8_t i = 0; i < FACTORY_ADC_COUNT; i++) {
            ctrl.addAnalogInput(FACTORY_ADC_PINS[i], 3, 100);
        }
    } else if (role == SEEKBCI_ROLE_OUTPUT) {
        // 默认注册所有可用输出引脚
        for (uint8_t i = 0; i < FACTORY_DOUT_COUNT; i++) {
            ctrl.addDigitalOutput(FACTORY_DOUT_PINS[i]);
        }
        for (uint8_t i = 0; i < FACTORY_DAC_COUNT; i++) {
            ctrl.addDacOutput(FACTORY_DAC_PINS[i]);
        }
        for (uint8_t i = 0; i < FACTORY_PWM_COUNT; i++) {
            ctrl.addPwmOutput(FACTORY_PWM_PINS[i], 5000, 8);
        }
    }
}

// ============================================================
// Setup
// ============================================================

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("\n[SEEKBCI_CTRL] Factory Firmware v1.0.0");

    generateDeviceName();
    Serial.printf("[SEEKBCI_CTRL] Device: %s\n", deviceName);

    // 注册回调
    ctrl.onConnect(onConnected);
    ctrl.onDisconnect(onDisconnected);
    ctrl.onCommand(onCommand);
    ctrl.onInputTrigger(onInput);

    // 默认角色为 OUTPUT（被控板更常见于出厂场景）
    // 平台连接后可通过 CONFIG 特征值更改
    ctrl.setRole(SEEKBCI_ROLE_OUTPUT);

    // 初始化（内部会检查 NVS 决定进入配对/独立模式）
    ctrl.begin(deviceName);

    // 根据当前角色注册引脚
    setupFactoryPins();

    Serial.printf("[SEEKBCI_CTRL] Mode: %s, Role: %s\n",
                  ctrl.isStandaloneMode() ? "STANDALONE" : "PAIRING",
                  ctrl.getRole() == SEEKBCI_ROLE_INPUT ? "INPUT" : "OUTPUT");
}

// ============================================================
// Loop
// ============================================================

void loop() {
    // OTA 处理优先
    ota.processLoop();
    if (ota.isInProgress()) {
        delay(1);
        return;
    }

    // 主逻辑
    ctrl.update();

    delay(1);
}
