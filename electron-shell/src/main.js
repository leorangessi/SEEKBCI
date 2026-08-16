'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const apiLauncher = require('./api-launcher');

// Web Bluetooth（SEEKBCI OTA、IMU BMI270 等）
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-features', 'WebBluetooth');

/** 开发时 file:// 回退路径；正式版走 API /ui */
const WEB_FRONTEND = path.join(__dirname, '..', '..', 'web_frontend');
const STIMULUS_HTML = 'stimulus.html';

const FRAMED_SHELL_PAGE_TITLES = {
    'editor.html': 'SEEKBCI 项目编辑器',
    'index.html': 'SEEKBCI PLAT',
    'project-manager.html': 'SEEKBCI 项目管理',
    'device-manager.html': 'SEEKBCI 设备管理',
    'plaza.html': 'SEEKBCI 项目广场',
    'profile.html': 'SEEKBCI 个人中心',
    'experiment.html': 'SEEKBCI 实验测试',
    'devices.html': 'SEEKBCI 设备管理',
    'physical-world.html': 'SEEKBCI 物理世界',
    'ssvep-test.html': 'SEEKBCI 实验 · 准确度',
    'emg-test.html': 'SEEKBCI 实验 · 运动通道',
    'imu-test.html': 'SEEKBCI 实验 · IMU / 光标',
    'test-stimulus.html': 'SEEKBCI 实验 · 刺激参数'
};

function isFramedShellPage(base) {
    return !!(base && FRAMED_SHELL_PAGE_TITLES[base]);
}

function isInAppShellPage(base) {
    return isFramedShellPage(base) || base === STIMULUS_HTML;
}

/** 进入刺激前所在的带导航壳页面，退出刺激时恢复 */
let lastFramedShellPage = 'index.html';

function resolveShellPageBase(urlString) {
    if (!urlString) return null;
    const raw = String(urlString).trim();
    if (/^[a-z0-9._-]+\.html$/i.test(raw)) return raw.toLowerCase();
    const base = htmlBasenameFromNavigationUrl(raw);
    if (!base || base === 'ui') return 'index.html';
    return base;
}

let shellLaunchMode = 'home';
let apiOrigin = apiLauncher.apiOrigin();
let useApiUi = true;
let splashWindow = null;

function htmlBasenameFromNavigationUrl(urlString) {
    try {
        const u = new URL(urlString);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
            const base = path.basename(u.pathname).toLowerCase();
            return base || null;
        }
        if (u.protocol === 'file:') {
            const fp = fileURLToPath(u);
            return path.basename(fp).toLowerCase();
        }
        return null;
    } catch {
        return null;
    }
}

function resolvePageUrl(htmlFile) {
    if (useApiUi) {
        return apiLauncher.uiPageUrl(htmlFile, apiOrigin);
    }
    return path.join(WEB_FRONTEND, htmlFile);
}

function loadWindowPage(win, htmlFile) {
    const target = resolvePageUrl(htmlFile);
    if (useApiUi) {
        return win.loadURL(target);
    }
    return win.loadFile(target);
}

function openFramedShellPageFromStimulus(stimulusWin, htmlFile) {
    const base = resolveShellPageBase(htmlFile) || lastFramedShellPage || 'project-manager.html';
    const title = FRAMED_SHELL_PAGE_TITLES[base] || 'SEEKBCI PLAT';
    createFramedShellWindow(base, title);
    if (stimulusWin && !stimulusWin.isDestroyed()) stimulusWin.close();
}

function attachStimulusShellNavigationHandlers(win) {
    win.webContents.on('will-navigate', (event, url) => {
        const base = resolveShellPageBase(url);
        if (!base || base === STIMULUS_HTML) return;
        if (!isFramedShellPage(base)) return;
        event.preventDefault();
        openFramedShellPageFromStimulus(win, base);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        const base = resolveShellPageBase(url);
        if (base && base !== STIMULUS_HTML && isFramedShellPage(base)) {
            openFramedShellPageFromStimulus(win, base);
        }
        return { action: 'deny' };
    });
}

function attachFramedShellNavigationHandlers(win) {
    win.webContents.on('will-navigate', (event, url) => {
        const base = resolveShellPageBase(url);
        if (!base) return;
        if (base === STIMULUS_HTML) {
            event.preventDefault();
            lastFramedShellPage = resolveShellPageBase(win.webContents.getURL()) || 'index.html';
            createStimulusWindow();
            if (!win.isDestroyed()) win.close();
            return;
        }
        if (isFramedShellPage(base)) {
            return;
        }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        const base = htmlBasenameFromNavigationUrl(url);
        if (base && isInAppShellPage(base)) {
            loadWindowPage(win, base).catch((err) => console.error('deny-open nav failed:', err));
        }
        return { action: 'deny' };
    });
}

function parseShellMode() {
    const argv = process.argv.slice(1);
    if (argv.includes('--editor')) return 'editor';
    if (argv.includes('--stimulus')) return 'stimulus';
    if (argv.includes('--home') || argv.includes('--index')) return 'home';
    return 'home';
}

function registerShellIpcOnce() {
    if (registerShellIpcOnce._done) return;
    registerShellIpcOnce._done = true;

    const fromEvent = (event) => BrowserWindow.fromWebContents(event.sender);

    ipcMain.handle('ssvep-window-minimize', (event) => {
        fromEvent(event)?.minimize();
    });
    ipcMain.handle('ssvep-window-toggle-maximize', (event) => {
        const w = fromEvent(event);
        if (!w) return;
        if (w.isMaximized()) w.unmaximize();
        else w.maximize();
    });
    ipcMain.handle('ssvep-window-close', (event) => {
        fromEvent(event)?.close();
    });
    ipcMain.handle('ssvep-set-always-on-top', (event, flag) => {
        const w = fromEvent(event);
        if (!w) return;
        if (flag) {
            try {
                w.setAlwaysOnTop(true, 'screen-saver');
            } catch (_) {
                w.setAlwaysOnTop(true);
            }
        } else {
            w.setAlwaysOnTop(false);
        }
    });
    ipcMain.handle('ssvep-window-is-maximized', (event) => {
        const w = fromEvent(event);
        return w ? w.isMaximized() : false;
    });
    ipcMain.handle('ssvep-viewport-to-screen', (event, pt) => {
        const w = fromEvent(event);
        if (!w || !pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') {
            return { x: 0, y: 0 };
        }
        const b = w.getContentBounds();
        return { x: b.x + pt.x, y: b.y + pt.y };
    });
    ipcMain.handle('ssvep-set-mouse-passthrough', (event, opts) => {
        const w = fromEvent(event);
        if (!w) return;
        const enable = !!(opts && opts.enable);
        const forward = !!(opts && opts.forward);
        w.setIgnoreMouseEvents(enable, { forward });
    });
    ipcMain.handle('ssvep-exit-stimulus-to', (event, htmlFile) => {
        const from = fromEvent(event);
        let base = null;
        if (htmlFile && typeof htmlFile === 'string' && htmlFile.trim()) {
            base = resolveShellPageBase(htmlFile.trim());
        }
        if (!base) {
            base = lastFramedShellPage || 'project-manager.html';
        }
        openFramedShellPageFromStimulus(from, base);
    });
    ipcMain.handle('ssvep-focus-app-window', (event) => {
        const w = fromEvent(event);
        if (!w || w.isDestroyed()) return;
        w.show();
        w.setAlwaysOnTop(false);
        w.focus();
        w.webContents.focus();
        try {
            app.focus({ steal: true });
        } catch (_) {
            try {
                app.focus();
            } catch (_2) {
                /* ignore */
            }
        }
    });
    ipcMain.handle('ssvep-focus-stimulus', (event) => {
        bringStimulusWindowForward(fromEvent(event));
    });
    ipcMain.handle('ssvep-blur-stimulus', (event) => {
        const w = fromEvent(event);
        if (!w || w.isDestroyed()) return;
        w.blur();
        try {
            if (process.platform === 'win32') {
                w.setAlwaysOnTop(true, 'screen-saver');
            }
        } catch (_) {
            w.setAlwaysOnTop(true);
        }
    });
}

function bringStimulusWindowForward(win) {
    if (!win || win.isDestroyed()) return;
    win.show();
    try {
        win.setAlwaysOnTop(true, 'screen-saver');
    } catch (_) {
        win.setAlwaysOnTop(true);
    }
    win.moveTop();
    win.focus();
    try {
        app.focus({ steal: true });
    } catch (_) {
        try {
            app.focus();
        } catch (_2) {
            /* ignore */
        }
    }
}

function createStimulusWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.on('maximize', () => win.webContents.send('ssvep-window-maximized-changed', true));
    win.on('unmaximize', () => win.webContents.send('ssvep-window-maximized-changed', false));
    win.once('ready-to-show', () => bringStimulusWindowForward(win));

    loadWindowPage(win, 'stimulus.html').catch((err) => console.error('load stimulus failed:', err));

    win.webContents.on('did-finish-load', () => bringStimulusWindowForward(win));
    attachStimulusShellNavigationHandlers(win);
}

function attachBluetoothHandlers(win) {
    const ses = win.webContents.session;
    ses.setDevicePermissionHandler((details) => details.deviceType === 'bluetooth');

    // 关键：空列表时不能立刻 callback('')，否则会取消扫描；应等待目标设备出现。
    let selectBluetoothCallback = null;
    let scanTimer = null;

    const clearScanTimer = () => {
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
    };

    win.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
        event.preventDefault();
        selectBluetoothCallback = callback;

        const list = Array.isArray(deviceList) ? deviceList : [];
        if (list.length) {
            console.log(
                '[bluetooth] seen:',
                list.map((d) => `${d.deviceName || '(no-name)'}@${d.deviceId}`).join(', ')
            );
        }

        const preferred = list.find((d) =>
            /SEEKBCI|BMI270|ESP32_BMI270/i.test(String(d.deviceName || ''))
        ) || list[0];
        if (preferred) {
            clearScanTimer();
            selectBluetoothCallback = null;
            console.log('[bluetooth] selected:', preferred.deviceName || '(no-name)', preferred.deviceId);
            callback(preferred.deviceId);
            return;
        }

        if (!scanTimer) {
            scanTimer = setTimeout(() => {
                scanTimer = null;
                if (selectBluetoothCallback) {
                    console.warn('[bluetooth] timeout waiting for SEEKBCI / ESP32_BMI270 device');
                    const cb = selectBluetoothCallback;
                    selectBluetoothCallback = null;
                    cb('');
                }
            }, 20000);
        }
    });

    win.on('closed', () => {
        clearScanTimer();
        if (selectBluetoothCallback) {
            try {
                selectBluetoothCallback('');
            } catch (_) { /* ignore */ }
            selectBluetoothCallback = null;
        }
    });
}

function createFramedShellWindow(htmlFile, title) {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        title: title || 'SEEKBCI PLAT',
        frame: true,
        transparent: false,
        alwaysOnTop: false,
        backgroundColor: '#121212',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const ensureNotAlwaysOnTop = () => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    };

    attachBluetoothHandlers(win);

    win.once('ready-to-show', () => {
        ensureNotAlwaysOnTop();
        win.show();
        win.focus();
    });
    win.webContents.on('did-finish-load', ensureNotAlwaysOnTop);
    win.on('blur', ensureNotAlwaysOnTop);

    loadWindowPage(win, htmlFile).catch((err) => console.error('load page failed:', err));
    attachFramedShellNavigationHandlers(win);
}

function createShellWindow() {
    if (shellLaunchMode === 'editor') {
        createFramedShellWindow('editor.html', 'SEEKBCI 项目编辑器');
    } else if (shellLaunchMode === 'home') {
        createFramedShellWindow('index.html', 'SEEKBCI PLAT');
    } else {
        createStimulusWindow();
    }
}

function showSplash(message) {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.executeJavaScript(
            `document.getElementById('msg').textContent = ${JSON.stringify(message)};`
        );
        return;
    }
    splashWindow = new BrowserWindow({
        width: 420,
        height: 220,
        frame: false,
        transparent: false,
        resizable: false,
        alwaysOnTop: true,
        backgroundColor: '#121212',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#121212;color:#eee;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px;box-sizing:border-box}
h1{color:#00D9FF;font-size:22px;margin:0 0 12px}
p{color:#aaa;font-size:14px;line-height:1.5;margin:0}
</style></head><body><div><h1>SEEKBCI PLAT</h1><p id="msg">${message}</p></div></body></html>
    `)}`);
}

function closeSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    splashWindow = null;
}

async function bootstrap() {
    shellLaunchMode = parseShellMode();
    registerShellIpcOnce();
    showSplash('正在启动本地服务…');

    try {
        const result = await apiLauncher.startApi(app, app.getPath('userData'));
        apiOrigin = result.origin;
        useApiUi = true;
        console.log('[seekbci] API ready:', result.mode, apiOrigin);
    } catch (err) {
        console.error('[seekbci] API start failed:', err);
        closeSplash();
        const bundled = apiLauncher.getBundledApiExe(app);
        const detail = bundled
            ? `无法启动内置 API：${err.message || err}`
            : `开发模式需要 Python 3.9 启动后端，但 API 未就绪：${err.message || err}\n\n` +
              `请确认已安装 Python 3.9，并在 python_backend 目录执行：\n` +
              `  py -3.9 -m pip install -r requirements-desktop.txt\n\n` +
              `或设置环境变量 SEEKBCi_PYTHON 指向 py3.9.exe 后再运行 npm start。`;
        dialog.showErrorBox('SEEKBCI 启动失败', detail);
        app.quit();
        return;
    }

    closeSplash();
    createShellWindow();
}

app.whenReady().then(bootstrap);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createShellWindow();
    }
});

app.on('before-quit', () => {
    apiLauncher.stopApi();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
