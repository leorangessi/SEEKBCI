/**
 * 项目广场 API 客户端 + 本机用户 ID。
 */
(function (global) {
    const USER_ID_KEY = 'ssvep_plaza_user_id';
    const PROFILE_KEY = 'ssvep_plaza_profile_cache';

    const PLAZA_TAG_LABELS = {
        keyboard: '键盘',
        drone: '无人机',
        multimodal: '多模态',
        teaching: '教学'
    };

    function resolveApiOrigin() {
        if (typeof global.ssvepResolveApiOrigin === 'function') {
            return global.ssvepResolveApiOrigin().replace(/\/$/, '');
        }
        return 'http://127.0.0.1:28765';
    }

    function getOrCreateUserId() {
        let id = localStorage.getItem(USER_ID_KEY);
        if (!id) {
            id = 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
            localStorage.setItem(USER_ID_KEY, id);
        }
        return id;
    }

    function getCachedProfile() {
        try {
            const raw = localStorage.getItem(PROFILE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function cacheProfile(profile, stats) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ profile, stats, ts: Date.now() }));
    }

    function clearProfileCache() {
        localStorage.removeItem(PROFILE_KEY);
    }

    function setUserId(userId) {
        const id = (userId || '').trim();
        if (!id) return;
        localStorage.setItem(USER_ID_KEY, id);
    }

    /** 退出当前本机账号：清除本机用户 ID 与资料缓存，下次将生成新 ID */
    function logoutAccount() {
        abortPendingProfileFetch();
        localStorage.removeItem(USER_ID_KEY);
        clearProfileCache();
    }

    let activeProfileAbort = null;

    function abortPendingProfileFetch() {
        if (activeProfileAbort) {
            try {
                activeProfileAbort.abort();
            } catch (_) {
                /* ignore */
            }
            activeProfileAbort = null;
        }
    }

    function mergeAbortSignals(timeoutCtrl, userSignal) {
        if (!userSignal) return timeoutCtrl.signal;
        if (userSignal.aborted) {
            timeoutCtrl.abort();
            return timeoutCtrl.signal;
        }
        const linked = new AbortController();
        const relay = () => linked.abort();
        userSignal.addEventListener('abort', relay);
        timeoutCtrl.signal.addEventListener('abort', relay);
        return linked.signal;
    }

    async function plazaFetch(path, options) {
        const origin = resolveApiOrigin();
        const opts = options && typeof options === 'object' ? options : {};
        const timeoutMs = opts.timeoutMs || 8000;
        const timeoutCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = timeoutCtrl ? setTimeout(() => timeoutCtrl.abort(), timeoutMs) : null;
        const headers = Object.assign(
            {
                'Content-Type': 'application/json',
                'X-SSVEP-User-Id': getOrCreateUserId()
            },
            opts.headers || {}
        );
        const fetchOpts = Object.assign({}, opts, { headers });
        if (timeoutCtrl) {
            fetchOpts.signal = mergeAbortSignals(timeoutCtrl, opts.signal);
        }
        delete fetchOpts.timeoutMs;

        let res;
        try {
            res = await fetch(origin + path, fetchOpts);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error(`连接后端超时（${timeoutMs / 1000}s），请确认桌面版/API 已启动`);
            }
            throw new Error('无法连接后端（' + origin + '），请确认 API 已启动');
        } finally {
            if (timer) clearTimeout(timer);
        }
        let data = null;
        try {
            data = await res.json();
        } catch (_) {
            data = null;
        }
        if (!res.ok) {
            const detail = data && (data.detail || data.message);
            throw new Error(typeof detail === 'string' ? detail : `请求失败 (${res.status})`);
        }
        return data;
    }

    async function listProjects(params) {
        const q = new URLSearchParams();
        if (params && params.sort) q.set('sort', params.sort);
        if (params && params.q) q.set('q', params.q);
        if (params && params.tag) q.set('tag', params.tag);
        if (params && params.skip != null) q.set('skip', String(params.skip));
        if (params && params.limit != null) q.set('limit', String(params.limit));
        const qs = q.toString();
        return plazaFetch('/api/plaza/projects' + (qs ? '?' + qs : ''));
    }

    async function getProject(id) {
        return plazaFetch('/api/plaza/projects/' + encodeURIComponent(id));
    }

    async function publishProject(content, description, tags, ipRightsAck) {
        return plazaFetch('/api/plaza/projects', {
            method: 'POST',
            body: JSON.stringify({
                content,
                description: description || null,
                tags: tags || [],
                ip_rights_ack: !!ipRightsAck
            })
        });
    }

    async function unpublishProject(id) {
        return plazaFetch('/api/plaza/projects/' + encodeURIComponent(id), { method: 'DELETE' });
    }

    async function likeProject(id) {
        return plazaFetch('/api/plaza/projects/' + encodeURIComponent(id) + '/like', {
            method: 'POST',
            body: '{}'
        });
    }

    async function reportProject(id, reason) {
        return plazaFetch('/api/plaza/projects/' + encodeURIComponent(id) + '/report', {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    async function getMyProfile(options) {
        abortPendingProfileFetch();
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        activeProfileAbort = ctrl;
        const reqOpts = Object.assign({}, options || {});
        if (ctrl) reqOpts.signal = ctrl.signal;
        try {
            const data = await plazaFetch('/api/plaza/users/me', reqOpts);
            if (ctrl && ctrl.signal.aborted) return null;
            if (data && data.profile) cacheProfile(data.profile, data.stats);
            return data;
        } catch (err) {
            if (ctrl && ctrl.signal.aborted) return null;
            throw err;
        } finally {
            if (activeProfileAbort === ctrl) activeProfileAbort = null;
        }
    }

    async function loginUser(email, password) {
        const data = await plazaFetch('/api/plaza/users/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        if (data && data.account_user_id) {
            setUserId(data.account_user_id);
        }
        if (data && data.profile) cacheProfile(data.profile, data.stats);
        return data;
    }

    async function registerUser(email, displayName, password, passwordConfirm) {
        const data = await plazaFetch('/api/plaza/users/register', {
            method: 'POST',
            body: JSON.stringify({
                email,
                display_name: displayName,
                password,
                password_confirm: passwordConfirm
            })
        });
        if (data && data.profile) cacheProfile(data.profile, data.stats);
        return data;
    }

    async function verifyEmail(code) {
        const data = await plazaFetch('/api/plaza/users/verify-email', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        if (data && data.profile) cacheProfile(data.profile, data.stats);
        return data;
    }

    async function redeemMembership() {
        const data = await plazaFetch('/api/plaza/users/redeem-membership', { method: 'POST', body: '{}' });
        if (data && data.profile) cacheProfile(data.profile, data.stats);
        return data;
    }

    async function updateMyProfile(displayName, bio, avatarOptions) {
        const body = { display_name: displayName, bio: bio };
        if (avatarOptions && typeof avatarOptions === 'object') {
            if ('avatar_image' in avatarOptions) {
                body.avatar_image = avatarOptions.avatar_image == null ? '' : avatarOptions.avatar_image;
            }
            if ('avatar_original_image' in avatarOptions) {
                body.avatar_original_image =
                    avatarOptions.avatar_original_image == null ? '' : avatarOptions.avatar_original_image;
            }
            if (avatarOptions.avatar_display_mode) {
                body.avatar_display_mode = avatarOptions.avatar_display_mode;
            }
            if (avatarOptions.avatar_edit_mode) {
                body.avatar_edit_mode = avatarOptions.avatar_edit_mode;
            }
        }
        const data = await plazaFetch('/api/plaza/users/me', {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if (data && data.profile) cacheProfile(data.profile, data.stats);
        return data;
    }

    function isRegistered(profile) {
        return !!(profile && profile.registered && profile.email && profile.email_verified);
    }

    function isEmailVerified(profile) {
        return !!(profile && profile.email_verified);
    }

    async function ensureRegisteredForAction(actionLabel) {
        let data;
        try {
            data = await getMyProfile();
        } catch (_) {
            data = null;
        }
        const profile = data && data.profile;
        if (isRegistered(profile)) return profile;
        if (profile && profile.email && !profile.email_verified) {
            const go = confirm(
                (actionLabel || '此操作') + '需要先完成邮箱验证。\n\n是否现在前往个人中心？'
            );
            if (go) window.location.href = 'profile.html';
            throw new Error('需要邮箱验证');
        }
        const go = confirm(
            (actionLabel || '此操作') + '需要先在个人中心登录或注册并完成邮箱验证。\n\n是否现在前往个人中心？'
        );
        if (go) window.location.href = 'profile.html';
        throw new Error('需要邮箱注册');
    }

    async function listMyProjects() {
        return plazaFetch('/api/plaza/users/me/projects');
    }

    function renderTagChips(tags) {
        const list = Array.isArray(tags) ? tags : [];
        if (!list.length) return '';
        return list
            .map((t) => {
                const label = PLAZA_TAG_LABELS[t] || t;
                return `<span class="plaza-tag-chip">${escapeHtml(label)}</span>`;
            })
            .join('');
    }

    /** 将广场项目导入本地项目管理器（标记为仅导入、不可二次发布） */
    function importProjectToLocal(content) {
        if (!content || typeof content !== 'object') throw new Error('项目内容无效');
        let clone = JSON.parse(JSON.stringify(content));
        if (global.SEEKBCI_PROJECT_CONTRACT) {
            clone = global.SEEKBCI_PROJECT_CONTRACT.assertValidProject(
                global.SEEKBCI_PROJECT_CONTRACT.ensureContractVersion(clone),
                '导入项目'
            );
        }
        clone.id = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        clone.updated_at = new Date().toISOString();
        if (!clone.created_at) clone.created_at = clone.updated_at;
        clone.importOnlyNoRepublish = true;
        clone.importedFromPlaza = true;

        let projects = [];
        try {
            const saved = localStorage.getItem('ssvep_projects');
            if (saved) projects = JSON.parse(saved);
            if (!Array.isArray(projects)) projects = [];
        } catch (_) {
            projects = [];
        }
        projects.unshift(clone);
        localStorage.setItem('ssvep_projects', JSON.stringify(projects));
        localStorage.setItem('ssvep_project', JSON.stringify(clone));
        return clone;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatRelativeTime(iso) {
        if (!iso) return '—';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';
        const diff = Date.now() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return minutes + ' 分钟前';
        if (hours < 24) return hours + ' 小时前';
        if (days < 7) return days + ' 天前';
        return date.toLocaleDateString('zh-CN');
    }

    global.SSVEP_PLAZA = {
        resolveApiOrigin,
        getOrCreateUserId,
        setUserId,
        getCachedProfile,
        logoutAccount,
        abortPendingProfileFetch,
        listProjects,
        getProject,
        publishProject,
        unpublishProject,
        likeProject,
        reportProject,
        getMyProfile,
        loginUser,
        registerUser,
        verifyEmail,
        redeemMembership,
        updateMyProfile,
        listMyProjects,
        isRegistered,
        isEmailVerified,
        ensureRegisteredForAction,
        importProjectToLocal,
        escapeHtml,
        formatRelativeTime,
        PLAZA_TAG_LABELS,
        renderTagChips
    };
})(typeof window !== 'undefined' ? window : globalThis);
