// 项目管理 JavaScript

/** keyboard-binding.js 未加载时的降级，避免 validateProject 内调用报错导致「运行」无反应 */
(function ensureKeyboardBindingShimPm() {
    if (typeof window.parseKeyboardBinding === 'function') return;
    console.warn('[项目管理] keyboard-binding 未就绪，使用内置键盘绑定解析');
    window.parseKeyboardBinding = function (raw) {
        if (raw == null || raw === '') return null;
        const s = String(raw).trim();
        if (!s) return null;
        if (s.startsWith('{')) {
            try {
                const o = JSON.parse(s);
                if (o && o.v === 1 && Array.isArray(o.chords)) return o;
            } catch (_) {
                /* ignore */
            }
        }
        return { v: 1, legacyText: s };
    };
    window.hasKeyboardBinding = function (binding) {
        if (!binding) return false;
        if (binding.legacyText) return binding.legacyText.length > 0;
        return Array.isArray(binding.chords) && binding.chords.length > 0;
    };
})();

function pmGetBlockActions(block) {
    if (!block || typeof block !== 'object') return [];
    if (Array.isArray(block.actions) && block.actions.length > 0) return block.actions;
    if (block.action && typeof block.action === 'object') return [block.action];
    return [];
}

// 全局变量
let projects = [];
let currentView = 'grid';
let currentSort = 'updated';
let editingProjectId = null;

let pmThumbnailDraft = {
    source: 'canvas',
    image: null,
    originalImage: null,
    displayMode: 'fit',
    editMode: 'fit',
    cleared: false
};

const PM_THUMBNAIL_DISPLAY_MODES = {
    fit: 'fill',
    stretch: 'fill',
    crop: 'fill',
    cover: 'fill'
};

/** 将内置示例项目合并进列表（按固定 id，不重复添加） */
function seedSampleProjects(options) {
    const samples = window.SSVEP_SAMPLE_PROJECTS;
    if (!Array.isArray(samples) || samples.length === 0) return 0;

    const forceRefresh = !!(options && options.forceRefresh);
    const existingById = new Map(projects.map((p) => [p.id, p]));
    let added = 0;
    let updated = 0;

    for (const sample of samples) {
        if (!isValidProjectRecord(sample)) continue;
        const clone = JSON.parse(JSON.stringify(sample));
        const cur = existingById.get(clone.id);
        if (!cur) {
            projects.push(clone);
            existingById.set(clone.id, clone);
            added++;
            continue;
        }
        if (forceRefresh && clone.sampleKey && cur.sampleKey !== clone.sampleKey) {
            const idx = projects.findIndex((p) => p.id === clone.id);
            if (idx >= 0) {
                projects[idx] = clone;
                updated++;
            }
        }
    }

    if (added > 0 || updated > 0) saveProjects();
    if (added > 0) {
        console.info(`[项目管理] 已加载 ${added} 个示例项目`);
    }
    return added;
}

function importSampleProjectsManually() {
    const added = seedSampleProjects({ forceRefresh: false });
    renderProjects();
    if (added > 0) {
        alert(`已导入 ${added} 个示例项目。\n\n• 脑控音乐盒\n• 脑控骰子运势站`);
    } else {
        alert('示例项目已在列表中。\n\n如需重新导出，可在编辑器中修改后另存为新项目。');
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    seedSampleProjects();
    renderProjects();

    // 搜索功能
    document.getElementById('search-input').addEventListener('input', (e) => {
        filterProjects(e.target.value);
    });

    // 表单提交
    document.getElementById('project-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveProject();
    });

    document.getElementById('pm-thumbnail-preview-box')?.addEventListener('click', () => {
        openProjectThumbnailEditor();
    });

    const projectModal = document.getElementById('project-modal');
    if (projectModal) {
        projectModal.addEventListener('click', (e) => {
            if (e.target.id === 'project-modal') {
                closeModal();
            }
        });
    }

    const runBackdrop = (id, onBackdrop) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', (e) => {
            if (e.target === el) onBackdrop();
        });
    };
    runBackdrop('run-config-modal', closeRunConfigModal);
    runBackdrop('run-config-modal-threshold', closeRunThresholdParamModal);
    runBackdrop('run-config-modal-interval', closeRunIntervalParamModal);
});

function isValidProjectRecord(project) {
    if (!project || typeof project !== 'object') return false;
    if (typeof project.id !== 'string' || !project.id.trim()) return false;
    if (typeof project.name !== 'string' || !String(project.name).trim()) return false;
    if (!Array.isArray(project.pages)) return false;
    return true;
}

/** 移除无效条目（无 id/名称、无 pages 等），避免列表出现 Invalid Date / undefined */
function purgeInvalidProjects() {
    const before = projects.length;
    projects = projects.filter(isValidProjectRecord);
    const removed = before - projects.length;
    if (removed > 0) {
        saveProjects();
        console.warn(`[项目管理] 已自动清除 ${removed} 个无效项目`);
    }
    try {
        const cur = localStorage.getItem('ssvep_project');
        if (cur) {
            const p = JSON.parse(cur);
            if (!isValidProjectRecord(p)) {
                localStorage.removeItem('ssvep_project');
                console.warn('[项目管理] 已清除无效的当前编辑缓存 ssvep_project');
            }
        }
    } catch (_) {
        localStorage.removeItem('ssvep_project');
    }
    return removed;
}

// 加载项目列表
function loadProjects() {
    const saved = localStorage.getItem('ssvep_projects');
    if (saved) {
        try {
            projects = JSON.parse(saved);
            if (!Array.isArray(projects)) projects = [];
        } catch (error) {
            console.error('加载项目失败:', error);
            projects = [];
        }
    }
    purgeInvalidProjects();
}

// 保存项目列表
function saveProjects() {
    localStorage.setItem('ssvep_projects', JSON.stringify(projects));
}

function ensureProjectCanvasThumbnail(project) {
    if (!project) return;
    if (project.thumbnailSource === 'custom' && project.thumbnailImage) return;
    const TH = window.SSVEP_PROJECT_THUMBNAIL;
    if (TH && typeof TH.refreshProjectThumbnailFromCanvas === 'function') {
        TH.refreshProjectThumbnailFromCanvas(project, 0);
    }
}

function escapeAttrPm(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function renderProjectThumbnailInner(project) {
    const url = project && project.thumbnailImage;
    if (url && (String(url).startsWith('data:image') || String(url).startsWith('http') || String(url).startsWith('blob:'))) {
        // thumbnailImage 已按 16:9 烘焙，铺满即可与编辑预览一致
        return `<img src="${escapeAttrPm(url)}" alt="" style="object-fit:fill">`;
    }
    return escapeHtmlPm(project.thumbnail || '📊');
}

function updatePmThumbnailPreviewUi() {
    const box = document.getElementById('pm-thumbnail-preview-box');
    const img = document.getElementById('pm-thumbnail-preview-img');
    const ph = document.getElementById('pm-thumbnail-placeholder');
    if (!box || !img || !ph) return;
    box.style.display = 'flex';
    if (pmThumbnailDraft.image) {
        ph.style.display = 'none';
        img.style.display = 'block';
        img.style.objectFit = 'fill';
        img.src = pmThumbnailDraft.image;
    } else {
        img.style.display = 'none';
        img.removeAttribute('src');
        ph.style.display = 'block';
    }
}

function getEditingProjectForThumbnail() {
    const id = document.getElementById('project-id')?.value;
    return id ? projects.find((p) => p.id === id) : null;
}

function loadPmThumbnailDraftFromProject(project) {
    if (project && project.thumbnailImage) {
        pmThumbnailDraft = {
            source: project.thumbnailSource === 'custom' ? 'custom' : 'canvas',
            image: project.thumbnailImage,
            originalImage: project.thumbnailOriginalImage || null,
            displayMode: project.thumbnailDisplayMode || 'stretch',
            editMode: project.thumbnailEditMode || 'fit',
            cleared: false
        };
    } else if (project) {
        ensureProjectCanvasThumbnail(project);
        pmThumbnailDraft = {
            source: 'canvas',
            image: project.thumbnailImage || null,
            originalImage: null,
            displayMode: 'stretch',
            editMode: 'fit',
            cleared: false
        };
    } else {
        pmThumbnailDraft = {
            source: 'canvas',
            image: null,
            originalImage: null,
            displayMode: 'fit',
            editMode: 'fit',
            cleared: false
        };
    }
    updatePmThumbnailPreviewUi();
}

function openProjectThumbnailEditor() {
    const editor = window.SSVEP_IMAGE_DISPLAY_EDITOR;
    if (!editor || typeof editor.open !== 'function') {
        alert('图片编辑器未加载，请刷新页面后重试');
        return;
    }
    const project = getEditingProjectForThumbnail();
    editor.open({
        title: '编辑项目图标',
        originalImage: pmThumbnailDraft.originalImage || null,
        image: pmThumbnailDraft.originalImage || pmThumbnailDraft.image,
        displayMode: pmThumbnailDraft.displayMode || 'fit',
        editMode: pmThumbnailDraft.editMode || 'fit',
        aspectRatio: 16 / 9,
        outputWidth: 400,
        outputHeight: 225,
        emptyHint: '点击下方「上传图片」选择项目图标',
        getDefaultImage: async () => {
            if (!project) {
                return null;
            }
            // 优先用编辑器缓存里的最新 pages / layout，避免列表里坐标或画布尺寸过期
            try {
                const raw = localStorage.getItem('ssvep_project');
                if (raw) {
                    const cur = JSON.parse(raw);
                    if (cur && cur.id === project.id && Array.isArray(cur.pages)) {
                        project.pages = cur.pages;
                    }
                }
            } catch (_) {
                /* ignore */
            }
            if (project.thumbnailSource === 'custom') {
                delete project.thumbnailImage;
                delete project.thumbnailOriginalImage;
                project.thumbnailSource = 'canvas';
            }
            const TH = window.SSVEP_PROJECT_THUMBNAIL;
            if (TH && typeof TH.refreshProjectThumbnailFromCanvas === 'function') {
                TH.refreshProjectThumbnailFromCanvas(project, 0);
            } else {
                ensureProjectCanvasThumbnail(project);
            }
            return project.thumbnailImage || null;
        },
        onConfirm: ({ image, originalImage, displayMode, editMode, restored }) => {
            if (restored && !image) {
                pmThumbnailDraft = {
                    source: 'canvas',
                    image: null,
                    originalImage: null,
                    displayMode: 'fit',
                    editMode: 'fit',
                    cleared: true
                };
            } else if (image) {
                pmThumbnailDraft = {
                    source: restored ? 'canvas' : 'custom',
                    image,
                    originalImage: restored ? null : (originalImage || null),
                    displayMode: displayMode || 'stretch',
                    editMode: editMode || 'fit',
                    cleared: false
                };
                if (restored && project) {
                    project.thumbnailImage = image;
                    project.thumbnailSource = 'canvas';
                    delete project.thumbnailOriginalImage;
                }
            }
            updatePmThumbnailPreviewUi();
        }
    });
}

    // 渲染项目列表
function renderProjects() {
    const gridContainer = document.getElementById('projects-grid');
    const listContainer = document.getElementById('projects-list');
    const emptyState = document.getElementById('empty-state');
    
    if (projects.length === 0) {
        gridContainer.style.display = 'none';
        listContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    // 排序
    sortProjectsArray();

    let thumbsDirty = false;
    for (const project of projects) {
        if (!project.thumbnailImage && project.thumbnailSource !== 'custom') {
            ensureProjectCanvasThumbnail(project);
            thumbsDirty = true;
        }
    }
    if (thumbsDirty) saveProjects();
    
    // 网格视图
    gridContainer.innerHTML = projects.map(project => `
        <div class="project-card" onclick="openProject('${project.id}')">
            <div class="project-thumbnail">
                ${renderProjectThumbnailInner(project)}
            </div>
            <div class="project-info">
                <div class="project-name">${escapeHtmlPm(project.name)}</div>
                <div class="project-meta">
                    <span>v${project.version}</span>
                    <span>${formatDate(project.updated_at)}</span>
                </div>
                <div class="project-stats">
                    <span>📄 ${project.pages?.length || 0} 页面</span>
                    <span>🎯 ${countBlocks(project)} 对象</span>
                </div>
                <div class="project-actions" onclick="event.stopPropagation()">
                    <button class="action-btn action-btn-run" onclick="runProject('${project.id}')">
                        ▶️ 运行
                    </button>
                    <button class="action-btn action-btn-edit" onclick="editProject('${project.id}')">
                        ✏️ 编辑
                    </button>
                    <button class="action-btn action-btn-export" onclick="exportProject('${project.id}')">
                        💾 导出
                    </button>
                    <button class="action-btn action-btn-share" onclick="shareProjectToPlaza('${project.id}')">
                        🏛️ 分享
                    </button>
                    <button class="action-btn action-btn-delete" onclick="deleteProject('${project.id}')">
                        🗑️ 删除
                    </button>
                </div>
            </div>
        </div>
    `).join('');
    
    // 列表视图
    listContainer.innerHTML = projects.map(project => `
        <div class="project-list-item">
            <div class="project-list-info" onclick="openProject('${project.id}')">
                <div class="project-list-icon">
                    ${renderProjectThumbnailInner(project)}
                </div>
                <div class="project-list-details">
                    <div class="project-list-name">
                        ${escapeHtmlPm(project.name)}
                        <span class="version-badge">v${escapeHtmlPm(project.version || '1.0.0')}</span>
                    </div>
                    <div class="project-list-meta">
                        ${project.description || '暂无描述'} · 
                        ${formatDate(project.updated_at)} · 
                        ${project.pages?.length || 0} 页面 · 
                        ${countBlocks(project)} 对象
                    </div>
                </div>
            </div>
            <div class="project-list-actions" onclick="event.stopPropagation()">
                <button class="action-btn action-btn-run" onclick="runProject('${project.id}')">
                    ▶️ 运行
                </button>
                <button class="action-btn action-btn-edit" onclick="editProject('${project.id}')">
                    ✏️ 编辑
                </button>
                <button class="action-btn action-btn-export" onclick="exportProject('${project.id}')">
                    💾 导出
                </button>
                <button class="action-btn action-btn-share" onclick="shareProjectToPlaza('${project.id}')">
                    🏛️ 分享
                </button>
                <button class="action-btn action-btn-delete" onclick="deleteProject('${project.id}')">
                    🗑️ 删除
                </button>
            </div>
        </div>
    `).join('');
}

// 切换视图
function switchView(view) {
    currentView = view;
    
    const gridContainer = document.getElementById('projects-grid');
    const listContainer = document.getElementById('projects-list');
    const viewBtns = document.querySelectorAll('.view-btn');
    
    viewBtns.forEach(btn => btn.classList.remove('active'));
    
    if (view === 'grid') {
        gridContainer.style.display = 'grid';
        listContainer.style.display = 'none';
        viewBtns[0].classList.add('active');
    } else {
        gridContainer.style.display = 'none';
        listContainer.style.display = 'block';
        viewBtns[1].classList.add('active');
    }
}

// 排序项目
function sortProjects() {
    currentSort = document.getElementById('sort-select').value;
    renderProjects();
}

function sortProjectsArray() {
    projects.sort((a, b) => {
        switch (currentSort) {
            case 'updated':
                return new Date(b.updated_at) - new Date(a.updated_at);
            case 'created':
                return new Date(b.created_at) - new Date(a.created_at);
            case 'name':
                return a.name.localeCompare(b.name);
            default:
                return 0;
        }
    });
}

// 搜索过滤
function filterProjects(query) {
    const gridContainer = document.getElementById('projects-grid');
    const listContainer = document.getElementById('projects-list');
    
    const filtered = projects.filter(project => 
        project.name.toLowerCase().includes(query.toLowerCase()) ||
        (project.description && project.description.toLowerCase().includes(query.toLowerCase())) ||
        (project.author && project.author.toLowerCase().includes(query.toLowerCase()))
    );
    
    // 临时替换projects数组进行渲染
    const originalProjects = projects;
    projects = filtered;
    renderProjects();
    projects = originalProjects;
}

// 显示创建模态框
function showCreateModal() {
    editingProjectId = null;
    document.getElementById('modal-title').textContent = '创建新项目';
    document.getElementById('project-id').value = '';
    document.getElementById('project-name').value = '';
    document.getElementById('project-description').value = '';
    document.getElementById('project-author').value = '';
    loadPmThumbnailDraftFromProject(null);
    document.getElementById('project-modal').classList.add('active');
}

// 关闭模态框
function closeModal() {
    document.getElementById('project-modal').classList.remove('active');
}

// 保存项目
function saveProject() {
    const id = document.getElementById('project-id').value;
    const name = document.getElementById('project-name').value.trim();
    const description = document.getElementById('project-description').value.trim();
    const author = document.getElementById('project-author').value.trim();
    
    if (!name) {
        alert('请输入项目名称');
        return;
    }
    
    const now = new Date().toISOString();
    
    if (id) {
        // 更新现有项目
        const project = projects.find(p => p.id === id);
        if (project) {
            project.name = name;
            project.description = description;
            project.author = author;
            project.updated_at = now;
            if (pmThumbnailDraft.cleared) {
                delete project.thumbnailImage;
                delete project.thumbnailOriginalImage;
                delete project.thumbnailEditMode;
                project.thumbnailSource = null;
                project.thumbnail = '📊';
            } else if (pmThumbnailDraft.image) {
                project.thumbnailImage = pmThumbnailDraft.image;
                project.thumbnailSource = pmThumbnailDraft.source === 'custom' ? 'custom' : 'canvas';
                if (pmThumbnailDraft.source === 'custom' && pmThumbnailDraft.originalImage) {
                    project.thumbnailOriginalImage = pmThumbnailDraft.originalImage;
                } else {
                    delete project.thumbnailOriginalImage;
                }
                project.thumbnailEditMode = pmThumbnailDraft.editMode || 'fit';
            } else if (pmThumbnailDraft.source !== 'custom') {
                ensureProjectCanvasThumbnail(project);
            }
            project.thumbnailDisplayMode = pmThumbnailDraft.displayMode || 'stretch';
            
            // 版本号递增
            const versionParts = project.version.split('.');
            versionParts[2] = parseInt(versionParts[2]) + 1;
            project.version = versionParts.join('.');
            
            // 保存版本历史
            if (!project.version_history) {
                project.version_history = [];
            }
            project.version_history.push({
                version: project.version,
                timestamp: now,
                changes: '项目信息更新'
            });
        }
    } else {
        // 创建新项目
        const newProject = {
            id: generateId(),
            name: name,
            description: description,
            author: author,
            version: '1.0.0',
            created_at: now,
            updated_at: now,
            thumbnail: '📊',
            pages: [
                {
                    id: 0,
                    name: 'Page 1',
                    blocks: [],
                    multimodalBlocks: []
                }
            ],
            frequencies: [],
            phases: [0, 0.15, 0.3, 0.45, 0.60, 0.75, 0.9, 0],
            runConfig: defaultRunConfig(),
            version_history: [
                {
                    version: '1.0.0',
                    timestamp: now,
                    changes: '项目创建'
                }
            ]
        };
        
        if (pmThumbnailDraft.cleared) {
            newProject.thumbnail = '📊';
        } else if (pmThumbnailDraft.image) {
            newProject.thumbnailImage = pmThumbnailDraft.image;
            newProject.thumbnailSource = pmThumbnailDraft.source === 'custom' ? 'custom' : 'canvas';
            if (pmThumbnailDraft.source === 'custom' && pmThumbnailDraft.originalImage) {
                newProject.thumbnailOriginalImage = pmThumbnailDraft.originalImage;
            }
            newProject.thumbnailEditMode = pmThumbnailDraft.editMode || 'fit';
        }
        newProject.thumbnailDisplayMode = pmThumbnailDraft.displayMode || 'stretch';
        projects.push(newProject);
    }
    
    saveProjects();
    renderProjects();
    closeModal();
}

// 编辑项目
function editProject(id) {
    const project = projects.find(p => p.id === id);
    if (!project) return;
    
    editingProjectId = id;
    document.getElementById('modal-title').textContent = '编辑项目';
    document.getElementById('project-id').value = project.id;
    document.getElementById('project-name').value = project.name;
    document.getElementById('project-description').value = project.description || '';
    document.getElementById('project-author').value = project.author || '';
    loadPmThumbnailDraftFromProject(project);
    document.getElementById('project-modal').classList.add('active');
}

// 删除项目
function deleteProject(id) {
    const project = projects.find((p) => p.id === id);
    const label = project && project.name ? project.name : id || '该项目';
    if (!confirm(`确定要删除项目 "${label}" 吗？此操作无法撤销！`)) return;
    projects = projects.filter((p) => p.id !== id);
    saveProjects();
    try {
        const cur = localStorage.getItem('ssvep_project');
        if (cur) {
            const p = JSON.parse(cur);
            if (p && p.id === id) localStorage.removeItem('ssvep_project');
        }
    } catch (_) {
        /* ignore */
    }
    renderProjects();
}

// 打开项目（进入编辑器）
function openProject(id) {
    const project = projects.find(p => p.id === id);
    if (!project) return;
    
    // 保存到localStorage供编辑器使用
    localStorage.setItem('ssvep_project', JSON.stringify(project));
    
    // 跳转到编辑器
    window.location.href = 'editor.html';
}

// 分享到项目广场
async function shareProjectToPlaza(id) {
    const project = projects.find((p) => p.id === id);
    if (!project) {
        alert('未找到该项目');
        return;
    }
    if (project.importOnlyNoRepublish) {
        alert('该项目为从广场导入的副本，受知识产权保护，不可再次发布。');
        return;
    }
    if (!window.SSVEP_PLAZA) {
        alert('广场模块未加载，请刷新页面后重试。');
        return;
    }
    try {
        await window.SSVEP_PLAZA.ensureRegisteredForAction('分享到项目广场');
    } catch (_) {
        return;
    }
    const shareOpts = await openPlazaShareDialog(project);
    if (!shareOpts) return;
    try {
        let updated = { ...project };
        if (window.SEEKBCI_PROJECT_CONTRACT) {
            updated = window.SEEKBCI_PROJECT_CONTRACT.assertValidProject(
                window.SEEKBCI_PROJECT_CONTRACT.ensureContractVersion(updated),
                '分享到广场'
            );
        }
        if (shareOpts.description) updated.description = shareOpts.description;
        await window.SSVEP_PLAZA.publishProject(
            updated,
            shareOpts.description || null,
            shareOpts.tags,
            shareOpts.ipRightsAck
        );
        alert(
            `「${project.name}」已发布到项目广场！\n\n可在「项目广场」浏览，或在「个人中心」管理已发布项目。`
        );
    } catch (err) {
        alert('分享失败：' + (err.message || err) + '\n\n请确认 Python 后端已启动。');
    }
}

function openPlazaShareDialog(project) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
        const tags = window.SSVEP_PLAZA.PLAZA_TAG_LABELS || {};
        const tagChecks = Object.keys(tags)
            .map(
                (k) =>
                    `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;color:#ccc;font-size:13px;">
                        <input type="checkbox" class="plaza-share-tag" value="${k}"> ${tags[k]}
                    </label>`
            )
            .join('');
        overlay.innerHTML = `
            <div style="background:#1e1e1e;border:1px solid #333;border-radius:14px;padding:24px;max-width:480px;width:100%;color:#eee;">
                <h3 style="color:#00D9FF;margin-bottom:12px;">分享到项目广场</h3>
                <p style="font-size:13px;color:#888;margin-bottom:12px;">项目：${window.SSVEP_PLAZA.escapeHtml(project.name)}</p>
                <label style="display:block;color:#aaa;font-size:13px;margin-bottom:6px;">补充说明（可选）</label>
                <textarea id="plaza-share-desc" style="width:100%;min-height:72px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;padding:10px;margin-bottom:12px;">${window.SSVEP_PLAZA.escapeHtml(project.description || '')}</textarea>
                <div style="margin-bottom:12px;"><span style="color:#aaa;font-size:13px;">标签：</span><br>${tagChecks}</div>
                <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#ccc;line-height:1.45;margin-bottom:16px;">
                    <input type="checkbox" id="plaza-share-ip" style="margin-top:3px;">
                    <span>我确认拥有所分享内容的知识产权，并同意他人仅可导入使用、不可二次发布。</span>
                </label>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button type="button" class="btn" id="plaza-share-cancel" style="background:#2a2a2a;color:#fff;">取消</button>
                    <button type="button" class="btn" id="plaza-share-ok">发布</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = (val) => {
            document.body.removeChild(overlay);
            resolve(val);
        };
        overlay.querySelector('#plaza-share-cancel').onclick = () => close(null);
        overlay.querySelector('#plaza-share-ok').onclick = () => {
            const ip = overlay.querySelector('#plaza-share-ip').checked;
            if (!ip) {
                alert('请勾选知识产权确认');
                return;
            }
            const selected = [];
            overlay.querySelectorAll('.plaza-share-tag:checked').forEach((el) => selected.push(el.value));
            close({
                description: overlay.querySelector('#plaza-share-desc').value.trim(),
                tags: selected,
                ipRightsAck: true
            });
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
    });
}

// 导出项目
function exportProject(id) {
    const project = projects.find(p => p.id === id);
    if (!project) return;
    
    // 导出为JSON文件
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}_v${project.version}.ssvep.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert('项目已导出！');
}

// 运行项目
function runProject(id) {
    try {
        const project = projects.find((p) => p.id === id);
        if (!project) {
            alert('未找到该项目');
            return;
        }

        console.log('开始验证项目:', project.name);

        const validation = validateProject(project);

        if (!validation.valid) {
            showValidationErrors(validation.errors);
            return;
        }

        if (validation.errors.length > 0) {
            window._continueRunAfterValidation = () => openRunConfigModal(project);
            showValidationErrors(validation.errors);
            return;
        }

        openRunConfigModal(project);
    } catch (err) {
        console.error('runProject:', err);
        alert('运行失败：' + (err && err.message ? err.message : String(err)));
    }
}

function updateProjectInList(project) {
    if (!isValidProjectRecord(project)) {
        console.warn('跳过写入无效项目', project);
        return;
    }
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) projects[idx] = project;
    else projects.push(project);
    saveProjects();
}

let _runConfigProject = null;
let _runConfigSelectedMode = 'threshold';

function defaultRunConfig() {
    return {
        eegEnabled: true,
        mode: 'threshold',
        windowSec: 2.0,
        cooldownSec: 1.5,
        pollMs: 320,
        intervalSec: 3,
        minProbability: 0.28,
        minMargin: 0.08,
        thresholdRequireStable: false,
        transparentBackground: false,
        startFullscreen: false,
        flickerHighBlank: false,
        flickerOnDutyPercent: 32,
        flickerBlockOpacityPercent: 58,
        speakOnDecode: false,
        ssvepMultimodalWaitSec: 1.0
    };
}

const MIN_SOFTMAX_PROBABILITY = 0.03;

function getProjectRunConfig(project) {
    const defaults = defaultRunConfig();
    if (typeof window.getEffectiveRunConfigForModal === 'function') {
        return window.getEffectiveRunConfigForModal(project, defaults);
    }
    const cfg = { ...defaults, ...((project && project.runConfig) || {}) };
    return typeof window.normalizeStimulusRunConfig === 'function'
        ? window.normalizeStimulusRunConfig(cfg)
        : cfg;
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setInputChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

function applyRunConfigToModal(project) {
    const cfg = getProjectRunConfig(project);
    _runConfigSelectedMode = cfg.mode === 'interval' ? 'interval' : 'threshold';
    setInputChecked('rc-eeg-enabled', cfg.eegEnabled);
    setInputValue('rc-window', cfg.windowSec);
    setInputValue('rc-cooldown', cfg.cooldownSec);
    setInputValue('rc-ssvep-mm-wait', cfg.ssvepMultimodalWaitSec);
    setInputChecked('rc-speak-on-decode', cfg.speakOnDecode);
    setInputChecked('rc-transparent-bg', cfg.transparentBackground);
    setInputChecked('rc-start-fullscreen', cfg.startFullscreen);
    setInputChecked('rc-flicker-high-blank', cfg.flickerHighBlank);
    setInputValue('rc-flicker-on-duty', cfg.flickerOnDutyPercent);
    setInputValue('rc-flicker-block-opacity', cfg.flickerBlockOpacityPercent);
    setInputValue('rc-th-minp', cfg.mode === 'threshold' ? cfg.minProbability : 0.28);
    setInputValue('rc-th-minm', cfg.minMargin);
    setInputChecked('rc-th-stable', cfg.thresholdRequireStable);
    setInputValue('rc-iv-interval', cfg.intervalSec);
    setInputValue('rc-iv-minp', cfg.mode === 'interval' ? cfg.minProbability : 0.22);
    const fw = document.getElementById('rc-flicker-duty-wrap');
    const fcb = document.getElementById('rc-flicker-high-blank');
    if (fw && fcb) fw.style.display = fcb.checked ? 'block' : 'none';
    syncRunConfigEegUi();
    updateRunModeButtons();
}

function updateRunModeButtons() {
    const th = document.getElementById('btn-rc-mode-threshold');
    const iv = document.getElementById('btn-rc-mode-interval');
    if (th) th.classList.toggle('active', _runConfigSelectedMode === 'threshold');
    if (iv) iv.classList.toggle('active', _runConfigSelectedMode === 'interval');
}

function syncRunConfigEegUi() {
    const cb = document.getElementById('rc-eeg-enabled');
    const on = cb ? cb.checked : false;
    const eegAct = document.getElementById('rc-eeg-mode-actions');
    const hint = document.getElementById('rc-eeg-footer-hint');
    const speakWrap = document.getElementById('rc-speak-wrap');
    if (eegAct) eegAct.style.display = on ? 'block' : 'none';
    if (hint) hint.style.display = on ? 'block' : 'none';
    if (speakWrap) speakWrap.style.display = on ? 'block' : 'none';
}

function openRunThresholdParamModal() {
    _runConfigSelectedMode = 'threshold';
    updateRunModeButtons();
    document.getElementById('run-config-modal-threshold')?.classList.add('active');
}

function closeRunThresholdParamModal() {
    document.getElementById('run-config-modal-threshold')?.classList.remove('active');
}

function openRunIntervalParamModal() {
    _runConfigSelectedMode = 'interval';
    updateRunModeButtons();
    document.getElementById('run-config-modal-interval')?.classList.add('active');
}

function closeRunIntervalParamModal() {
    document.getElementById('run-config-modal-interval')?.classList.remove('active');
}

function readSharedRunParams() {
    const windowRaw = parseFloat(document.getElementById('rc-window')?.value);
    const cooldownSec = parseFloat(document.getElementById('rc-cooldown')?.value) || 1.5;
    const out = {
        mode: _runConfigSelectedMode === 'interval' ? 'interval' : 'threshold',
        windowSec: Number.isFinite(windowRaw) ? windowRaw : 2.0,
        cooldownSec: Math.max(0.2, cooldownSec),
        pollMs: 320,
        speakOnDecode: !!document.getElementById('rc-speak-on-decode')?.checked,
        ssvepMultimodalWaitSec: (() => {
            const raw = parseFloat(document.getElementById('rc-ssvep-mm-wait')?.value);
            return Number.isFinite(raw) ? raw : 1.0;
        })()
    };
    return typeof window.normalizeStimulusRunConfig === 'function'
        ? window.normalizeStimulusRunConfig(out)
        : out;
}

/** 主运行对话框：透明背景 / 全屏（写入 stimulus_run_config） */
function readRuntimePresentationForSession() {
    const dutyRaw = parseFloat(document.getElementById('rc-flicker-on-duty')?.value);
    const dutyPct = Number.isFinite(dutyRaw) ? dutyRaw : 32;
    const opacityRaw = parseFloat(document.getElementById('rc-flicker-block-opacity')?.value);
    const opacityPct = Number.isFinite(opacityRaw) ? opacityRaw : 58;
    return {
        transparentBackground: !!document.getElementById('rc-transparent-bg')?.checked,
        startFullscreen: !!document.getElementById('rc-start-fullscreen')?.checked,
        flickerHighBlank: !!document.getElementById('rc-flicker-high-blank')?.checked,
        flickerOnDutyPercent: Math.min(50, Math.max(15, dutyPct)),
        flickerBlockOpacityPercent: Math.min(100, Math.max(20, opacityPct))
    };
}

function openRunConfigModal(project) {
    _runConfigProject = project;
    const m = document.getElementById('run-config-modal');
    if (m) {
        applyRunConfigToModal(project);
        m.classList.add('active');
        return;
    }
    console.error('缺少 #run-config-modal，可能加载了缓存的旧 HTML');
    alert(
        '当前页面没有「运行配置」对话框（多为缓存了旧版 HTML）。\n请打开 http://127.0.0.1:28765/ui/project-manager.html 或对当前页 Ctrl+F5 强制刷新。'
    );
}

function closeRunConfigModal() {
    _runConfigProject = null;
    const m = document.getElementById('run-config-modal');
    if (m) m.classList.remove('active');
    closeRunThresholdParamModal();
    closeRunIntervalParamModal();
}

function writeRunAndNavigate(runConfig) {
    const proj = _runConfigProject;
    if (!proj) return;
    let finalConfig = {
        ...runConfig,
        ...readRuntimePresentationForSession()
    };
    if (typeof window.attachProjectIdToRunConfig === 'function') {
        finalConfig = window.attachProjectIdToRunConfig(finalConfig, proj.id);
    } else if (proj.id) {
        finalConfig._projectId = proj.id;
    }
    proj.runConfig = finalConfig;
    localStorage.setItem('ssvep_project', JSON.stringify(proj));
    updateProjectInList(proj);
    const runPayload = JSON.stringify(finalConfig);
    sessionStorage.setItem('stimulus_run_config', runPayload);
    sessionStorage.setItem('stimulus_return_page', 'project-manager.html');
    localStorage.setItem('stimulus_run_config', runPayload);
    closeRunConfigModal();
    window.location.href = 'stimulus.html';
}

function confirmRunStimulusSelectedMode() {
    if (!_runConfigProject) return;
    const eegOn = document.getElementById('rc-eeg-enabled')?.checked;
    if (!eegOn) {
        confirmRunStimulusNoEeg();
        return;
    }
    if (_runConfigSelectedMode === 'interval') confirmRunStimulusInterval();
    else confirmRunStimulusThreshold();
}

/** 未启用 EEG：仅闪烁与点击 */
function confirmRunStimulusNoEeg() {
    if (!_runConfigProject) return;
    const sh = readSharedRunParams();
    writeRunAndNavigate({
        eegEnabled: false,
        mode: 'threshold',
        intervalSec: 3,
        minProbability: 0.35,
        minMargin: 0.12,
        ...sh
    });
}

/** 置信度模式（子对话框） */
function confirmRunStimulusThreshold() {
    if (!_runConfigProject) return;
    const eegOn = document.getElementById('rc-eeg-enabled')?.checked;
    if (!eegOn) {
        confirmRunStimulusNoEeg();
        return;
    }
    const minProbability = parseFloat(document.getElementById('rc-th-minp')?.value) || 0.28;
    const minMargin = parseFloat(document.getElementById('rc-th-minm')?.value) || 0.08;
    const sh = readSharedRunParams();
    writeRunAndNavigate({
        eegEnabled: true,
        mode: 'threshold',
        intervalSec: 3,
        minProbability: Math.min(0.99, Math.max(MIN_SOFTMAX_PROBABILITY, minProbability)),
        minMargin: Math.min(0.5, Math.max(0.02, minMargin)),
        thresholdRequireStable: !!document.getElementById('rc-th-stable')?.checked,
        ...sh
    });
}

/** 定时模式（子对话框） */
function confirmRunStimulusInterval() {
    if (!_runConfigProject) return;
    const eegOn = document.getElementById('rc-eeg-enabled')?.checked;
    if (!eegOn) {
        confirmRunStimulusNoEeg();
        return;
    }
    const intervalSec = parseFloat(document.getElementById('rc-iv-interval')?.value) || 3;
    const minProbability = parseFloat(document.getElementById('rc-iv-minp')?.value) || 0.22;
    const sh = readSharedRunParams();
    writeRunAndNavigate({
        eegEnabled: true,
        mode: 'interval',
        intervalSec: Math.max(0.5, intervalSec),
        minProbability: Math.min(0.99, Math.max(MIN_SOFTMAX_PROBABILITY, minProbability)),
        minMargin: 0.12,
        ...sh
    });
}

// 验证项目
function validateProject(project) {
    const errors = [];
    const settings = (project && project.settings) || {};
    let projectGlobalCode = typeof settings.pythonGlobalCode === 'string' ? settings.pythonGlobalCode : '';
    if (!projectGlobalCode.trim() && Array.isArray(settings.pythonImports)) {
        projectGlobalCode = settings.pythonImports.filter((s) => typeof s === 'string' && s.trim()).join('\n');
    }
    
    // 检查是否有页面
    if (!project.pages || project.pages.length === 0) {
        errors.push({
            type: 'error',
            message: '项目没有页面',
            details: '请至少创建一个页面'
        });
        return { valid: false, errors };
    }
    
    // 检查每个页面
    project.pages.forEach((page, pageIndex) => {
        const blocks = page.blocks || [];
        const multimodalBlocks = page.multimodalBlocks || [];

        const mmSeen = {};
        multimodalBlocks.forEach((mb) => {
            const ch = mb && mb.channel;
            if (!ch) return;
            if (mmSeen[ch]) {
                errors.push({
                    type: 'error',
                    message: `页面「${page.name}」多模态通道被重复使用`,
                    details: `通道 ${ch} 只能绑定一个方块`,
                    page: page.name
                });
            }
            mmSeen[ch] = true;
        });

        // 检查是否有可运行内容（SSVEP 对象和/或多模态）
        if (blocks.length === 0 && multimodalBlocks.length === 0) {
            errors.push({
                type: 'warning',
                message: `页面 "${page.name}" 没有对象`,
                details: '该页面没有 SSVEP 闪烁对象或多模态通道'
            });
            return;
        }
        if (blocks.length === 0) {
            return;
        }

        const KB = window.SSVEP_KEYBOARD_40;
        const kbCount = KB ? KB.countSsvepKeyboardsOnPage(blocks) : 0;
        const otherSsvep = KB ? KB.countNonKeyboardSsvepBlocks(blocks) : blocks.length;
        if (kbCount > 1) {
            errors.push({
                type: 'error',
                message: `页面「${page.name}」放置了多个 SSVEP 键盘`,
                details: '每页仅允许一个 40 目标键盘对象',
                suggestion: '删除多余的键盘，或分到不同页面',
                page: page.name
            });
        }
        if (kbCount > 0 && otherSsvep > 0) {
            errors.push({
                type: 'warning',
                message: `页面「${page.name}」同时含有键盘与其它闪烁对象`,
                details: `键盘页建议仅保留 SSVEP 键盘（当前另有 ${otherSsvep} 个方块）`,
                suggestion: '将其它对象移到别的页面，或删除，避免频率表冲突与视觉干扰',
                page: page.name
            });
        }

        // 同一画布：任意两路闪烁频率须相差 ≥ 0.2 Hz（键盘展开为 40 路）
        const MIN_GAP = 0.2;
        const freqEntries = KB
            ? KB.collectPageFrequencyEntries(blocks)
            : blocks
                  .filter((b) => b && b.frequency != null)
                  .map((b) => ({ label: b.label, hz: Number(b.frequency), block: b }));
        for (let i = 0; i < freqEntries.length; i++) {
            const fi = freqEntries[i].hz;
            if (!Number.isFinite(fi)) {
                if (!KB || !KB.isSsvepKeyboardBlock(freqEntries[i].block)) {
                    errors.push({
                        type: 'error',
                        message: `对象 "${freqEntries[i].label}" 的频率无效`,
                        details: `画布: ${page.name}`,
                        suggestion: '请在编辑器中为该对象填写有效数字（Hz）'
                    });
                }
                continue;
            }
            for (let j = i + 1; j < freqEntries.length; j++) {
                const fj = freqEntries[j].hz;
                if (!Number.isFinite(fj)) continue;
                if (Math.abs(fi - fj) < MIN_GAP - 1e-9) {
                    errors.push({
                        type: 'error',
                        message: `画布 "${page.name}" 闪烁频率过近`,
                        details: `「${freqEntries[i].label}」(${fi} Hz) 与 「${freqEntries[j].label}」(${fj} Hz) 间隔须 ≥ ${MIN_GAP} Hz`,
                        suggestion: '在编辑器中调整频率，使任意两路至少相差 0.2 Hz',
                        page: page.name
                    });
                }
            }
        }
        
        // 检查 Python / 键盘动作（支持多条 actions）
        const validateBlockActions = (block, blockKind) => {
            pmGetBlockActions(block).forEach((action, ai) => {
                if (action && action.type === 'python') {
                    const code = action.content || '';
                    const label = block.label || blockKind;
                    if (!code.trim()) {
                        errors.push({
                            type: 'warning',
                            message: `对象 "${label}" 的动作 ${ai + 1}（Python）代码为空`,
                            details: `画布: ${page.name}`,
                            suggestion: '该条 Python 动作将不会执行'
                        });
                        return;
                    }
                    const pythonErrors = validatePythonCode(code, label, page.name, projectGlobalCode);
                    errors.push(...pythonErrors);
                }
                if (action && action.type === 'keyboard') {
                    const binding = parseKeyboardBinding(action.content);
                    const label = block.label || blockKind;
                    if (!hasKeyboardBinding(binding)) {
                        errors.push({
                            type: 'warning',
                            message: `对象 "${label}" 的动作 ${ai + 1} 未设置快捷键`,
                            details: `画布: ${page.name}`,
                            suggestion: '在编辑器中为该动作用「录制快捷键」绑定组合键'
                        });
                    }
                }
            });
        };
        blocks.forEach((block) => validateBlockActions(block, 'SSVEP'));
        multimodalBlocks.forEach((block) => validateBlockActions(block, '多模态'));
        
        // 检查对象数量
        if (blocks.length > 8) {
            errors.push({
                type: 'warning',
                message: `页面 "${page.name}" 对象过多`,
                details: `当前有 ${blocks.length} 个对象，建议不超过8个`,
                suggestion: '过多的对象可能影响SSVEP识别准确率'
            });
        }
        
        // 合法频率范围 8–15 Hz（与编辑器一致）
        blocks.forEach((block) => {
            const freq = Number(block.frequency);
            if (!Number.isFinite(freq)) return;
            if (freq < 8 || freq > 15.8) {
                errors.push({
                    type: 'error',
                    message: `对象 "${block.label}" 的频率不在允许范围`,
                    details: `画布: ${page.name}，当前: ${freq} Hz，允许: 8～15.8 Hz`,
                    suggestion: '在编辑器侧栏将闪烁频率改为 8～15.8 Hz 之间（可含小数）',
                    page: page.name
                });
            }
        });
    });
    
    // 判断是否可以运行
    const hasErrors = errors.some(e => e.type === 'error');
    
    return {
        valid: !hasErrors,
        errors: errors
    };
}

// 验证Python代码
function validatePythonCode(code, blockLabel, pageName, projectGlobalCode) {
    const errors = [];
    const importContext = [(projectGlobalCode || ''), code].filter(Boolean).join('\n');
    
    // 检查常见库的使用和import
    const libraryPatterns = [
        { name: 'numpy', patterns: ['np.', 'numpy.', 'from numpy'] },
        { name: 'scipy', patterns: ['scipy.', 'from scipy'] },
        { name: 'pandas', patterns: ['pd.', 'pandas.', 'from pandas'] },
        { name: 'matplotlib', patterns: ['plt.', 'matplotlib.', 'from matplotlib'] },
        { name: 'cv2', patterns: ['cv2.', 'import cv2'] },
        { name: 'torch', patterns: ['torch.', 'from torch'] },
        { name: 'tensorflow', patterns: ['tf.', 'tensorflow.', 'from tensorflow'] },
        { name: 'sklearn', patterns: ['sklearn.', 'from sklearn'] },
        { name: 'djitellopy', patterns: ['Tello', 'tello.', 'from djitellopy'] },
        { name: 'os', patterns: ['os.', 'os.path'] },
        { name: 'sys', patterns: ['sys.'] },
        { name: 'json', patterns: ['json.'] },
        { name: 're', patterns: ['re.'] }
    ];
    
    const missingImports = [];
    
    libraryPatterns.forEach(lib => {
        const isUsed = lib.patterns.some(pattern => code.includes(pattern));
        if (isUsed) {
            // 检查动作代码或项目级 import 中是否已有对应语句
            const hasImport = importContext.includes(`import ${lib.name}`) || 
                             importContext.includes(`from ${lib.name}`) ||
                             (lib.name === 'numpy' && importContext.includes('import numpy as np')) ||
                             (lib.name === 'pandas' && importContext.includes('import pandas as pd')) ||
                             (lib.name === 'matplotlib' && importContext.includes('import matplotlib.pyplot as plt')) ||
                             (lib.name === 'djitellopy' && importContext.includes('from djitellopy'));
            
            if (!hasImport) {
                missingImports.push(lib.name);
            }
        }
    });
    
    if (missingImports.length > 0) {
        errors.push({
            type: 'error',
            message: `对象 "${blockLabel}" 的Python脚本缺少包引入`,
            details: `画布: ${pageName}，缺少包: ${missingImports.join(', ')}`,
            suggestion: `请在「高级功能 → Python 全局编辑器」或动作代码中补充 import / 初始化`,
            code: `# 建议添加:\nimport ${missingImports.join('\nimport ')}`
        });
    }
    
    // 检查语法错误
    const lines = code.split('\n');
    lines.forEach((line, lineNum) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        
        // 检查缺少冒号
        if (/^(def|class|if|elif|else|for|while|try|except|finally|with)\s/.test(trimmed)) {
            if (!trimmed.endsWith(':') && !trimmed.endsWith('\\')) {
                errors.push({
                    type: 'error',
                    message: `对象 "${blockLabel}" 的Python代码存在语法错误`,
                    details: `画布: ${pageName}，第 ${lineNum + 1} 行缺少冒号`,
                    code: trimmed,
                    suggestion: '请在语句末尾添加冒号 (:)'
                });
            }
        }
        
        // 检查括号匹配
        const openParens = (trimmed.match(/\(/g) || []).length;
        const closeParens = (trimmed.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            errors.push({
                type: 'error',
                message: `对象 "${blockLabel}" 的Python代码存在语法错误`,
                details: `画布: ${pageName}，第 ${lineNum + 1} 行括号不匹配`,
                code: trimmed,
                suggestion: '请检查括号是否正确闭合'
            });
        }
        
        // 检查引号匹配
        const singleQuotes = (trimmed.match(/'/g) || []).length;
        const doubleQuotes = (trimmed.match(/"/g) || []).length;
        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
            errors.push({
                type: 'error',
                message: `对象 "${blockLabel}" 的Python代码存在语法错误`,
                details: `画布: ${pageName}，第 ${lineNum + 1} 行引号不匹配`,
                code: trimmed,
                suggestion: '请检查引号是否正确闭合'
            });
        }
    });
    
    // 检查缩进问题（简单检查）
    let prevIndent = 0;
    lines.forEach((line, lineNum) => {
        if (!line.trim() || line.trim().startsWith('#')) return;
        
        const indent = line.search(/\S/);
        if (indent > 0 && indent % 4 !== 0) {
            errors.push({
                type: 'warning',
                message: `对象 "${blockLabel}" 的Python代码缩进不规范`,
                details: `画布: ${pageName}，第 ${lineNum + 1} 行缩进应为4的倍数`,
                code: line,
                suggestion: 'Python推荐使用4个空格作为缩进'
            });
        }
    });
    
    return errors;
}

function closeValidationModalAndContinue(btn) {
    const m = btn.closest('.modal');
    if (m) m.remove();
    if (typeof window._continueRunAfterValidation === 'function') {
        const fn = window._continueRunAfterValidation;
        window._continueRunAfterValidation = null;
        fn();
    }
}

// 显示验证错误
function showValidationErrors(errors) {
    const errorTypes = {
        error: '❌ 错误',
        warning: '⚠️ 警告',
        info: 'ℹ️ 提示'
    };
    
    let html = '<div style="max-height: 400px; overflow-y: auto;">';
    
    errors.forEach(error => {
        const typeLabel = errorTypes[error.type] || error.type;
        const bgColor = error.type === 'error' ? '#ff5252' : error.type === 'warning' ? '#ff9800' : '#2196f3';
        
        html += `
            <div style="background: rgba(${error.type === 'error' ? '255,82,82' : error.type === 'warning' ? '255,152,0' : '33,150,243'}, 0.1); 
                        padding: 15px; margin-bottom: 10px; border-radius: 8px; 
                        border-left: 4px solid ${bgColor};">
                <div style="font-weight: bold; color: ${bgColor}; margin-bottom: 5px;">
                    ${typeLabel}: ${error.message}
                </div>
                <div style="color: #aaa; font-size: 13px; margin-bottom: 5px;">
                    ${error.details}
                </div>
                ${error.suggestion ? `<div style="color: #00D9FF; font-size: 12px;">💡 ${error.suggestion}</div>` : ''}
                ${error.code ? `<pre style="background: #2A2A2A; padding: 10px; border-radius: 4px; margin-top: 5px; overflow-x: auto;"><code>${error.code}</code></pre>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    
    const hasErrors = errors.some(e => e.type === 'error');
    
    if (hasErrors) {
        html += '<p style="color: #ff5252; margin-top: 15px;">❌ 存在错误，无法运行项目。请修复后重试。</p>';
    } else {
        html += '<p style="color: #ff9800; margin-top: 15px;">⚠️ 存在警告，但仍可运行。建议修复后运行以获得最佳效果。</p>';
    }
    
    // 创建模态框显示错误
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">项目验证结果</div>
            ${html}
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">关闭</button>
                ${!hasErrors ? '<button type="button" class="btn btn-primary" onclick="closeValidationModalAndContinue(this)">继续运行</button>' : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function escapeHtmlPm(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 工具函数
function generateId() {
    return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function formatDate(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    
    return date.toLocaleDateString('zh-CN');
}

function countBlocks(project) {
    if (!project.pages) return 0;
    return project.pages.reduce((total, page) => {
        return total + (page.blocks ? page.blocks.length : 0);
    }, 0);
}

// 键盘快捷键
document.addEventListener('keydown', (e) => {
    // ESC关闭模态框
    if (e.key === 'Escape') {
        closeModal();
    }
    
    // Ctrl+N 创建新项目
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        showCreateModal();
    }
});
