/**
 * 全局连接状态悬浮条
 * 在任意页面显示设备连接状态，不依赖当前是否在设备管理页
 */
(function () {
    function resolveApiOrigin() {
        if (typeof window.ssvepResolveApiOrigin === "function") {
            return window.ssvepResolveApiOrigin();
        }
        if (typeof window.SSVEP_API_ORIGIN === "string" && window.SSVEP_API_ORIGIN.trim()) {
            return window.SSVEP_API_ORIGIN.trim().replace(/\/$/, "");
        }
        return "http://127.0.0.1:28765";
    }

    function physicalDeviceSummary() {
        try {
            const list = JSON.parse(localStorage.getItem("seekbci_physical_devices") || "[]");
            if (!Array.isArray(list) || list.length === 0) return "";
            return ` · 物理设备 ${list.length} 个`;
        } catch (_err) {
            return "";
        }
    }

    function statusText(connected, info, lastError) {
        const physical = physicalDeviceSummary();
        if (!connected) {
            if (lastError) {
                return `控制核心未连接（原因: ${String(lastError).slice(0, 80)}）${physical}`;
            }
            return `控制核心未连接${physical}`;
        }
        const name = info?.name || info?.port || info?.ip || "已连接";
        const sr = info?.sampling_rate ? ` @ ${info.sampling_rate}Hz` : "";
        return `控制核心已连接: ${name}${sr}${physical}`;
    }

    function ensureBadge() {
        let badge = document.getElementById("global-device-status-badge");
        if (badge) return badge;

        badge = document.createElement("div");
        badge.id = "global-device-status-badge";
        badge.style.position = "fixed";
        badge.style.right = "16px";
        badge.style.bottom = "16px";
        badge.style.zIndex = "9999";
        badge.style.padding = "8px 12px";
        badge.style.borderRadius = "999px";
        badge.style.fontSize = "12px";
        badge.style.fontWeight = "600";
        badge.style.border = "1px solid #333";
        badge.style.backdropFilter = "blur(4px)";
        badge.style.background = "rgba(42,42,42,0.95)";
        badge.style.color = "#ddd";
        badge.style.boxShadow = "0 4px 16px rgba(0,0,0,0.35)";
        badge.style.cursor = "pointer";
        badge.title = "点击进入设备管理页";
        badge.textContent = "设备状态: 检查中...";
        badge.addEventListener("click", async () => {
            await fetchStatusFallback();
            if (!window.location.pathname.endsWith("/device-manager.html")) {
                const href = "device-manager.html";
                if (
                    typeof window.ssvepBeforeNavigate === "function" &&
                    window.ssvepBeforeNavigate(href) === false
                ) {
                    return;
                }
                window.location.href = href;
            }
        });
        document.body.appendChild(badge);
        return badge;
    }

    function paintBadge(connected, info, lastError) {
        const badge = ensureBadge();
        badge.textContent = statusText(connected, info, lastError);
        if (connected) {
            badge.style.borderColor = "#4CAF50";
            badge.style.color = "#C8E6C9";
        } else {
            badge.style.borderColor = "#666";
            badge.style.color = "#ddd";
        }
    }

    async function fetchStatusFallback() {
        try {
            const origin = resolveApiOrigin();
            const resp = await fetch(`${origin}/api/devices/status`);
            const data = await resp.json();
            if (data.success) {
                paintBadge(
                    Boolean(data.status?.connected),
                    data.status?.device_info || {},
                    data.status?.last_error || ""
                );
            }
        } catch (_err) {
            const badge = ensureBadge();
            badge.textContent = "设备状态: 后端离线";
            badge.style.borderColor = "#F44336";
            badge.style.color = "#FFCDD2";
        }
    }

    function bindWithGlobalManager() {
        const gdm = window.globalDeviceManager;
        if (!gdm || typeof gdm.addEventListener !== "function") {
            return false;
        }

        const snapshot = gdm.getStatus ? gdm.getStatus() : {};
        paintBadge(Boolean(snapshot.isConnected), snapshot.deviceInfo || {}, "");

        gdm.addEventListener((event, data) => {
            if (event === "connected") {
                paintBadge(true, data?.device_info || {}, "");
            } else if (event === "disconnected") {
                paintBadge(false, {}, "");
            } else if (event === "statusChange") {
                paintBadge(Boolean(data?.connected), data?.device_info || {}, data?.last_error || "");
            } else if (event === "wsDisconnected") {
                // 页面切换后 WS 断开不代表设备断开，立即向后端拉取一次真实状态
                fetchStatusFallback();
            }
        });
        return true;
    }

    function init() {
        ensureBadge();
        if (!bindWithGlobalManager()) {
            fetchStatusFallback();
            setInterval(fetchStatusFallback, 1000);
        } else {
            // 兜底同步一次后端状态，防止 localStorage 与后端状态短暂不一致
            fetchStatusFallback();
            setInterval(fetchStatusFallback, 1000);
        }

        // 切回页面时立即同步，减少“刚断开仍显示已连接”的视觉延迟
        window.addEventListener("focus", fetchStatusFallback);
        window.addEventListener("seekbciPhysicalDevicesChanged", fetchStatusFallback);
        window.addEventListener("storage", (event) => {
            if (event.key === "seekbci_physical_devices") fetchStatusFallback();
        });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) fetchStatusFallback();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
