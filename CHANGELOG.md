# 修改日志

本文档记录 SSVEP 平台与参考工程（Psychopy `9_cca_withoutvideo.py` / `lsl_received_data.py` / `fbcca.py`）对齐及测试体验相关的主要进度。

## [未发布] — 2026-05-03

### 四圆球实时解码（网页）

- **`POST /api/ssvep/fbcca/decode_window`**：`band`（`low`/`high`）+ `preset_index` 指定 4 个刺激频率；**0.8 s** 窗 FBCCA，返回各频 **score** 与 **softmax 概率**、`ranked_by_probability`。
- **`fbcca_classify.py`**：`get_reference_signal_for_freqs`、`fbcca_classify_multi`、`decode_window_fbcca`；短序列滤波使用受限 `padlen` 的 `filtfilt`。
- **`test-stimulus.html` / `test-stimulus.js`**（**刺激参数测试**页）：「测试类型」中选「四圆球 + EEG 实时解码」；频段单选、三套预设、四圆球闪烁；**每 0.3 s** 刷新柱状图与排序；与单目标闪烁模式互斥。**不在** `ssvep-test.html`（准确度测试页）。

### FBCCA 与数据管线

- **后端** `python_backend/app/services/fbcca_classify.py`：`prepare_like_reference` 取试次末尾至多 4 s 并重采样至 1000 点；`CCA` 使用 `scale=False` 以贴近旧版 `fbcca.py`；`classify_from_trial_samples` 默认 **`trim_head_sec=0`**，与参考脚本「直接取 CSV 末尾 4×250 段」一致（此前默认 0.25 s 会削弱与参考的一致性）。
- **API** `python_backend/app/api/ssvep.py`：`POST /api/ssvep/fbcca/classify`；**`POST /api/ssvep/fbcca/classify_captured`** — 结束服务端试次切段并分类，响应含 `captured_sample_count` 等。

### 设备与试次边界（对齐 `start-*` / `end` 语义）

- **后端** `python_backend/app/services/device_manager.py`：试次切段缓冲（线程安全）、`trial_segment_start`（LSL 时 **`inlet.flush()`**）、`trial_segment_cancel` / `trial_segment_stop`；在 **`read_data`** 返回前把原始采样追加到切段缓冲。
- **API** `python_backend/app/api/devices.py`：**`POST /api/devices/trial_segment/start`**、**`POST /api/devices/trial_segment/cancel`**。
- **说明**：切段数据依赖 FastAPI 侧设备读循环（如 WebSocket）；需设备已连接且数据流在读。

### Web 端 SSVEP 测试

- **`web_frontend/ssvep-test.js` / `ssvep-test.html`**：
  - 刺激相位：**`frameN = floor(t × 60)`**，与 `sin(2πf·frameN/60+φ)` 的 60 Hz 离散帧一致（避免高刷屏下 `requestAnimationFrame` 逐帧加一破坏频率）。
  - 目标顺序：与参考 **`loop_id` 递增** 一致，按 **0→7（8～15 Hz）循环**，非随机。
  - **提示阶段**：倒计时前即 **`drawStaticCue`**（静态灰块 + 频率标签 + 青色注视框）；倒计时改为顶部 **`countdown-overlay-bar`**，不遮挡画布。
  - 默认 **提示时长 1 s**（与 Psychopy cue 1 s 接近）；已连接设备时：**`trial_segment/start`** 在刺激开始前调用；识别优先 **`classify_captured`**，失败回退前端缓冲 + `/fbcca/classify`；停止/完成时 **`trial_segment/cancel`**。
- **信号路径**：设备 **`data`** 为原始采样；波形展示可用 **`data_display`**（滤波可选）。

### 桌面端准确度测试（tkinter + pylsl）

- **`python_backend/desktop/ssvep_accuracy_tk.py`**：
  - LSL：**`deque(maxlen)` + 后台 `pull_chunk`**；试次顺序 **0→7** 循环；提示阶段 **`_draw_static_cue`**；闪烁 **`frame_n = int(elapsed × 60)`**。
  - **试次开始**：`raw_buf.clear()` 后对 **`inlet.flush()`**。
  - **分类前**：仅保留约 **`trial_s × sampling_rate`** 个样本（从头截取），避免 deque 混入刺激结束后的数据导致「末 4 s」窗口污染；过长时在日志中提示截断。
  - 调用 **`classify_from_trial_samples(..., trim_head_sec=0.0)`**。

### 参考与脚本

- **`reference/ssevp/fbcca.py`**：仓库内保留与原始 `fbcca.py` 对照副本。
- **`python_backend/scripts/ssvep_psychopy_stimulus.py`**：可选独立 Psychopy/全屏闪烁说明仍在文档或页面提示中。

---

更新时可延续 `[未发布]` 或改为版本号小节；重大行为变更建议在条目中标明「破坏性变更」。
