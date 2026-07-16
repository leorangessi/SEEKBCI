/*
  SEEKPHY ESP32-WROOM BLE Demo

  Board: ESP32-WROOM / ESP32 Dev Module
  IDE: Arduino IDE
  Required library: Arduino ESP32 core with BLEDevice.h

  功能：
  - 广播 SEEKPHY BLE Control Service
  - 平台可读取 Device Info
  - 平台可写入 Command JSON: turn_on / turn_off / toggle / ping
  - 设备通过 State / Result Notify 上报状态

  默认用 GPIO2 作为 LED/继电器示例输出。多数 ESP32 DevKit 板载 LED 在 GPIO2。
*/

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// 取消下一行注释可开启串口调试日志。
// #define SEEKPHY_DEBUG 1

#ifdef SEEKPHY_DEBUG
#define DBG_BEGIN(baud) Serial.begin(baud)
#define DBG_PRINT(x) Serial.print(x)
#define DBG_PRINTLN(x) Serial.println(x)
#else
#define DBG_BEGIN(baud) do {} while (0)
#define DBG_PRINT(x) do {} while (0)
#define DBG_PRINTLN(x) do {} while (0)
#endif

#define SEEKPHY_SERVICE_UUID   "7f510001-1b15-4a0b-9f7f-8f54f8d7a001"
#define DEVICE_INFO_CHAR_UUID  "7f510002-1b15-4a0b-9f7f-8f54f8d7a001"
#define STATE_CHAR_UUID        "7f510003-1b15-4a0b-9f7f-8f54f8d7a001"
#define COMMAND_CHAR_UUID      "7f510004-1b15-4a0b-9f7f-8f54f8d7a001"
#define RESULT_CHAR_UUID       "7f510005-1b15-4a0b-9f7f-8f54f8d7a001"
#define HEARTBEAT_CHAR_UUID    "7f510006-1b15-4a0b-9f7f-8f54f8d7a001"
#define SAFETY_CHAR_UUID       "7f510007-1b15-4a0b-9f7f-8f54f8d7a001"

static const int OUTPUT_PIN = 2;

BLECharacteristic* stateChar = nullptr;
BLECharacteristic* resultChar = nullptr;
BLECharacteristic* safetyChar = nullptr;

bool deviceConnected = false;
bool powerOn = false;
uint32_t lastHeartbeatMs = 0;
uint32_t bootMs = 0;
String deviceUid;

String macNoColon() {
  String mac = BLEDevice::getAddress().toString().c_str();
  mac.replace(":", "");
  mac.toUpperCase();
  return mac;
}

String jsonEscape(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '\\' || c == '"') {
      out += '\\';
      out += c;
    } else if (c == '\n') {
      out += "\\n";
    } else if (c == '\r') {
      out += "\\r";
    } else {
      out += c;
    }
  }
  return out;
}

String getJsonStringValue(const String& json, const String& key) {
  String pat = "\"" + key + "\"";
  int k = json.indexOf(pat);
  if (k < 0) return "";
  int colon = json.indexOf(':', k + pat.length());
  if (colon < 0) return "";
  int firstQuote = json.indexOf('"', colon + 1);
  if (firstQuote < 0) return "";
  int secondQuote = json.indexOf('"', firstQuote + 1);
  if (secondQuote < 0) return "";
  return json.substring(firstQuote + 1, secondQuote);
}

String buildDeviceInfoJson() {
  return String("{") +
    "\"apiVersion\":\"1.0\"," +
    "\"deviceUid\":\"" + deviceUid + "\"," +
    "\"name\":\"SEEKPHY ESP32 Demo\"," +
    "\"manufacturer\":\"SEEKBCI\"," +
    "\"model\":\"esp32-wroom-ble-v1\"," +
    "\"firmwareVersion\":\"1.0.0\"," +
    "\"deviceType\":\"switch\"," +
    "\"category\":\"iot\"," +
    "\"capabilities\":[" +
      "{\"id\":\"power\",\"type\":\"switch\",\"actions\":[\"turn_on\",\"turn_off\",\"toggle\"],\"stateKey\":\"power\"}," +
      "{\"id\":\"heartbeat\",\"type\":\"system\",\"actions\":[\"ping\"]}" +
    "]," +
    "\"safety\":{\"riskLevel\":\"low\",\"emergencyStopSupported\":false,\"commandTimeoutMs\":3000}" +
  "}";
}

String buildStateJson() {
  return String("{") +
    "\"online\":true," +
    "\"power\":\"" + String(powerOn ? "on" : "off") + "\"," +
    "\"uptimeMs\":" + String(millis() - bootMs) +
  "}";
}

void notifyState() {
  if (!stateChar) return;
  String state = buildStateJson();
  stateChar->setValue(state.c_str());
  if (deviceConnected) stateChar->notify();
}

void notifyResult(const String& commandId, const String& status, const String& message) {
  if (!resultChar) return;
  String result = String("{") +
    "\"commandId\":\"" + jsonEscape(commandId) + "\"," +
    "\"status\":\"" + status + "\"," +
    "\"message\":\"" + jsonEscape(message) + "\"," +
    "\"state\":" + buildStateJson() +
  "}";
  resultChar->setValue(result.c_str());
  if (deviceConnected) resultChar->notify();
}

void applyPower(bool on) {
  powerOn = on;
  digitalWrite(OUTPUT_PIN, powerOn ? HIGH : LOW);
  DBG_PRINT("[SEEKPHY] power state -> ");
  DBG_PRINTLN(powerOn ? "on" : "off");
  notifyState();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    DBG_PRINTLN("[SEEKPHY] client connected");
    notifyState();
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    DBG_PRINTLN("[SEEKPHY] client disconnected, advertising restarted");
    BLEDevice::startAdvertising();
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    String cmd = characteristic->getValue().c_str();
    DBG_PRINT("[SEEKPHY] command raw: ");
    DBG_PRINTLN(cmd);
    String commandId = getJsonStringValue(cmd, "commandId");
    String action = getJsonStringValue(cmd, "action");
    DBG_PRINT("[SEEKPHY] commandId=");
    DBG_PRINT(commandId);
    DBG_PRINT(" action=");
    DBG_PRINTLN(action);
    if (commandId.length() == 0) commandId = "unknown";

    if (action == "turn_on") {
      applyPower(true);
      notifyResult(commandId, "success", "power on");
    } else if (action == "turn_off") {
      applyPower(false);
      notifyResult(commandId, "success", "power off");
    } else if (action == "toggle") {
      applyPower(!powerOn);
      notifyResult(commandId, "success", "power toggled");
    } else if (action == "ping") {
      notifyResult(commandId, "success", "pong");
    } else {
      notifyResult(commandId, "failed", "unsupported action: " + action);
    }
  }
};

class HeartbeatCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    DBG_PRINTLN("[SEEKPHY] heartbeat received");
    lastHeartbeatMs = millis();
    characteristic->setValue("{\"status\":\"ok\"}");
    if (deviceConnected) characteristic->notify();
  }
};

void setup() {
  DBG_BEGIN(115200);
  pinMode(OUTPUT_PIN, OUTPUT);
  applyPower(false);
  bootMs = millis();

  BLEDevice::init("SEEKPHY-BOOT");
  deviceUid = "seekphy_" + macNoColon();
  String shortName = "SEEKPHY-" + deviceUid.substring(deviceUid.length() - 4);
  BLEDevice::deinit(false);
  delay(100);
  BLEDevice::init(shortName.c_str());

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SEEKPHY_SERVICE_UUID);

  BLECharacteristic* infoChar = service->createCharacteristic(
    DEVICE_INFO_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  infoChar->setValue(buildDeviceInfoJson().c_str());

  stateChar = service->createCharacteristic(
    STATE_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  stateChar->addDescriptor(new BLE2902());
  stateChar->setValue(buildStateJson().c_str());

  BLECharacteristic* commandChar = service->createCharacteristic(
    COMMAND_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  commandChar->setCallbacks(new CommandCallbacks());

  resultChar = service->createCharacteristic(
    RESULT_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  resultChar->addDescriptor(new BLE2902());

  BLECharacteristic* heartbeatChar = service->createCharacteristic(
    HEARTBEAT_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  heartbeatChar->addDescriptor(new BLE2902());
  heartbeatChar->setCallbacks(new HeartbeatCallbacks());

  safetyChar = service->createCharacteristic(
    SAFETY_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  safetyChar->setValue("{\"emergencyStop\":false,\"riskLevel\":\"low\"}");

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SEEKPHY_SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  DBG_PRINTLN("[SEEKPHY] ESP32 BLE Demo started");
  DBG_PRINT("[SEEKPHY] Device UID: ");
  DBG_PRINTLN(deviceUid);
  DBG_PRINT("[SEEKPHY] BLE Name: ");
  DBG_PRINTLN(shortName);
}

void loop() {
  static uint32_t lastStateNotify = 0;
  if (deviceConnected && millis() - lastStateNotify > 5000) {
    lastStateNotify = millis();
    notifyState();
  }
  delay(20);
}
