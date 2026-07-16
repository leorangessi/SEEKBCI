/**
 * 独立页面左侧导航栏（与主页 index.html 侧栏一致）
 * 切换时先铺满 #121212 遮罩，目标页在侧栏挂载完成前隐藏主内容，避免闪现上一页/半成品布局。
 */
(function () {
    const NAV_ITEMS = [
        { key: 'home', icon: '🏠', label: '主页', href: 'index.html' },
        { key: 'projects', icon: '📁', label: '项目管理', href: 'project-manager.html' },
        { key: 'devices', icon: '🔌', label: '设备管理', href: 'devices.html' },
        { key: 'testing', icon: '🧪', label: '实验测试', href: 'experiment.html' },
        { key: 'plaza', icon: '🏛️', label: '项目广场', href: 'plaza.html' },
        { key: 'profile', icon: '👤', label: '个人中心', href: 'profile.html' }
    ];

    const COVER_ID = 'ssvep-nav-cover';

    function ensureNavCoverStyles() {
        if (document.getElementById('ssvep-nav-cover-style')) return;
        const style = document.createElement('style');
        style.id = 'ssvep-nav-cover-style';
        style.textContent =
            '#' +
            COVER_ID +
            '{position:fixed;inset:0;z-index:2147483646;background:#121212;pointer-events:none;}' +
            'body.app-shell-page:not(.shell-ready) .app-container{opacity:0 !important;}' +
            'body.app-shell-page.shell-ready .app-container{opacity:1;}';
        (document.head || document.documentElement).appendChild(style);
    }

    function showNavCover() {
        ensureNavCoverStyles();
        let el = document.getElementById(COVER_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = COVER_ID;
            el.setAttribute('aria-hidden', 'true');
            (document.body || document.documentElement).appendChild(el);
        }
        el.style.display = 'block';
    }

    function hideNavCover() {
        const el = document.getElementById(COVER_ID);
        if (el) el.remove();
    }

    function navigateTo(href) {
        if (!href) return;
        try {
            const next = new URL(href, window.location.href);
            const cur = new URL(window.location.href);
            if (next.pathname === cur.pathname && next.search === cur.search && next.hash === cur.hash) {
                return;
            }
        } catch (_) {
            /* ignore */
        }
        showNavCover();
        // 等遮罩完成一帧绘制后再跳转，避免仍能看见当前页被撕掉
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                window.location.href = href;
            });
        });
    }

    function markShellReady() {
        ensureNavCoverStyles();
        if (document.body) {
            document.body.classList.add('shell-ready');
        }
        hideNavCover();
    }

    function renderSidebar(activeKey) {
        const mount = document.getElementById('app-sidebar-mount');
        if (!mount) return;

        const itemsHtml = NAV_ITEMS.map(function (item) {
            const active = item.key === activeKey ? ' active' : '';
            return (
                '<div class="nav-item' +
                active +
                '" data-nav-href="' +
                item.href +
                '" role="link" tabindex="0">' +
                '<span class="nav-icon">' +
                item.icon +
                '</span>' +
                '<span>' +
                item.label +
                '</span></div>'
            );
        }).join('');

        mount.innerHTML =
            '<div class="sidebar">' +
            '<div class="logo">' +
            '<h1>🧠 SEEKBCI PLAT</h1>' +
            '<p>探索脑机平台</p>' +
            '</div>' +
            itemsHtml +
            '</div>';

        mount.querySelectorAll('[data-nav-href]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                navigateTo(el.getAttribute('data-nav-href'));
            });
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigateTo(el.getAttribute('data-nav-href'));
                }
            });
        });
    }

    function boot() {
        ensureNavCoverStyles();
        const mount = document.getElementById('app-sidebar-mount');
        if (mount) {
            renderSidebar(mount.getAttribute('data-active') || '');
        }
        markShellReady();
    }

    // 尽早隐藏半成品壳层；侧栏挂载后再显示
    ensureNavCoverStyles();
    if (document.body && document.body.classList.contains('app-shell-page')) {
        // 已有 body
    } else {
        document.addEventListener(
            'DOMContentLoaded',
            function () {
                ensureNavCoverStyles();
            },
            { once: true }
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    window.addEventListener('pageshow', function (ev) {
        // bfcache 恢复时去掉可能残留的遮罩
        if (ev.persisted) {
            hideNavCover();
            if (document.body) document.body.classList.add('shell-ready');
        }
    });

    window.ssvepNavigateTo = navigateTo;
})();
