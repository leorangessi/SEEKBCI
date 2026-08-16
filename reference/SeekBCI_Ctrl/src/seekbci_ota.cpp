#include "seekbci_ota.h"

SeekBCI_OTA::SeekBCI_OTA()
    : _otaChar(nullptr), _txChar(nullptr), _statusCb(nullptr),
      _inProgress(false), _expectedSize(0), _writtenSize(0), _lastPercent(255),
      _partition(nullptr), _handle(0), _handleActive(false),
      _beginRequested(false), _endRequested(false), _abortRequested(false),
      _rebootPending(false), _rebootAt(0),
      _qHead(0), _qTail(0), _qCount(0) {
    _beginHeader[0] = '\0';
    _qMux = portMUX_INITIALIZER_UNLOCKED;
    memset(_queue, 0, sizeof(_queue));
}

void SeekBCI_OTA::begin(NimBLECharacteristic* otaChar, NimBLECharacteristic* txChar) {
    _otaChar = otaChar;
    _txChar = txChar;
}

void SeekBCI_OTA::setStatusCallback(ota_status_cb_t cb) { _statusCb = cb; }
bool SeekBCI_OTA::isInProgress() { return _inProgress; }

void SeekBCI_OTA::_notifyStatus(const char* status, const char* detail) {
    char payload[OTA_STATUS_BUF_SIZE];
    if (detail && detail[0])
        snprintf(payload, sizeof(payload), "OTA:%s:%s", status, detail);
    else
        snprintf(payload, sizeof(payload), "OTA:%s", status);

    if (_txChar) {
        _txChar->setValue((uint8_t*)payload, strlen(payload));
        _txChar->notify();
    }
    if (_statusCb) _statusCb(status, detail ? detail : "");
}

void SeekBCI_OTA::_notifyProgress() {
    if (_expectedSize == 0) { _notifyStatus("PROGRESS", "0"); return; }
    uint8_t pct = (uint8_t)((_writtenSize * 100UL) / _expectedSize);
    if (pct > 100) pct = 100;
    char detail[8];
    snprintf(detail, sizeof(detail), "%u", pct);
    _notifyStatus("PROGRESS", detail);
}

void SeekBCI_OTA::_cancel(const char* reason) {
    if (_handleActive) {
        esp_ota_abort(_handle);
        _handleActive = false;
        _handle = 0;
        _partition = nullptr;
    }
    _inProgress = false;
    _expectedSize = 0;
    _writtenSize = 0;
    _lastPercent = 255;
    _endRequested = false;
    _abortRequested = false;
    _beginRequested = false;
    _beginHeader[0] = '\0';
    _queueReset();
    _notifyStatus("ERROR", reason);
}

bool SeekBCI_OTA::_queuePush(const uint8_t* data, size_t size) {
    if (size == 0 || size > OTA_MAX_CHUNK_SIZE) return false;
    portENTER_CRITICAL(&_qMux);
    if (_qCount >= OTA_QUEUE_LENGTH) { portEXIT_CRITICAL(&_qMux); return false; }
    _queue[_qTail].size = size;
    memcpy(_queue[_qTail].data, data, size);
    _qTail = (_qTail + 1) % OTA_QUEUE_LENGTH;
    _qCount++;
    portEXIT_CRITICAL(&_qMux);
    return true;
}

bool SeekBCI_OTA::_queuePop(ota_chunk_t* out) {
    portENTER_CRITICAL(&_qMux);
    if (_qCount == 0) { portEXIT_CRITICAL(&_qMux); return false; }
    out->size = _queue[_qHead].size;
    memcpy(out->data, _queue[_qHead].data, out->size);
    _qHead = (_qHead + 1) % OTA_QUEUE_LENGTH;
    _qCount--;
    portEXIT_CRITICAL(&_qMux);
    return true;
}

void SeekBCI_OTA::_queueReset() {
    portENTER_CRITICAL(&_qMux);
    _qHead = 0; _qTail = 0; _qCount = 0;
    portEXIT_CRITICAL(&_qMux);
}

void SeekBCI_OTA::handleWrite(const uint8_t* data, size_t len) {
    if (len == 0) return;

    bool maybeText = (len >= 4 && memcmp(data, "OTA:", 4) == 0);
    if (maybeText) {
        String header;
        for (size_t i = 0; i < len; i++) header += (char)data[i];
        header.trim();

        if (!_inProgress && header.startsWith("OTA:BEGIN:")) {
            size_t copyLen = (len < sizeof(_beginHeader) - 1) ? len : sizeof(_beginHeader) - 1;
            memcpy(_beginHeader, data, copyLen);
            _beginHeader[copyLen] = '\0';
            _beginRequested = true;
            return;
        }
        if (_inProgress && header == "OTA:END") { _endRequested = true; return; }
        if (_inProgress && header == "OTA:ABORT") { _abortRequested = true; return; }
        if (!_inProgress) { _notifyStatus("ERROR", "bad-command"); return; }
    }

    if (!_inProgress) { _notifyStatus("ERROR", "not-started"); return; }
    if (len > OTA_MAX_CHUNK_SIZE) { _cancel("bad-chunk"); return; }
    if (!_queuePush(data, len)) { _abortRequested = true; _notifyStatus("ERROR", "queue-full"); }
}

void SeekBCI_OTA::_beginUpdate(const char* header) {
    if (_inProgress) { _cancel("busy"); return; }

    String h = String(header);
    int sizeStart = h.indexOf(':', 10); // after "OTA:BEGIN:"
    int md5Start = (sizeStart >= 0) ? h.indexOf(':', sizeStart + 1) : -1;
    if (sizeStart < 0 || md5Start < 0) { _notifyStatus("ERROR", "bad-begin"); return; }

    size_t fwSize = (size_t)h.substring(sizeStart + 1, md5Start).toInt();
    if (fwSize == 0) { _notifyStatus("ERROR", "bad-size"); return; }
    if (fwSize > ESP.getFreeSketchSpace()) { _notifyStatus("ERROR", "no-space"); return; }

    _partition = esp_ota_get_next_update_partition(NULL);
    if (!_partition) { _notifyStatus("ERROR", "no-partition"); return; }
    if (fwSize > _partition->size) { _notifyStatus("ERROR", "partition-small"); return; }

    esp_err_t err = esp_ota_begin(_partition, OTA_WITH_SEQUENTIAL_WRITES, &_handle);
    if (err != ESP_OK) { _notifyStatus("ERROR", "begin-failed"); _partition = nullptr; return; }

    _handleActive = true;
    _inProgress = true;
    _expectedSize = fwSize;
    _writtenSize = 0;
    _lastPercent = 255;
    _endRequested = false;
    _abortRequested = false;
    _queueReset();

    char detail[16];
    snprintf(detail, sizeof(detail), "%u", (unsigned)fwSize);
    _notifyStatus("READY", detail);
}

void SeekBCI_OTA::_finishUpdate() {
    if (!_inProgress) { _notifyStatus("ERROR", "not-started"); return; }
    if (_writtenSize != _expectedSize) { _cancel("size-mismatch"); return; }

    esp_err_t err = esp_ota_end(_handle);
    _handleActive = false; _handle = 0;
    if (err != ESP_OK) { _cancel("end-failed"); return; }

    err = esp_ota_set_boot_partition(_partition);
    if (err != ESP_OK) { _cancel("activate-failed"); return; }

    _partition = nullptr;
    _inProgress = false;
    _notifyStatus("DONE", "rebooting");
    _rebootPending = true;
    _rebootAt = millis() + 1200;
}

void SeekBCI_OTA::processLoop() {
    if (_rebootPending && millis() >= _rebootAt) { ESP.restart(); }

    if (_beginRequested && !_inProgress) {
        _beginRequested = false;
        _beginUpdate(_beginHeader);
        _beginHeader[0] = '\0';
    }

    if (!_inProgress) return;
    if (_abortRequested) { _cancel("aborted"); return; }

    ota_chunk_t chunk;
    if (_queuePop(&chunk)) {
        if (_writtenSize + chunk.size > _expectedSize) { _cancel("size-overflow"); return; }

        size_t prevPct = (_writtenSize * 100UL) / _expectedSize;
        esp_err_t err = esp_ota_write(_handle, chunk.data, chunk.size);
        if (err != ESP_OK) { _cancel("write-failed"); return; }

        _writtenSize += chunk.size;
        size_t curPct = (_writtenSize * 100UL) / _expectedSize;
        if (curPct != prevPct || _writtenSize == _expectedSize) {
            if (curPct >= 100 || _lastPercent == 255 || curPct >= (size_t)_lastPercent + 2) {
                _lastPercent = (uint8_t)curPct;
                _notifyProgress();
            }
        }
    }

    if (_endRequested && _qCount == 0) { _finishUpdate(); }
}
