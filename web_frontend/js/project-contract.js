/**
 * SEEKBCI 项目 JSON 契约校验（contractVersion 1）。
 */
(function (global) {
    const CONTRACT_VERSION = 1;

    function validateSeekbciProject(project) {
        const errors = [];
        if (!project || typeof project !== 'object') {
            return { valid: false, errors: ['项目必须是 JSON 对象'] };
        }
        if (project.contractVersion != null && project.contractVersion !== CONTRACT_VERSION) {
            errors.push(`不支持的 contractVersion: ${project.contractVersion}`);
        }
        if (!project.name || !String(project.name).trim()) {
            errors.push('缺少项目名称 name');
        }
        if (!Array.isArray(project.pages) || project.pages.length === 0) {
            errors.push('项目至少需要一个页面 pages');
        } else {
            project.pages.forEach((page, i) => {
                if (!page || typeof page !== 'object') {
                    errors.push(`pages[${i}] 无效`);
                    return;
                }
                if (!Array.isArray(page.blocks)) {
                    errors.push(`pages[${i}].blocks 必须是数组`);
                }
            });
        }
        return { valid: errors.length === 0, errors };
    }

    function ensureContractVersion(project) {
        const clone = Object.assign({}, project);
        if (clone.contractVersion == null) clone.contractVersion = CONTRACT_VERSION;
        return clone;
    }

    function assertValidProject(project, actionLabel) {
        const result = validateSeekbciProject(project);
        if (!result.valid) {
            throw new Error(
                (actionLabel || '项目校验失败') + '：\n' + result.errors.join('\n')
            );
        }
        return ensureContractVersion(project);
    }

    global.SEEKBCI_PROJECT_CONTRACT = {
        CONTRACT_VERSION,
        validateSeekbciProject,
        ensureContractVersion,
        assertValidProject
    };
})(typeof window !== 'undefined' ? window : globalThis);
