"""
设备连接管理模块
支持LSL、串口、WiFi、BrainFlow四种连接方式
"""
import asyncio
import json
import threading
from typing import Optional, Dict, List
from datetime import datetime
import numpy as np
# LSL相关
try:
    from pylsl import StreamInlet, resolve_streams, resolve_byprop
    LSL_AVAILABLE = True
except ImportError:
    LSL_AVAILABLE = False

# 串口相关
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

# BrainFlow相关
try:
    from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
    from brainflow.data_filter import DataFilter
    BRAINFLOW_AVAILABLE = True
except ImportError:
    BRAINFLOW_AVAILABLE = False

# WiFi相关
import socket

from app.services.signal_processor import signal_processor


class DeviceManager:
    """设备管理器"""
    
    def __init__(self):
        self.device_type = None
        self.device_info = {}
        self.is_connected = False
        self.data_buffer = []
        self.inlet = None  # LSL inlet
        self.serial_port = None  # 串口对象
        self.socket = None  # WiFi socket
        self.board = None  # BrainFlow board
        self.board_id = None  # BrainFlow board ID
        self.sampling_rate = 250
        self.channel_count = 8
        self.enable_signal_processing = True  # data_display 用 OpenBCI 显示滤波；试次 data 始终原始
        self.last_error = None
        # LSL：流端关闭后 pull 常返回空而不抛错，用连续空读检测断开
        self._lsl_empty_streak = 0
        self._lsl_got_first_sample = False

        # SSVEP：与 lsl_received_data.py 一致，在「start-*」与「end」之间累积原始采样（由 API 标记边界）
        self._trial_lock = threading.Lock()
        self._trial_segment_active = False
        self._trial_segment_samples: List[List[float]] = []

    def _sync_display_processor(self):
        """连接后同步显示用滤波器采样率并清空滚动缓冲（对齐 OpenBCI 显示链）"""
        try:
            signal_processor.set_sampling_rate(self.sampling_rate)
            signal_processor.reset_display_buffer()
        except Exception as e:
            print(f"[SignalProcessor] sync failed: {e}")

    def _mark_connection_lost(self, reason: str):
        """底层流中断时统一标记离线状态。"""
        self.last_error = reason
        self.is_connected = False
        if self.device_type == 'lsl':
            self.inlet = None
            self._lsl_empty_streak = 0
            self._lsl_got_first_sample = False
        print(f"连接已中断: {reason}")
        
    # ==================== LSL连接 ====================
    
    def scan_lsl_devices(self) -> List[Dict]:
        """扫描LSL设备"""
        if not LSL_AVAILABLE:
            print("警告: pylsl未安装，LSL功能不可用")
            return []
        
        try:
            print("正在扫描LSL设备...")
            # pylsl 1.18+ 使用 wait_time 参数；旧版本通常支持 timeout 或位置参数
            try:
                streams = resolve_streams(wait_time=5.0)
            except TypeError:
                # 回退：兼容旧 API
                streams = resolve_streams(5.0)
            
            devices = []
            for stream in streams:
                info = {
                    'name': stream.name(),
                    'type': stream.type(),
                    'channel_count': stream.channel_count(),
                    'sampling_rate': stream.nominal_srate(),
                    'source_id': stream.source_id()
                }
                devices.append(info)
                print(f"发现设备: {info['name']}")
            
            return devices
        except Exception as e:
            print(f"扫描LSL设备失败: {e}")
            return []
    
    def connect_lsl(self, stream_name: str, stream_type: str = 'EEG') -> bool:
        """连接LSL设备"""
        if not LSL_AVAILABLE:
            return False
        
        try:
            print(f"正在连接LSL设备: {stream_name}")

            if self.inlet is not None:
                try:
                    self.inlet.close_stream()
                except Exception:
                    pass
                self.inlet = None

            # 查找流
            streams = resolve_byprop('name', stream_name, timeout=5.0)
            if not streams:
                print(f"未找到LSL流: {stream_name}")
                return False
            
            # 创建inlet
            self.inlet = StreamInlet(streams[0])
            
            # 获取设备信息
            info = self.inlet.info()
            self.device_type = 'lsl'
            self.device_info = {
                'name': info.name(),
                'type': info.type(),
                'channel_count': info.channel_count(),
                'sampling_rate': info.nominal_srate(),
                'source_id': info.source_id(),
            }
            self.channel_count = info.channel_count()
            sr = float(info.nominal_srate() or 0)
            self.sampling_rate = sr if sr > 0 else 250.0
            self.is_connected = True
            self.last_error = None
            self._lsl_empty_streak = 0
            self._lsl_got_first_sample = False
            self._sync_display_processor()
            
            print(f"LSL设备连接成功: {self.device_info}")
            return True
            
        except Exception as e:
            print(f"连接LSL设备失败: {e}")
            return False

    def trial_segment_start(self) -> None:
        """
        对齐 Psychopy queue.put(\"start-1\")：自下一次 read_data 起累积样本直至 trial_segment_stop。
        LSL 时 flush  inlet，减少缓冲区内陈旧采样混入试次开头。
        """
        with self._trial_lock:
            self._trial_segment_samples = []
            self._trial_segment_active = True
        if self.device_type == "lsl" and self.inlet is not None:
            try:
                self.inlet.flush()
            except Exception:
                pass

    def trial_segment_cancel(self) -> None:
        """丢弃当前试次缓冲（停止测试或超时）。"""
        with self._trial_lock:
            self._trial_segment_active = False
            self._trial_segment_samples = []

    def trial_segment_stop(self) -> List[List[float]]:
        """结束累积并取出试次数据 (n_samples, n_channels)，对齐 queue.put(\"end\") 后的 CSV。"""
        with self._trial_lock:
            self._trial_segment_active = False
            out = [list(row) for row in self._trial_segment_samples]
            self._trial_segment_samples = []
        return out

    def _append_trial_segment_if_active(self, raw_data: Optional[np.ndarray]) -> None:
        if raw_data is None or raw_data.size == 0:
            return
        cap = max(5000, int(self.sampling_rate * 35) + 2000)
        with self._trial_lock:
            if not self._trial_segment_active:
                return
            self._trial_segment_samples.extend(raw_data.tolist())
            if len(self._trial_segment_samples) > cap:
                self._trial_segment_samples = self._trial_segment_samples[-cap:]
    
    def read_lsl_data(self, duration: float = 1.0) -> Optional[np.ndarray]:
        """读取LSL数据"""
        if not self.is_connected or self.device_type != 'lsl':
            return None
        
        try:
            num_samples = max(1, int(self.sampling_rate * duration))
            # 单次阻塞不宜过长，否则流关闭后 UI 长时间不更新（WS 常用 duration≈0.1）
            chunk_timeout = min(0.35, max(0.06, float(duration) * 2.2))

            # 优先整块拉取（适合 WS 高频小窗口）
            if self.inlet is not None and hasattr(self.inlet, "pull_chunk"):
                chunk, _ts = self.inlet.pull_chunk(
                    max_samples=num_samples, timeout=chunk_timeout
                )
                if chunk is not None and len(chunk) > 0:
                    self._lsl_empty_streak = 0
                    self._lsl_got_first_sample = True
                    return np.array(chunk)

                self._lsl_empty_streak += 1
                # 首包前多容忍空读（多 WebSocket / 慢启动流）
                cap = 200 if not self._lsl_got_first_sample else 12
                if self._lsl_empty_streak >= cap:
                    self._mark_connection_lost("LSL流无数据（流源可能已关闭）")
                return None

            samples = []
            per_timeout = min(0.35, max(0.05, float(duration) / max(num_samples, 1) * 4.0))
            for _ in range(num_samples):
                sample, timestamp = self.inlet.pull_sample(timeout=per_timeout)
                if sample:
                    samples.append(sample)

            if samples:
                self._lsl_empty_streak = 0
                self._lsl_got_first_sample = True
                return np.array(samples)

            self._lsl_empty_streak += 1
            cap = 200 if not self._lsl_got_first_sample else 12
            if self._lsl_empty_streak >= cap:
                self._mark_connection_lost("LSL流无数据（流源可能已关闭）")
            return None
            
        except Exception as e:
            err = str(e)
            print(f"读取LSL数据失败: {err}")
            # 发流端关闭后常见 "Input stream error"/"stream transmission broke off"。
            # 为避免前端状态长时间滞后，LSL读取出现异常时统一标记离线。
            self._mark_connection_lost(err)
            return None
    
    # ==================== 串口连接 ====================
    
    def scan_serial_ports(self) -> List[Dict]:
        """扫描串口设备"""
        if not SERIAL_AVAILABLE:
            return []
        
        try:
            ports = serial.tools.list_ports.comports()
            devices = []
            
            for port in ports:
                info = {
                    'port': port.device,
                    'description': port.description,
                    'hwid': port.hwid,
                    'manufacturer': port.manufacturer or 'Unknown'
                }
                devices.append(info)
                print(f"发现串口: {port.device} - {port.description}")
            
            return devices
        except Exception as e:
            print(f"扫描串口失败: {e}")
            return []
    
    def connect_serial(self, port: str, baudrate: int = 115200) -> bool:
        """连接串口设备"""
        if not SERIAL_AVAILABLE:
            return False
        
        try:
            print(f"正在连接串口: {port} @ {baudrate}")
            
            self.serial_port = serial.Serial(
                port=port,
                baudrate=baudrate,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=1.0
            )
            
            # 等待串口稳定
            import time
            time.sleep(1)
            
            # 发送 'b' 命令启动设备（OpenBCI 协议）
            print("发送启动命令 'b' 到设备...")
            self.serial_port.write(b'b')
            self.serial_port.flush()
            
            # 等待设备响应
            time.sleep(0.5)
            
            # 清空缓冲区
            self.serial_port.reset_input_buffer()
            
            self.device_type = 'serial'
            self.device_info = {
                'port': port,
                'baudrate': baudrate,
                'started': True
            }
            self.is_connected = True
            self._sync_display_processor()
            
            print(f"串口连接成功并已启动设备: {port}")
            return True
            
        except Exception as e:
            print(f"连接串口失败: {e}")
            if self.serial_port:
                try:
                    self.serial_port.close()
                except:
                    pass
                self.serial_port = None
            return False
    
    def read_serial_data(self, duration: float = 1.0) -> Optional[np.ndarray]:
        """读取串口数据（在 duration 时间窗内尽量多收样本，避免空转 num_samples 次仍无数据）"""
        if not self.is_connected or self.device_type != 'serial':
            return None

        try:
            import time

            samples = []
            deadline = time.monotonic() + max(0.05, float(duration))

            while time.monotonic() < deadline:
                if self.serial_port.in_waiting:
                    line = self.serial_port.readline().decode('utf-8', errors='ignore').strip()
                    if not line:
                        continue
                    values = [float(x) for x in line.split(',')]
                    if len(values) == self.channel_count:
                        samples.append(values)
                else:
                    time.sleep(0.002)

            if samples:
                return np.array(samples)
            return None

        except Exception as e:
            print(f"读取串口数据失败: {e}")
            return None
    
    # ==================== WiFi连接 ====================
    
    def connect_wifi(self, ip: str, port: int, protocol: str = 'tcp') -> bool:
        """连接WiFi设备"""
        try:
            print(f"正在连接WiFi设备: {ip}:{port} ({protocol.upper()})")
            
            if protocol.lower() == 'tcp':
                self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.socket.connect((ip, port))
            else:  # UDP
                self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.socket.bind(('', port))
            
            self.device_type = 'wifi'
            self.device_info = {
                'ip': ip,
                'port': port,
                'protocol': protocol
            }
            self.is_connected = True
            self._sync_display_processor()
            
            print(f"WiFi设备连接成功: {ip}:{port}")
            return True
            
        except Exception as e:
            print(f"连接WiFi设备失败: {e}")
            return False
    
    def read_wifi_data(self, duration: float = 1.0) -> Optional[np.ndarray]:
        """读取WiFi数据"""
        if not self.is_connected or self.device_type != 'wifi':
            return None
        
        try:
            samples = []
            num_samples = int(self.sampling_rate * duration)
            
            for _ in range(num_samples):
                data = self.socket.recv(1024).decode('utf-8').strip()
                # 假设数据格式为JSON: {"channels": [ch1, ch2, ..., ch8]}
                try:
                    json_data = json.loads(data)
                    values = json_data.get('channels', [])
                    if len(values) == self.channel_count:
                        samples.append(values)
                except json.JSONDecodeError:
                    # 尝试CSV格式
                    values = [float(x) for x in data.split(',')]
                    if len(values) == self.channel_count:
                        samples.append(values)
            
            if samples:
                return np.array(samples)
            return None
            
        except Exception as e:
            print(f"读取WiFi数据失败: {e}")
            return None
    
    # ==================== BrainFlow连接 ====================
    
    def list_brainflow_boards(self) -> List[Dict]:
        """列出支持的BrainFlow设备"""
        if not BRAINFLOW_AVAILABLE:
            return []
        
        # 常用的设备列表
        boards = [
            {'id': BoardIds.CYTON_BOARD.value, 'name': 'OpenBCI Cyton', 'channels': 8},
            {'id': BoardIds.CYTON_DAISY_BOARD.value, 'name': 'OpenBCI Cyton+Daisy', 'channels': 16},
            {'id': BoardIds.GANGLION_BOARD.value, 'name': 'OpenBCI Ganglion', 'channels': 4},
            {'id': BoardIds.SYNTHETIC_BOARD.value, 'name': 'Synthetic Board (测试)', 'channels': 8},
        ]
        return boards
    
    def connect_brainflow(self, board_id: int, serial_port: str = None) -> bool:
        """
        连接BrainFlow设备
        
        Args:
            board_id: 设备ID (BoardIds枚举值)
            serial_port: 串口号 (如果需要)
        """
        if not BRAINFLOW_AVAILABLE:
            print("警告: brainflow未安装")
            return False
        
        try:
            print(f"正在连接BrainFlow设备: board_id={board_id}, port={serial_port}")
            
            # 配置参数
            params = BrainFlowInputParams()
            if serial_port:
                params.serial_port = serial_port
            
            # 创建board
            self.board = BoardShim(board_id, params)
            self.board_id = board_id
            
            # 准备会话
            self.board.prepare_session()
            
            # 开始数据流
            self.board.start_stream()
            
            # 获取设备信息
            self.sampling_rate = BoardShim.get_sampling_rate(board_id)
            eeg_channels = BoardShim.get_eeg_channels(board_id)
            self.channel_count = len(eeg_channels)
            
            self.device_type = 'brainflow'
            self.device_info = {
                'board_id': board_id,
                'board_name': BoardShim.get_board_descr(board_id)['name'],
                'sampling_rate': self.sampling_rate,
                'channel_count': self.channel_count,
                'eeg_channels': eeg_channels,
                'serial_port': serial_port
            }
            self.is_connected = True
            self._sync_display_processor()
            
            print(f"BrainFlow设备连接成功: {self.device_info}")
            return True
            
        except Exception as e:
            print(f"连接BrainFlow设备失败: {e}")
            if self.board:
                try:
                    self.board.release_session()
                except:
                    pass
            return False
    
    def read_brainflow_data(self, duration: float = 1.0) -> Optional[np.ndarray]:
        """读取BrainFlow数据"""
        if not self.is_connected or self.device_type != 'brainflow':
            return None
        
        try:
            # 计算需要读取的样本数
            num_samples = int(self.sampling_rate * duration)
            
            # 获取数据
            data = self.board.get_current_board_data(num_samples)
            
            # 提取EEG通道
            eeg_channels = BoardShim.get_eeg_channels(self.board_id)
            eeg_data = data[eeg_channels, :].T  # 转置为 (samples, channels)
            
            if eeg_data.shape[0] > 0:
                return eeg_data
            return None
            
        except Exception as e:
            print(f"读取BrainFlow数据失败: {e}")
            return None
    
    # ==================== 通用方法 ====================
    
    def read_data(self, duration: float = 1.0) -> Optional[np.ndarray]:
        """读取数据（自动选择方法）"""
        if not self.is_connected:
            return None
        
        # 读取原始数据
        raw_data = None
        if self.device_type == 'lsl':
            raw_data = self.read_lsl_data(duration)
        elif self.device_type == 'serial':
            raw_data = self.read_serial_data(duration)
        elif self.device_type == 'wifi':
            raw_data = self.read_wifi_data(duration)
        elif self.device_type == 'brainflow':
            raw_data = self.read_brainflow_data(duration)
        
        self._append_trial_segment_if_active(raw_data)

        # 带通/去趋势仅用于前端波形绘制（见 devices WebSocket 的 data_display），此处始终返回原始采样
        return raw_data
    
    def disconnect(self):
        """断开设备连接"""
        err = None
        try:
            if self.device_type == 'lsl' and self.inlet:
                self.inlet.close_stream()
                self.inlet = None
            elif self.device_type == 'serial' and self.serial_port:
                # 发送 's' 命令停止设备（OpenBCI 协议）
                try:
                    print("发送停止命令 's' 到设备...")
                    self.serial_port.write(b's')
                    self.serial_port.flush()
                    import time
                    time.sleep(0.5)
                except:
                    pass
                self.serial_port.close()
                self.serial_port = None
            elif self.device_type == 'wifi' and self.socket:
                self.socket.close()
                self.socket = None
            elif self.device_type == 'brainflow' and self.board:
                self.board.stop_stream()
                self.board.release_session()
                self.board = None
                self.board_id = None

        except Exception as e:
            err = str(e)
            print(f"断开设备失败: {err}")
        finally:
            # 无论底层关闭是否报错，都将逻辑状态置为已断开，
            # 避免前端状态栏长期显示“已连接”。
            self.is_connected = False
            self.device_type = None
            self.device_info = {}
            self.last_error = err
            self._lsl_empty_streak = 0
            self._lsl_got_first_sample = False
            self.trial_segment_cancel()
            try:
                signal_processor.reset_display_buffer()
            except Exception:
                pass
            print("设备已断开")
    
    def get_status(self) -> Dict:
        """获取设备状态"""
        return {
            'connected': self.is_connected,
            'device_type': self.device_type,
            'device_info': self.device_info,
            'sampling_rate': self.sampling_rate,
            'channel_count': self.channel_count,
            'last_error': self.last_error,
        }


# 全局设备管理器实例
device_manager = DeviceManager()
