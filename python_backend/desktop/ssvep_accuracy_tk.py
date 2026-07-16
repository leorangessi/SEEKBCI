#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SSVEP 准确度测试 — 纯 Python 桌面版（tkinter + pylsl + 本仓库 FBCCA）。

与 9_cca_withoutvideo 一致：闪烁相位用 sin(2π f·frameN/60+Phas)，frameN=floor(t×60)（与 60Hz 离散帧同步，避免定时器漂移）。
LSL 用 deque(maxlen) 缓冲 pull_chunk，避免 list 头删导致长时间运行卡死、准确率掉到 0%。
试次内直连 LSL，不经 FastAPI；分类用原始采样。

运行（在 python_backend 目录下）:
    python desktop/ssvep_accuracy_tk.py

依赖: pylsl, numpy, scipy, scikit-learn（见 requirements.txt）
"""
from __future__ import annotations

import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Deque, List, Optional, Tuple

import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

try:
    import tkinter as tk
    from tkinter import messagebox, ttk
except ImportError as e:
    raise SystemExit("需要 tkinter（标准库，一般随 Python 安装）") from e

try:
    from pylsl import StreamInlet, resolve_streams
except ImportError as e:
    raise SystemExit("请安装 pylsl: pip install pylsl") from e

from app.services.fbcca_classify import classify_from_trial_samples

# 与 web_frontend/ssvep-test.js 中 TEST_CONFIG 一致
FREQS = [8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0]
PHASES = [0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.0]
LABELS = ["左上", "右上", "左下", "右下", "上中", "下中", "左中", "右中"]
POSITIONS = [
    (0.25, 0.25),
    (0.75, 0.25),
    (0.25, 0.75),
    (0.75, 0.75),
    (0.5, 0.25),
    (0.5, 0.75),
    (0.25, 0.5),
    (0.75, 0.5),
]

CANVAS_W, CANVAS_H = 1200, 800
BLOCK = 120
# 与 9_cca_withoutvideo 中 frameN/60 一致
STIM_REF_HZ = 60.0


class LSLChunkReader(threading.Thread):
    """后台 pull_chunk；缓冲用 deque(maxlen)，禁止对 list 反复 del 头部（长时间会卡死、LSL 饿死）。"""

    def __init__(self, inlet: StreamInlet, buf: Deque[List[float]], lock: threading.Lock):
        super().__init__(daemon=True)
        self.inlet = inlet
        self.buf = buf
        self.lock = lock
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                chunk, _ts = self.inlet.pull_chunk(timeout=0.25, max_samples=256)
            except Exception:
                time.sleep(0.05)
                continue
            if not chunk:
                continue
            with self.lock:
                for row in chunk:
                    self.buf.append([float(x) for x in row])


class SSVEPAccuracyApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("SSVEP 准确度测试（Python 桌面版）")
        self.geometry("1280x920")

        self.inlet: Optional[StreamInlet] = None
        self.sampling_rate = 250.0
        self.n_channels = 8
        self.reader: Optional[LSLChunkReader] = None
        self.raw_buf: Deque[List[float]] = deque(maxlen=3500)
        self.buf_lock = threading.Lock()

        self._trial_running = False
        self._stim_start = 0.0
        self._target_index = 0
        self._after_id: Optional[str] = None

        self.results: List[Tuple[int, int, bool]] = []  # target_idx, pred_idx, correct

        self._build_ui()

    def _build_ui(self) -> None:
        top = ttk.Frame(self, padding=8)
        top.pack(fill=tk.X)

        ttk.Label(top, text="LSL 流名称（留空则选第一个 EEG 类型流）:").pack(side=tk.LEFT)
        self.stream_name = tk.StringVar(value="")
        ttk.Entry(top, textvariable=self.stream_name, width=28).pack(side=tk.LEFT, padx=4)

        ttk.Button(top, text="连接 LSL", command=self.connect_lsl).pack(side=tk.LEFT, padx=4)
        self.lbl_conn = ttk.Label(top, text="未连接", foreground="red")
        self.lbl_conn.pack(side=tk.LEFT, padx=8)

        cfg = ttk.Frame(self, padding=8)
        cfg.pack(fill=tk.X)
        ttk.Label(cfg, text="试次时长(s)").pack(side=tk.LEFT)
        self.var_trial = tk.StringVar(value="5")
        ttk.Spinbox(cfg, from_=3, to=15, textvariable=self.var_trial, width=5).pack(side=tk.LEFT, padx=4)
        ttk.Label(cfg, text="提示倒计时(s)").pack(side=tk.LEFT, padx=(12, 0))
        self.var_cue = tk.StringVar(value="1")
        ttk.Spinbox(cfg, from_=1, to=8, textvariable=self.var_cue, width=5).pack(side=tk.LEFT, padx=4)
        ttk.Label(cfg, text="每频率重复次数").pack(side=tk.LEFT, padx=(12, 0))
        self.var_rep = tk.StringVar(value="1")
        ttk.Spinbox(cfg, from_=1, to=10, textvariable=self.var_rep, width=5).pack(side=tk.LEFT, padx=4)

        self.btn_start = ttk.Button(cfg, text="开始一轮测试", command=self.start_round, state=tk.DISABLED)
        self.btn_start.pack(side=tk.LEFT, padx=12)

        self.lbl_status = ttk.Label(self, text="请先连接 LSL", font=("Segoe UI", 11))
        self.lbl_status.pack(pady=4)

        self.canvas = tk.Canvas(self, width=CANVAS_W, height=CANVAS_H, bg="black", highlightthickness=0)
        self.canvas.pack(padx=8, pady=4)

        self.txt = tk.Text(self, height=10, wrap=tk.WORD, font=("Consolas", 10))
        self.txt.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

    def log(self, s: str) -> None:
        self.txt.insert(tk.END, s + "\n")
        self.txt.see(tk.END)

    def connect_lsl(self) -> None:
        name = self.stream_name.get().strip()
        try:
            streams = resolve_streams(wait_time=4.0)
        except Exception as e:
            messagebox.showerror("LSL", f"解析流失败: {e}")
            return
        if not streams:
            messagebox.showwarning("LSL", "未发现任何 LSL 流")
            return

        chosen = None
        if name:
            for s in streams:
                if s.name() == name:
                    chosen = s
                    break
            if chosen is None:
                messagebox.showerror("LSL", f"未找到名为「{name}」的流")
                return
        else:
            for s in streams:
                if (s.type() or "").upper() == "EEG":
                    chosen = s
                    break
            chosen = chosen or streams[0]

        if self.reader:
            self.reader.stop()
            self.reader.join(timeout=1.0)

        self.inlet = StreamInlet(chosen)
        info = self.inlet.info()
        self.sampling_rate = float(info.nominal_srate()) or 250.0
        self.n_channels = int(info.channel_count())

        max_keep = int(self.sampling_rate * 12) + 500
        with self.buf_lock:
            self.raw_buf = deque(maxlen=max(2000, max_keep))
            self.raw_buf.clear()
        try:
            self.inlet.flush()
        except Exception:
            pass
        self.reader = LSLChunkReader(self.inlet, self.raw_buf, self.buf_lock)
        self.reader.start()

        self.lbl_conn.config(text=f"已连接: {info.name()}  {self.sampling_rate:.0f}Hz × {self.n_channels}ch", foreground="green")
        self.btn_start.config(state=tk.NORMAL)
        self.log(
            f"LSL 已连接: name={info.name()} type={info.type()} fs={self.sampling_rate} ch={self.n_channels}"
        )

    def start_round(self) -> None:
        if not self.reader or not self.inlet:
            messagebox.showwarning("", "请先连接 LSL")
            return
        try:
            trial_s = float(self.var_trial.get())
            cue_s = int(float(self.var_cue.get()))
            rep = int(float(self.var_rep.get()))
        except ValueError:
            messagebox.showerror("", "参数无效")
            return

        self.btn_start.config(state=tk.DISABLED)
        self.results.clear()
        self.txt.delete("1.0", tk.END)

        # 与 9_cca_withoutvideo.py 一致：每试次 loop_id+1，目标顺序 0→7 循环（非随机打乱）
        order: List[int] = []
        for _ in range(rep):
            order.extend(range(len(FREQS)))

        self._run_trials_async(order, trial_s, cue_s, 0)

    def _run_trials_async(self, order: List[int], trial_s: float, cue_s: int, idx: int) -> None:
        if idx >= len(order):
            self._finish_round()
            return
        self._target_index = order[idx]
        freq = FREQS[self._target_index]
        lab = LABELS[self._target_index]
        self.lbl_status.config(text=f"试次 {idx + 1}/{len(order)} — 下一目标 {freq} Hz ({lab})，请看倒计时")
        self.after(100, lambda: self._countdown_then_trial(cue_s, trial_s, order, idx))

    def _countdown_then_trial(self, cue_s: int, trial_s: float, order: List[int], idx: int) -> None:
        if cue_s > 0:
            self.lbl_status.config(text=f"准备：{cue_s} 秒后注视「{LABELS[self._target_index]}」{FREQS[self._target_index]} Hz")
            self._draw_static_cue(self._target_index)
            self.after(1000, lambda: self._countdown_then_trial(cue_s - 1, trial_s, order, idx))
            return

        with self.buf_lock:
            self.raw_buf.clear()
        # 对齐 Psychopy：标记试次开始后丢弃 LSL 积压，使首采样更接近闪烁起点
        try:
            if self.inlet is not None:
                self.inlet.flush()
        except Exception:
            pass
        self._trial_running = True
        self._stim_start = time.perf_counter()
        self.lbl_status.config(
            text=f"请注视青色边框方块：{FREQS[self._target_index]} Hz ({LABELS[self._target_index]})"
        )
        self._stim_tick(trial_s, order, idx)

    def _stim_tick(self, trial_s: float, order: List[int], idx: int) -> None:
        if not self._trial_running:
            return
        elapsed = time.perf_counter() - self._stim_start
        if elapsed >= float(trial_s):
            self._trial_running = False
            self._end_trial(trial_s, order, idx)
            return
        if elapsed > float(trial_s) + 2.0:
            self._trial_running = False
            self._end_trial(trial_s, order, idx)
            return
        frame_n = int(elapsed * STIM_REF_HZ)
        self._draw_stimulus(frame_n, self._target_index)
        self._after_id = self.after(16, lambda: self._stim_tick(trial_s, order, idx))

    def _draw_static_cue(self, target_index: int) -> None:
        """提示阶段：静态灰块 + 标签 + 青色注视框（与网页一致）。"""
        self.canvas.delete("all")
        for i, freq in enumerate(FREQS):
            nx, ny = POSITIONS[i]
            x1 = nx * CANVAS_W - BLOCK / 2
            y1 = ny * CANVAS_H - BLOCK / 2
            x2, y2 = x1 + BLOCK, y1 + BLOCK
            self.canvas.create_rectangle(x1, y1, x2, y2, fill="#808080", outline="")
            self.canvas.create_text(
                (x1 + x2) / 2, (y1 + y2) / 2, text=f"{freq:.0f} Hz", fill="white", font=("Segoe UI", 14, "bold")
            )
            if i == target_index:
                self.canvas.create_rectangle(x1 - 3, y1 - 3, x2 + 3, y2 + 3, outline="#00D9FF", width=4)

    def _draw_stimulus(self, frame_n: int, target_index: int) -> None:
        self.canvas.delete("all")
        for i, freq in enumerate(FREQS):
            nx, ny = POSITIONS[i]
            x1 = nx * CANVAS_W - BLOCK / 2
            y1 = ny * CANVAS_H - BLOCK / 2
            x2, y2 = x1 + BLOCK, y1 + BLOCK
            ph = PHASES[i]
            amp = (np.sin(2 * np.pi * freq * float(frame_n) / STIM_REF_HZ + ph) - 0.5) * 2.0
            g = int(np.clip((amp + 1) / 2 * 255, 0, 255))
            fill = f"#{g:02x}{g:02x}{g:02x}"
            self.canvas.create_rectangle(x1, y1, x2, y2, fill=fill, outline="")
            tc = "black" if g > 127 else "white"
            self.canvas.create_text(
                (x1 + x2) / 2, (y1 + y2) / 2, text=f"{freq:.0f} Hz", fill=tc, font=("Segoe UI", 14, "bold")
            )
            if i == target_index:
                self.canvas.create_rectangle(x1 - 3, y1 - 3, x2 + 3, y2 + 3, outline="#00D9FF", width=4)

    def _end_trial(self, trial_s: float, order: List[int], idx: int) -> None:
        self.canvas.delete("all")
        with self.buf_lock:
            snap = [list(row) for row in self.raw_buf]

        # 只保留「约一个试次时长」的样本（从缓冲清空后起算），避免 deque 里混入刺激结束后的数据；
        # 9_cca_withoutvideo 的 CSV 边界即 start～end，等价于固定长度窗口。
        n_expect = max(1, int(round(float(trial_s) * float(self.sampling_rate))))
        if len(snap) > n_expect:
            self.log(f"  试次 EEG 截断: {len(snap)} → {n_expect} 点（去掉刺激结束后 deque 溢出段）")
            snap = snap[:n_expect]

        need = int(self.sampling_rate * float(trial_s) * 0.65)
        if len(snap) < max(50, need):
            self.log(f"本试次数据过少 (n={len(snap)}, 期望≥{need})，可能 LSL 线程被拖慢或未收到数据，跳过")
            self.after(500, lambda: self._run_trials_async(order, trial_s, int(self.var_cue.get()), idx + 1))
            return

        arr = np.asarray(snap, dtype=np.float64)
        try:
            pred_class, _prep, scores = classify_from_trial_samples(
                arr, self.sampling_rate, trim_head_sec=0.0
            )
            pred_idx = int(pred_class) - 1
            self.log(f"  FBCCA scores(8..15Hz): {np.round(scores, 4).tolist()}")
        except Exception as e:
            self.log(f"FBCCA 失败: {e}")
            pred_idx = -1

        ok = pred_idx == self._target_index
        self.results.append((self._target_index, pred_idx, ok))
        tgt_f = FREQS[self._target_index]
        pred_f = FREQS[pred_idx] if 0 <= pred_idx < len(FREQS) else float("nan")
        self.log(f"目标 {tgt_f}Hz → 识别 {pred_f}Hz  {'✓' if ok else '✗'}  (n={len(snap)})")

        self.after(800, lambda: self._run_trials_async(order, trial_s, int(self.var_cue.get()), idx + 1))

    def _finish_round(self) -> None:
        if self._after_id:
            try:
                self.after_cancel(self._after_id)
            except Exception:
                pass
            self._after_id = None
        n = len(self.results)
        c = sum(1 for _, _, ok in self.results if ok)
        acc = (100.0 * c / n) if n else 0.0
        self.lbl_status.config(text=f"本轮结束：准确率 {acc:.1f}% ({c}/{n})")
        self.log(f"=== 本轮准确率 {acc:.1f}% ({c}/{n}) ===")
        self.btn_start.config(state=tk.NORMAL)

    def on_close(self) -> None:
        self._trial_running = False
        if self.reader:
            self.reader.stop()
        self.destroy()


def main() -> None:
    app = SSVEPAccuracyApp()
    app.protocol("WM_DELETE_WINDOW", app.on_close)
    app.mainloop()


if __name__ == "__main__":
    main()
