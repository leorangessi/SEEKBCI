"""
独立 Psychopy 全屏 SSVEP 刺激（与 ssevp/9_cca_withoutvideo.py 的帧计数公式一致）。

说明：Psychopy 无法在浏览器标签页内运行；本脚本用于在本机单独打开全屏闪烁，
浏览器/ssvep-test.html 仍负责 LSL 连接与调用后端 FBCCA。

用法（在 python_backend 目录）:
    python scripts/ssvep_psychopy_stimulus.py --seconds 5
    python scripts/ssvep_psychopy_stimulus.py --seconds 5 --refresh-hz 60

注视提示：请注视与网页测试中相同位置的方块（8 目标布局与 ssvep-test 一致）。
"""
from __future__ import annotations

import argparse

import numpy as np

try:
    from psychopy import visual, core, event
except ImportError as e:
    raise SystemExit(
        "未安装 Psychopy，请在后端环境执行: pip install psychopy\n" + str(e)
    ) from e

# 与 ssevp 脚本一致
FREQ = np.array([8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0])
PHAS = np.array([0.0, 0.15, 0.3, 0.45, 0.60, 0.75, 0.9, 0.0])

# 与 web_frontend/ssvep-test.js TEST_CONFIG.positions 一致（归一化 0~1，左上为 y 小）
POSITIONS_NORM = [
    (0.25, 0.25),
    (0.75, 0.25),
    (0.25, 0.75),
    (0.75, 0.75),
    (0.5, 0.25),
    (0.5, 0.75),
    (0.25, 0.5),
    (0.75, 0.5),
]


def run_block(duration_sec: float, refresh_hz: float, fullscreen: bool) -> None:
    win = visual.Window(
        size=(1920, 1080),
        fullscr=fullscreen,
        screen=0,
        winType="pyglet",
        allowGUI=False,
        color=(-1, -1, -1),
        units="pix",
    )
    w, h = win.size
    size = min(w, h) // 7

    rects = []
    labels = []
    for i in range(8):
        nx, ny = POSITIONS_NORM[i]
        cx = (nx - 0.5) * w
        cy = (0.5 - ny) * h
        r = visual.Rect(
            win,
            width=size,
            height=size,
            pos=(cx, cy),
            fillColor=(1, 1, 1),
            lineColor=(0.2, 0.2, 0.2),
        )
        t = visual.TextStim(
            win,
            text=f"{FREQ[i]:.0f} Hz",
            pos=(cx, cy),
            height=size * 0.12,
            color="black",
        )
        rects.append(r)
        labels.append(t)

    clock = core.Clock()
    frame_n = 0
    while clock.getTime() < duration_sec:
        amp = (np.sin(2 * np.pi * FREQ * frame_n / refresh_hz + PHAS) - 0.5) * 2.0
        for idx in range(8):
            g = float(np.clip(amp[idx], -1.0, 1.0))
            rects[idx].fillColor = (g, g, g)
            rects[idx].draw()
            lbl_color = "black" if g > 0 else "white"
            labels[idx].color = lbl_color
            labels[idx].draw()
        win.flip()
        frame_n += 1
        if "escape" in event.getKeys(["escape"]):
            break
    win.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Psychopy SSVEP 全屏刺激（配合浏览器 LSL + FBCCA）")
    ap.add_argument("--seconds", type=float, default=5.0, help="刺激时长（秒）")
    ap.add_argument(
        "--refresh-hz",
        type=float,
        default=60.0,
        help="frameN/refresh_hz 中的刷新率，与 9_cca_withoutvideo 默认 60 一致",
    )
    ap.add_argument("--windowed", action="store_true", help="窗口模式（默认全屏）")
    args = ap.parse_args()
    run_block(args.seconds, args.refresh_hz, fullscreen=not args.windowed)


if __name__ == "__main__":
    main()
