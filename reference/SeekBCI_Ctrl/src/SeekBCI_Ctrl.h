#ifndef SEEKBCI_CTRL_H
#define SEEKBCI_CTRL_H

#include <Arduino.h>
#include <stdint.h>

// ============================================================
// 常量定义
// ============================================================

#define SEEKBCI_CTRL_VERSION       "1.0.0"
#define SEEKBCI_CTRL_MAX_INPUTS    8
#define SEEKBCI_CTRL_MAX_OUTPUTS   8
#define SEEKBCI_CTRL_MAX_RULES     8
#define SEEKBCI_CTRL_NVS_NAMESPACE "sbci_ctrl"
#define SEEKBCI_CTRL_NVS_RULES_KEY "ctrl_rules"
#define SEEKBCI_CTRL_NVS_ALGO_KEY  "algo_params"
#define SEEKBCI_CTRL_NVS_META_KEY  "ctrl_meta"

// BLE UUIDs
#define CTRL_SERVICE_UUID   "7f530001-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_RX_UUID        "7f530002-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_TX_UUID        "7f530003-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_OTA_UUID       "7f530004-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_CONFIG_UUID    "7f530005-1b15-4a0b-9f7f-8f54f8d7a001"

// 指令包
#define CMD_PACKET_HEADER   0xC0
#define CMD_PACKET_FOOTER   0xC3
#define CMD_PACKET_SIZE     8

// 状态上报包
#define STATUS_PACKET_HEADER 0xD0
#define STATUS_PACKET_FOOTER 0xD3
#define STATUS_PACKET_SIZE   6

// ============================================================
// 枚举
// ============================================================

typedef enum {
    SEEKBCI_ROLE_INPUT  = 0x01,
    SEEKBCI_ROLE_OUTPUT = 0x02
} seekbci_role_t;

typedef enum {
    EDGE_RISING  = 0x01,
    EDGE_FALLING = 0x02,
    EDGE_BOTH    = 0x03
} seekbci_edge_t;

typedef enum {
    SIGNAL_GPIO  = 0x01,
    SIGNAL_ADC   = 0x02,
    SIGNAL_EOG   = 0x10,
    SIGNAL_EMG   = 0x11,
    SIGNAL_FOCUS = 0x12
} seekbci_signal_type_t;

typedef enum {
    ACTION_GPIO_SET     = 0x01,
    ACTION_GPIO_TOGGLE  = 0x02,
    ACTION_DAC          = 0x03,
    ACTION_PWM          = 0x04,
    ACTION_PWM_TIMED    = 0x05,
    ACTION_SERVO        = 0x06
} seekbci_action_type_t;

typedef enum {
    TRIGGER_EDGE    = 0x01,
    TRIGGER_THRESH  = 0x02,
    TRIGGER_LINEAR  = 0x03
} seekbci_trigger_mode_t;

typedef enum {
    LED_PAIRING_SLOW_BLINK,   // 配对模式 1Hz
    LED_CONNECTED_SOLID,      // PC已连接 常亮
    LED_STANDALONE_SCANNING,  // 独立模式搜索 3Hz
    LED_STANDALONE_PAIRED,    // 独立模式已配对 常亮
    LED_STANDALONE_LOST,      // 连接丢失 双闪
    LED_OTA_BREATHING         // OTA 呼吸灯
} seekbci_led_state_t;

typedef enum {
    MODE_PAIRING,             // 等待PC连接（Peripheral）
    MODE_CONNECTED,           // PC已连接
    MODE_STANDALONE_SCAN,     // 独立模式扫描中（Central）
    MODE_STANDALONE_RUN       // 独立模式运行中
} seekbci_mode_t;

// ============================================================
// 数据结构
// ============================================================

typedef struct {
    uint8_t  pin;
    uint8_t  pull;            // GPIO_PULLUP / GPIO_PULLDOWN / GPIO_FLOATING
    uint8_t  edge;            // seekbci_edge_t
    uint8_t  signal_type;     // SIGNAL_GPIO
    volatile bool triggered;
    volatile uint32_t last_trigger_ms;
    uint16_t debounce_ms;
} ctrl_digital_input_t;

typedef struct {
    uint8_t  pin;
    uint8_t  attenuation;     // ADC_ATTEN_DB_0 / _2_5 / _6 / _11
    uint8_t  signal_type;     // SIGNAL_ADC
    uint16_t value;           // 最新采样值
    uint16_t report_threshold; // 变化超过此值才上报
} ctrl_analog_input_t;

typedef struct {
    uint8_t  pin;
    uint8_t  action_type;     // seekbci_action_type_t
    uint8_t  ledc_channel;    // ESP32 LEDC 通道号 (PWM/Servo用)
    uint32_t pwm_freq;
    uint8_t  pwm_resolution;
    uint16_t current_value;
} ctrl_output_t;

// NVS 中存储的规则（20 bytes per rule）
typedef struct {
    uint8_t  valid;           // 0xFF=空, 0x01=有效
    uint8_t  signal_type;     // seekbci_signal_type_t
    uint8_t  source_channel;  // pin号 或 算法通道
    uint8_t  trigger_mode;    // seekbci_trigger_mode_t
    int16_t  threshold_low;
    int16_t  threshold_high;
    uint8_t  action_type;     // seekbci_action_type_t
    uint8_t  target_pin;
    uint16_t action_param1;   // duty / value / angle
    uint16_t action_param2;   // freq / duration_ms
    uint8_t  target_mac[6];   // 被控板 MAC
} __attribute__((packed)) ctrl_rule_t;

// 算法参数（独立模式下使用）
typedef struct {
    float    eog_threshold_uv;
    uint32_t eog_refractory_ms;
    float    eog_baseline_tau;

    float    emg_threshold_uv;
    float    emg_window_sec;
    float    emg_min_bin_fraction;

    uint8_t  focus_threshold;
    uint8_t  focus_metric;        // 0=TBR, 1=engagement
    uint16_t focus_fft_size;

    uint8_t  reserved[8];
} __attribute__((packed)) ctrl_algo_params_t;

// BLE 指令包（Central发给被控板）
typedef struct {
    uint8_t  header;          // CMD_PACKET_HEADER
    uint8_t  action_type;
    uint8_t  target_pin;
    uint16_t param1;          // LE
    uint16_t param2;          // LE
    uint8_t  footer;          // CMD_PACKET_FOOTER
} __attribute__((packed)) ctrl_command_t;

// 状态上报包（控制板发给PC）
typedef struct {
    uint8_t  header;          // STATUS_PACKET_HEADER
    uint8_t  channel_index;
    uint8_t  signal_type;
    uint16_t value;           // LE
    uint8_t  footer;          // STATUS_PACKET_FOOTER
} __attribute__((packed)) ctrl_status_t;

// 设备元信息（NVS持久化）
typedef struct {
    uint16_t device_id;
    uint8_t  role;            // seekbci_role_t
    uint8_t  capabilities;    // bit flags
    char     name[20];
} __attribute__((packed)) ctrl_meta_t;

// ============================================================
// 回调函数类型
// ============================================================

typedef void (*seekbci_connect_cb_t)();
typedef void (*seekbci_disconnect_cb_t)();
typedef void (*seekbci_command_cb_t)(ctrl_command_t cmd);
typedef void (*seekbci_input_cb_t)(uint8_t channel, uint16_t value);

// ============================================================
// 主类
// ============================================================

class SeekBCI_Ctrl {
public:
    SeekBCI_Ctrl();
    ~SeekBCI_Ctrl();

    // ===== 初始化 =====
    void begin(const char* deviceName);
    void setRole(seekbci_role_t role);

    // ===== 输入端配置 (ROLE_INPUT) =====
    uint8_t addDigitalInput(uint8_t pin, uint8_t pull = GPIO_PULLUP,
                            seekbci_edge_t edge = EDGE_RISING,
                            uint16_t debounce_ms = 50);
    uint8_t addAnalogInput(uint8_t pin, uint8_t attenuation = 3,
                           uint16_t report_threshold = 50);

    // ===== 输出端配置 (ROLE_OUTPUT) =====
    uint8_t addDigitalOutput(uint8_t pin);
    uint8_t addDacOutput(uint8_t pin);
    uint8_t addPwmOutput(uint8_t pin, uint32_t freq = 5000, uint8_t resolution = 8);
    uint8_t addServoOutput(uint8_t pin);

    // ===== 动作执行 =====
    void executeGpioSet(uint8_t pin, bool level);
    void executeGpioToggle(uint8_t pin);
    void executeDac(uint8_t pin, uint8_t value);
    void executePwm(uint8_t pin, uint16_t duty);
    void executePwmTimed(uint8_t pin, uint16_t duty, uint32_t duration_ms);
    void executeServo(uint8_t pin, uint8_t angle);

    // ===== 规则管理 =====
    bool addRule(ctrl_rule_t rule);
    bool clearRules();
    bool saveRulesToNvs();
    bool loadRulesFromNvs();
    uint8_t getRuleCount();

    // ===== 算法参数 =====
    void setAlgoParams(ctrl_algo_params_t params);
    ctrl_algo_params_t getAlgoParams();
    bool saveAlgoParamsToNvs();
    bool loadAlgoParamsFromNvs();

    // ===== 回调 =====
    void onConnect(seekbci_connect_cb_t cb);
    void onDisconnect(seekbci_disconnect_cb_t cb);
    void onCommand(seekbci_command_cb_t cb);
    void onInputTrigger(seekbci_input_cb_t cb);

    // ===== 状态查询 =====
    bool isPaired();
    bool isConnectedToPlatform();
    bool isStandaloneMode();
    seekbci_mode_t getMode();
    seekbci_led_state_t getLedState();
    seekbci_role_t getRole();

    // ===== 信号读取（用户手动） =====
    uint16_t readInput(uint8_t channel);
    void writeOutput(uint8_t pin, uint16_t value);

    // ===== 主循环（必须在 loop() 中调用） =====
    void update();

    // ===== 独立模式 =====
    void enterStandaloneMode();
    void exitStandaloneMode();
    void setPairTargetMac(const uint8_t mac[6]);

private:
    // 设备信息
    char _deviceName[24];
    seekbci_role_t _role;
    seekbci_mode_t _mode;
    ctrl_meta_t _meta;
    uint8_t _ledPin;

    // 输入
    ctrl_digital_input_t _digitalInputs[SEEKBCI_CTRL_MAX_INPUTS];
    uint8_t _digitalInputCount;
    ctrl_analog_input_t _analogInputs[SEEKBCI_CTRL_MAX_INPUTS];
    uint8_t _analogInputCount;

    // 输出
    ctrl_output_t _outputs[SEEKBCI_CTRL_MAX_OUTPUTS];
    uint8_t _outputCount;
    uint8_t _nextLedcChannel;

    // 规则
    ctrl_rule_t _rules[SEEKBCI_CTRL_MAX_RULES];
    uint8_t _ruleCount;
    ctrl_algo_params_t _algoParams;

    // BLE
    bool _bleConnected;
    bool _bleInitialized;
    uint8_t _targetMac[6];
    bool _hasTargetMac;

    // 回调
    seekbci_connect_cb_t _connectCb;
    seekbci_disconnect_cb_t _disconnectCb;
    seekbci_command_cb_t _commandCb;
    seekbci_input_cb_t _inputCb;

    // LED
    seekbci_led_state_t _ledState;
    unsigned long _ledLastToggle;
    bool _ledOn;
    uint8_t _ledBlinkCount;

    // PWM 定时
    struct {
        uint8_t pin;
        uint32_t stop_at_ms;
        bool active;
    } _pwmTimers[SEEKBCI_CTRL_MAX_OUTPUTS];

    // 内部方法
    void _initBlePeripheral();
    void _initBleCentral();
    void _scanAndConnect();
    void _processInputs();
    void _processRules();
    void _updateLed();
    void _updatePwmTimers();
    void _sendStatusPacket(uint8_t channel, uint8_t signalType, uint16_t value);
    void _sendCommandToTarget(ctrl_command_t cmd);
    void _executeAction(ctrl_rule_t* rule, uint16_t inputValue);
    ctrl_output_t* _findOutput(uint8_t pin);

    // ISR 静态支持
    static SeekBCI_Ctrl* _instance;
    static void IRAM_ATTR _gpioIsrHandler(void* arg);
};

// ============================================================
// 默认算法参数
// ============================================================

static inline ctrl_algo_params_t seekbci_default_algo_params() {
    ctrl_algo_params_t p = {};
    p.eog_threshold_uv    = 45.0f;
    p.eog_refractory_ms   = 350;
    p.eog_baseline_tau    = 1.5f;
    p.emg_threshold_uv    = 60.0f;
    p.emg_window_sec      = 1.0f;
    p.emg_min_bin_fraction = 0.4f;
    p.focus_threshold     = 70;
    p.focus_metric        = 0;  // TBR
    p.focus_fft_size      = 128;
    return p;
}

#endif // SEEKBCI_CTRL_H
