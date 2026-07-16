/**
 * 测量显示器实际刷新率（Hz），供刺激页提示与频率上限参考。
 */
(function (global) {
    let measuredHz = null;
    let measuring = false;

    function measureDisplayRefreshRate(callback) {
        if (measuring) return Promise.resolve(measuredHz);
        measuring = true;
        return new Promise((resolve) => {
            let frames = 0;
            let t0 = performance.now();
            function tick(t) {
                frames += 1;
                if (t - t0 >= 1000) {
                    measuredHz = Math.max(30, Math.round((frames * 1000) / (t - t0)));
                    measuring = false;
                    if (typeof callback === 'function') callback(measuredHz);
                    resolve(measuredHz);
                    return;
                }
                requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        });
    }

    function getMeasuredRefreshHz() {
        return measuredHz;
    }

    /** 正弦闪烁可视效果的上限约为刷新率的一半（奈奎斯特） */
    function suggestMaxFlickerHz(refreshHz) {
        const hz = refreshHz || measuredHz || 60;
        return Math.floor(hz / 2);
    }

    global.SEEKBCI_DISPLAY = {
        measureDisplayRefreshRate,
        getMeasuredRefreshHz,
        suggestMaxFlickerHz
    };
})(typeof window !== 'undefined' ? window : globalThis);
