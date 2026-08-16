#ifndef SEEKBCI_OTA_H
#define SEEKBCI_OTA_H

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>

#define OTA_MAX_CHUNK_SIZE   512
#define OTA_QUEUE_LENGTH     16
#define OTA_STATUS_BUF_SIZE  96

typedef struct {
    size_t size;
    uint8_t data[OTA_MAX_CHUNK_SIZE];
} ota_chunk_t;

typedef void (*ota_status_cb_t)(const char* status, const char* detail);

class SeekBCI_OTA {
public:
    SeekBCI_OTA();

    void begin(NimBLECharacteristic* otaChar, NimBLECharacteristic* txChar);
    void handleWrite(const uint8_t* data, size_t len);
    void processLoop();
    bool isInProgress();
    void setStatusCallback(ota_status_cb_t cb);

private:
    NimBLECharacteristic* _otaChar;
    NimBLECharacteristic* _txChar;
    ota_status_cb_t _statusCb;

    bool _inProgress;
    size_t _expectedSize;
    size_t _writtenSize;
    uint8_t _lastPercent;

    const esp_partition_t* _partition;
    esp_ota_handle_t _handle;
    bool _handleActive;

    bool _beginRequested;
    bool _endRequested;
    bool _abortRequested;
    char _beginHeader[80];

    bool _rebootPending;
    unsigned long _rebootAt;

    // Ring queue
    ota_chunk_t _queue[OTA_QUEUE_LENGTH];
    volatile uint8_t _qHead;
    volatile uint8_t _qTail;
    volatile uint8_t _qCount;
    portMUX_TYPE _qMux;

    void _notifyStatus(const char* status, const char* detail = "");
    void _notifyProgress();
    void _cancel(const char* reason);
    void _beginUpdate(const char* header);
    void _finishUpdate();
    bool _queuePush(const uint8_t* data, size_t size);
    bool _queuePop(ota_chunk_t* out);
    void _queueReset();
};

#endif // SEEKBCI_OTA_H
