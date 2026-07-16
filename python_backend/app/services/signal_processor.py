"""
信号处理模块
- data_display：流式 IIR（5–50 Hz 带通 + 50/60 Hz 陷波），避免 filtfilt 重算滚动窗造成尖峰/偏移
- process()：离线试次等用途（去趋势 + 带通）
"""
import numpy as np
from scipy import signal
from scipy.signal import butter, detrend, iirnotch, sosfilt, sosfilt_zi, tf2sos


class SignalProcessor:
    """显示链：Butterworth 4 阶 5–50 Hz + 50/60 Hz 陷波（流式，对齐 GUI 时序波形幅度）。"""

    def __init__(self, sampling_rate=250):
        self.sampling_rate = sampling_rate
        self.lowcut = 5.0
        self.highcut = 50.0
        self.filter_order = 4
        self.notch_q = 30.0
        self._sos_bp = None
        self._sos_n50 = None
        self._sos_n60 = None
        self._zi_bp = None
        self._zi_n50 = None
        self._zi_n60 = None
        self._stream_n_channels = 0
        self._rebuild_filters()

    def _rebuild_filters(self):
        sr = max(1.0, float(self.sampling_rate))
        nyquist = 0.5 * sr
        low = self.lowcut / nyquist
        high = min(0.99, self.highcut / nyquist)
        self._sos_bp = butter(self.filter_order, [low, high], btype="band", output="sos")
        b50, a50 = iirnotch(50.0, self.notch_q, sr)
        b60, a60 = iirnotch(60.0, self.notch_q, sr)
        self._sos_n50 = tf2sos(b50, a50)
        self._sos_n60 = tf2sos(b60, a60)

    def _min_samples_for_filtfilt(self):
        if self._sos_bp is None:
            self._rebuild_filters()
        return 3 * (self._sos_bp.shape[0] + 2)

    def _reset_stream_states(self, n_channels: int):
        n = max(1, int(n_channels))
        self._stream_n_channels = n
        self._zi_bp = np.zeros((self._sos_bp.shape[0], 2, n))
        self._zi_n50 = np.zeros((self._sos_n50.shape[0], 2, n))
        self._zi_n60 = np.zeros((self._sos_n60.shape[0], 2, n))
        for c in range(n):
            self._zi_bp[:, :, c] = sosfilt_zi(self._sos_bp)
            self._zi_n50[:, :, c] = sosfilt_zi(self._sos_n50)
            self._zi_n60[:, :, c] = sosfilt_zi(self._sos_n60)

    def _warmup_stream_states(self, n_channels: int):
        """用零输入预热滤波器状态，减轻连接后首包尖峰。"""
        n = max(1, int(n_channels))
        self._reset_stream_states(n)
        warm_n = max(64, int(self.sampling_rate * 0.4))
        zeros = np.zeros((warm_n, n), dtype=np.float64)
        self._filter_chunk_streaming(zeros)

    def _ensure_stream_states(self, n_channels: int):
        n = max(1, int(n_channels))
        if self._zi_bp is None or self._stream_n_channels != n:
            self._warmup_stream_states(n)

    def _filter_chunk_streaming(self, arr: np.ndarray) -> np.ndarray:
        """仅处理本块样本，保持跨包滤波状态（与 OpenBCI 连续时序一致）。"""
        out = np.asarray(arr, dtype=np.float64)
        if out.ndim == 1:
            out = out.reshape(-1, 1)
        n_ch = out.shape[1]
        self._ensure_stream_states(n_ch)

        for c in range(n_ch):
            x = out[:, c]
            x, self._zi_bp[:, :, c] = sosfilt(self._sos_bp, x, zi=self._zi_bp[:, :, c])
            x, self._zi_n50[:, :, c] = sosfilt(self._sos_n50, x, zi=self._zi_n50[:, :, c])
            x, self._zi_n60[:, :, c] = sosfilt(self._sos_n60, x, zi=self._zi_n60[:, :, c])
            out[:, c] = x
        return out

    def _apply_chain_1d_filtfilt(self, x):
        min_len = self._min_samples_for_filtfilt()
        if len(x) <= min_len:
            return x
        y = signal.sosfiltfilt(self._sos_bp, x)
        y = signal.sosfiltfilt(self._sos_n50, y)
        y = signal.sosfiltfilt(self._sos_n60, y)
        return y

    def detrend_signal(self, data):
        if data.ndim == 1:
            return detrend(data)
        return np.apply_along_axis(detrend, 0, data)

    def openbci_display_filter(self, data):
        """整段零相位滤波（离线/调试）；实时 WS 请用 append_and_process_display。"""
        if data is None or len(data) == 0:
            return data
        min_len = self._min_samples_for_filtfilt()
        if data.ndim == 1:
            if len(data) <= min_len:
                return data
            return self._apply_chain_1d_filtfilt(np.asarray(data, dtype=np.float64))
        if data.shape[0] <= min_len:
            return data
        out = np.zeros_like(data, dtype=np.float64)
        for ch in range(data.shape[1]):
            out[:, ch] = self._apply_chain_1d_filtfilt(data[:, ch])
        return out

    def bandpass_filter(self, data):
        min_len = self._min_samples_for_filtfilt()
        if data.ndim == 1:
            if len(data) <= min_len:
                return data
            return signal.sosfiltfilt(self._sos_bp, data)
        if data.shape[0] <= min_len:
            return data
        out = np.zeros_like(data)
        for ch in range(data.shape[1]):
            out[:, ch] = signal.sosfiltfilt(self._sos_bp, data[:, ch])
        return out

    def process(self, data):
        if data is None or len(data) == 0:
            return data
        n_samples = len(data) if data.ndim == 1 else data.shape[0]
        if n_samples <= self._min_samples_for_filtfilt():
            return data
        detrended = self.detrend_signal(data)
        return self.bandpass_filter(detrended)

    def process_display(self, data):
        return self.openbci_display_filter(data)

    def set_sampling_rate(self, sampling_rate):
        sr = int(sampling_rate) if sampling_rate else 250
        if sr == self.sampling_rate and self._sos_bp is not None:
            return
        self.sampling_rate = sr
        self._rebuild_filters()
        self.reset_display_buffer()

    def append_and_process_display(self, data):
        """
        流式滤波：每包只处理新样本，避免对滚动缓冲反复 filtfilt 导致 CH3 等通道尖峰/漂移。
        """
        if data is None:
            return data
        arr = np.asarray(data, dtype=np.float64)
        if arr.size == 0:
            return arr
        if arr.ndim == 1:
            arr = arr.reshape(-1, 1)
        return self._filter_chunk_streaming(arr)

    def reset_display_buffer(self):
        self._zi_bp = None
        self._zi_n50 = None
        self._zi_n60 = None
        self._stream_n_channels = 0

    def process_realtime(self, data, buffer_size=1000):
        if len(data) > buffer_size:
            data = data[-buffer_size:]
        return self.process(data)

    def calculate_psd(self, data, nperseg=256):
        if data.ndim == 1:
            freqs, psd = signal.welch(data, self.sampling_rate, nperseg=nperseg)
            return freqs, psd
        psd_list = []
        for ch in range(data.shape[1]):
            freqs, psd_ch = signal.welch(data[:, ch], self.sampling_rate, nperseg=nperseg)
            psd_list.append(psd_ch)
        return freqs, np.array(psd_list).T

    def extract_frequency_power(self, data, target_freq, bandwidth=1.0):
        freqs, psd = self.calculate_psd(data)
        freq_mask = (freqs >= target_freq - bandwidth / 2) & (freqs <= target_freq + bandwidth / 2)
        if data.ndim == 1:
            return np.mean(psd[freq_mask])
        return np.mean(psd[freq_mask, :], axis=0)


signal_processor = SignalProcessor(sampling_rate=250)
