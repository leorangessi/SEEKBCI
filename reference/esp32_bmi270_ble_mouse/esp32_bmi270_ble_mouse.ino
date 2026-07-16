/*
  ESP32-WROOM + BMI270 BLE IMU mouse sender

  Arduino IDE libraries:
    - SparkFun BMI270 Arduino Library
    - ESP32 BLE Arduino, included with many ESP32 board packages

  Wiring, default I2C:
    BMI270 VCC  -> 3V3
    BMI270 GND  -> GND
    BMI270 SDA  -> GPIO21
    BMI270 SCL  -> GPIO22

  BLE payload:
    ax,ay,az,gx,gy,gz
  Acceleration is m/s^2. Gyro is rad/s.
*/

#include <Wire.h>
#include <SparkFun_BMI270_Arduino_Library.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

static const char *DEVICE_NAME = "ESP32_BMI270_MOUSE";

// Custom Nordic-UART-like service/characteristic UUIDs.
static const char *SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char *IMU_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

// Change these if your ESP32 board uses different I2C pins.
static const int I2C_SDA_PIN = 21;
static const int I2C_SCL_PIN = 22;
static const uint32_t I2C_CLOCK_HZ = 400000;

static const uint16_t SAMPLE_INTERVAL_MS = 4;  // 250 Hz target
static const uint16_t STATUS_INTERVAL_MS = 1000;
static const uint16_t SERIAL_SAMPLE_INTERVAL_MS = 250;
static const float G_TO_MS2 = 9.80665f;
static const float GYRO_DEG_TO_RAD = 0.01745329252f;

BMI270 imu;
BLECharacteristic *imuCharacteristic = nullptr;
bool bleConnected = false;
bool imuReady = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    bleConnected = true;
    Serial.println("BLE client connected.");
  }

  void onDisconnect(BLEServer *server) override {
    bleConnected = false;
    Serial.println("BLE client disconnected. Restarting advertising.");
    server->getAdvertising()->start();
  }
};

void scanI2cBus() {
  Serial.println("Scanning I2C bus...");
  int foundCount = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("  I2C device found at 0x");
      if (address < 16) {
        Serial.print("0");
      }
      Serial.println(address, HEX);
      foundCount++;
    }
  }
  if (foundCount == 0) {
    Serial.println("  No I2C devices found.");
  }
}

bool setupSensor() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(I2C_CLOCK_HZ);
  scanI2cBus();

  const uint8_t addresses[] = {BMI2_I2C_PRIM_ADDR, BMI2_I2C_SEC_ADDR};
  for (uint8_t i = 0; i < 2; i++) {
    Serial.print("Trying BMI270 at 0x");
    Serial.println(addresses[i], HEX);

    if (imu.beginI2C(addresses[i], Wire) == BMI2_OK) {
      Serial.print("BMI270 ready at 0x");
      Serial.println(addresses[i], HEX);
      return true;
    }
  }

  Serial.println("BMI270 not found at 0x68 or 0x69.");
  Serial.println("BLE will still advertise so the PC can find the ESP32.");
  return false;
}

void setupBle() {
  BLEDevice::init(DEVICE_NAME);

  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *service = server->createService(SERVICE_UUID);
  imuCharacteristic = service->createCharacteristic(
      IMU_CHAR_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  imuCharacteristic->addDescriptor(new BLE2902());
  imuCharacteristic->setValue("0,0,0,0,0,0");

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  advertising->start();

  Serial.print("BLE advertising as ");
  Serial.println(DEVICE_NAME);
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("ESP32 BMI270 BLE mouse booting...");
  setupBle();
  imuReady = setupSensor();
}

void loop() {
  static uint32_t lastSampleMs = 0;
  uint32_t nowMs = millis();

  if (nowMs - lastSampleMs < SAMPLE_INTERVAL_MS) {
    delay(1);
    return;
  }
  lastSampleMs = nowMs;

  if (!imuReady) {
    static uint32_t lastStatusMs = 0;
    if (nowMs - lastStatusMs >= STATUS_INTERVAL_MS) {
      lastStatusMs = nowMs;
      Serial.println("Waiting for BMI270. BLE advertising is active.");
      if (bleConnected && imuCharacteristic != nullptr) {
        imuCharacteristic->setValue("ERR,BMI270_NOT_READY");
        imuCharacteristic->notify();
      }
    }
    return;
  }

  if (imu.getSensorData() != BMI2_OK) {
    Serial.println("BMI270 read failed.");
    return;
  }

  float ax = imu.data.accelX * G_TO_MS2;
  float ay = imu.data.accelY * G_TO_MS2;
  float az = imu.data.accelZ * G_TO_MS2;
  float gx = imu.data.gyroX * GYRO_DEG_TO_RAD;
  float gy = imu.data.gyroY * GYRO_DEG_TO_RAD;
  float gz = imu.data.gyroZ * GYRO_DEG_TO_RAD;

  char payload[96];
  snprintf(payload, sizeof(payload),
           "%.4f,%.4f,%.4f,%.4f,%.4f,%.4f",
           ax, ay, az, gx, gy, gz);

  static uint32_t lastSerialSampleMs = 0;
  if (nowMs - lastSerialSampleMs >= SERIAL_SAMPLE_INTERVAL_MS) {
    lastSerialSampleMs = nowMs;
    Serial.println(payload);
  }

  if (bleConnected && imuCharacteristic != nullptr) {
    imuCharacteristic->setValue((uint8_t *)payload, strlen(payload));
    imuCharacteristic->notify();
  }
}
