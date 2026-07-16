/**
 * SEEKBCI 新手引导：首次打开自动展示，主页可重复打开。
 */
(function (global) {
    const STORAGE_KEY = 'seekbci_onboarding_done';

    const STEPS = [
        {
            title: '欢迎使用 SEEKBCI PLAT',
            body: '探索脑机平台帮助您设计 SSVEP 刺激、连接 EEG 设备、运行脑控项目，并与社区分享创意。'
        },
        {
            title: '① 从示例项目开始',
            body: '打开「项目管理」，内置脑控音乐盒、骰子运势站等示例。导入后可直接运行（无设备时也可体验界面与 Python 反馈）。',
            action: { label: '打开项目管理', href: 'project-manager.html' }
        },
        {
            title: '② 连接设备',
            body: '在「设备管理」中连接 LSL、串口或 WiFi EEG 设备。刺激运行时会使用全局设备条中的连接状态。',
            action: { label: '设备管理', href: 'devices.html' }
        },
        {
            title: '③ 实验测试调参',
            body: '在「实验测试」中尝试刺激参数、准确度与运动通道设置。找到合适参数后，写入项目的运行配置再正式使用。',
            action: { label: '进入实验测试', href: 'experiment.html' }
        },
        {
            title: '④ 项目广场',
            body: '注册并验证邮箱后，可分享项目、点赞他人作品。从广场导入的项目仅供本地使用，不可二次发布（知识产权保护）。',
            action: { label: '项目广场', href: 'plaza.html' }
        },
        {
            title: '⑤ 一键启动',
            body: '开发期可使用 scripts/start_seekbci.bat 启动；正式版将提供 exe，内嵌 Python，无需用户自行安装。后续规划 Android / Linux 版本。'
        }
    ];

    let stepIndex = 0;
    let overlayEl = null;

    function injectStyles() {
        if (document.getElementById('seekbci-onboarding-style')) return;
        const style = document.createElement('style');
        style.id = 'seekbci-onboarding-style';
        style.textContent = `
            .seekbci-onboard-overlay {
                position: fixed; inset: 0; z-index: 99999;
                background: rgba(0,0,0,.72);
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
            }
            .seekbci-onboard-card {
                background: #1e1e1e; border: 1px solid #333; border-radius: 16px;
                max-width: 520px; width: 100%; padding: 28px 32px;
                box-shadow: 0 20px 60px rgba(0,217,255,.12);
            }
            .seekbci-onboard-card h2 { color: #00D9FF; font-size: 22px; margin-bottom: 14px; }
            .seekbci-onboard-card p { color: #bbb; line-height: 1.65; font-size: 15px; }
            .seekbci-onboard-dots { display: flex; gap: 8px; margin: 20px 0; }
            .seekbci-onboard-dot { width: 8px; height: 8px; border-radius: 50%; background: #444; }
            .seekbci-onboard-dot.active { background: #00D9FF; }
            .seekbci-onboard-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
            .seekbci-onboard-btn {
                padding: 10px 18px; border-radius: 8px; border: none; cursor: pointer;
                font-weight: 600; font-size: 14px;
            }
            .seekbci-onboard-btn.primary { background: #00D9FF; color: #111; }
            .seekbci-onboard-btn.secondary { background: #2a2a2a; color: #eee; border: 1px solid #444; }
            .seekbci-onboard-btn.link { background: transparent; color: #888; border: none; }
        `;
        document.head.appendChild(style);
    }

    function renderStep() {
        const step = STEPS[stepIndex];
        const dots = STEPS.map((_, i) =>
            `<span class="seekbci-onboard-dot${i === stepIndex ? ' active' : ''}"></span>`
        ).join('');
        const actionBtn = step.action
            ? `<button type="button" class="seekbci-onboard-btn secondary" data-href="${step.action.href}">${step.action.label}</button>`
            : '';
        const isLast = stepIndex >= STEPS.length - 1;
        overlayEl.innerHTML = `
            <div class="seekbci-onboard-card" role="dialog" aria-modal="true">
                <h2>${step.title}</h2>
                <p>${step.body}</p>
                <div class="seekbci-onboard-dots">${dots}</div>
                <div class="seekbci-onboard-actions">
                    ${stepIndex > 0 ? '<button type="button" class="seekbci-onboard-btn secondary" data-act="prev">上一步</button>' : ''}
                    ${actionBtn}
                    <button type="button" class="seekbci-onboard-btn primary" data-act="${isLast ? 'done' : 'next'}">
                        ${isLast ? '开始使用' : '下一步'}
                    </button>
                    <button type="button" class="seekbci-onboard-btn link" data-act="skip">跳过</button>
                </div>
            </div>
        `;
        overlayEl.querySelectorAll('[data-act]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const act = btn.getAttribute('data-act');
                if (act === 'prev') stepIndex = Math.max(0, stepIndex - 1);
                else if (act === 'next') stepIndex = Math.min(STEPS.length - 1, stepIndex + 1);
                else close(true);
                if (act === 'prev' || act === 'next') renderStep();
            });
        });
        overlayEl.querySelectorAll('[data-href]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const href = btn.getAttribute('data-href');
                close(true);
                if (href) window.location.href = href;
            });
        });
    }

    function close(markDone) {
        if (markDone) localStorage.setItem(STORAGE_KEY, '1');
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
        stepIndex = 0;
    }

    function open(force) {
        injectStyles();
        if (!force && localStorage.getItem(STORAGE_KEY)) return;
        if (overlayEl) return;
        overlayEl = document.createElement('div');
        overlayEl.className = 'seekbci-onboard-overlay';
        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) close(false);
        });
        document.body.appendChild(overlayEl);
        renderStep();
    }

    function initAuto() {
        if (!localStorage.getItem(STORAGE_KEY)) {
            setTimeout(() => open(false), 400);
        }
    }

    global.SEEKBCI_ONBOARDING = { open, close, initAuto };
})(typeof window !== 'undefined' ? window : globalThis);
