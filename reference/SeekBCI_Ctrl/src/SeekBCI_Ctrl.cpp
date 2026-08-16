#include "SeekBCI_Ctrl.h"
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <esp_system.h>
#include <driver/dac.h>

// ============================================================
// 静态成员
// ============================================================

SeekBCI_Ctrl* SeekBCI_Ctrl::_instance = nullptr;

// BLE 对象（Peripheral 模式）
static NimBLEServer* _bleServer = nullptr;
static NimBLECharacteristic* _txChar = nullptr;
static NimBLECharacteristic* _rxChar = nullptr;
static NimBLECharacteristic* _configChar = nullptr;
static NimBLECharacteristic* _otaChar = nullptr;

// BLE 对象（Central/独立模式）
static NimBLEClient* _bleClient = nullptr;
static NimBLERemoteCharacteristic* _remoteRxChar = nullptr;

// ============================================================
// BLE Callbacks (Peripheral)
// ============================================================

class CtrlServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* server) override {
        SeekBCI_Ctrl* inst = SeekBCI_Ctrl::_instance;
        if (!inst) return;
        inst->_bleConnected = true;
        inst->_mode = MODE_CONNECTED;
        if (inst->_connectCb) inst->_connectCb();
    }
    void onDisconnect(NimBLEServer* server) override {
        SeekBCI_Ctrl* inst = SeekBCI_Ctrl::_instance;
        if (!inst) return;
        inst->_bleConnected = false;
        if (inst->isStandaloneMode()) {
            inst->_mode = MODE_STANDALONE_SCAN;
        } else {
            inst->_mode = MODE_PAIRING;
        }
        if (inst->_disconnectCb) inst->_disconnectCb();
        NimBLEDevice::startAdvertising();
    }
};

class CtrlRxCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* characteristic) override {
        SeekBCI_Ctrl* inst = SeekBCI_Ctrl::_instance;
        if (!inst) return;
        std::string val = characteristic->getValue();
        if (val.size() < CMD_PACKET_SIZE) return;
        const uint8_t* data = (const uint8_t*)val.data();
        if (data[0] != CMD_PACKET_HEADER || data[CMD_PACKET_SIZE - 1] != CMD_PACKET_FOOTER) return;

        ctrl_command_t cmd;
        cmd.header      = data[0];
        cmd.action_type = data[1];
        cmd.target_pin  = data[2];
        cmd.param1      = (uint16_t)data[3] | ((uint16_t)data[4] << 8);
        cmd.param2      = (uint16_t)data[5] | ((uint16_t)data[6] << 8);
        cmd.footer      = data[7];

        // 执行标准动作
        if (inst->getRole() == SEEKBCI_ROLE_OUTPUT) {
            switch (cmd.action_type) {
                case ACTION_GPIO_SET:
                    inst->executeGpioSet(cmd.target_pin, cmd.param1 != 0);
                    break;
                case ACTION_GPIO_TOGGLE:
                    inst->executeGpioToggle(cmd.target_pin);
                    break;
                case ACTION_DAC:
                    inst->executeDac(cmd.target_pin, (uint8_t)(cmd.param1 & 0xFF));
                    break;
                case ACTION_PWM:
                    inst->executePwm(cmd.target_pin, cmd.param1);
                    break;
                case ACTION_PWM_TIMED:
                    inst->executePwmTimed(cmd.target_pin, cmd.param1, (uint32_t)cmd.param2);
                    break;
                case ACTION_SERVO:
                    inst->executeServo(cmd.target_pin, (uint8_t)(cmd.param1 & 0xFF));
                    break;
            }
        }

        if (inst->_commandCb) inst->_commandCb(cmd);
    }
};

class CtrlConfigCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* characteristic) override {
        SeekBCI_Ctrl* inst = SeekBCI_Ctrl::_instance;
        if (!inst) return;
        std::string val = characteristic->getValue();

        // 判断写入类型：规则包 或 算法参数包
        if (val.size() == sizeof(ctrl_rule_t)) {
            ctrl_rule_t rule;
            memcpy(&rule, val.data(), sizeof(ctrl_rule_t));
            inst->addRule(rule);
        } else if (val.size() == sizeof(ctrl_algo_params_t)) {
            ctrl_algo_params_t params;
            memcpy(&params, val.data(), sizeof(ctrl_algo_params_t));
            inst->setAlgoParams(params);
            inst->saveAlgoParamsToNvs();
        }
        // 特殊命令字节
        else if (val.size() >= 2 && (uint8_t)val[0] == 0xEE) {
            uint8_t subcmd = (uint8_t)val[1];
            if (subcmd == 0x01) {
                // 保存规则到NVS并重启进独立模式
                inst->saveRulesToNvs();
                delay(200);
                ESP.restart();
            } else if (subcmd == 0x02) {
                // 清除规则，退出独立模式
                inst->clearRules();
                inst->saveRulesToNvs();
                delay(200);
                ESP.restart();
            }
        }
    }

    void onRead(NimBLECharacteristic* characteristic) override {
        SeekBCI_Ctrl* inst = SeekBCI_Ctrl::_instance;
        if (!inst) return;
        // 返回当前规则数据
        uint8_t buf[sizeof(ctrl_rule_t) * SEEKBCI_CTRL_MAX_RULES];
        memcpy(buf, inst->_rules, sizeof(buf));
        characteristic->setValue(buf, sizeof(buf));
    }
};

// ============================================================
// 构造 / 析构
// ============================================================

SeekBCI_Ctrl::SeekBCI_Ctrl() {
    _instance = this;
    memset(_deviceName, 0, sizeof(_deviceName));
    _role = SEEKBCI_ROLE_INPUT;
    _mode = MODE_PAIRING;
    memset(&_meta, 0, sizeof(_meta));
    _ledPin = 2; // ESP32 内置LED常见引脚

    _digitalInputCount = 0;
    _analogInputCount = 0;
    _outputCount = 0;
    _nextLedcChannel = 0;
    _ruleCount = 0;
    _algoParams = seekbci_default_algo_params();

    _bleConnected = false;
    _bleInitialized = false;
    memset(_targetMac, 0, 6);
    _hasTargetMac = false;

    _connectCb = nullptr;
    _disconnectCb = nullptr;
    _commandCb = nullptr;
    _inputCb = nullptr;

    _ledState = LED_PAIRING_SLOW_BLINK;
    _ledLastToggle = 0;
    _ledOn = false;
    _ledBlinkCount = 0;

    memset(_digitalInputs, 0, sizeof(_digitalInputs));
    memset(_analogInputs, 0, sizeof(_analogInputs));
    memset(_outputs, 0, sizeof(_outputs));
    memset(_rules, 0xFF, sizeof(_rules));
    memset(_pwmTimers, 0, sizeof(_pwmTimers));
}

SeekBCI_Ctrl::~SeekBCI_Ctrl() {
    if (_instance == this) _instance = nullptr;
}

// ============================================================
// 初始化
// ============================================================

void SeekBCI_Ctrl::begin(const char* deviceName) {
    strncpy(_deviceName, deviceName, sizeof(_deviceName) - 1);

    pinMode(_ledPin, OUTPUT);
    digitalWrite(_ledPin, LOW);

    // 尝试从 NVS 加载规则
    bool hasRules = loadRulesFromNvs();
    loadAlgoParamsFromNvs();

    // 检查 BOOT 键（GPIO0）长按3秒 → 清除规则
    pinMode(0, INPUT_PULLUP);
    if (digitalRead(0) == LOW) {
        uint32_t pressStart = millis();
        while (digitalRead(0) == LOW && (millis() - pressStart) < 3000) {
            delay(10);
        }
        if (millis() - pressStart >= 3000) {
            clearRules();
            saveRulesToNvs();
            hasRules = false;
            // 快闪示意已清除
            for (int i = 0; i < 10; i++) {
                digitalWrite(_ledPin, !digitalRead(_ledPin));
                delay(100);
            }
        }
    }

    // 根据是否有有效规则决定模式
    if (hasRules && _ruleCount > 0) {
        _mode = MODE_STANDALONE_SCAN;
        // 提取第一条规则的目标 MAC
        for (uint8_t i = 0; i < _ruleCount; i++) {
            if (_rules[i].valid == 0x01) {
                memcpy(_targetMac, _rules[i].target_mac, 6);
                _hasTargetMac = true;
                break;
            }
        }
        _initBleCentral();
    } else {
        _mode = MODE_PAIRING;
        _initBlePeripheral();
    }
}

void SeekBCI_Ctrl::setRole(seekbci_role_t role) {
    _role = role;
    _meta.role = (uint8_t)role;
}

// ============================================================
// 输入配置
// ============================================================

uint8_t SeekBCI_Ctrl::addDigitalInput(uint8_t pin, uint8_t pull,
                                       seekbci_edge_t edge,
                                       uint16_t debounce_ms) {
    if (_digitalInputCount >= SEEKBCI_CTRL_MAX_INPUTS) return 0xFF;
    uint8_t idx = _digitalInputCount++;

    _digitalInputs[idx].pin = pin;
    _digitalInputs[idx].pull = pull;
    _digitalInputs[idx].edge = (uint8_t)edge;
    _digitalInputs[idx].signal_type = SIGNAL_GPIO;
    _digitalInputs[idx].triggered = false;
    _digitalInputs[idx].last_trigger_ms = 0;
    _digitalInputs[idx].debounce_ms = debounce_ms;

    if (pull == GPIO_PULLUP) {
        pinMode(pin, INPUT_PULLUP);
    } else if (pull == GPIO_PULLDOWN) {
        pinMode(pin, INPUT_PULLDOWN);
    } else {
        pinMode(pin, INPUT);
    }

    // 注册中断
    int isr_mode = RISING;
    if (edge == EDGE_FALLING) isr_mode = FALLING;
    else if (edge == EDGE_BOTH) isr_mode = CHANGE;
    attachInterruptArg(digitalPinToInterrupt(pin), _gpioIsrHandler,
                       (void*)(uintptr_t)idx, isr_mode);

    return idx;
}

uint8_t SeekBCI_Ctrl::addAnalogInput(uint8_t pin, uint8_t attenuation,
                                      uint16_t report_threshold) {
    if (_analogInputCount >= SEEKBCI_CTRL_MAX_INPUTS) return 0xFF;
    uint8_t idx = _analogInputCount++;

    _analogInputs[idx].pin = pin;
    _analogInputs[idx].attenuation = attenuation;
    _analogInputs[idx].signal_type = SIGNAL_ADC;
    _analogInputs[idx].value = 0;
    _analogInputs[idx].report_threshold = report_threshold;

    analogSetPinAttenuation(pin, (adc_attenuation_t)attenuation);
    return idx;
}

// ============================================================
// 输出配置
// ============================================================

uint8_t SeekBCI_Ctrl::addDigitalOutput(uint8_t pin) {
    if (_outputCount >= SEEKBCI_CTRL_MAX_OUTPUTS) return 0xFF;
    uint8_t idx = _outputCount++;
    _outputs[idx].pin = pin;
    _outputs[idx].action_type = ACTION_GPIO_SET;
    _outputs[idx].ledc_channel = 0xFF;
    _outputs[idx].current_value = 0;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    return idx;
}

uint8_t SeekBCI_Ctrl::addDacOutput(uint8_t pin) {
    if (_outputCount >= SEEKBCI_CTRL_MAX_OUTPUTS) return 0xFF;
    if (pin != 25 && pin != 26) return 0xFF; // ESP32 only supports DAC on GPIO25/26
    uint8_t idx = _outputCount++;
    _outputs[idx].pin = pin;
    _outputs[idx].action_type = ACTION_DAC;
    _outputs[idx].ledc_channel = 0xFF;
    _outputs[idx].current_value = 0;
    dac_output_enable((pin == 25) ? DAC_CHANNEL_1 : DAC_CHANNEL_2);
    return idx;
}

uint8_t SeekBCI_Ctrl::addPwmOutput(uint8_t pin, uint32_t freq, uint8_t resolution) {
    if (_outputCount >= SEEKBCI_CTRL_MAX_OUTPUTS) return 0xFF;
    if (_nextLedcChannel >= 16) return 0xFF;
    uint8_t idx = _outputCount++;
    uint8_t ch = _nextLedcChannel++;

    _outputs[idx].pin = pin;
    _outputs[idx].action_type = ACTION_PWM;
    _outputs[idx].ledc_channel = ch;
    _outputs[idx].pwm_freq = freq;
    _outputs[idx].pwm_resolution = resolution;
    _outputs[idx].current_value = 0;

    ledcSetup(ch, freq, resolution);
    ledcAttachPin(pin, ch);
    ledcWrite(ch, 0);
    return idx;
}

uint8_t SeekBCI_Ctrl::addServoOutput(uint8_t pin) {
    if (_outputCount >= SEEKBCI_CTRL_MAX_OUTPUTS) return 0xFF;
    if (_nextLedcChannel >= 16) return 0xFF;
    uint8_t idx = _outputCount++;
    uint8_t ch = _nextLedcChannel++;

    _outputs[idx].pin = pin;
    _outputs[idx].action_type = ACTION_SERVO;
    _outputs[idx].ledc_channel = ch;
    _outputs[idx].pwm_freq = 50;        // 50Hz for servo
    _outputs[idx].pwm_resolution = 16;  // 16-bit for fine control
    _outputs[idx].current_value = 90;   // center

    ledcSetup(ch, 50, 16);
    ledcAttachPin(pin, ch);
    // Set to center (1.5ms pulse at 50Hz with 16-bit: ~4915)
    ledcWrite(ch, 4915);
    return idx;
}

// ============================================================
// 动作执行
// ============================================================

void SeekBCI_Ctrl::executeGpioSet(uint8_t pin, bool level) {
    ctrl_output_t* out = _findOutput(pin);
    if (out) {
        out->current_value = level ? 1 : 0;
    }
    pinMode(pin, OUTPUT);
    digitalWrite(pin, level ? HIGH : LOW);
}

void SeekBCI_Ctrl::executeGpioToggle(uint8_t pin) {
    ctrl_output_t* out = _findOutput(pin);
    bool current = digitalRead(pin);
    digitalWrite(pin, !current);
    if (out) out->current_value = !current ? 1 : 0;
}

void SeekBCI_Ctrl::executeDac(uint8_t pin, uint8_t value) {
    ctrl_output_t* out = _findOutput(pin);
    if (out) out->current_value = value;
    dac_channel_t ch = (pin == 25) ? DAC_CHANNEL_1 : DAC_CHANNEL_2;
    dac_output_voltage(ch, value);
}

void SeekBCI_Ctrl::executePwm(uint8_t pin, uint16_t duty) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out || out->ledc_channel == 0xFF) return;
    out->current_value = duty;
    ledcWrite(out->ledc_channel, duty);
}

void SeekBCI_Ctrl::executePwmTimed(uint8_t pin, uint16_t duty, uint32_t duration_ms) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out || out->ledc_channel == 0xFF) return;
    out->current_value = duty;
    ledcWrite(out->ledc_channel, duty);

    // 注册定时器
    for (uint8_t i = 0; i < SEEKBCI_CTRL_MAX_OUTPUTS; i++) {
        if (!_pwmTimers[i].active) {
            _pwmTimers[i].pin = pin;
            _pwmTimers[i].stop_at_ms = millis() + duration_ms;
            _pwmTimers[i].active = true;
            break;
        }
    }
}

void SeekBCI_Ctrl::executeServo(uint8_t pin, uint8_t angle) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out || out->ledc_channel == 0xFF) return;
    if (angle > 180) angle = 180;
    out->current_value = angle;
    // 舵机脉宽: 0.5ms(0°) ~ 2.5ms(180°), 周期20ms, 16bit分辨率
    // duty = (0.5 + angle/180*2.0) / 20.0 * 65536
    uint32_t pulseUs = 500 + (uint32_t)angle * 2000 / 180;
    uint32_t duty = (uint32_t)((float)pulseUs / 20000.0f * 65536.0f);
    ledcWrite(out->ledc_channel, duty);
}

// ============================================================
// 规则管理
// ============================================================

bool SeekBCI_Ctrl::addRule(ctrl_rule_t rule) {
    if (_ruleCount >= SEEKBCI_CTRL_MAX_RULES) return false;
    rule.valid = 0x01;
    _rules[_ruleCount++] = rule;
    return true;
}

bool SeekBCI_Ctrl::clearRules() {
    memset(_rules, 0xFF, sizeof(_rules));
    _ruleCount = 0;
    return true;
}

bool SeekBCI_Ctrl::saveRulesToNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, false)) return false;
    prefs.putBytes(SEEKBCI_CTRL_NVS_RULES_KEY, _rules, sizeof(_rules));
    prefs.end();
    return true;
}

bool SeekBCI_Ctrl::loadRulesFromNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, true)) return false;
    size_t len = prefs.getBytes(SEEKBCI_CTRL_NVS_RULES_KEY, _rules, sizeof(_rules));
    prefs.end();
    if (len != sizeof(_rules)) {
        memset(_rules, 0xFF, sizeof(_rules));
        _ruleCount = 0;
        return false;
    }
    _ruleCount = 0;
    for (uint8_t i = 0; i < SEEKBCI_CTRL_MAX_RULES; i++) {
        if (_rules[i].valid == 0x01) _ruleCount++;
    }
    return _ruleCount > 0;
}

uint8_t SeekBCI_Ctrl::getRuleCount() {
    return _ruleCount;
}

// ============================================================
// 算法参数
// ============================================================

void SeekBCI_Ctrl::setAlgoParams(ctrl_algo_params_t params) {
    _algoParams = params;
}

ctrl_algo_params_t SeekBCI_Ctrl::getAlgoParams() {
    return _algoParams;
}

bool SeekBCI_Ctrl::saveAlgoParamsToNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, false)) return false;
    prefs.putBytes(SEEKBCI_CTRL_NVS_ALGO_KEY, &_algoParams, sizeof(_algoParams));
    prefs.end();
    return true;
}

bool SeekBCI_Ctrl::loadAlgoParamsFromNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, true)) return false;
    size_t len = prefs.getBytes(SEEKBCI_CTRL_NVS_ALGO_KEY, &_algoParams, sizeof(_algoParams));
    prefs.end();
    if (len != sizeof(_algoParams)) {
        _algoParams = seekbci_default_algo_params();
        return false;
    }
    return true;
}

// ============================================================
// 回调注册
// ============================================================

void SeekBCI_Ctrl::onConnect(seekbci_connect_cb_t cb) { _connectCb = cb; }
void SeekBCI_Ctrl::onDisconnect(seekbci_disconnect_cb_t cb) { _disconnectCb = cb; }
void SeekBCI_Ctrl::onCommand(seekbci_command_cb_t cb) { _commandCb = cb; }
void SeekBCI_Ctrl::onInputTrigger(seekbci_input_cb_t cb) { _inputCb = cb; }

// ============================================================
// 状态查询
// ============================================================

bool SeekBCI_Ctrl::isPaired() {
    return _mode == MODE_STANDALONE_RUN || _mode == MODE_CONNECTED;
}

bool SeekBCI_Ctrl::isConnectedToPlatform() {
    return _mode == MODE_CONNECTED && _bleConnected;
}

bool SeekBCI_Ctrl::isStandaloneMode() {
    return _mode == MODE_STANDALONE_SCAN || _mode == MODE_STANDALONE_RUN;
}

seekbci_mode_t SeekBCI_Ctrl::getMode() { return _mode; }
seekbci_led_state_t SeekBCI_Ctrl::getLedState() { return _ledState; }
seekbci_role_t SeekBCI_Ctrl::getRole() { return _role; }

uint16_t SeekBCI_Ctrl::readInput(uint8_t channel) {
    if (channel < _digitalInputCount) {
        return digitalRead(_digitalInputs[channel].pin) ? 1 : 0;
    }
    uint8_t ai = channel - _digitalInputCount;
    if (ai < _analogInputCount) {
        return analogRead(_analogInputs[ai].pin);
    }
    return 0;
}

void SeekBCI_Ctrl::writeOutput(uint8_t pin, uint16_t value) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out) return;
    switch (out->action_type) {
        case ACTION_GPIO_SET:
            executeGpioSet(pin, value != 0);
            break;
        case ACTION_DAC:
            executeDac(pin, (uint8_t)(value & 0xFF));
            break;
        case ACTION_PWM:
            executePwm(pin, value);
            break;
        case ACTION_SERVO:
            executeServo(pin, (uint8_t)(value & 0xFF));
            break;
        default:
            break;
    }
}

// ============================================================
// 动作执行
// ============================================================

void SeekBCI_Ctrl::executeGpioSet(uint8_t pin, bool level) {
    ctrl_output_t* out = _findOutput(pin);
    if (out) out->current_value = level ? 1 : 0;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, level ? HIGH : LOW);
}

void SeekBCI_Ctrl::executeGpioToggle(uint8_t pin) {
    ctrl_output_t* out = _findOutput(pin);
    bool current = digitalRead(pin);
    digitalWrite(pin, !current);
    if (out) out->current_value = !current ? 1 : 0;
}

void SeekBCI_Ctrl::executeDac(uint8_t pin, uint8_t value) {
    ctrl_output_t* out = _findOutput(pin);
    if (out) out->current_value = value;
    dac_channel_t ch = (pin == 25) ? DAC_CHANNEL_1 : DAC_CHANNEL_2;
    dac_output_voltage(ch, value);
}

void SeekBCI_Ctrl::executePwm(uint8_t pin, uint16_t duty) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out || out->ledc_channel == 0xFF) return;
    out->current_value = duty;
    ledcWrite(out->ledc_channel, duty);
}

void SeekBCI_Ctrl::executePwmTimed(uint8_t pin, uint16_t duty, uint32_t duration_ms) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out || out->ledc_channel == 0xFF) return;
    out->current_value = duty;
    ledcWrite(out->ledc_channel, duty);
    for (uint8_t i = 0; i < SEEKBCI_CTRL_MAX_OUTPUTS; i++) {
        if (!_pwmTimers[i].active) {
            _pwmTimers[i].pin = pin;
            _pwmTimers[i].stop_at_ms = millis() + duration_ms;
            _pwmTimers[i].active = true;
            break;
        }
    }
}

void SeekBCI_Ctrl::executeServo(uint8_t pin, uint8_t angle) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out || out->ledc_channel == 0xFF) return;
    if (angle > 180) angle = 180;
    out->current_value = angle;
    uint32_t pulseUs = 500 + (uint32_t)angle * 2000 / 180;
    uint32_t duty = (uint32_t)((float)pulseUs / 20000.0f * 65536.0f);
    ledcWrite(out->ledc_channel, duty);
}

// ============================================================
// 规则管理
// ============================================================

bool SeekBCI_Ctrl::addRule(ctrl_rule_t rule) {
    if (_ruleCount >= SEEKBCI_CTRL_MAX_RULES) return false;
    rule.valid = 0x01;
    _rules[_ruleCount++] = rule;
    return true;
}

bool SeekBCI_Ctrl::clearRules() {
    memset(_rules, 0xFF, sizeof(_rules));
    _ruleCount = 0;
    return true;
}

bool SeekBCI_Ctrl::saveRulesToNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, false)) return false;
    prefs.putBytes(SEEKBCI_CTRL_NVS_RULES_KEY, _rules, sizeof(_rules));
    prefs.end();
    return true;
}

bool SeekBCI_Ctrl::loadRulesFromNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, true)) return false;
    size_t len = prefs.getBytes(SEEKBCI_CTRL_NVS_RULES_KEY, _rules, sizeof(_rules));
    prefs.end();
    if (len != sizeof(_rules)) {
        memset(_rules, 0xFF, sizeof(_rules));
        _ruleCount = 0;
        return false;
    }
    _ruleCount = 0;
    for (uint8_t i = 0; i < SEEKBCI_CTRL_MAX_RULES; i++) {
        if (_rules[i].valid == 0x01) _ruleCount++;
    }
    return _ruleCount > 0;
}

uint8_t SeekBCI_Ctrl::getRuleCount() { return _ruleCount; }

// ============================================================
// 算法参数
// ============================================================

void SeekBCI_Ctrl::setAlgoParams(ctrl_algo_params_t params) { _algoParams = params; }
ctrl_algo_params_t SeekBCI_Ctrl::getAlgoParams() { return _algoParams; }

bool SeekBCI_Ctrl::saveAlgoParamsToNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, false)) return false;
    prefs.putBytes(SEEKBCI_CTRL_NVS_ALGO_KEY, &_algoParams, sizeof(_algoParams));
    prefs.end();
    return true;
}

bool SeekBCI_Ctrl::loadAlgoParamsFromNvs() {
    Preferences prefs;
    if (!prefs.begin(SEEKBCI_CTRL_NVS_NAMESPACE, true)) return false;
    size_t len = prefs.getBytes(SEEKBCI_CTRL_NVS_ALGO_KEY, &_algoParams, sizeof(_algoParams));
    prefs.end();
    if (len != sizeof(_algoParams)) {
        _algoParams = seekbci_default_algo_params();
        return false;
    }
    return true;
}

// ============================================================
// 回调 & 状态
// ============================================================

void SeekBCI_Ctrl::onConnect(seekbci_connect_cb_t cb) { _connectCb = cb; }
void SeekBCI_Ctrl::onDisconnect(seekbci_disconnect_cb_t cb) { _disconnectCb = cb; }
void SeekBCI_Ctrl::onCommand(seekbci_command_cb_t cb) { _commandCb = cb; }
void SeekBCI_Ctrl::onInputTrigger(seekbci_input_cb_t cb) { _inputCb = cb; }

bool SeekBCI_Ctrl::isPaired() { return _mode == MODE_STANDALONE_RUN || _mode == MODE_CONNECTED; }
bool SeekBCI_Ctrl::isConnectedToPlatform() { return _mode == MODE_CONNECTED && _bleConnected; }
bool SeekBCI_Ctrl::isStandaloneMode() { return _mode == MODE_STANDALONE_SCAN || _mode == MODE_STANDALONE_RUN; }
seekbci_mode_t SeekBCI_Ctrl::getMode() { return _mode; }
seekbci_led_state_t SeekBCI_Ctrl::getLedState() { return _ledState; }
seekbci_role_t SeekBCI_Ctrl::getRole() { return _role; }

uint16_t SeekBCI_Ctrl::readInput(uint8_t channel) {
    if (channel < _digitalInputCount)
        return digitalRead(_digitalInputs[channel].pin) ? 1 : 0;
    uint8_t ai = channel - _digitalInputCount;
    if (ai < _analogInputCount)
        return analogRead(_analogInputs[ai].pin);
    return 0;
}

void SeekBCI_Ctrl::writeOutput(uint8_t pin, uint16_t value) {
    ctrl_output_t* out = _findOutput(pin);
    if (!out) return;
    switch (out->action_type) {
        case ACTION_GPIO_SET: executeGpioSet(pin, value != 0); break;
        case ACTION_DAC: executeDac(pin, (uint8_t)(value & 0xFF)); break;
        case ACTION_PWM: executePwm(pin, value); break;
        case ACTION_SERVO: executeServo(pin, (uint8_t)(value & 0xFF)); break;
        default: break;
    }
}

// ============================================================
// BLE 初始化
// ============================================================

void SeekBCI_Ctrl::_initBlePeripheral() {
    NimBLEDevice::init(_deviceName);
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);

    _bleServer = NimBLEDevice::createServer();
    _bleServer->setCallbacks(new CtrlServerCallbacks());

    NimBLEService* service = _bleServer->createService(CTRL_SERVICE_UUID);

    _txChar = service->createCharacteristic(
        CTRL_TX_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    _rxChar = service->createCharacteristic(
        CTRL_RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    _rxChar->setCallbacks(new CtrlRxCallbacks());
    _configChar = service->createCharacteristic(
        CTRL_CONFIG_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE);
    _configChar->setCallbacks(new CtrlConfigCallbacks());
    _otaChar = service->createCharacteristic(
        CTRL_OTA_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);

    service->start();

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(CTRL_SERVICE_UUID);
    adv->setScanResponse(true);

    uint8_t mfgData[4];
    mfgData[0] = (uint8_t)_role;
    mfgData[1] = (_role == SEEKBCI_ROLE_INPUT) ? 0x03 : 0x3C;
    mfgData[2] = (uint8_t)(_meta.device_id & 0xFF);
    mfgData[3] = (uint8_t)((_meta.device_id >> 8) & 0xFF);

    NimBLEAdvertisementData advData;
    advData.setName(_deviceName);
    advData.setManufacturerData(std::string((char*)mfgData, 4));
    adv->setAdvertisementData(advData);
    adv->start();
    _bleInitialized = true;
}

void SeekBCI_Ctrl::_initBleCentral() {
    NimBLEDevice::init(_deviceName);
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);
    _bleInitialized = true;
    _scanAndConnect();
}

void SeekBCI_Ctrl::_scanAndConnect() {
    if (!_hasTargetMac) return;
    _ledState = LED_STANDALONE_SCANNING;

    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             _targetMac[0], _targetMac[1], _targetMac[2],
             _targetMac[3], _targetMac[4], _targetMac[5]);

    NimBLEScan* scan = NimBLEDevice::getScan();
    scan->setActiveScan(true);
    scan->setInterval(100);
    scan->setWindow(99);
    NimBLEScanResults results = scan->start(5, false);

    NimBLEAdvertisedDevice* target = nullptr;
    for (int i = 0; i < results.getCount(); i++) {
        NimBLEAdvertisedDevice dev = results.getDevice(i);
        if (dev.getAddress().toString() == std::string(macStr)) {
            target = &results.getDevice(i);
            break;
        }
    }

    if (target) {
        _bleClient = NimBLEDevice::createClient();
        if (_bleClient->connect(target)) {
            NimBLERemoteService* svc = _bleClient->getService(CTRL_SERVICE_UUID);
            if (svc) _remoteRxChar = svc->getCharacteristic(CTRL_RX_UUID);
            _mode = MODE_STANDALONE_RUN;
            _ledState = LED_STANDALONE_PAIRED;
            _bleConnected = true;
        } else {
            _ledState = LED_STANDALONE_LOST;
        }
    }
    scan->clearResults();
}

// ============================================================
// 主循环
// ============================================================

void SeekBCI_Ctrl::update() {
    _updateLed();
    _updatePwmTimers();

    // 独立模式重连
    if (isStandaloneMode()) {
        if (!_bleConnected || (_bleClient && !_bleClient->isConnected())) {
            _bleConnected = false;
            _mode = MODE_STANDALONE_SCAN;
            _ledState = LED_STANDALONE_LOST;
            static unsigned long lastScan = 0;
            if (millis() - lastScan > 3000) {
                lastScan = millis();
                _scanAndConnect();
            }
        }
    }

    if (_role == SEEKBCI_ROLE_INPUT || isStandaloneMode()) {
        _processInputs();
        _processRules();
    }
}

// ============================================================
// 输入处理
// ============================================================

void SeekBCI_Ctrl::_processInputs() {
    for (uint8_t i = 0; i < _digitalInputCount; i++) {
        if (_digitalInputs[i].triggered) {
            _digitalInputs[i].triggered = false;
            uint16_t val = digitalRead(_digitalInputs[i].pin) ? 1 : 0;
            if (_inputCb) _inputCb(i, val);
            if (_mode == MODE_CONNECTED && _txChar)
                _sendStatusPacket(i, SIGNAL_GPIO, val);
        }
    }

    for (uint8_t i = 0; i < _analogInputCount; i++) {
        uint16_t newVal = analogRead(_analogInputs[i].pin);
        int16_t diff = (int16_t)newVal - (int16_t)_analogInputs[i].value;
        if (abs(diff) >= _analogInputs[i].report_threshold) {
            _analogInputs[i].value = newVal;
            uint8_t ch = _digitalInputCount + i;
            if (_inputCb) _inputCb(ch, newVal);
            if (_mode == MODE_CONNECTED && _txChar)
                _sendStatusPacket(ch, SIGNAL_ADC, newVal);
        }
    }
}

// ============================================================
// 规则引擎
// ============================================================

void SeekBCI_Ctrl::_processRules() {
    for (uint8_t i = 0; i < SEEKBCI_CTRL_MAX_RULES; i++) {
        if (_rules[i].valid != 0x01) continue;
        ctrl_rule_t* rule = &_rules[i];
        uint16_t inputValue = 0;
        bool shouldFire = false;

        if (rule->signal_type == SIGNAL_GPIO) {
            for (uint8_t j = 0; j < _digitalInputCount; j++) {
                if (_digitalInputs[j].pin == rule->source_channel &&
                    _digitalInputs[j].triggered) {
                    inputValue = digitalRead(_digitalInputs[j].pin) ? 1 : 0;
                    shouldFire = true;
                    break;
                }
            }
        } else if (rule->signal_type == SIGNAL_ADC) {
            for (uint8_t j = 0; j < _analogInputCount; j++) {
                if (_analogInputs[j].pin == rule->source_channel) {
                    inputValue = _analogInputs[j].value;
                    if (rule->trigger_mode == TRIGGER_THRESH)
                        shouldFire = (inputValue >= (uint16_t)rule->threshold_low &&
                                      inputValue <= (uint16_t)rule->threshold_high);
                    else if (rule->trigger_mode == TRIGGER_LINEAR)
                        shouldFire = true;
                    break;
                }
            }
        }

        if (shouldFire) _executeAction(rule, inputValue);
    }
}

void SeekBCI_Ctrl::_executeAction(ctrl_rule_t* rule, uint16_t inputValue) {
    ctrl_command_t cmd;
    cmd.header = CMD_PACKET_HEADER;
    cmd.action_type = rule->action_type;
    cmd.target_pin = rule->target_pin;
    cmd.param1 = rule->action_param1;
    cmd.param2 = rule->action_param2;
    cmd.footer = CMD_PACKET_FOOTER;

    if (rule->trigger_mode == TRIGGER_LINEAR) {
        uint16_t inRange = (uint16_t)rule->threshold_high - (uint16_t)rule->threshold_low;
        if (inRange > 0) {
            float norm = (float)(inputValue - (uint16_t)rule->threshold_low) / (float)inRange;
            if (norm < 0) norm = 0;
            if (norm > 1.0f) norm = 1.0f;
            cmd.param1 = (uint16_t)(norm * rule->action_param1);
        }
    }

    if (isStandaloneMode() && _bleConnected && _remoteRxChar) {
        _sendCommandToTarget(cmd);
    } else if (_role == SEEKBCI_ROLE_OUTPUT) {
        switch (cmd.action_type) {
            case ACTION_GPIO_SET: executeGpioSet(cmd.target_pin, cmd.param1 != 0); break;
            case ACTION_GPIO_TOGGLE: executeGpioToggle(cmd.target_pin); break;
            case ACTION_DAC: executeDac(cmd.target_pin, (uint8_t)(cmd.param1 & 0xFF)); break;
            case ACTION_PWM: executePwm(cmd.target_pin, cmd.param1); break;
            case ACTION_PWM_TIMED: executePwmTimed(cmd.target_pin, cmd.param1, cmd.param2); break;
            case ACTION_SERVO: executeServo(cmd.target_pin, (uint8_t)(cmd.param1 & 0xFF)); break;
        }
    }
}

// ============================================================
// BLE 通信
// ============================================================

void SeekBCI_Ctrl::_sendStatusPacket(uint8_t channel, uint8_t signalType, uint16_t value) {
    uint8_t pkt[STATUS_PACKET_SIZE] = {
        STATUS_PACKET_HEADER, channel, signalType,
        (uint8_t)(value & 0xFF), (uint8_t)((value >> 8) & 0xFF),
        STATUS_PACKET_FOOTER
    };
    if (_txChar) { _txChar->setValue(pkt, STATUS_PACKET_SIZE); _txChar->notify(); }
}

void SeekBCI_Ctrl::_sendCommandToTarget(ctrl_command_t cmd) {
    if (!_remoteRxChar) return;
    uint8_t pkt[CMD_PACKET_SIZE] = {
        cmd.header, cmd.action_type, cmd.target_pin,
        (uint8_t)(cmd.param1 & 0xFF), (uint8_t)((cmd.param1 >> 8) & 0xFF),
        (uint8_t)(cmd.param2 & 0xFF), (uint8_t)((cmd.param2 >> 8) & 0xFF),
        cmd.footer
    };
    _remoteRxChar->writeValue(pkt, CMD_PACKET_SIZE, false);
}

// ============================================================
// LED
// ============================================================

void SeekBCI_Ctrl::_updateLed() {
    unsigned long now = millis();
    switch (_mode) {
        case MODE_PAIRING:
            _ledState = LED_PAIRING_SLOW_BLINK;
            if (now - _ledLastToggle >= 500) {
                _ledLastToggle = now; _ledOn = !_ledOn;
                digitalWrite(_ledPin, _ledOn);
            }
            break;
        case MODE_CONNECTED:
            _ledState = LED_CONNECTED_SOLID;
            if (!_ledOn) { _ledOn = true; digitalWrite(_ledPin, HIGH); }
            break;
        case MODE_STANDALONE_SCAN:
            _ledState = LED_STANDALONE_SCANNING;
            if (now - _ledLastToggle >= 166) {
                _ledLastToggle = now; _ledOn = !_ledOn;
                digitalWrite(_ledPin, _ledOn);
            }
            break;
        case MODE_STANDALONE_RUN:
            if (_bleConnected) {
                _ledState = LED_STANDALONE_PAIRED;
                if (!_ledOn) { _ledOn = true; digitalWrite(_ledPin, HIGH); }
            } else {
                _ledState = LED_STANDALONE_LOST;
                uint32_t phase = (now / 200) % 5;
                bool on = (phase == 0 || phase == 2);
                if (on != _ledOn) { _ledOn = on; digitalWrite(_ledPin, _ledOn); }
            }
            break;
    }
}

// ============================================================
// PWM 定时器 & 工具
// ============================================================

void SeekBCI_Ctrl::_updatePwmTimers() {
    uint32_t now = millis();
    for (uint8_t i = 0; i < SEEKBCI_CTRL_MAX_OUTPUTS; i++) {
        if (_pwmTimers[i].active && now >= _pwmTimers[i].stop_at_ms) {
            _pwmTimers[i].active = false;
            ctrl_output_t* out = _findOutput(_pwmTimers[i].pin);
            if (out && out->ledc_channel != 0xFF) {
                ledcWrite(out->ledc_channel, 0);
                out->current_value = 0;
            }
        }
    }
}

ctrl_output_t* SeekBCI_Ctrl::_findOutput(uint8_t pin) {
    for (uint8_t i = 0; i < _outputCount; i++) {
        if (_outputs[i].pin == pin) return &_outputs[i];
    }
    return nullptr;
}

void SeekBCI_Ctrl::enterStandaloneMode() {
    saveRulesToNvs();
    saveAlgoParamsToNvs();
    delay(200);
    ESP.restart();
}

void SeekBCI_Ctrl::exitStandaloneMode() {
    clearRules();
    saveRulesToNvs();
    delay(200);
    ESP.restart();
}

void SeekBCI_Ctrl::setPairTargetMac(const uint8_t mac[6]) {
    memcpy(_targetMac, mac, 6);
    _hasTargetMac = true;
}

// ============================================================
// ISR
// ============================================================

void IRAM_ATTR SeekBCI_Ctrl::_gpioIsrHandler(void* arg) {
    uint8_t idx = (uint8_t)(uintptr_t)arg;
    SeekBCI_Ctrl* inst = _instance;
    if (!inst || idx >= inst->_digitalInputCount) return;
    uint32_t now = millis();
    ctrl_digital_input_t* input = &inst->_digitalInputs[idx];
    if (now - input->last_trigger_ms < input->debounce_ms) return;
    input->last_trigger_ms = now;
    input->triggered = true;
}
