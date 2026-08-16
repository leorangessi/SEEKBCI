/**
 * SEEKBCI 控制板通用固件 v2.0
 * 
 * 支持动态引脚配置：平台通过 BLE CONFIG Characteristic 下发哪些 GPIO 作为输入监听
 * 所有输入引脚的状态变化通过 TX Notify 上报，channel 字段 = GPIO pin 号
 * 
 * 协议：
 *   STATUS 包 (TX Notify): [0xD0, pin_number, sig_type, value_lo, value_hi, 0xD3]
 *     sig_type: 0x01=数字输入(ON/OFF), 0x02=ADC模拟量
 *   CMD 包 (RX Write):     [0xC0, action, pin, p1_lo, p1_hi, p2_lo, p2_hi, 0xC3]
 *   CONFIG 包 (CONFIG Write): [0xE0, sub_cmd, ...data..., 0xE3]
 *     sub_cmd 0x01: 配置数字输入引脚 [0xE0, 0x01, count, pin0, pin1, ..., 0xE3]
 *     sub_cmd 0x02: 配置ADC输入引脚  [0xE0, 0x02, count, pin0, pin1, ..., 0xE3]
 *     sub_cmd 0x10: 清除所有输入配置 [0xE0, 0x10, 0xE3]
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <driver/dac.h>

#define CTRL_SERVICE_UUID  "7f530001-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_RX_UUID       "7f530002-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_TX_UUID       "7f530003-1b15-4a0b-9f7f-8f54f8d7a001"
#define CTRL_CONFIG_UUID   "7f530005-1b15-4a0b-9f7f-8f54f8d7a001"

#define CMD_HEADER     0xC0
#define CMD_FOOTER     0xC3
#define STATUS_HEADER  0xD0
#define STATUS_FOOTER  0xD3
#define CONFIG_HEADER  0xE0
#define CONFIG_FOOTER  0xE3

#define ACT_GPIO_SET    0x01
#define ACT_GPIO_TOGGLE 0x02
#define ACT_DAC         0x03
#define ACT_PWM         0x04
#define ACT_PWM_TIMED   0x05
#define ACT_SERVO       0x06
#define ACT_CFG_DIN     0x10
#define ACT_CFG_ADC     0x11
#define ACT_READ_PIN    0x12
#define ACT_CLEAR_CFG   0x13

#define MAX_DIN_PINS  8
#define MAX_ADC_PINS  6
#define PWM_CHANNEL   0
#define PWM_FREQ      5000
#define PWM_RESOLUTION 8
#define SERVO_CHANNEL 1
#define SERVO_FREQ    50
#define SERVO_RES     16

BLECharacteristic* txChar = nullptr;
BLECharacteristic* rxChar = nullptr;
BLECharacteristic* cfgChar = nullptr;
bool bleConnected = false;
uint32_t cmdCount = 0;

uint8_t dinPins[MAX_DIN_PINS];
uint8_t dinCount = 0;
uint8_t adcPins[MAX_ADC_PINS];
uint8_t adcCount = 0;
uint8_t dinLastState[MAX_DIN_PINS];
uint16_t adcLastValue[MAX_ADC_PINS];

bool pwmTimedActive = false;
unsigned long pwmTimedEnd = 0;
uint8_t pwmTimedPin = 0;

void executeAction(uint8_t action, uint8_t pin, uint16_t p1, uint16_t p2);
void processConfig(uint8_t* data, size_t len);
void sendStatusPacket(uint8_t pinNum, uint8_t sigType, uint16_t value);

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* s) override {
        bleConnected = true;
        Serial.println("[BLE] connected");
    }
    void onDisconnect(BLEServer* s) override {
        bleConnected = false;
        Serial.println("[BLE] disconnected");
        BLEDevice::startAdvertising();
    }
};

class RxCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* c) override {
        std::string val = c->getValue();
        if (val.size() < 8) return;
        uint8_t* d = (uint8_t*)val.data();
        if (d[0] != CMD_HEADER || d[7] != CMD_FOOTER) return;
        uint8_t action = d[1];
        uint8_t pin = d[2];
        uint16_t p1 = d[3] | (d[4] << 8);
        uint16_t p2 = d[5] | (d[6] << 8);
        cmdCount++;
        Serial.printf("[CMD #%u] act=0x%02X pin=%d p1=%d p2=%d\n", cmdCount, action, pin, p1, p2);
        executeAction(action, pin, p1, p2);
    }
};

class ConfigCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* c) override {
        std::string val = c->getValue();
        if (val.size() < 3) return;
        processConfig((uint8_t*)val.data(), val.size());
    }
};

void processConfig(uint8_t* data, size_t len) {
    if (data[0] != CONFIG_HEADER || data[len - 1] != CONFIG_FOOTER) return;
    uint8_t subCmd = data[1];
    if (subCmd == 0x10) {
        dinCount = 0; adcCount = 0;
        Serial.println("[CFG] cleared");
        return;
    }
    if (subCmd == 0x01 && len >= 4) {
        uint8_t count = data[2];
        if (count > MAX_DIN_PINS) count = MAX_DIN_PINS;
        dinCount = count;
        for (uint8_t i = 0; i < count && (3+i) < (len-1); i++) {
            dinPins[i] = data[3+i];
            pinMode(dinPins[i], INPUT_PULLUP);
            dinLastState[i] = digitalRead(dinPins[i]);
        }
        Serial.printf("[CFG] DIN: %d pins\n", count);
        for (uint8_t i = 0; i < dinCount; i++) {
            sendStatusPacket(dinPins[i], 0x01, dinLastState[i]);
        }
        return;
    }
    if (subCmd == 0x02 && len >= 4) {
        uint8_t count = data[2];
        if (count > MAX_ADC_PINS) count = MAX_ADC_PINS;
        adcCount = count;
        for (uint8_t i = 0; i < count && (3+i) < (len-1); i++) {
            adcPins[i] = data[3+i];
            analogSetPinAttenuation(adcPins[i], ADC_11db);
            adcLastValue[i] = analogRead(adcPins[i]);
        }
        Serial.printf("[CFG] ADC: %d pins\n", count);
        for (uint8_t i = 0; i < adcCount; i++) {
            sendStatusPacket(adcPins[i], 0x02, adcLastValue[i]);
        }
        return;
    }
}

void sendStatusPacket(uint8_t pinNum, uint8_t sigType, uint16_t value) {
    if (!bleConnected || !txChar) return;
    uint8_t pkt[6];
    pkt[0] = STATUS_HEADER;
    pkt[1] = pinNum;
    pkt[2] = sigType;
    pkt[3] = value & 0xFF;
    pkt[4] = (value >> 8) & 0xFF;
    pkt[5] = STATUS_FOOTER;
    txChar->setValue(pkt, 6);
    txChar->notify();
}

void executeAction(uint8_t action, uint8_t pin, uint16_t p1, uint16_t p2) {
    switch (action) {
        case ACT_GPIO_SET:
            pinMode(pin, OUTPUT);
            digitalWrite(pin, p1 ? HIGH : LOW);
            sendStatusPacket(pin, 0x21, p1 ? 1 : 0);
            Serial.printf("  -> GPIO%d = %s\n", pin, p1 ? "HIGH" : "LOW");
            break;
        case ACT_GPIO_TOGGLE:
            pinMode(pin, OUTPUT);
            digitalWrite(pin, !digitalRead(pin));
            sendStatusPacket(pin, 0x21, digitalRead(pin));
            Serial.printf("  -> GPIO%d TOGGLE\n", pin);
            break;
        case ACT_DAC:
            if (pin == 25) dac_output_voltage(DAC_CHANNEL_1, p1 & 0xFF);
            else if (pin == 26) dac_output_voltage(DAC_CHANNEL_2, p1 & 0xFF);
            Serial.printf("  -> DAC%d = %d\n", pin, p1 & 0xFF);
            sendStatusPacket(pin, 0x22, p1 & 0xFF);
            break;
        case ACT_PWM:
            ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
            ledcAttachPin(pin, PWM_CHANNEL);
            ledcWrite(PWM_CHANNEL, p1 & 0xFF);
            Serial.printf("  -> PWM%d duty=%d\n", pin, p1 & 0xFF);
            sendStatusPacket(pin, 0x23, p1 & 0xFF);
            break;
        case ACT_PWM_TIMED:
            ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
            ledcAttachPin(pin, PWM_CHANNEL);
            ledcWrite(PWM_CHANNEL, p1 & 0xFF);
            pwmTimedActive = true;
            pwmTimedEnd = millis() + p2;
            pwmTimedPin = pin;
            sendStatusPacket(pin, 0x23, p1 & 0xFF);
            Serial.printf("  -> PWM%d duty=%d for %dms\n", pin, p1 & 0xFF, p2);
            break;
        case ACT_SERVO: {
            ledcSetup(SERVO_CHANNEL, SERVO_FREQ, SERVO_RES);
            ledcAttachPin(pin, SERVO_CHANNEL);
            uint16_t angle = p1 > 180 ? 180 : p1;
            uint32_t duty = (uint32_t)((500.0f + angle * 2000.0f / 180.0f) / 20000.0f * 65536.0f);
            ledcWrite(SERVO_CHANNEL, duty);
            sendStatusPacket(pin, 0x24, angle);
            Serial.printf("  -> SERVO%d angle=%d\n", pin, angle);
            break;
        }
        case ACT_CFG_DIN:
            if (dinCount < MAX_DIN_PINS) {
                dinPins[dinCount] = pin;
                pinMode(pin, INPUT_PULLUP);
                dinLastState[dinCount] = digitalRead(pin);
                dinCount++;
                sendStatusPacket(pin, 0x01, dinLastState[dinCount-1]);
                Serial.printf("  -> CFG DIN GPIO%d (total %d)\n", pin, dinCount);
            }
            break;
        case ACT_CFG_ADC:
            if (adcCount < MAX_ADC_PINS) {
                adcPins[adcCount] = pin;
                analogSetPinAttenuation(pin, ADC_11db);
                adcLastValue[adcCount] = analogRead(pin);
                adcCount++;
                sendStatusPacket(pin, 0x02, adcLastValue[adcCount-1]);
                Serial.printf("  -> CFG ADC GPIO%d (total %d)\n", pin, adcCount);
            }
            break;
        case ACT_READ_PIN: {
            bool found = false;
            for (uint8_t i = 0; i < dinCount; i++) {
                if (dinPins[i] == pin) {
                    uint8_t v = digitalRead(pin);
                    dinLastState[i] = v;
                    sendStatusPacket(pin, 0x01, v);
                    found = true; break;
                }
            }
            if (!found) {
                for (uint8_t i = 0; i < adcCount; i++) {
                    if (adcPins[i] == pin) {
                        uint16_t v = analogRead(pin);
                        adcLastValue[i] = v;
                        sendStatusPacket(pin, 0x02, v);
                        found = true; break;
                    }
                }
            }
            if (!found) {
                uint8_t v = digitalRead(pin);
                sendStatusPacket(pin, 0x01, v);
            }
            Serial.printf("  -> READ GPIO%d\n", pin);
            break;
        }
        case ACT_CLEAR_CFG:
            dinCount = 0; adcCount = 0;
            Serial.println("  -> CFG cleared");
            break;
        default:
            Serial.printf("  -> unknown 0x%02X\n", action);
            break;
    }
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n=== SEEKBCI_CTRL v2.0 ===");

    BLEDevice::init("SEEKBCI_CTRL_TEST1");
    BLEServer* server = BLEDevice::createServer();
    server->setCallbacks(new ServerCallbacks());
    BLEService* service = server->createService(CTRL_SERVICE_UUID);

    rxChar = service->createCharacteristic(CTRL_RX_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    rxChar->setCallbacks(new RxCallbacks());

    txChar = service->createCharacteristic(CTRL_TX_UUID,
        BLECharacteristic::PROPERTY_NOTIFY);
    txChar->addDescriptor(new BLE2902());

    cfgChar = service->createCharacteristic(CTRL_CONFIG_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
    cfgChar->setCallbacks(new ConfigCallbacks());

    service->start();
    BLEAdvertising* adv = BLEDevice::getAdvertising();
    adv->addServiceUUID(CTRL_SERVICE_UUID);
    adv->setScanResponse(true);
    BLEDevice::startAdvertising();
    Serial.println("[BLE] advertising: SEEKBCI_CTRL_TEST\n");
}

void loop() {
    if (pwmTimedActive && millis() >= pwmTimedEnd) {
        ledcWrite(PWM_CHANNEL, 0);
        sendStatusPacket(pwmTimedPin, 0x23, 0);
        pwmTimedActive = false;
    }

    // Poll digital inputs
    for (uint8_t i = 0; i < dinCount; i++) {
        uint8_t cur = digitalRead(dinPins[i]);
        if (cur != dinLastState[i]) {
            dinLastState[i] = cur;
            sendStatusPacket(dinPins[i], 0x01, cur);
            Serial.printf("[DIN] GPIO%d = %s\n", dinPins[i], cur ? "HIGH" : "LOW");
        }
    }

    // Poll ADC inputs (report on change > 50)
    static unsigned long adcMs = 0;
    if (millis() - adcMs >= 100) {
        adcMs = millis();
        for (uint8_t i = 0; i < adcCount; i++) {
            uint16_t v = analogRead(adcPins[i]);
            if (abs((int)v - (int)adcLastValue[i]) >= 15) {
                adcLastValue[i] = v;
                sendStatusPacket(adcPins[i], 0x02, v);
                Serial.printf("[ADC] GPIO%d = %d\n", adcPins[i], v);
            }
        }
    }

    // Periodic report every 2s so platform always has fresh data
    static unsigned long periodicMs = 0;
    if (millis() - periodicMs >= 2000) {
        periodicMs = millis();
        for (uint8_t i = 0; i < dinCount; i++) {
            sendStatusPacket(dinPins[i], 0x01, dinLastState[i]);
        }
        for (uint8_t i = 0; i < adcCount; i++) {
            sendStatusPacket(adcPins[i], 0x02, adcLastValue[i]);
        }
    }

    delay(10);
}
