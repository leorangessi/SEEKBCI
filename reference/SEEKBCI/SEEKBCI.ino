/*
  SEEKBCI — ESP32 + ADS1299 + BMI270 over BLE

  Cyton 扩展包 seekbci_eeg_v2（39 字节）:
    0xA0 | sample | EEG 24B (8×24bit) | IMU 12B (6×int16 BE) | 0xC1
  IMU 缩放: accel = m/s^2 * 1000; gyro = rad/s * 10000
  BMI270 I2C: SDA=IO25, SCL=IO33

  Advertise: SEEKBCI
*/

#include <SPI.h>
#include <Wire.h>
#include <SparkFun_BMI270_Arduino_Library.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Update.h>
#include <esp_partition.h>
#include <esp_ota_ops.h>
#include <math.h>

#define ADS1299_PIN_RESET 27//4
#define ADS1299_PIN_DRDY 25//21
#define ADS1299_PIN_SCK 14//18
#define ADS1299_PIN_MISO 12//19
#define ADS1299_PIN_MOSI 13//23
#define ADS1299_PIN_SS 15//15
// #define ADS1299_PIN_RESET 4
// #define ADS1299_PIN_DRDY 21
// #define ADS1299_PIN_SCK 18
// #define ADS1299_PIN_MISO 19
// #define ADS1299_PIN_MOSI 23
// #define ADS1299_PIN_SS 15
#define BAT_DET 36//34//36  // 电池电压检测引脚，读取电压为BAT/2（注意：当前与SCK引脚冲突，需要确认硬件连接）
#define LED_PWR 32

#define BMI270_SDA_PIN 19//25//19
#define BMI270_SCL_PIN 18//33//18
#define BMI270_I2C_HZ 400000

#define BATTERY_CHECK_INTERVAL 20000  // 20秒检测一次（毫秒）
#define BATTERY_LOW_VOLTAGE 3.0       // 低电压阈值（V）
#define LED_BLINK_PERIOD 1000         // LED闪烁周期1Hz = 1000ms

#define OPENBCI_DATA_BUFFER_SIZE 50 //缓存50个数据组

#define OPENBCI_NAME "Cyton"
#define OPENBCI_VERSION "v2.0.5"

static const char *DEVICE_NAME = "SEEKBCI";
static const char *SEEKBCI_SERVICE_UUID = "7f520001-1b15-4a0b-9f7f-8f54f8d7a001";
static const char *SEEKBCI_RX_UUID = "7f520002-1b15-4a0b-9f7f-8f54f8d7a001";
static const char *SEEKBCI_TX_UUID = "7f520003-1b15-4a0b-9f7f-8f54f8d7a001";
static const char *SEEKBCI_OTA_UUID = "7f520004-1b15-4a0b-9f7f-8f54f8d7a001";

#define OTA_HEADER_PREFIX "OTA:"
#define OTA_MAX_CHUNK_SIZE 512
#define OTA_QUEUE_LENGTH 16
#define OTA_STATUS_BUFFER_SIZE 96

static const float G_TO_MS2 = 9.80665f;
static const float GYRO_DEG_TO_RAD = 0.01745329252f;
static const float IMU_ACCEL_SCALE = 1000.0f;   // → milli m/s^2
static const float IMU_GYRO_SCALE = 10000.0f;   // → 1e-4 rad/s

BLECharacteristic *txCharacteristic = nullptr;
bool bleConnected = false;
bool otaInProgress = false;
size_t otaExpectedSize = 0;
size_t otaWrittenSize = 0;
uint8_t otaLastProgressPercent = 255;
bool otaEndRequested = false;
bool otaAbortRequested = false;
bool otaBeginRequested = false;
char otaBeginHeader[80] = {0};
bool otaSafeModeEntered = false;
const esp_partition_t *otaUpdatePartition = nullptr;
esp_ota_handle_t otaUpdateHandle = 0;
bool otaHandleActive = false;
bool otaRebootPending = false;
unsigned long otaRebootAt = 0;
portMUX_TYPE otaQueueMux = portMUX_INITIALIZER_UNLOCKED;

typedef struct ota_chunk_packet
{
    size_t size;
    uint8_t data[OTA_MAX_CHUNK_SIZE];
} ota_chunk_packet;

ota_chunk_packet otaQueue[OTA_QUEUE_LENGTH] = {};
volatile uint8_t otaQueueHead = 0;
volatile uint8_t otaQueueTail = 0;
volatile uint8_t otaQueueCount = 0;

BMI270 bmi270;
bool imuReady = false;
// 最新 IMU（由 loop 更新，ISR 只 memcpy，避免在中断里走 I2C）
volatile uint8_t latest_imu_bytes[12] = {0};

enum ads1299_command : uint8_t        //ADS1299控制字：
{
    ads1299_command_start = 0x08,         //启动
    ads1299_command_stop = 0x0A,          //停止

    ads1299_command_rdatac = 0x10,        //启用连续读取
    ads1299_command_sdatac = 0x11,        //停止连续读取

    ads1299_command_rreg = 0x20,          //读寄存器
    ads1299_command_wreg = 0x40           //写寄存器
};

typedef struct ads1299_register_packet    //ADS1299的寄存器包。这个数据结构对应各寄存器地址
{
    uint8_t id;

    uint8_t config1;
    uint8_t config2;
    uint8_t config3;

    uint8_t loff;

    uint8_t chnset[8];//八个通道
    
    uint8_t bias_sensp;
    uint8_t bias_sensn;

    uint8_t loff_sensp;
    uint8_t loff_sensn;

    uint8_t loff_flip;

    uint8_t loff_statp;
    uint8_t loff_statn;

    uint8_t gpio;

    uint8_t misc1;
    uint8_t misc2;
    
    uint8_t config4;
} __attribute__ ((packed)) ads1299_register_packet;

typedef struct ads1299_data_packet            //ADS1299采集到的数据
{
    uint32_t stat : 24;

    uint8_t channel_data[24];
} __attribute__ ((packed)) ads1299_data_packet;

typedef struct openbci_data_packet
{
    uint8_t header;

    uint8_t sample_number;

    uint8_t channel_data[24];

    // 扩展：6×int16 BE = ax,ay,az,gx,gy,gz（替代原 6B aux）
    uint8_t imu_data[12];

    uint8_t footer;  // 0xC1 = EEG+IMU 扩展包
} __attribute__ ((packed)) openbci_data_packet;

ads1299_register_packet ads1299_register_buffer = {};
ads1299_data_packet ads1299_data_buffer = {};

openbci_data_packet openbci_data_buffer[OPENBCI_DATA_BUFFER_SIZE] = {{}};

uint16_t openbci_data_buffer_head = 0;
uint16_t openbci_data_buffer_tail = 0;   

uint8_t channel_setting_buffer[8] = {0};

uint8_t sample_counter = 0;

bool streaming_enabled = false;
bool isSampled = true;

uint8_t* tcp_transfer_buffer = NULL;

size_t wifi_latency = 10000;
/* 电池电压检测相关变量 */
unsigned long last_battery_check_time = 0;  // 上次电池检测时间
float battery_voltage = 0.0;                // 当前电池电压
bool battery_low = false;                   // 电池低电压标志
unsigned long last_led_toggle_time = 0;     // LED上次切换时间
bool led_state = false;                     // LED当前状态
volatile bool battery_query_pending = false; // 主机 'p' 请求，主循环里读 ADC

float read_battery_voltage();  // 读取电池电压
uint8_t battery_percent_from_voltage(float v); // 估算电量百分比
void notify_battery_status();  // 经 BLE 上报电量包 0xB0…0xC2
void check_battery_voltage();  // 检测电池电压
void update_low_battery_led(); // 更新低电压LED闪烁

void IRAM_ATTR ads1299_read_buffer(void* input_buffer, size_t buffer_size)
{
    spiTransferBytesNL(SPI.bus(), NULL, (uint8_t*)input_buffer, buffer_size);
}

void IRAM_ATTR ads1299_write_byte(uint8_t byte_to_write)
{
    spiWriteByteNL(SPI.bus(), byte_to_write);
}

void IRAM_ATTR ads1299_write_buffer(void* output_buffer, size_t buffer_size)
{
    spiWriteNL(SPI.bus(), (uint8_t*)output_buffer, buffer_size);
}

void ads1299_load_registers()
{
    spiWriteByteNL(SPI.bus(), ads1299_command_rreg);
    spiWriteByteNL(SPI.bus(), sizeof(ads1299_register_packet) - 1);    
    ads1299_read_buffer(&ads1299_register_buffer, sizeof(ads1299_register_packet));
}

void ads1299_flush_registers()
{
    ads1299_write_byte(ads1299_command_wreg);
    ads1299_write_byte(sizeof(ads1299_register_packet) - 1);
  
    ads1299_write_buffer(&ads1299_register_buffer, sizeof(ads1299_register_packet));
}
/* 丢失包的原因：中断抖动（缺少中断抖动电路），解决办法：1.detach、attach避免中断嵌套；2.加锁；3.把序号增加放到后面，其执行完后立即tail++，这样会允许抖动来的中断覆盖前面的采集 */

static int16_t float_to_i16(float v, float scale)
{
    long x = lroundf(v * scale);
    if (x > 32767L) x = 32767L;
    if (x < -32768L) x = -32768L;
    return (int16_t)x;
}

static void write_i16_be(uint8_t *dst, int16_t v)
{
    dst[0] = (uint8_t)((v >> 8) & 0xFF);
    dst[1] = (uint8_t)(v & 0xFF);
}

void update_imu_sample()
{
    if (!imuReady)
    {
        return;
    }
    if (bmi270.getSensorData() != BMI2_OK)
    {
        return;
    }

    float ax = bmi270.data.accelX * G_TO_MS2;
    float ay = bmi270.data.accelY * G_TO_MS2;
    float az = bmi270.data.accelZ * G_TO_MS2;
    float gx = bmi270.data.gyroX * GYRO_DEG_TO_RAD;
    float gy = bmi270.data.gyroY * GYRO_DEG_TO_RAD;
    float gz = bmi270.data.gyroZ * GYRO_DEG_TO_RAD;

    uint8_t tmp[12];
    write_i16_be(&tmp[0], float_to_i16(ax, IMU_ACCEL_SCALE));
    write_i16_be(&tmp[2], float_to_i16(ay, IMU_ACCEL_SCALE));
    write_i16_be(&tmp[4], float_to_i16(az, IMU_ACCEL_SCALE));
    write_i16_be(&tmp[6], float_to_i16(gx, IMU_GYRO_SCALE));
    write_i16_be(&tmp[8], float_to_i16(gy, IMU_GYRO_SCALE));
    write_i16_be(&tmp[10], float_to_i16(gz, IMU_GYRO_SCALE));

    for (int i = 0; i < 12; i++)
    {
        latest_imu_bytes[i] = tmp[i];
    }
}

bool setupImu()
{
    Wire.begin(BMI270_SDA_PIN, BMI270_SCL_PIN);
    Wire.setClock(BMI270_I2C_HZ);

    const uint8_t addresses[] = {BMI2_I2C_PRIM_ADDR, BMI2_I2C_SEC_ADDR};
    for (uint8_t i = 0; i < 2; i++)
    {
        Serial.print("Trying BMI270 at 0x");
        Serial.println(addresses[i], HEX);
        if (bmi270.beginI2C(addresses[i], Wire) == BMI2_OK)
        {
            Serial.print("BMI270 ready at 0x");
            Serial.println(addresses[i], HEX);
            return true;
        }
    }
    Serial.println("BMI270 not found (SDA=25 SCL=33). EEG BLE will still run.");
    return false;
}

void IRAM_ATTR ads1299_drdy_interrupt()
{   
    ads1299_read_buffer(&ads1299_data_buffer, sizeof(ads1299_data_packet));
    
    if (streaming_enabled)
    {
        openbci_data_buffer[openbci_data_buffer_tail].header = 0xA0;
     
        memcpy(&openbci_data_buffer[openbci_data_buffer_tail].channel_data, &ads1299_data_buffer.channel_data, sizeof(ads1299_data_buffer.channel_data));

        for (int i = 0; i < 12; i++)
        {
            openbci_data_buffer[openbci_data_buffer_tail].imu_data[i] = latest_imu_bytes[i];
        }
      
        openbci_data_buffer[openbci_data_buffer_tail].footer = 0xC1;

        openbci_data_buffer[openbci_data_buffer_tail].sample_number = sample_counter++;

        if (++openbci_data_buffer_tail >= OPENBCI_DATA_BUFFER_SIZE) openbci_data_buffer_tail = 0;
    }
}

size_t get_sampling_rate()//获得采样率
{
    return 16000 >> (ads1299_register_buffer.config1 & 0b111);//Config1寄存器低三位：000 -> fMOD / 64，001 -> fMOD / 128
}

size_t get_sample_delay()
{
    return 1000000 / get_sampling_rate();
}

size_t gain_from_channel(uint8_t channel_index)
{
    uint8_t gain = (ads1299_register_buffer.chnset[channel_index] >> 4) & 0b111;//右移四位并去掉最高位，读到PGA增益值
    
    switch (gain)
    {
        case 0b000:
          return 1;
        case 0b001:
          return 2;
        case 0b010:
          return 4;
        case 0b011:
          return 6;
        case 0b100:
          return 8;
        case 0b101:
          return 12;
        case 0b110:
          return 24;
        default:
          return 0;
    }
}

uint8_t digit_from_char(char digit_char)
{
    return digit_char - '0';
}

#define BOARD_VERSION "SEEKBCI ADS1299+BMI270 Firmware seekbci_eeg_v2 $$$"
// void processCmd(const uint8_t *command, size_t size)
// {
//     if (size <= 0)
//     {
//       return;
//     }
//     String return_message = "";

//     bool streaming_state = streaming_enabled;//记录先前状态
    
//     streaming_enabled = false;//暂时关闭流

//     ads1299_write_byte(ads1299_command_sdatac);//停止连续读取
  
//     delayMicroseconds(50);
    
//     if (command[0] == '~' && size > 1)
//     {
//         uint8_t sampling_rate = digit_from_char(command[1]);//采样率来自command1提取采样频率

//         ads1299_register_buffer.config1 &= ~(0b111);//清空config1的采样频率位（低三位）
//         ads1299_register_buffer.config1 |= sampling_rate;//按位或写入采样频率
        
//         return_message = "Success: Sample rate is now ";
//         return_message += get_sampling_rate();
//         return_message += "Hz";
//     }
//     else if (command[0] == '1' && size == 1) ads1299_register_buffer.chnset[0] = 0b10000001;//关闭通道，PGA增益为1，与SRB2连接，配置通道1为输入短路（用于偏移量或噪声测量）
//     else if (command[0] == '2' && size == 1) ads1299_register_buffer.chnset[1] = 0b10000001;//同上
//     else if (command[0] == '3' && size == 1) ads1299_register_buffer.chnset[2] = 0b10000001;
//     else if (command[0] == '4' && size == 1) ads1299_register_buffer.chnset[3] = 0b10000001;
//     else if (command[0] == '5' && size == 1) ads1299_register_buffer.chnset[4] = 0b10000001;
//     else if (command[0] == '6' && size == 1) ads1299_register_buffer.chnset[5] = 0b10000001;
//     else if (command[0] == '7' && size == 1) ads1299_register_buffer.chnset[6] = 0b10000001;
//     else if (command[0] == '8' && size == 1) ads1299_register_buffer.chnset[7] = 0b10000001;
//     else if (command[0] == '!' && size == 1) ads1299_register_buffer.chnset[0] = channel_setting_buffer[0];//使用单片机里缓存的配置
//     else if (command[0] == '@' && size == 1) ads1299_register_buffer.chnset[1] = channel_setting_buffer[1];
//     else if (command[0] == '#' && size == 1) ads1299_register_buffer.chnset[2] = channel_setting_buffer[2];
//     else if (command[0] == '$' && size == 1) ads1299_register_buffer.chnset[3] = channel_setting_buffer[3];
//     else if (command[0] == '%' && size == 1) ads1299_register_buffer.chnset[4] = channel_setting_buffer[4];
//     else if (command[0] == '^' && size == 1) ads1299_register_buffer.chnset[5] = channel_setting_buffer[5];
//     else if (command[0] == '&' && size == 1) ads1299_register_buffer.chnset[6] = channel_setting_buffer[6];
//     else if (command[0] == '*' && size == 1) ads1299_register_buffer.chnset[7] = channel_setting_buffer[7];
//     else if (command[0] == 'x' && size >= 7)//提取其后的索引、掉电值、增益设置、源、偏置使能等
//     {
//        uint8_t channel_index = digit_from_char(command[1]) - 1;

//        uint8_t channel_power_down = digit_from_char(command[2]);
//        uint8_t channel_gain = digit_from_char(command[3]);
//        uint8_t channel_source = digit_from_char(command[4]);
//        uint8_t channel_bias_enabled = digit_from_char(command[5]);
//        uint8_t channel_srb2_enabled = digit_from_char(command[6]);
 
//        uint8_t channel_setting = (channel_power_down << 7) | (channel_gain << 4) | (channel_srb2_enabled << 3) | channel_source;//重新组装

//        channel_setting_buffer[channel_index] = channel_setting;
//        ads1299_register_buffer.chnset[channel_index] = channel_setting;//写入寄存器

//        ads1299_register_buffer.bias_sensp &= ~(1 << channel_index);
//        ads1299_register_buffer.bias_sensp |= (channel_bias_enabled << channel_index);

//        ads1299_register_buffer.bias_sensn &= ~(1 << channel_index);
//        ads1299_register_buffer.bias_sensn |= (channel_bias_enabled << channel_index);

//        uint8_t srb1_enabled = digit_from_char(command[7]);

//        ads1299_register_buffer.misc1 &= ~(0b00100000);//srb和misc
//        ads1299_register_buffer.misc1 |= (srb1_enabled << 5);
//     }
//     else if (command[0] == 'b' && size == 1) streaming_state = true;
//     else if (command[0] == 's' && size == 1) streaming_state = false;
//     else if (command[0] == 'v' && size == 1) SerialBT.println(BOARD_VERSION);
//     else//无效字符
//     {
//       streaming_enabled = streaming_state;
//       return;
//     }

//     ads1299_flush_registers();
    
//     ads1299_write_byte(ads1299_command_rdatac);//读
  
//     delayMicroseconds(50);

//     streaming_enabled = streaming_state;
// }
void processCmd(String command)
{
    String return_message = "";

    // 电量查询：仅置位，ADC 在 loop 中读取（避免 BLE 回调里 delay）
    if (command.length() > 0 && command[0] == 'p')
    {
        battery_query_pending = true;
        return;
    }

    bool streaming_state = streaming_enabled;//记录先前状态
    
    streaming_enabled = false;//暂时关闭流

    ads1299_write_byte(ads1299_command_sdatac);//停止连续读取
  
    delayMicroseconds(50);
    
    if (command[0] == '~')
    {
        uint8_t sampling_rate = digit_from_char(command[1]);//采样率来自command1提取采样频率

        ads1299_register_buffer.config1 &= ~(0b111);//清空config1的采样频率位（低三位）
        ads1299_register_buffer.config1 |= sampling_rate;//按位或写入采样频率
        
        return_message = "Success: Sample rate is now ";
        return_message += get_sampling_rate();
        return_message += "Hz";
    }
    else if (command == "1") ads1299_register_buffer.chnset[0] = 0b10000001;//关闭通道，PGA增益为1，与SRB2连接，配置通道1为输入短路（用于偏移量或噪声测量）
    else if (command == "2") ads1299_register_buffer.chnset[1] = 0b10000001;//同上
    else if (command == "3") ads1299_register_buffer.chnset[2] = 0b10000001;
    else if (command == "4") ads1299_register_buffer.chnset[3] = 0b10000001;
    else if (command == "5") ads1299_register_buffer.chnset[4] = 0b10000001;
    else if (command == "6") ads1299_register_buffer.chnset[5] = 0b10000001;
    else if (command == "7") ads1299_register_buffer.chnset[6] = 0b10000001;
    else if (command == "8") ads1299_register_buffer.chnset[7] = 0b10000001;
    else if (command == "!") ads1299_register_buffer.chnset[0] = channel_setting_buffer[0];//使用单片机里缓存的配置
    else if (command == "@") ads1299_register_buffer.chnset[1] = channel_setting_buffer[1];
    else if (command == "#") ads1299_register_buffer.chnset[2] = channel_setting_buffer[2];
    else if (command == "$") ads1299_register_buffer.chnset[3] = channel_setting_buffer[3];
    else if (command == "%") ads1299_register_buffer.chnset[4] = channel_setting_buffer[4];
    else if (command == "^") ads1299_register_buffer.chnset[5] = channel_setting_buffer[5];
    else if (command == "&") ads1299_register_buffer.chnset[6] = channel_setting_buffer[6];
    else if (command == "*") ads1299_register_buffer.chnset[7] = channel_setting_buffer[7];
    else if (command[0] == 'x')//提取其后的索引、掉电值、增益设置、源、偏置使能等
    {
       uint8_t channel_index = digit_from_char(command[1]) - 1;

       uint8_t channel_power_down = digit_from_char(command[2]);
       uint8_t channel_gain = digit_from_char(command[3]);
       uint8_t channel_source = digit_from_char(command[4]);
       uint8_t channel_bias_enabled = digit_from_char(command[5]);
       uint8_t channel_srb2_enabled = digit_from_char(command[6]);
 
       uint8_t channel_setting = (channel_power_down << 7) | (channel_gain << 4) | (channel_srb2_enabled << 3) | channel_source;//重新组装

       channel_setting_buffer[channel_index] = channel_setting;
       ads1299_register_buffer.chnset[channel_index] = channel_setting;//写入寄存器

       ads1299_register_buffer.bias_sensp &= ~(1 << channel_index);
       ads1299_register_buffer.bias_sensp |= (channel_bias_enabled << channel_index);

       ads1299_register_buffer.bias_sensn &= ~(1 << channel_index);
       ads1299_register_buffer.bias_sensn |= (channel_bias_enabled << channel_index);

       uint8_t srb1_enabled = digit_from_char(command[7]);

       ads1299_register_buffer.misc1 &= ~(0b00100000);//srb和misc
       ads1299_register_buffer.misc1 |= (srb1_enabled << 5);
    }
    else if (command[0] == 'b') streaming_state = true;
    else if (command[0] == 's') streaming_state = false;
    else if (command[0] == 'v')
    {
        if (txCharacteristic != nullptr && bleConnected)
        {
            txCharacteristic->setValue((uint8_t *)BOARD_VERSION, strlen(BOARD_VERSION));
            txCharacteristic->notify();
        }
    }

    ads1299_flush_registers();
    
    ads1299_write_byte(ads1299_command_rdatac);//读
  
    delayMicroseconds(50);

    streaming_enabled = streaming_state;

}

bool otaQueuePush(const uint8_t *data, size_t size)
{
    if (size == 0 || size > OTA_MAX_CHUNK_SIZE)
    {
        return false;
    }
    portENTER_CRITICAL(&otaQueueMux);
    if (otaQueueCount >= OTA_QUEUE_LENGTH)
    {
        portEXIT_CRITICAL(&otaQueueMux);
        return false;
    }
    uint8_t tail = otaQueueTail;
    otaQueue[tail].size = size;
    memcpy(otaQueue[tail].data, data, size);
    otaQueueTail = (otaQueueTail + 1) % OTA_QUEUE_LENGTH;
    otaQueueCount++;
    portEXIT_CRITICAL(&otaQueueMux);
    return true;
}

bool otaQueuePop(ota_chunk_packet *out)
{
    portENTER_CRITICAL(&otaQueueMux);
    if (otaQueueCount == 0)
    {
        portEXIT_CRITICAL(&otaQueueMux);
        return false;
    }
    uint8_t head = otaQueueHead;
    out->size = otaQueue[head].size;
    memcpy(out->data, otaQueue[head].data, out->size);
    otaQueueHead = (otaQueueHead + 1) % OTA_QUEUE_LENGTH;
    otaQueueCount--;
    portEXIT_CRITICAL(&otaQueueMux);
    return true;
}

void otaQueueReset()
{
    portENTER_CRITICAL(&otaQueueMux);
    otaQueueHead = 0;
    otaQueueTail = 0;
    otaQueueCount = 0;
    portEXIT_CRITICAL(&otaQueueMux);
}

void otaNotifyStatus(const char *status, const char *detail = "")
{
    if (!bleConnected || txCharacteristic == nullptr)
    {
        return;
    }
    char payload[OTA_STATUS_BUFFER_SIZE];
    if (detail != nullptr && detail[0] != '\0')
    {
        snprintf(payload, sizeof(payload), "OTA:%s:%s", status, detail);
    }
    else
    {
        snprintf(payload, sizeof(payload), "OTA:%s", status);
    }
    txCharacteristic->setValue((uint8_t *)payload, strlen(payload));
    txCharacteristic->notify();
}

void otaNotifyProgress()
{
    if (otaExpectedSize == 0)
    {
        otaNotifyStatus("PROGRESS", "0");
        return;
    }

    size_t percentValue = (otaWrittenSize * (size_t)100) / otaExpectedSize;
    if (percentValue > 100)
    {
        percentValue = 100;
    }
    uint8_t percent = (uint8_t)percentValue;
    char detail[12];
    snprintf(detail, sizeof(detail), "%u", percent);
    otaNotifyStatus("PROGRESS", detail);
}

void cancelOtaUpdate(const char *reason)
{
    if (otaHandleActive)
    {
        esp_ota_abort(otaUpdateHandle);
        otaHandleActive = false;
        otaUpdateHandle = 0;
        otaUpdatePartition = nullptr;
    }
    otaInProgress = false;
    otaExpectedSize = 0;
    otaWrittenSize = 0;
    otaLastProgressPercent = 255;
    otaEndRequested = false;
    otaAbortRequested = false;
    otaBeginRequested = false;
    otaBeginHeader[0] = '\0';
    otaQueueReset();
    otaNotifyStatus("ERROR", reason);
}

void enterOtaSafeMode()
{
    if (otaSafeModeEntered)
    {
        return;
    }

    streaming_enabled = false;
    detachInterrupt(digitalPinToInterrupt(ADS1299_PIN_DRDY));

    noInterrupts();
    interrupts();

    digitalWrite(ADS1299_PIN_SS, LOW);
    delayMicroseconds(5);
    ads1299_write_byte(ads1299_command_sdatac);
    delayMicroseconds(50);
    ads1299_write_byte(ads1299_command_stop);
    delayMicroseconds(50);
    digitalWrite(ADS1299_PIN_SS, HIGH);

    SPI.endTransaction();
    delay(50);
    otaSafeModeEntered = true;
}

void beginOtaUpdate(String header)
{
    if (otaInProgress)
    {
        cancelOtaUpdate("busy");
        return;
    }

    int sizeStart = header.indexOf(':', strlen("OTA:BEGIN"));
    int md5Start = sizeStart >= 0 ? header.indexOf(':', sizeStart + 1) : -1;
    if (sizeStart < 0 || md5Start < 0)
    {
        otaNotifyStatus("ERROR", "bad-begin");
        return;
    }

    size_t firmwareSize = (size_t)header.substring(sizeStart + 1, md5Start).toInt();
    String md5 = header.substring(md5Start + 1);
    md5.trim();

    if (firmwareSize == 0)
    {
        otaNotifyStatus("ERROR", "bad-size");
        return;
    }
    if (firmwareSize > ESP.getFreeSketchSpace())
    {
        otaNotifyStatus("ERROR", "no-space");
        return;
    }

    enterOtaSafeMode();

    otaUpdatePartition = esp_ota_get_next_update_partition(NULL);
    if (otaUpdatePartition == NULL)
    {
        otaNotifyStatus("ERROR", "no-ota-partition");
        return;
    }
    Serial.printf("OTA partition label=%s addr=0x%X size=%u firmware=%u freeSketch=%u\n",
        otaUpdatePartition->label,
        (unsigned int)otaUpdatePartition->address,
        (unsigned int)otaUpdatePartition->size,
        (unsigned int)firmwareSize,
        (unsigned int)ESP.getFreeSketchSpace());

    if (firmwareSize > otaUpdatePartition->size)
    {
        otaNotifyStatus("ERROR", "partition-small");
        return;
    }

    esp_err_t beginErr = esp_ota_begin(otaUpdatePartition, OTA_WITH_SEQUENTIAL_WRITES, &otaUpdateHandle);
    if (beginErr != ESP_OK)
    {
        Serial.printf("esp_ota_begin failed: %s\n", esp_err_to_name(beginErr));
        otaNotifyStatus("ERROR", "begin-failed");
        otaUpdatePartition = nullptr;
        otaUpdateHandle = 0;
        return;
    }
    otaHandleActive = true;

    otaInProgress = true;
    otaExpectedSize = firmwareSize;
    otaWrittenSize = 0;
    otaLastProgressPercent = 255;
    otaEndRequested = false;
    otaAbortRequested = false;
    otaBeginRequested = false;
    otaBeginHeader[0] = '\0';
    otaQueueReset();
    char sizeDetail[16];
    snprintf(sizeDetail, sizeof(sizeDetail), "%u", (unsigned int)firmwareSize);
    otaNotifyStatus("READY", sizeDetail);
}

void finishOtaUpdate()
{
    if (!otaInProgress)
    {
        otaNotifyStatus("ERROR", "not-started");
        return;
    }
    if (otaWrittenSize != otaExpectedSize)
    {
        cancelOtaUpdate("size-mismatch");
        return;
    }
    esp_err_t endErr = esp_ota_end(otaUpdateHandle);
    otaHandleActive = false;
    otaUpdateHandle = 0;
    if (endErr != ESP_OK)
    {
        Serial.printf("esp_ota_end failed: %s\n", esp_err_to_name(endErr));
        cancelOtaUpdate("end-failed");
        return;
    }
    esp_err_t bootErr = esp_ota_set_boot_partition(otaUpdatePartition);
    if (bootErr != ESP_OK)
    {
        Serial.printf("esp_ota_set_boot_partition failed: %s\n", esp_err_to_name(bootErr));
        cancelOtaUpdate("activate-failed");
        return;
    }
    otaUpdatePartition = nullptr;
    otaInProgress = false;
    otaNotifyStatus("DONE", "rebooting");
    otaRebootPending = true;
    otaRebootAt = millis() + 1200;
}

void handleOtaWrite(const uint8_t *data, size_t size)
{
    if (size == 0)
    {
        return;
    }

    bool maybeTextCommand = size >= strlen(OTA_HEADER_PREFIX) && memcmp(data, OTA_HEADER_PREFIX, strlen(OTA_HEADER_PREFIX)) == 0;
    if (maybeTextCommand)
    {
        String header;
        for (size_t i = 0; i < size; i++)
        {
            header += (char)data[i];
        }
        header.trim();
        if (!otaInProgress && header.startsWith("OTA:BEGIN:"))
        {
            size_t copyLen = size;
            if (copyLen > sizeof(otaBeginHeader) - 1)
            {
                copyLen = sizeof(otaBeginHeader) - 1;
            }
            memcpy(otaBeginHeader, data, copyLen);
            otaBeginHeader[copyLen] = '\0';
            otaBeginRequested = true;
            return;
        }
        if (otaInProgress && header == "OTA:END")
        {
            otaEndRequested = true;
            return;
        }
        if (otaInProgress && header == "OTA:ABORT")
        {
            otaAbortRequested = true;
            return;
        }
        if (!otaInProgress)
        {
            otaNotifyStatus("ERROR", "bad-command");
            return;
        }
    }

    if (!otaInProgress)
    {
        otaNotifyStatus("ERROR", "not-started");
        return;
    }
    if (size > OTA_MAX_CHUNK_SIZE)
    {
        cancelOtaUpdate("bad-chunk");
        return;
    }

    if (!otaQueuePush(data, size))
    {
        otaAbortRequested = true;
        otaNotifyStatus("ERROR", "queue-full");
        return;
    }
}

void processOtaControlRequests()
{
    if (otaBeginRequested && !otaInProgress)
    {
        otaBeginRequested = false;
        String header = String(otaBeginHeader);
        otaBeginHeader[0] = '\0';
        beginOtaUpdate(header);
    }
}

void processOtaQueue()
{
    if (!otaInProgress)
    {
        return;
    }
    if (otaAbortRequested)
    {
        cancelOtaUpdate("aborted");
        return;
    }

    ota_chunk_packet chunk;
    if (otaQueuePop(&chunk))
    {
        if (otaWrittenSize + chunk.size > otaExpectedSize)
        {
            cancelOtaUpdate("size-overflow");
            return;
        }

        size_t previousPercent = otaExpectedSize == 0 ? 0 : (otaWrittenSize * 100UL) / otaExpectedSize;
        esp_err_t writeErr = esp_ota_write(otaUpdateHandle, chunk.data, chunk.size);
        if (writeErr != ESP_OK)
        {
            Serial.printf("esp_ota_write failed at %u: %s\n", (unsigned int)otaWrittenSize, esp_err_to_name(writeErr));
            cancelOtaUpdate("write-failed");
            return;
        }

        otaWrittenSize += chunk.size;
        size_t currentPercent = otaExpectedSize == 0 ? 0 : (otaWrittenSize * 100UL) / otaExpectedSize;
        if (currentPercent != previousPercent || otaWrittenSize == otaExpectedSize)
        {
            if (currentPercent >= 100 || otaLastProgressPercent == 255 || currentPercent >= (size_t)otaLastProgressPercent + 2)
            {
                otaLastProgressPercent = (uint8_t)currentPercent;
                otaNotifyProgress();
            }
        }
    }

    if (otaEndRequested && otaQueueCount == 0)
    {
        finishOtaUpdate();
    }
}

class SeekbciOtaCallbacks : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        std::string value = characteristic->getValue();
        handleOtaWrite((const uint8_t *)value.data(), value.length());
    }
};

class SeekbciServerCallbacks : public BLEServerCallbacks
{
    void onConnect(BLEServer *server) override
    {
        bleConnected = true;
        Serial.println("SEEKBCI BLE client connected.");
    }

    void onDisconnect(BLEServer *server) override
    {
        bleConnected = false;
        streaming_enabled = false;
        Serial.println("SEEKBCI BLE client disconnected. Restarting advertising.");
        server->getAdvertising()->start();
    }
};

class SeekbciRxCallbacks : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        std::string value = characteristic->getValue();
        if (value.empty())
        {
            return;
        }
        String cmd;
        for (size_t i = 0; i < value.length(); i++)
        {
            char c = value[i];
            if (c == '\r' || c == '\n')
            {
                continue;
            }
            cmd += c;
        }
        if (cmd.length() == 0)
        {
            return;
        }
        Serial.print("BLE cmd: ");
        Serial.println(cmd);
        processCmd(cmd);
    }
};

void setupBle()
{
    BLEDevice::init(DEVICE_NAME);
    BLEServer *server = BLEDevice::createServer();
    server->setCallbacks(new SeekbciServerCallbacks());

    BLEService *service = server->createService(SEEKBCI_SERVICE_UUID);

    txCharacteristic = service->createCharacteristic(
        SEEKBCI_TX_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    txCharacteristic->addDescriptor(new BLE2902());

    BLECharacteristic *rxCharacteristic = service->createCharacteristic(
        SEEKBCI_RX_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    rxCharacteristic->setCallbacks(new SeekbciRxCallbacks());

    BLECharacteristic *otaCharacteristic = service->createCharacteristic(
        SEEKBCI_OTA_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    otaCharacteristic->setCallbacks(new SeekbciOtaCallbacks());

    service->start();

    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    // 显式写入广播名：Windows 否则经常扫到「无名设备」，平台按名过滤会漏掉
    BLEAdvertisementData advData;
    advData.setName(DEVICE_NAME);
    advData.setCompleteServices(BLEUUID(SEEKBCI_SERVICE_UUID));
    advertising->setAdvertisementData(advData);

    BLEAdvertisementData scanData;
    scanData.setName(DEVICE_NAME);
    advertising->setScanResponseData(scanData);

    advertising->addServiceUUID(SEEKBCI_SERVICE_UUID);
    advertising->setScanResponse(true);
    advertising->setMinPreferred(0x06);
    advertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();
    Serial.println("SEEKBCI BLE advertising as SEEKBCI");
}

// void RecvData(const uint8_t *buffer, size_t size)
// {
//   if(size>1)
//   {
//     Serial.print(size);
//     for (int i = 0; i < size;i++)
//     {
//       Serial.print(buffer[i]);
//     }
//     processCmd(buffer, size-1); 
//   }
// }
/* 电池电压检测相关函数 */
float read_battery_voltage()
{
    //板子硬件设计问题!先将LED_PWR设为高阻态
    pinMode(BAT_DET, ANALOG);
    delay(100);
    // 读取BAT_DET引脚的ADC值，该引脚检测的电压是BAT/2
    int adc_value = analogRead(BAT_DET);
    
    // ESP32的ADC是12位，参考电压3.3V，但实际参考电压可能需要根据硬件校准
    // #ifdef ESP32
    // ESP32 ADC参考电压通常为3.3V，但实际可能略有差异
    float adc_voltage = (adc_value / 4095.0) * 3.3;  // 12位ADC，最大值4095
    // #else
    // 其他平台可能需要不同的计算方式
    // float adc_voltage = (adc_value / 1023.0) * 3.3;  // 10位ADC，最大值1023
    // #endif
    
    // BAT_DET读取的是BAT/2，所以实际电池电压 = 读取电压 * 2
    float battery_voltage = adc_voltage * 2.0;
    //板子硬件设计问题!还原
    pinMode(BAT_DET, INPUT);
    
    return battery_voltage;
}

// 电量映射：3.00V→0%，3.95V及以上→100%
uint8_t battery_percent_from_voltage(float v)
{
    if (v <= 3.00f)
    {
        return 0;
    }
    if (v >= 3.95f)
    {
        return 100;
    }
    return (uint8_t)((v - 3.00f) / 0.95f * 100.0f + 0.5f);
}

// 状态包 6B: 0xB0 | volt_mV_BE | percent | flags | 0xC2
// flags bit0 = battery_low
void notify_battery_status()
{
    if (!bleConnected || txCharacteristic == nullptr)
    {
        return;
    }
    uint16_t mv = (uint16_t)(battery_voltage * 1000.0f + 0.5f);
    uint8_t pct = battery_percent_from_voltage(battery_voltage);
    uint8_t flags = battery_low ? 0x01 : 0x00;
    uint8_t pkt[6] = {
        0xB0,
        (uint8_t)((mv >> 8) & 0xFF),
        (uint8_t)(mv & 0xFF),
        pct,
        flags,
        0xC2};
    txCharacteristic->setValue(pkt, 6);
    txCharacteristic->notify();
}

void check_battery_voltage()
{
    unsigned long current_time = millis();
    
    // 每20秒检测一次
    if (current_time - last_battery_check_time >= BATTERY_CHECK_INTERVAL)
    {
        last_battery_check_time = current_time;
        battery_voltage = read_battery_voltage();
        
        // 检查电压
        battery_low = (battery_voltage < BATTERY_LOW_VOLTAGE);
        // 经 BLE 上报，供 SEEKBCI_PLAT 显示电量
        notify_battery_status();
        
        if (battery_low)
        {
            // Serial.printf("警告：电池电压低！当前电压: %.2fV\n", battery_voltage);
        }
        else
        {
            // Serial.printf("电池电压正常：%.2fV\n", battery_voltage);
        }
    }
}

void update_low_battery_led()
{
    if (battery_low)
    {
        unsigned long current_time = millis();
        
        // 1Hz闪烁 = 每500ms切换一次状态（总周期1000ms）
        if (current_time - last_led_toggle_time >= (LED_BLINK_PERIOD / 2))
        {
            last_led_toggle_time = current_time;
            led_state = !led_state;
            digitalWrite(LED_PWR, led_state ? HIGH : LOW);
        }
    }
    else
    {
        // 电压正常时，LED保持点亮
        digitalWrite(LED_PWR, HIGH);
        led_state = true;
    }
}

void setup()
{ 
    pinMode(LED_PWR, OUTPUT);
    digitalWrite(LED_PWR, HIGH);
    // 初始化电池电压检测引脚
    pinMode(BAT_DET, INPUT);
    Serial.begin(115200);
    setupBle();
    imuReady = setupImu();
    
    pinMode(ADS1299_PIN_RESET, OUTPUT);                 //拉低复位引脚
    digitalWrite(ADS1299_PIN_RESET, LOW);
  
    pinMode(ADS1299_PIN_DRDY, INPUT_PULLUP);
  
    delayMicroseconds(50);

    SPI.begin(ADS1299_PIN_SCK, ADS1299_PIN_MISO, ADS1299_PIN_MOSI, ADS1299_PIN_SS);
    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE1));//4MHz，先移位最高有效位，SPI_MODE1——上升沿置位，下降沿采样，SCK闲置时为0

    pinMode(ADS1299_PIN_SS, OUTPUT);
    digitalWrite(ADS1299_PIN_SS, LOW);
  
    delay(5);
  
    digitalWrite(ADS1299_PIN_RESET, HIGH);
    delay(25);
    digitalWrite(ADS1299_PIN_RESET, LOW);
    delay(25);
    digitalWrite(ADS1299_PIN_RESET, HIGH);
  
    delay(5);
    //reset
    ads1299_write_byte(ads1299_command_sdatac);
    
    delayMicroseconds(50);
    
    ads1299_write_byte(ads1299_command_stop);//
    
    delayMicroseconds(50);

    ads1299_load_registers();

    ads1299_register_buffer.config1 = 0b10010110;//设备输出数据速率fCLK/2/2048,fCLK是多少呢 0b10010110
    ads1299_register_buffer.config2 = 0b11010001;//测试信号由内部产生，信号校准幅度1 × –(VREFP – VREFN) / 2400，校准频率设置为fCLK/2^20
    ads1299_register_buffer.config3 = 0b11111100;//启用内部引用缓冲区， BIAS_IN信号被路由到具有MUX_Setting 010的通道，BIAS缓冲区已启用//0b11101100
    ads1299_register_buffer.loff = 0b00000000;//比较器阈值95%，先导电流6nA,先导信号为直流
    for (uint8_t channel_index = 0; channel_index < 8; channel_index++) ads1299_register_buffer.chnset[channel_index] = 0b01101000;
    ads1299_register_buffer.bias_sensp = 0b11111111;//将8个正极同道路由到BIAS derivation
    ads1299_register_buffer.bias_sensn = 0b11111111;//将8个负极同道路由到BIAS derivation
    ads1299_register_buffer.loff_sensp = 0b00000000;//断开所有正极通道的先导检测
    ads1299_register_buffer.loff_sensn = 0b00000000;//断开所有负极通道的先导检测
    ads1299_register_buffer.loff_flip = 0b00000000;//所有通道的正极拉到AVDD，负极拉到AVSS
    ads1299_register_buffer.gpio = 0b00001111;//GPIO为输入引脚
    ads1299_register_buffer.misc1 = 0b00000000;//将SRB1连接到所有4、6或8个通道的反相输入
    ads1299_register_buffer.misc2 = 0b00000000;
    ads1299_register_buffer.config4 = 0b00000000;//连续转换，禁用比较器

    ads1299_flush_registers();//把ads1299_register_buffer的内容通过spi写入
    Serial.printf("OpenBCI ESP32 Initialisation, Daisy ID 0x%X", ads1299_register_buffer.id);
    delayMicroseconds(50);

    ads1299_write_byte(ads1299_command_start);//启动
    
    delayMicroseconds(50);
    
    ads1299_write_byte(ads1299_command_rdatac);//读取

    attachInterrupt(digitalPinToInterrupt(ADS1299_PIN_DRDY), ads1299_drdy_interrupt, FALLING);//drdy设置为中断
    
    delayMicroseconds(50);

    tcp_transfer_buffer = (uint8_t*)malloc(sizeof(openbci_data_buffer));
    Serial.print("version 1.4");
}

uint64_t last_micros = 0;

void loop()
{
    if (otaRebootPending && millis() >= otaRebootAt)
    {
        ESP.restart();
    }

    processOtaControlRequests();

    if (otaInProgress)
    {
        processOtaQueue();
        delay(1);
        return;
    }

    // 在 loop 更新 IMU，供 DRDY 中断写入扩展包
    update_imu_sample();

    // BLE 通知批量发送扩展 Cyton 包（39B，含 IMU）
    if (streaming_enabled && !otaInProgress && bleConnected && txCharacteristic != nullptr)
    {
        uint64_t current_micros = micros();

        size_t batch_target = wifi_latency / get_sample_delay();
        if (batch_target < 1) batch_target = 1;
        // 39*4=156B，兼容默认 MTU
        if (batch_target > 4) batch_target = 4;

        int16_t packets_to_write = openbci_data_buffer_tail - openbci_data_buffer_head;
        if (packets_to_write < 0) packets_to_write += OPENBCI_DATA_BUFFER_SIZE;

        if ((last_micros + wifi_latency <= current_micros) || (packets_to_write >= (int16_t)batch_target))
        {
            if (packets_to_write > (int16_t)batch_target)
            {
                packets_to_write = (int16_t)batch_target;
            }

            if (packets_to_write > 0)
            {
                if (openbci_data_buffer_head + packets_to_write >= OPENBCI_DATA_BUFFER_SIZE)
                {
                    size_t wrap_size = OPENBCI_DATA_BUFFER_SIZE - openbci_data_buffer_head;
                    memcpy(tcp_transfer_buffer, &openbci_data_buffer[openbci_data_buffer_head], wrap_size * sizeof(openbci_data_packet));
                    memcpy(tcp_transfer_buffer + (wrap_size * sizeof(openbci_data_packet)), &openbci_data_buffer, (packets_to_write - wrap_size) * sizeof(openbci_data_packet));
                }
                else
                {
                    memcpy(tcp_transfer_buffer, &openbci_data_buffer[openbci_data_buffer_head], packets_to_write * sizeof(openbci_data_packet));
                }

                openbci_data_buffer_head = (openbci_data_buffer_head + packets_to_write) % OPENBCI_DATA_BUFFER_SIZE;

                size_t nbytes = (size_t)packets_to_write * sizeof(openbci_data_packet);
                txCharacteristic->setValue(tcp_transfer_buffer, nbytes);
                txCharacteristic->notify();
            }

            last_micros = current_micros;
        }
    }

    // 主机请求电量（命令 'p'）
    if (battery_query_pending)
    {
        battery_query_pending = false;
        battery_voltage = read_battery_voltage();
        battery_low = (battery_voltage < BATTERY_LOW_VOLTAGE);
        notify_battery_status();
    }

    // 电池电压检测和LED控制
    check_battery_voltage();
    update_low_battery_led();
}
