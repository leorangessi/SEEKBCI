let pendingDevVerifyCode = null;
/** 用户正在编辑任意表单字段时，后台同步不覆盖输入 */
let profileFormTouched = false;
/** 退出登录后为 true，阻止后台请求改写登录/注册界面 */
let profileAuthLocked = false;
/** 递增后，进行中的 loadProfilePage 结果会被丢弃 */
let profileApplyToken = 0;
let currentAuthTab = 'login';
/** 当前资料页头像草稿（点头像编辑后立即保存到服务端） */
let profileAvatarDraft = { image: null, originalImage: null, displayMode: 'stretch', editMode: 'fit' };

const PROFILE_FORM_INPUT_IDS = [
    'login-email', 'login-password',
    'register-email', 'register-name', 'register-password', 'register-password2',
    'verify-code', 'profile-name', 'profile-bio'
];

const AUTH_FORM_INPUT_IDS = [
    'login-email', 'login-password',
    'register-email', 'register-name', 'register-password', 'register-password2',
    'verify-code'
];

function bumpProfileApplyToken() {
    profileApplyToken += 1;
    return profileApplyToken;
}

function updateUserIdHints(uid) {
    const idEl = document.getElementById('profile-user-id');
    const idRegEl = document.getElementById('profile-user-id-reg');
    if (idEl) idEl.textContent = uid;
    if (idRegEl) idRegEl.textContent = uid;
}

function resetAuthForms() {
    AUTH_FORM_INPUT_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function enableAuthFormInputs() {
    AUTH_FORM_INPUT_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = false;
        el.readOnly = false;
        el.removeAttribute('aria-disabled');
    });
    const card = document.getElementById('profile-auth-card');
    if (card) {
        card.style.pointerEvents = '';
        card.style.opacity = '';
    }
}

function bindProfileFormGuard() {
    PROFILE_FORM_INPUT_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const markTouched = () => {
            profileFormTouched = true;
        };
        el.addEventListener('pointerdown', markTouched, true);
        el.addEventListener('focus', markTouched);
        el.addEventListener('input', markTouched);
    });
}

let profileConfirmResolver = null;

function restorePageFocus(inputId) {
    try {
        window.focus();
    } catch (_) {
        /* ignore */
    }
    const electron = window.ssvepElectron;
    if (electron && typeof electron.focusAppWindow === 'function') {
        electron.focusAppWindow().catch(() => {});
    }
    const id = inputId || (currentAuthTab === 'register' ? 'register-email' : 'login-email');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const el = document.getElementById(id);
            if (el && el.offsetParent !== null) {
                el.focus({ preventScroll: true });
            }
        });
    });
}

function closeProfileConfirm(result) {
    const overlay = document.getElementById('profile-confirm-overlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
    }
    const resolve = profileConfirmResolver;
    profileConfirmResolver = null;
    if (typeof resolve === 'function') {
        resolve(!!result);
    }
}

function openProfileConfirm(opts) {
    const options = opts || {};
    return new Promise((resolve) => {
        if (profileConfirmResolver) {
            closeProfileConfirm(false);
        }
        profileConfirmResolver = resolve;
        const overlay = document.getElementById('profile-confirm-overlay');
        const titleEl = document.getElementById('profile-confirm-title');
        const msgEl = document.getElementById('profile-confirm-message');
        const okBtn = document.getElementById('profile-confirm-ok');
        const cancelBtn = document.getElementById('profile-confirm-cancel');
        if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) {
            resolve(false);
            profileConfirmResolver = null;
            return;
        }
        titleEl.textContent = options.title || '确认';
        msgEl.textContent = options.message || '';
        okBtn.textContent = options.confirmText || '确定';
        cancelBtn.textContent = options.cancelText || '取消';
        okBtn.classList.toggle('danger', !!options.danger);
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        cancelBtn.onclick = () => {
            closeProfileConfirm(false);
            restorePageFocus(options.restoreFocusId);
        };
        okBtn.onclick = () => {
            closeProfileConfirm(true);
        };
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                closeProfileConfirm(false);
                restorePageFocus(options.restoreFocusId);
            }
        };
        setTimeout(() => cancelBtn.focus(), 0);
    });
}

function showProfileStatus(message, kind) {
    const el = document.getElementById('profile-status-hint');
    if (!el) return;
    if (!message) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    el.style.display = 'block';
    el.textContent = message;
    el.className = kind === 'error' ? 'error-banner' : 'info-banner';
}

document.addEventListener('DOMContentLoaded', () => {
    updateUserIdHints(window.SSVEP_PLAZA.getOrCreateUserId());
    bindProfileFormGuard();

    const cached = window.SSVEP_PLAZA.getCachedProfile();
    if (cached && cached.profile && cached.profile.email) {
        profileAuthLocked = false;
        applyProfileUiFromData(cached);
        loadProfilePage();
        return;
    }

    profileAuthLocked = false;
    showAuthUi('login');
});

function switchAuthTab(tab) {
    currentAuthTab = tab === 'register' ? 'register' : 'login';
    const loginTab = document.getElementById('auth-tab-login');
    const regTab = document.getElementById('auth-tab-register');
    const loginPanel = document.getElementById('auth-login-panel');
    const regPanel = document.getElementById('auth-register-panel');
    if (loginTab) loginTab.classList.toggle('active', currentAuthTab === 'login');
    if (regTab) regTab.classList.toggle('active', currentAuthTab === 'register');
    if (loginPanel) loginPanel.style.display = currentAuthTab === 'login' ? 'block' : 'none';
    if (regPanel) regPanel.style.display = currentAuthTab === 'register' ? 'block' : 'none';
    enableAuthFormInputs();
}

function setProfileLoading(on) {
    const el = document.getElementById('profile-loading-hint');
    if (el) el.style.display = on ? 'block' : 'none';
}

function hideAllProfileCards() {
    ['profile-auth-card', 'profile-verify-card', 'profile-main-card', 'profile-published-section'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function showAuthUi(tab, options) {
    const opts = options || {};
    hideAllProfileCards();
    const card = document.getElementById('profile-auth-card');
    if (card) card.style.display = 'block';
    switchAuthTab(tab || currentAuthTab || 'login');
    if (!opts.keepTouched) {
        profileFormTouched = false;
    }
    enableAuthFormInputs();
    setProfileLoading(false);
}

function showVerifyUi(email) {
    if (profileAuthLocked) return;
    hideAllProfileCards();
    document.getElementById('profile-verify-card').style.display = 'block';
    document.getElementById('verify-email-display').textContent = email || '—';
    const hint = document.getElementById('dev-verify-hint');
    if (pendingDevVerifyCode && hint) {
        hint.style.display = 'block';
        hint.textContent = '开发模式验证码：' + pendingDevVerifyCode;
    } else if (hint) {
        hint.style.display = 'none';
    }
}

function showRegisteredUi() {
    if (profileAuthLocked) return;
    hideAllProfileCards();
    document.getElementById('profile-main-card').style.display = 'block';
    document.getElementById('profile-published-section').style.display = 'block';
}

function applyProfileUiFromData(data, options) {
    if (profileAuthLocked && !(options && options.force)) {
        return false;
    }
    const opts = options || {};
    const profile = (data && data.profile) || {};
    if (!profile.email) {
        if (!profileFormTouched || opts.force) showAuthUi(currentAuthTab || 'login');
        return false;
    }
    if (!profile.email_verified) {
        if (!profileFormTouched || opts.force) {
            profileFormTouched = false;
            showVerifyUi(profile.email);
        }
        return true;
    }
    showRegisteredUi();
    if (!profileFormTouched || opts.force) {
        profileFormTouched = false;
        document.getElementById('profile-email').value = profile.email || '';
        document.getElementById('profile-name').value = profile.display_name || '';
        document.getElementById('profile-bio').value = profile.bio || '';
        applyProfileAvatarUi(profile);
    } else {
        applyProfileAvatarUi(profile);
    }
    document.getElementById('stat-published').textContent = data.stats?.published_count ?? 0;
    document.getElementById('stat-likes').textContent = data.stats?.total_likes_received ?? 0;
    updateMemberUi(profile, data.stats);
    if (data.account_user_id) {
        updateUserIdHints(data.account_user_id);
    }
    return true;
}

function memberLabel(tier) {
    return tier === 'member' ? '会员' : '免费';
}

function updateMemberUi(profile, stats) {
    const pts = stats?.points ?? profile?.points ?? 0;
    const tier = stats?.membership_tier ?? profile?.membership_tier ?? 'free';
    const cost = stats?.member_points_cost ?? 1000;
    document.getElementById('stat-points').textContent = pts;
    document.getElementById('stat-member').textContent = memberLabel(tier);
    const redeemBtn = document.getElementById('redeem-member-btn');
    const hint = document.getElementById('member-hint');
    if (tier === 'member') {
        redeemBtn.style.display = 'none';
        hint.textContent = '您已是会员（积分兑换功能占位，规则后续完善）。';
    } else {
        redeemBtn.style.display = 'inline-block';
        hint.textContent = `积分可兑换会员（占位）：当前需要 ${cost} 积分。`;
    }
}

async function loadProfilePage() {
    if (profileAuthLocked) return;

    const loadId = profileApplyToken;
    const errEl = document.getElementById('profile-error');
    errEl.style.display = 'none';
    setProfileLoading(true);
    try {
        const data = await window.SSVEP_PLAZA.getMyProfile({ timeoutMs: 4000 });
        if (profileAuthLocked || loadId !== profileApplyToken || !data) return;
        if (!profileFormTouched) {
            applyProfileUiFromData(data);
        } else {
            syncProfileStatsOnly(data);
        }
        const profile = data.profile || {};
        if (profile.email && profile.email_verified) {
            loadMyPlazaProjects().catch(() => {
                /* 列表失败不阻断资料页 */
            });
        }
    } catch (err) {
        if (profileAuthLocked || loadId !== profileApplyToken) return;
        const cached = window.SSVEP_PLAZA.getCachedProfile();
        if (cached && cached.profile && cached.profile.email) {
            if (!profileFormTouched) applyProfileUiFromData(cached);
            else syncProfileStatsOnly(cached);
        } else if (!profileFormTouched) {
            showAuthUi(currentAuthTab || 'login');
            errEl.textContent =
                (err.message || err) + '。您仍可先登录或注册；提交时会再次连接后端。';
            errEl.style.display = 'block';
        }
    } finally {
        setProfileLoading(false);
    }
}

function syncProfileStatsOnly(data) {
    const profile = (data && data.profile) || {};
    if (!profile.email) return;
    const pub = document.getElementById('stat-published');
    const likes = document.getElementById('stat-likes');
    if (pub) pub.textContent = data.stats?.published_count ?? 0;
    if (likes) likes.textContent = data.stats?.total_likes_received ?? 0;
    updateMemberUi(profile, data.stats);
}

async function loginProfile() {
    const email = document.getElementById('login-email').value.trim();
    const pwd = document.getElementById('login-password').value;
    if (!email) {
        alert('请填写邮箱');
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('邮箱格式不正确');
        return;
    }
    if (pwd.length < 6) {
        alert('密码至少 6 位');
        return;
    }
    profileAuthLocked = false;
    bumpProfileApplyToken();
    setProfileLoading(true);
    showProfileStatus('', '');
    try {
        const data = await window.SSVEP_PLAZA.loginUser(email, pwd);
        profileFormTouched = false;
        applyProfileUiFromData(data, { force: true });
        updateUserIdHints(window.SSVEP_PLAZA.getOrCreateUserId());
        if (data.profile && data.profile.email_verified) {
            showProfileStatus('登录成功，可直接编辑资料或管理已发布项目。', 'ok');
            loadMyPlazaProjects().catch(() => {});
        } else if (data.profile && data.profile.email) {
            showProfileStatus('登录成功，请先完成邮箱验证。', 'ok');
        }
    } catch (err) {
        showProfileStatus('登录失败：' + (err.message || err), 'error');
    } finally {
        setProfileLoading(false);
    }
}

async function registerProfile() {
    const email = document.getElementById('register-email').value.trim();
    const name = document.getElementById('register-name').value.trim();
    const pwd = document.getElementById('register-password').value;
    const pwd2 = document.getElementById('register-password2').value;
    if (!email) {
        alert('请填写邮箱');
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('邮箱格式不正确');
        return;
    }
    if (!name) {
        alert('请填写显示名称');
        return;
    }
    if (pwd.length < 6) {
        alert('密码至少 6 位');
        return;
    }
    if (pwd !== pwd2) {
        alert('两次输入的密码不一致');
        return;
    }
    profileAuthLocked = false;
    bumpProfileApplyToken();
    setProfileLoading(true);
    showProfileStatus('', '');
    try {
        const data = await window.SSVEP_PLAZA.registerUser(email, name, pwd, pwd2);
        pendingDevVerifyCode = data.dev_verify_code || null;
        profileFormTouched = false;
        applyProfileUiFromData(data, { force: true });
        showProfileStatus(
            pendingDevVerifyCode
                ? '注册成功！开发模式验证码已显示在验证页。'
                : '注册成功！请查收邮箱验证码。',
            'ok'
        );
    } catch (err) {
        showProfileStatus('注册失败：' + (err.message || err), 'error');
    } finally {
        setProfileLoading(false);
    }
}

async function verifyProfileEmail() {
    const code = document.getElementById('verify-code').value.trim();
    if (!code) {
        alert('请输入验证码');
        return;
    }
    profileAuthLocked = false;
    bumpProfileApplyToken();
    setProfileLoading(true);
    try {
        await window.SSVEP_PLAZA.verifyEmail(code);
        pendingDevVerifyCode = null;
        profileFormTouched = false;
        showProfileStatus('邮箱验证成功！现在可以分享项目与点赞了。', 'ok');
        await loadProfilePage();
    } catch (err) {
        showProfileStatus('验证失败：' + (err.message || err), 'error');
    } finally {
        setProfileLoading(false);
    }
}

async function redeemMember() {
    const ok = await openProfileConfirm({
        title: '积分兑换会员',
        message: '使用积分兑换会员？（占位功能，规则后续完善）',
        confirmText: '兑换'
    });
    if (!ok) {
        restorePageFocus('profile-name');
        return;
    }
    try {
        const data = await window.SSVEP_PLAZA.redeemMembership();
        updateMemberUi(data.profile, data.stats);
        showProfileStatus('兑换成功！', 'ok');
    } catch (err) {
        showProfileStatus('兑换失败：' + (err.message || err), 'error');
    }
}

function avatarObjectFit() {
    // 头像展示图已按 1:1 烘焙，圆形区域铺满即可
    return 'cover';
}

function applyProfileAvatarUi(profile) {
    const img = document.getElementById('profile-avatar-img');
    const letter = document.getElementById('profile-avatar-letter');
    if (!img || !letter) return;
    const name = (profile && profile.display_name) || document.getElementById('profile-name')?.value || '?';
    const mode = (profile && profile.avatar_display_mode) || profileAvatarDraft.displayMode || 'stretch';
    const url = (profile && profile.avatar_image) || profileAvatarDraft.image;
    profileAvatarDraft = {
        image: url || null,
        originalImage: (profile && profile.avatar_original_image) || profileAvatarDraft.originalImage || null,
        displayMode: mode,
        editMode: (profile && profile.avatar_edit_mode) || profileAvatarDraft.editMode || 'fit'
    };
    if (url) {
        img.src = url;
        img.style.display = 'block';
        img.style.objectFit = avatarObjectFit();
        letter.style.display = 'none';
    } else {
        img.style.display = 'none';
        img.removeAttribute('src');
        letter.style.display = 'flex';
        letter.textContent = String(name).trim().charAt(0).toUpperCase() || '?';
        profileAvatarDraft.originalImage = null;
    }
}

async function openProfileAvatarEditor() {
    const editor = window.SSVEP_IMAGE_DISPLAY_EDITOR;
    if (!editor || typeof editor.open !== 'function') {
        alert('图片编辑器未加载，请刷新页面后重试');
        return;
    }
    editor.open({
        title: '编辑头像',
        originalImage: profileAvatarDraft.originalImage || null,
        image: profileAvatarDraft.originalImage || profileAvatarDraft.image,
        displayMode: profileAvatarDraft.displayMode || 'stretch',
        editMode: profileAvatarDraft.editMode || 'fit',
        aspectRatio: 1,
        outputWidth: 256,
        outputHeight: 256,
        emptyHint: '点击下方「上传图片」选择头像',
        showRestore: false,
        getDefaultImage: async () => null,
        onConfirm: async ({ image, originalImage, displayMode, editMode, restored }) => {
            const name = document.getElementById('profile-name').value.trim();
            const bio = document.getElementById('profile-bio').value.trim();
            if (!name) {
                alert('请先填写显示名称后再设置头像');
                return;
            }
            try {
                setProfileLoading(true);
                const clearing = !!(restored && !image);
                const data = await window.SSVEP_PLAZA.updateMyProfile(name, bio, {
                    avatar_image: clearing ? '' : image,
                    avatar_original_image: clearing ? '' : (originalImage || ''),
                    avatar_display_mode: clearing ? 'fit' : (displayMode || 'stretch'),
                    avatar_edit_mode: clearing ? 'fit' : (editMode || 'fit')
                });
                profileFormTouched = false;
                applyProfileUiFromData(data, { force: true });
                showProfileStatus(clearing ? '已还原默认头像' : '头像已更新', 'ok');
            } catch (err) {
                showProfileStatus('头像保存失败：' + (err.message || err), 'error');
            } finally {
                setProfileLoading(false);
            }
        }
    });
}

async function saveProfile() {
    const name = document.getElementById('profile-name').value.trim();
    const bio = document.getElementById('profile-bio').value.trim();
    if (!name) {
        alert('请填写显示名称');
        return;
    }
    try {
        const data = await window.SSVEP_PLAZA.updateMyProfile(name, bio);
        document.getElementById('stat-published').textContent = data.stats?.published_count ?? 0;
        document.getElementById('stat-likes').textContent = data.stats?.total_likes_received ?? 0;
        updateMemberUi(data.profile, data.stats);
        applyProfileAvatarUi(data.profile || {});
        showProfileStatus('资料已保存', 'ok');
    } catch (err) {
        showProfileStatus('保存失败：' + (err.message || err), 'error');
    }
}

function finishLogoutUi() {
    bumpProfileApplyToken();
    if (window.SSVEP_PLAZA.abortPendingProfileFetch) {
        window.SSVEP_PLAZA.abortPendingProfileFetch();
    }
    window.SSVEP_PLAZA.logoutAccount();
    pendingDevVerifyCode = null;
    profileAuthLocked = true;
    profileFormTouched = false;
    resetAuthForms();
    updateUserIdHints(window.SSVEP_PLAZA.getOrCreateUserId());
    showAuthUi('login');
    const errEl = document.getElementById('profile-error');
    if (errEl) errEl.style.display = 'none';
    showProfileStatus('已退出账号，可立即登录或注册。', 'ok');
    setProfileLoading(false);
}

async function logoutProfile() {
    const ok = await openProfileConfirm({
        title: '退出账号',
        message:
            '确定退出当前账号？\n\n将清除本机账号绑定并生成新的用户 ID。本地项目文件不会删除，但广场分享/点赞将关联到新账号。',
        confirmText: '退出',
        danger: true,
        restoreFocusId: 'login-email'
    });
    if (!ok) {
        restorePageFocus(currentAuthTab === 'register' ? 'register-email' : 'login-email');
        return;
    }
    finishLogoutUi();
    restorePageFocus('login-email');
}

async function loadMyPlazaProjects() {
    if (profileAuthLocked) return;
    const P = window.SSVEP_PLAZA;
    const grid = document.getElementById('my-plaza-grid');
    const empty = document.getElementById('my-plaza-empty');
    const data = await P.listMyProjects();
    const items = data.items || [];
    if (items.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    grid.innerHTML = items
        .map(
            (item) => `
        <div class="project-card">
            <div class="project-thumbnail">${renderThumb(item)}</div>
            <div class="project-info">
                <div class="project-name">${P.escapeHtml(item.name)}</div>
                <div class="plaza-tag-row">${P.renderTagChips(item.tags)}</div>
                <div class="project-desc">${P.escapeHtml(item.description || '暂无描述')}</div>
                <div class="project-meta">
                    <span>v${P.escapeHtml(item.version || '1.0.0')}</span>
                    <span>${P.formatRelativeTime(item.updated_at)}</span>
                </div>
                <div class="project-stats">
                    <span>👍 ${item.like_count || 0}</span>
                    <span>📄 ${item.page_count || 0} 页</span>
                </div>
                <div class="project-actions">
                    <button class="action-btn" onclick="window.location.href='plaza.html'">在广场查看</button>
                    <button class="action-btn btn-danger" onclick="unpublishMine('${P.escapeHtml(item.id)}')">下架</button>
                </div>
            </div>
        </div>
    `
        )
        .join('');
}

function renderThumb(item) {
    const url = item.thumbnail_image;
    if (url && String(url).startsWith('data:image')) {
        return `<img src="${window.SSVEP_PLAZA.escapeHtml(url)}" alt="">`;
    }
    return window.SSVEP_PLAZA.escapeHtml(item.thumbnail || '📊');
}

async function unpublishMine(id) {
    const ok = await openProfileConfirm({
        title: '下架项目',
        message: '确定从项目广场下架该项目？\n点赞记录也会清除。',
        confirmText: '下架',
        danger: true,
        restoreFocusId: 'profile-name'
    });
    if (!ok) {
        restorePageFocus('profile-name');
        return;
    }
    try {
        await window.SSVEP_PLAZA.unpublishProject(id);
        await loadProfilePage();
        showProfileStatus('已下架', 'ok');
    } catch (err) {
        showProfileStatus('下架失败：' + (err.message || err), 'error');
    }
}
