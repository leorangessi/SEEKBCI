'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 28765;
const PORT_SCAN_MAX = 24;

let apiProcess = null;
let activePort = DEFAULT_PORT;

function apiOrigin(host = DEFAULT_HOST, port = activePort) {
    return `http://${host}:${port}`;
}

function findAvailablePort(startPort = DEFAULT_PORT, maxAttempts = PORT_SCAN_MAX) {
    return new Promise((resolve, reject) => {
        let port = startPort;
        const tryListen = () => {
            if (port >= startPort + maxAttempts) {
                reject(new Error(`无法在 ${startPort}–${startPort + maxAttempts - 1} 找到空闲端口`));
                return;
            }
            const server = net.createServer();
            server.once('error', () => {
                port += 1;
                tryListen();
            });
            server.once('listening', () => {
                server.close(() => resolve(port));
            });
            server.listen(port, DEFAULT_HOST);
        };
        tryListen();
    });
}

function getResourcesApiDir(electronApp) {
    if (electronApp && electronApp.isPackaged) {
        return path.join(process.resourcesPath, 'seekbci-api');
    }
    return path.join(__dirname, '..', '..', 'python_backend', 'dist', 'seekbci-api');
}

function getBundledApiExe(electronApp) {
    const dir = getResourcesApiDir(electronApp);
    const winExe = path.join(dir, 'seekbci-api.exe');
    if (fs.existsSync(winExe)) return winExe;
    const unixExe = path.join(dir, 'seekbci-api');
    if (fs.existsSync(unixExe)) return unixExe;
    return null;
}

function getDevPythonBackendDir() {
    return path.join(__dirname, '..', '..', 'python_backend');
}

/** 开发回退：固定优先 Python 3.9（与 start_seekbci.bat 一致，避免误用 3.14 等缺依赖版本） */
function resolveDevPython() {
    const fromEnv = (process.env.SEEKBCi_PYTHON || '').trim();
    if (fromEnv && fs.existsSync(fromEnv)) {
        return { command: fromEnv, prefixArgs: [], label: fromEnv };
    }

    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || '';
        const py39Dir = path.join(local, 'Programs', 'Python', 'Python39');
        const direct = [
            path.join(py39Dir, 'py3.9.exe'),
            path.join(py39Dir, 'python.exe')
        ];
        for (const exe of direct) {
            if (fs.existsSync(exe)) {
                return { command: exe, prefixArgs: [], label: exe };
            }
        }
        return { command: 'py', prefixArgs: ['-3.9'], label: 'py -3.9' };
    }

    return { command: process.env.PYTHON || 'python3.9', prefixArgs: [], label: 'python3.9' };
}

function buildSpawnSpec(electronApp, userDataDir, port) {
    const bundledExe = getBundledApiExe(electronApp);
    const env = {
        ...process.env,
        SEEKBCi_DATA_DIR: userDataDir,
        SEEKBCi_API_HOST: DEFAULT_HOST,
        SEEKBCi_API_PORT: String(port),
        SEEKBCi_PACKAGED: electronApp && electronApp.isPackaged ? '1' : '0'
    };

    if (bundledExe) {
        return {
            command: bundledExe,
            args: [],
            cwd: path.dirname(bundledExe),
            env,
            mode: 'bundled',
            pythonLabel: bundledExe
        };
    }

    const backendDir = getDevPythonBackendDir();
    const py = resolveDevPython();
    if (py.command !== 'py' && fs.existsSync(py.command)) {
        env.SEEKBCi_PYTHON = py.command;
    }
    return {
        command: py.command,
        args: [
            ...py.prefixArgs,
            '-m',
            'uvicorn',
            'app.main:app',
            '--host',
            DEFAULT_HOST,
            '--port',
            String(port)
        ],
        cwd: backendDir,
        env,
        mode: 'dev-python',
        pythonLabel: py.label
    };
}

function waitForHealth(origin, timeoutMs = 90000, intervalMs = 400) {
    const deadline = Date.now() + timeoutMs;
    const url = `${origin.replace(/\/$/, '')}/health`;

    return new Promise((resolve, reject) => {
        const tick = () => {
            const req = http.get(url, (res) => {
                res.resume();
                if (res.statusCode === 200) {
                    resolve(true);
                    return;
                }
                schedule();
            });
            req.on('error', schedule);
            req.setTimeout(3000, () => {
                req.destroy();
                schedule();
            });
        };

        const schedule = () => {
            if (Date.now() > deadline) {
                reject(new Error(`API 未在 ${timeoutMs / 1000}s 内就绪：${url}`));
                return;
            }
            setTimeout(tick, intervalMs);
        };

        tick();
    });
}

async function startApi(electronApp, userDataDir) {
    if (apiProcess && !apiProcess.killed) {
        return Promise.resolve({ origin: apiOrigin(), port: activePort, mode: 'already-running' });
    }

    activePort = await findAvailablePort(DEFAULT_PORT);
    const origin = apiOrigin(DEFAULT_HOST, activePort);
    const spec = buildSpawnSpec(electronApp, userDataDir, activePort);
    console.log('[seekbci] Starting API with Python:', spec.pythonLabel || spec.command);

    return new Promise((resolve, reject) => {
        try {
            apiProcess = spawn(spec.command, spec.args, {
                cwd: spec.cwd,
                env: spec.env,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });
        } catch (err) {
            reject(err);
            return;
        }

        apiProcess.stdout?.on('data', (buf) => {
            const line = String(buf);
            if (line.trim()) console.log('[seekbci-api]', line.trim());
        });
        apiProcess.stderr?.on('data', (buf) => {
            const line = String(buf);
            if (line.trim()) console.error('[seekbci-api]', line.trim());
        });
        apiProcess.on('error', reject);
        apiProcess.on('exit', (code, signal) => {
            console.log('[seekbci-api] exited', code, signal);
            apiProcess = null;
        });

        waitForHealth(origin)
            .then(() => resolve({ origin, port: activePort, mode: spec.mode }))
            .catch((err) => {
                stopApi();
                reject(err);
            });
    });
}

function stopApi() {
    if (!apiProcess || apiProcess.killed) {
        apiProcess = null;
        return;
    }
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t'], { windowsHide: true });
        } else {
            apiProcess.kill('SIGTERM');
        }
    } catch (_) {
        try {
            apiProcess.kill();
        } catch (_2) {
            /* ignore */
        }
    }
    apiProcess = null;
}

function uiPageUrl(htmlFile, origin) {
    const base = (origin || apiOrigin()).replace(/\/$/, '');
    return `${base}/ui/${htmlFile}`;
}

function getActivePort() {
    return activePort;
}

module.exports = {
    DEFAULT_HOST,
    DEFAULT_PORT,
    apiOrigin,
    getBundledApiExe,
    getDevPythonBackendDir,
    resolveDevPython,
    startApi,
    stopApi,
    waitForHealth,
    uiPageUrl,
    getActivePort
};
