/**
 * 设备通道多模态编排：每路可标记为 SSVEP / 眼电 / 运动想象 / 未分配
 * 配置全局持久化，供 FBCCA、刺激页多模态、测试页共用。
 */
(function (global) {
    const FBCCA_OUTPUT_CHANNELS = 8;
    const DEVICE_CHANNEL_COUNT = 8;
    const STORAGE_KEY = 'ssvep_fbcca_settings';
    const CONFIG_VERSION = 6;

    const ROLE_IDS = ['ssvep', 'eog', 'motor_imagery', 'disabled'];

    const ROLE_META = {
        ssvep: {
            id: 'ssvep',
            label: 'SSVEP 视觉诱发',
            short: 'SSVEP',
            color: '#00D9FF',
            accent: '#007a94'
        },
        eog: {
            id: 'eog',
            label: '眼电 EOG',
            short: '眼电',
            color: '#C9A0FF',
            accent: '#6b4fa8'
        },
        motor_imagery: {
            id: 'motor_imagery',
            label: '运动想象 MI',
            short: '运动',
            color: '#FFB300',
            accent: '#b37a00'
        },
        disabled: {
            id: 'disabled',
            label: '取消（不参与 SSVEP / 多模态计算）',
            short: '取消',
            color: '#8a95a8',
            accent: '#4a5260'
        }
    };

    /** 与眼电模态相同的眼形，可平移/缩放后复用（SSVEP 双眼） */
    function eogEyeGraphic(cx, scale) {
        const s = scale != null ? scale : 1;
        const t = `translate(${cx} 12) scale(${s}) translate(-12 -12)`;
        return `<g transform="${t}"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></g>`;
    }

    function roleIconSvg(roleId) {
        const common = 'class="dm-role-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
        switch (roleId) {
            case 'ssvep':
                return `<svg ${common}><title>SSVEP</title>${eogEyeGraphic(7.2, 0.46)}${eogEyeGraphic(16.8, 0.46)}</svg>`;
            case 'eog':
                return `<svg ${common}><title>眼电</title>${eogEyeGraphic(12, 1)}</svg>`;
            case 'motor_imagery':
                return `<svg ${common}><title>运动想象</title><path d="M5.6 13.8c-1.1 0-2-.9-2.2-2.1-.2-1.2.5-2.3 1.7-2.6 1-.3 2 .3 2.4 1.4.4 1-.1 2.3-.7 3.1-.6.8-1.4 1.4-1.8 1.4z" fill="currentColor"/><path d="M8.5 19.6c-1.9 0-3.4-1.5-3.4-3.4v-4.9c0-.5.4-.9.9-.9h11.2c.5 0 .9.4.9.9v4.9c0 1.9-1.5 3.4-3.4 3.4H8.5z" fill="currentColor"/><path d="M8.7 11.4V7.5c0-.8.7-1.45 1.5-1.45.8 0 1.45.65 1.45 1.45v3.9H8.7z" fill="currentColor"/><path d="M10.95 11.4V7.1c0-.85.75-1.55 1.6-1.55s1.6.7 1.6 1.55v4.3h-3.2z" fill="currentColor"/><path d="M13.35 11.4V7.1c0-.85.75-1.55 1.6-1.55s1.6.7 1.6 1.55v4.3h-3.2z" fill="currentColor"/><path d="M15.75 11.4V7.5c0-.8.7-1.45 1.45-1.45.8 0 1.45.65 1.45 1.45v3.9h-2.9z" fill="currentColor"/><path d="M10.05 6.2v3.2M12.45 5.85v3.55M14.85 6.2v3.2" fill="none" stroke="currentColor" stroke-width="0.65" stroke-linecap="round" opacity="0.38"/></svg>`;
            case 'disabled':
            default:
                return `<svg ${common}><title>取消</title><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.45" opacity="0.55"/><path d="M7.2 7.2l9.6 9.6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
        }
    }

    const MULTIMODAL_BIND_ORDER = {
        eog: ['eog_left', 'eog_right'],
        motor_imagery: ['motion_left', 'motion_right']
    };

    function getPhysicalChannelsForRole(role) {
        const cfg = loadFullConfig();
        const roles = cfg.channelRoles || defaultRoles();
        const out = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === role) out.push(i);
        }
        return out;
    }

    function defaultRoles() {
        return Array(DEVICE_CHANNEL_COUNT).fill('ssvep');
    }

    function migrateStoredRoles(roles, storedVersion) {
        const raw = Array.isArray(roles) ? roles : [];
        let changed = !storedVersion || storedVersion < CONFIG_VERSION;
        if (raw.some((x) => x === 'off')) changed = true;
        const r = normalizeRolesArray(roles);
        if (!storedVersion || storedVersion < CONFIG_VERSION) {
            if (!r.some((x) => x === 'ssvep')) {
                return { roles: defaultRoles(), changed: true };
            }
        }
        return { roles: r, changed };
    }

    function normalizeRole(role) {
        if (role === 'off') return 'disabled';
        return ROLE_IDS.includes(role) ? role : 'disabled';
    }

    function normalizeRolesArray(raw) {
        if (!Array.isArray(raw)) return defaultRoles();
        const out = [];
        for (let i = 0; i < DEVICE_CHANNEL_COUNT; i++) {
            out.push(normalizeRole(raw[i]));
        }
        return out;
    }

    function rolesFromLegacyIndices(indices) {
        const roles = Array(DEVICE_CHANNEL_COUNT).fill('disabled');
        if (!indices || !indices.length) {
            return defaultRoles();
        }
        for (const i of indices) {
            if (i >= 0 && i < DEVICE_CHANNEL_COUNT) roles[i] = 'ssvep';
        }
        if (!roles.some((r) => r === 'ssvep')) return defaultRoles();
        return roles;
    }

    function ssvepIndicesFromRoles(roles) {
        const indices = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === 'ssvep') indices.push(i);
        }
        if (indices.length === 0) return null;
        if (indices.length === DEVICE_CHANNEL_COUNT) return null;
        return indices;
    }

    function rebuildMultimodalBindings(roles) {
        const bindings = {};
        for (const [role, ids] of Object.entries(MULTIMODAL_BIND_ORDER)) {
            const phys = [];
            for (let i = 0; i < roles.length; i++) {
                if (roles[i] === role) phys.push(i);
            }
            for (let j = 0; j < ids.length; j++) {
                bindings[ids[j]] = phys[j] != null ? phys[j] : null;
            }
        }
        return bindings;
    }

    function loadFullConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return {
                    version: CONFIG_VERSION,
                    channelRoles: defaultRoles(),
                    ssvepChannelIndices: null,
                    multimodalBindings: rebuildMultimodalBindings(defaultRoles())
                };
            }
            const o = JSON.parse(raw);
            let roles;
            if (o.channelRoles && Array.isArray(o.channelRoles)) {
                roles = normalizeRolesArray(o.channelRoles);
            } else {
                roles = rolesFromLegacyIndices(o.ssvepChannelIndices);
            }
            const migrated = migrateStoredRoles(roles, o.version);
            roles = migrated.roles;
            if (migrated.changed) {
                saveFullConfig({ channelRoles: roles });
            }
            const ssvep = ssvepIndicesFromRoles(roles);
            return {
                version: CONFIG_VERSION,
                channelRoles: roles,
                ssvepChannelIndices: ssvep,
                multimodalBindings: rebuildMultimodalBindings(roles)
            };
        } catch {
            const roles = defaultRoles();
            return {
                version: CONFIG_VERSION,
                channelRoles: roles,
                ssvepChannelIndices: null,
                multimodalBindings: rebuildMultimodalBindings(roles)
            };
        }
    }

    function saveFullConfig(config) {
        const roles = normalizeRolesArray(config.channelRoles);
        const payload = {
            version: CONFIG_VERSION,
            channelRoles: roles,
            ssvepChannelIndices: ssvepIndicesFromRoles(roles),
            multimodalBindings: rebuildMultimodalBindings(roles),
            updatedAt: Date.now()
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('保存通道配置失败', e);
        }
        if (global.globalDeviceManager && typeof global.globalDeviceManager.applyChannelConfig === 'function') {
            global.globalDeviceManager.applyChannelConfig(payload);
        }
        return payload;
    }

    function normalizeChannelIndexList(raw) {
        if (!Array.isArray(raw) || raw.length === 0) return null;
        const out = [];
        for (const x of raw) {
            const i = parseInt(String(x), 10);
            if (Number.isFinite(i) && i >= 0 && !out.includes(i)) out.push(i);
        }
        out.sort((a, b) => a - b);
        return out.length ? out : null;
    }

    function getGlobalSsvepChannelIndices() {
        const cfg = loadFullConfig();
        if (
            global.globalDeviceManager &&
            typeof global.globalDeviceManager.applyChannelConfig === 'function'
        ) {
            global.globalDeviceManager.applyChannelConfig(cfg);
        }
        return cfg.ssvepChannelIndices;
    }

    function getGlobalChannelRoles() {
        const cfg = loadFullConfig();
        if (
            global.globalDeviceManager &&
            typeof global.globalDeviceManager.applyChannelConfig === 'function'
        ) {
            global.globalDeviceManager.applyChannelConfig(cfg);
        }
        return cfg.channelRoles;
    }

    function getMultimodalPhysicalIndex(channelId) {
        const cfg = loadFullConfig();
        const map = cfg.multimodalBindings || {};
        if (map[channelId] != null && Number.isFinite(Number(map[channelId]))) {
            return Number(map[channelId]);
        }
        const meta = global.SSVEP_MULTIMODAL_BY_ID && global.SSVEP_MULTIMODAL_BY_ID[channelId];
        return meta && meta.fallbackIndex != null ? meta.fallbackIndex : null;
    }

    /** 与后端 fbcca_channel_expansion_plan 一致：块状复制（BCIduino 1 路×8 / 2 路各×4） */
    function buildFbccaExpansionPlan(ssvepIndices, nOut) {
        const n = nOut != null ? nOut : FBCCA_OUTPUT_CHANNELS;
        const indices = normalizeChannelIndexList(ssvepIndices);
        if (!indices || !indices.length) return null;
        const k = indices.length;
        if (k >= n) return indices.slice(0, n);
        const base = Math.floor(n / k);
        const extra = n % k;
        const plan = [];
        for (let i = 0; i < k; i++) {
            const copies = base + (i < extra ? 1 : 0);
            for (let c = 0; c < copies; c++) plan.push(indices[i]);
        }
        return plan;
    }

    function formatFbccaChannelIndicesLabel(indices) {
        if (!indices || !indices.length) return 'Ch1–8（设备前 8 路）';
        if (indices.length >= DEVICE_CHANNEL_COUNT) {
            return indices.map((i) => `Ch${i + 1}`).join('、');
        }
        const plan = buildFbccaExpansionPlan(indices);
        const ch = indices.map((i) => `Ch${i + 1}`).join('、');
        const expanded = plan.map((i) => `Ch${i + 1}`).join(', ');
        return `${ch}（${indices.length} 路）→ FBCCA 8 路：[${expanded}]`;
    }

    function formatRolesSummary(roles) {
        const counts = { ssvep: 0, eog: 0, motor_imagery: 0, disabled: 0 };
        for (const r of roles) counts[r] = (counts[r] || 0) + 1;
        const parts = [];
        if (counts.ssvep) parts.push(`SSVEP×${counts.ssvep}`);
        if (counts.eog) parts.push(`眼电×${counts.eog}`);
        if (counts.motor_imagery) parts.push(`运动想象×${counts.motor_imagery}`);
        if (counts.disabled) parts.push(`取消×${counts.disabled}`);
        const ssvep = ssvepIndicesFromRoles(roles);
        const fbcca = formatFbccaChannelIndicesLabel(ssvep);
        const hint =
            ssvep && ssvep.length === 2
                ? ' ｜ 2 路：试次分类用块状×4+双路融合；在线刺激仅块状×4（勿用 CAR）。'
                : ssvep && ssvep.length < DEVICE_CHANNEL_COUNT
                  ? ` ｜ ${ssvep.length} 路：块状复制为 8 路参与 FBCCA。`
                  : '';
        return `${parts.join(' · ')} ｜ FBCCA：${fbcca}${hint}`;
    }

    /** 与后端 prepare_samples_for_fbcca_decode 一致 */
    function expandSamplesToFbccaChannels(samples, channelIndices) {
        if (!samples || !samples.length) return samples;
        const nIn = samples[0].length;
        const plan = buildFbccaExpansionPlan(channelIndices);
        if (!plan) {
            if (nIn >= FBCCA_OUTPUT_CHANNELS) {
                return samples.map((row) => row.slice(0, FBCCA_OUTPUT_CHANNELS));
            }
            const fallback = buildFbccaExpansionPlan(
                Array.from({ length: nIn }, (_, i) => i)
            );
            const out = [];
            for (let t = 0; t < samples.length; t++) {
                const row = samples[t];
                out.push(fallback.map((src) => Number(row[src]) || 0));
            }
            return out;
        }
        const out = [];
        for (let t = 0; t < samples.length; t++) {
            const row = samples[t];
            out.push(plan.map((src) => Number(row[src]) || 0));
        }
        return out;
    }

    /** 设备管理页：渲染 8 路通道矩阵（状态挂在 container 上，避免切换时用到旧快照） */
    function renderDeviceChannelMatrix(container, roles, onRoleChange) {
        if (!container) return;
        const r = normalizeRolesArray(roles);
        container._channelRoles = r.slice();
        if (typeof onRoleChange === 'function') {
            container._onRoleChange = onRoleChange;
        }
        container.innerHTML = '';
        container.className = 'dm-channel-matrix';

        for (let i = 0; i < DEVICE_CHANNEL_COUNT; i++) {
            const role = container._channelRoles[i];
            const meta = ROLE_META[role] || ROLE_META.disabled;
            const card = document.createElement('div');
            card.className = `dm-ch-card dm-ch-role-${role}`;
            card.dataset.channelIndex = String(i);
            card.style.setProperty('--ch-accent', meta.color);
            card.style.setProperty('--ch-glow', meta.color + '55');

            card.innerHTML = `
                <div class="dm-ch-card-head">
                    <span class="dm-ch-num">CH ${i + 1}</span>
                    <span class="dm-ch-live" id="dm-ch-live-${i}">— μV</span>
                </div>
                <div class="dm-ch-role-badge" title="${meta.label}">
                    <span class="dm-ch-badge-icon">${roleIconSvg(role)}</span>
                    <span class="dm-ch-badge-text">${meta.short}</span>
                </div>
                <div class="dm-ch-role-pills" role="group" aria-label="Ch${i + 1} 模态">
                    ${ROLE_IDS.map((rid) => {
                        const m = ROLE_META[rid];
                        const active = rid === role ? ' active' : '';
                        return `<button type="button" class="dm-ch-pill dm-ch-pill-${rid}${active}" data-ch="${i}" data-role="${rid}" title="${m.label}" style="--pill-color:${m.color}">${roleIconSvg(rid)}</button>`;
                    }).join('')}
                </div>
            `;
            container.appendChild(card);
        }

        if (!container._roleClickBound) {
            container._roleClickBound = true;
            container.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.dm-ch-pill');
            if (!btn || !container.contains(btn)) return;
            const ch = parseInt(btn.dataset.ch, 10);
            const newRole = btn.dataset.role;
            if (!Number.isFinite(ch) || ch < 0 || ch >= DEVICE_CHANNEL_COUNT) return;
            if (!ROLE_IDS.includes(newRole)) return;

            const current = normalizeRolesArray(container._channelRoles);
            if (current[ch] === newRole) return;

            const next = current.slice();
            next[ch] = newRole;
            container._channelRoles = next;
            const handler = container._onRoleChange;
            if (typeof handler === 'function') handler(next, ch, newRole);
            });
        }
    }

    function refreshDeviceChannelMatrixUi(roles) {
        const root = document.getElementById('dm-channel-matrix-root');
        if (!root) return;
        renderDeviceChannelMatrix(root, roles, root._onRoleChange);
    }

    function updateChannelLiveValues(latestSample) {
        if (!latestSample || !Array.isArray(latestSample)) return;
        for (let i = 0; i < DEVICE_CHANNEL_COUNT; i++) {
            const el = document.getElementById(`dm-ch-live-${i}`);
            if (!el) continue;
            const v = Number(latestSample[i]);
            el.textContent = Number.isFinite(v) ? `${v.toFixed(1)} μV` : '— μV';
        }
    }

    function updateMatrixSummary(roles) {
        const el = document.getElementById('dm-channel-matrix-summary');
        if (!el) return;
        el.textContent = formatRolesSummary(roles);
    }

    global.SSVEP_DEVICE_CHANNEL_CONFIG = {
        FBCCA_OUTPUT_CHANNELS,
        DEVICE_CHANNEL_COUNT,
        STORAGE_KEY,
        ROLE_IDS,
        ROLE_META,
        roleIconSvg,
        defaultRoles,
        migrateStoredRoles,
        normalizeRolesArray,
        loadFullConfig,
        saveFullConfig,
        getGlobalSsvepChannelIndices,
        getGlobalChannelRoles,
        getMultimodalPhysicalIndex,
        getPhysicalChannelsForRole,
        buildFbccaExpansionPlan,
        formatFbccaChannelIndicesLabel,
        formatRolesSummary,
        expandSamplesToFbccaChannels,
        renderDeviceChannelMatrix,
        refreshDeviceChannelMatrixUi,
        updateChannelLiveValues,
        updateMatrixSummary,
        ssvepIndicesFromRoles
    };

    global.SSVEP_FBCCA_CHANNELS = {
        FBCCA_OUTPUT_CHANNELS,
        MAX_PICKER_CHANNELS: DEVICE_CHANNEL_COUNT,
        STORAGE_KEY,
        normalizeChannelIndexList,
        loadSettingsFromStorage: () => loadFullConfig().ssvepChannelIndices,
        saveSettingsToStorage: (indices) => {
            const roles = rolesFromLegacyIndices(indices);
            return saveFullConfig({ channelRoles: roles }).ssvepChannelIndices;
        },
        getGlobalSsvepChannelIndices,
        getGlobalChannelRoles,
        formatFbccaChannelIndicesLabel,
        formatRolesSummary,
        expandSamplesToFbccaChannels
    };
})(typeof window !== 'undefined' ? window : globalThis);
