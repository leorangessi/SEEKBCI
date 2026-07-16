/// EEG通道标签常量
class ChannelLabels {
  static const List<String> labels8Channel = [
    "PO7",
    "PO3",
    "O1",
    "POz",
    "Oz",
    "PO4",
    "O2",
    "PO8",
  ];
  
  static const int channelCount = 8;
  
  /// 信号质量阈值（微伏）
  static const double qualityThreshold = 80.0;
  
  /// 采样率
  static const int samplingRate = 250;
  
  /// 带通滤波器范围
  static const double filterLowCutoff = 5.0;
  static const double filterHighCutoff = 50.0;
}
