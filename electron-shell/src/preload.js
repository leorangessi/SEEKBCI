'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 预留：若渲染进程需要安全调用主进程（例：选文件打开 JSON），在此暴露 API。
 * 当前刺激页仍走 localStorage / sessionStorage，与浏览器一致。
 */
contextBridge.exposeInMainWorld('ssvepElectron', {
    isShell: true,
    windowMinimize: () => ipcRenderer.invoke('ssvep-window-minimize'),
    windowToggleMaximize: () => ipcRenderer.invoke('ssvep-window-toggle-maximize'),
    windowClose: () => ipcRenderer.invoke('ssvep-window-close'),
    setAlwaysOnTop: (flag) => ipcRenderer.invoke('ssvep-set-always-on-top', flag),
    windowIsMaximized: () => ipcRenderer.invoke('ssvep-window-is-maximized'),
    onMaximizedChanged: (cb) => {
        if (typeof cb !== 'function') return () => {};
        const handler = (_e, v) => cb(!!v);
        ipcRenderer.on('ssvep-window-maximized-changed', handler);
        return () => ipcRenderer.removeListener('ssvep-window-maximized-changed', handler);
    },
    viewportPointToScreen: (x, y) => ipcRenderer.invoke('ssvep-viewport-to-screen', { x, y }),
    setMousePassthrough: (enable, forward) =>
        ipcRenderer.invoke('ssvep-set-mouse-passthrough', { enable: !!enable, forward: !!forward }),
    focusAppWindow: () => ipcRenderer.invoke('ssvep-focus-app-window'),
    exitStimulusTo: (htmlFile) => ipcRenderer.invoke('ssvep-exit-stimulus-to', htmlFile),
    focusStimulusWindow: () => ipcRenderer.invoke('ssvep-focus-stimulus'),
    blurStimulusWindow: () => ipcRenderer.invoke('ssvep-blur-stimulus')
});
