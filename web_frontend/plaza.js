let plazaSort = 'recent';
let plazaQuery = '';
let plazaTag = '';
let plazaSkip = 0;
const plazaLimit = 24;
let plazaTotal = 0;
let plazaLoading = false;
let plazaDetailId = null;
let plazaDetailProject = null;

let plazaSearchTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('plaza-search')?.addEventListener('input', (e) => {
        plazaQuery = e.target.value.trim();
        if (plazaSearchTimer) clearTimeout(plazaSearchTimer);
        plazaSearchTimer = setTimeout(plazaReload, 320);
    });
    document.getElementById('plaza-detail-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'plaza-detail-modal') closePlazaDetail();
    });
    plazaReload();
});

function plazaSetSort(sort, btn) {
    plazaSort = sort;
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    plazaReload();
}

function plazaSetTag(tag, btn) {
    plazaTag = tag || '';
    document.querySelectorAll('.tag-filter-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    plazaReload();
}

function plazaReload() {
    plazaSkip = 0;
    document.getElementById('plaza-grid').innerHTML = '';
    plazaLoadMore(true);
}

async function plazaLoadMore(reset) {
    if (plazaLoading) return;
    plazaLoading = true;
    const P = window.SSVEP_PLAZA;
    const countEl = document.getElementById('plaza-count');
    if (countEl && reset) countEl.textContent = '加载中…';

    try {
        const data = await P.listProjects({
            sort: plazaSort,
            q: plazaQuery || undefined,
            tag: plazaTag || undefined,
            skip: plazaSkip,
            limit: plazaLimit
        });
        plazaTotal = data.total || 0;
        const items = data.items || [];
        if (countEl) countEl.textContent = `共 ${plazaTotal} 个项目`;

        const grid = document.getElementById('plaza-grid');
        const empty = document.getElementById('plaza-empty');
        if (plazaSkip === 0 && items.length === 0) {
            grid.innerHTML = '';
            empty.style.display = 'block';
        } else {
            empty.style.display = 'none';
            grid.insertAdjacentHTML('beforeend', items.map(renderPlazaCard).join(''));
        }

        plazaSkip += items.length;
        const moreWrap = document.getElementById('plaza-load-more-wrap');
        if (moreWrap) moreWrap.style.display = plazaSkip < plazaTotal ? 'block' : 'none';
    } catch (err) {
        if (countEl) countEl.textContent = '加载失败';
        alert('无法加载项目广场：' + (err.message || err) + '\n\n请确认 Python 后端已启动。');
    } finally {
        plazaLoading = false;
    }
}

function renderThumb(item) {
    const url = item.thumbnail_image;
    if (url && String(url).startsWith('data:image')) {
        return `<img src="${window.SSVEP_PLAZA.escapeHtml(url)}" alt="">`;
    }
    return window.SSVEP_PLAZA.escapeHtml(item.thumbnail || '📊');
}

function renderPlazaCard(item) {
    const P = window.SSVEP_PLAZA;
    const likedCls = item.liked_by_me ? 'btn-liked' : '';
    return `
        <div class="project-card">
            <div class="project-thumbnail">${renderThumb(item)}</div>
            <div class="project-info">
                <div class="project-name">${P.escapeHtml(item.name)}</div>
                <div class="plaza-tag-row">${P.renderTagChips(item.tags)}</div>
                <div class="project-desc">${P.escapeHtml(item.description || '暂无描述')}</div>
                <div class="project-meta">
                    <span>@${P.escapeHtml(item.author_name || '匿名')}</span>
                    <span>${P.formatRelativeTime(item.published_at)}</span>
                </div>
                <div class="project-stats">
                    <span>📄 ${item.page_count || 0} 页</span>
                    <span>🎯 ${item.block_count || 0} 对象</span>
                    <span>👍 ${item.like_count || 0}</span>
                </div>
                <div class="project-actions">
                    <button class="action-btn" onclick="openPlazaDetail('${P.escapeHtml(item.id)}')">查看</button>
                    <button class="action-btn ${likedCls}" id="like-btn-${P.escapeHtml(item.id)}"
                            onclick="plazaCardLike('${P.escapeHtml(item.id)}', event)">
                        ${item.liked_by_me ? '已赞' : '👍 点赞'}
                    </button>
                    <button class="action-btn" onclick="plazaCardImport('${P.escapeHtml(item.id)}', event)">📥 导入</button>
                </div>
            </div>
        </div>
    `;
}

async function openPlazaDetail(id) {
    const P = window.SSVEP_PLAZA;
    try {
        const item = await P.getProject(id);
        plazaDetailId = id;
        plazaDetailProject = item;
        document.getElementById('plaza-detail-title').textContent = item.name || '项目详情';
        document.getElementById('plaza-detail-body').innerHTML = `
            <div class="detail-meta">
                作者：${P.escapeHtml(item.author_name || '匿名')} ·
                版本 v${P.escapeHtml(item.version || '1.0.0')} ·
                ${P.formatRelativeTime(item.published_at)}<br>
                ${item.page_count || 0} 页 · ${item.block_count || 0} 个 SSVEP 对象 · 👍 ${item.like_count || 0}
            </div>
            <div class="plaza-tag-row">${P.renderTagChips(item.tags)}</div>
            <div class="detail-desc">${P.escapeHtml(item.description || '暂无描述')}</div>
            <div class="ip-notice">
                📋 <strong>知识产权说明：</strong>导入后仅供本地学习与运行，项目将标记为「仅导入、不可二次发布」。
            </div>
        `;
        syncDetailLikeBtn(item.liked_by_me);
        document.getElementById('plaza-detail-modal').classList.add('active');
    } catch (err) {
        alert('加载详情失败：' + (err.message || err));
    }
}

function closePlazaDetail() {
    document.getElementById('plaza-detail-modal').classList.remove('active');
    plazaDetailId = null;
    plazaDetailProject = null;
}

function syncDetailLikeBtn(liked) {
    const btn = document.getElementById('plaza-detail-like-btn');
    if (!btn) return;
    btn.textContent = liked ? '已赞 👍' : '👍 点赞';
    btn.classList.toggle('btn-liked', !!liked);
}

function updateCardLikeUi(id, likeCount, liked) {
    const btn = document.getElementById('like-btn-' + id);
    if (btn) {
        btn.textContent = liked ? '已赞' : '👍 点赞';
        btn.classList.toggle('btn-liked', !!liked);
    }
    document.querySelectorAll('.project-card').forEach((card) => {
        const likeBtn = card.querySelector('[id^="like-btn-"]');
        if (likeBtn && likeBtn.id === 'like-btn-' + id) {
            const stats = card.querySelector('.project-stats');
            if (stats) {
                stats.innerHTML = stats.innerHTML.replace(/👍 \d+/, '👍 ' + (likeCount || 0));
            }
        }
    });
}

async function plazaCardLike(id, ev) {
    if (ev) ev.stopPropagation();
    try {
        await window.SSVEP_PLAZA.ensureRegisteredForAction('点赞');
        const res = await window.SSVEP_PLAZA.likeProject(id);
        updateCardLikeUi(id, res.like_count, res.liked_by_me);
        if (plazaDetailId === id) syncDetailLikeBtn(res.liked_by_me);
    } catch (err) {
        if (err.message !== '需要邮箱注册' && err.message !== '需要邮箱验证') {
            alert('点赞失败：' + (err.message || err));
        }
    }
}

function plazaDetailLike() {
    if (plazaDetailId) plazaCardLike(plazaDetailId);
}

async function plazaDetailReport() {
    if (!plazaDetailId) return;
    try {
        await window.SSVEP_PLAZA.ensureRegisteredForAction('举报');
    } catch (_) {
        return;
    }
    const reason = prompt('请简要说明举报原因（侵权、不当内容等）：');
    if (!reason || !reason.trim()) return;
    try {
        await window.SSVEP_PLAZA.reportProject(plazaDetailId, reason.trim());
        alert('举报已提交，感谢您的反馈。');
    } catch (err) {
        alert('举报失败：' + (err.message || err));
    }
}

async function plazaCardImport(id, ev) {
    if (ev) ev.stopPropagation();
    try {
        const item = await window.SSVEP_PLAZA.getProject(id);
        if (!item.content) throw new Error('项目内容为空');
        const clone = window.SSVEP_PLAZA.importProjectToLocal(item.content);
        const msg =
            `「${clone.name}」已导入本地项目。\n\n该项目已标记为「仅导入、不可二次发布」。\n\n是否打开编辑器？`;
        if (confirm(msg)) {
            window.location.href = 'editor.html';
        }
    } catch (err) {
        alert('导入失败：' + (err.message || err));
    }
}

function plazaDetailImport() {
    if (plazaDetailId) plazaCardImport(plazaDetailId);
}
