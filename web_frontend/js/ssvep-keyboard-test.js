/**
 * SSVEP 键盘测试页
 * - 修复：像刺激页一样订阅 globalDeviceManager 的 data 事件缓存 EEG（仅靠 getRecentData 常为空）
 * - 布局：QWERTY 40 键 / 九宫格（搜狗式：先选键位组，再选字母；中文出候选）
 */
(function () {
    const KB = window.SSVEP_KEYBOARD_40;
    if (!KB) {
        console.error('ssvep-keyboard-test: 缺少 ssvep-keyboard-40.js');
        return;
    }

    const PHI = 0.618033988749895;
    const STORAGE_UI = 'ssvep_kb_test_ui_v3';
    /** 频段：QWERTY 40 键铺满 base～end；九宫格用更大步进铺在同一区间 */
    const FREQ_BANDS = {
        low: { id: 'low', base: 7.0, end: 15.8 },
        high: { id: 'high', base: 16.0, end: 31.8 }
    };
    const QWERTY_KEY_COUNT = 40;
    const T9_MAIN_SLOTS = 12;

    /** 搜狗式九宫格字母组（多击/二级选字） */
    const T9_KEYS = [
        [
            { id: 't1', digit: '1', title: '1', letters: '.,?!1', kind: 'punct' },
            { id: 't2', digit: '2', title: '2', letters: 'ABC', kind: 'letters' },
            { id: 't3', digit: '3', title: '3', letters: 'DEF', kind: 'letters' }
        ],
        [
            { id: 't4', digit: '4', title: '4', letters: 'GHI', kind: 'letters' },
            { id: 't5', digit: '5', title: '5', letters: 'JKL', kind: 'letters' },
            { id: 't6', digit: '6', title: '6', letters: 'MNO', kind: 'letters' }
        ],
        [
            { id: 't7', digit: '7', title: '7', letters: 'PQRS', kind: 'letters' },
            { id: 't8', digit: '8', title: '8', letters: 'TUV', kind: 'letters' },
            { id: 't9', digit: '9', title: '9', letters: 'WXYZ', kind: 'letters' }
        ],
        [
            { id: 'tStar', digit: '*', title: '中/英', letters: '', kind: 'lang' },
            { id: 't0', digit: '0', title: '0', letters: ' ⌴', kind: 'space' },
            { id: 'tHash', digit: '#', title: '#', letters: '确认', kind: 'confirm' }
        ]
    ];

    /** 常用拼音 → 候选汉字（九宫格中文） */
    const PINYIN_DICT = {
        a: ['啊', '阿'],
        ai: ['爱', '矮', '哀'],
        an: ['安', '按'],
        ba: ['吧', '把', '八', '爸'],
        bai: ['白', '百'],
        bei: ['被', '北', '杯'],
        bi: ['比', '笔', '必'],
        bu: ['不', '步', '部'],
        can: ['看', '参'],
        cao: ['草'],
        ce: ['测', '侧'],
        chang: ['长', '常', '场'],
        chi: ['吃', '持'],
        chu: ['出', '处'],
        da: ['大', '打', '达'],
        dao: ['到', '道', '倒'],
        de: ['的', '得', '地'],
        deng: ['等', '灯'],
        dian: ['点', '电'],
        dong: ['动', '东', '懂'],
        dui: ['对', '队'],
        duo: ['多', '朵'],
        e: ['额', '饿'],
        en: ['嗯'],
        fa: ['发', '法'],
        fan: ['反', '饭', '烦'],
        fang: ['放', '方', '房'],
        fen: ['分', '份'],
        feng: ['风', '封'],
        fo: ['佛'],
        fu: ['服', '副', '父'],
        gan: ['干', '感', '敢'],
        gang: ['刚', '钢'],
        gao: ['高', '搞', '告'],
        ge: ['个', '各', '哥'],
        gei: ['给'],
        gen: ['跟', '根'],
        gong: ['工', '公', '共'],
        gou: ['够', '狗'],
        gu: ['古', '故', '顾'],
        guo: ['过', '国', '果'],
        ha: ['哈'],
        hai: ['还', '海', '害'],
        han: ['含', '汉', '汗'],
        hao: ['好', '号', '毫'],
        he: ['和', '河', '合'],
        hen: ['很', '恨'],
        hou: ['后', '候'],
        hu: ['胡', '湖', '护'],
        hua: ['话', '花', '化', '华'],
        huan: ['换', '欢', '环'],
        huang: ['黄', '皇'],
        hui: ['会', '回', '灰'],
        huo: ['或', '活', '火'],
        ji: ['机', '及', '几', '记', '己'],
        jia: ['家', '加', '假'],
        jian: ['见', '间', '简', '件'],
        jiao: ['叫', '教', '交'],
        jie: ['接', '界', '姐', '解'],
        jin: ['进', '今', '近', '金'],
        jing: ['经', '静', '精', '京'],
        jiu: ['就', '九', '久'],
        ju: ['就', '句', '局'],
        kai: ['开', '凯'],
        kan: ['看', '砍'],
        kao: ['靠', '考'],
        ke: ['可', '课', '克'],
        ken: ['肯'],
        kong: ['空', '恐'],
        kou: ['口'],
        ku: ['苦', '哭'],
        kuai: ['快', '块'],
        lai: ['来', '赖'],
        lao: ['老', '劳'],
        le: ['了', '乐'],
        lei: ['累', '类'],
        li: ['里', '理', '力', '立'],
        lian: ['连', '脸', '练'],
        liang: ['两', '亮', '量'],
        liao: ['了', '料'],
        lie: ['列'],
        lin: ['林', '临'],
        ling: ['另', '零', '领'],
        liu: ['六', '留', '流'],
        long: ['龙', '隆'],
        lou: ['楼'],
        lu: ['路', '录'],
        luan: ['乱'],
        lun: ['论'],
        luo: ['落', '罗'],
        ma: ['吗', '妈', '马'],
        mai: ['买', '卖'],
        man: ['慢', '满'],
        mang: ['忙'],
        mao: ['毛', '猫'],
        me: ['么'],
        mei: ['没', '美', '每'],
        men: ['们', '门'],
        meng: ['梦', '猛'],
        mi: ['米', '密'],
        mian: ['面', '免'],
        miao: ['秒', '妙'],
        ming: ['名', '明'],
        mo: ['莫', '摸'],
        mou: ['某'],
        mu: ['目', '木', '母'],
        na: ['那', '拿', '哪'],
        nai: ['奶', '耐'],
        nan: ['难', '男', '南'],
        nao: ['脑', '闹'],
        ne: ['呢'],
        nei: ['内'],
        neng: ['能'],
        ni: ['你', '尼', '泥'],
        nian: ['年', '念'],
        niang: ['娘'],
        niao: ['鸟'],
        nin: ['您'],
        ning: ['宁'],
        niu: ['牛'],
        nong: ['弄', '农'],
        nu: ['女', '怒'],
        o: ['哦'],
        ou: ['欧'],
        pa: ['怕', '爬'],
        pai: ['排', '派'],
        pan: ['盘', '判'],
        pang: ['旁'],
        pao: ['跑', '炮'],
        pei: ['配', '陪'],
        peng: ['朋', '碰'],
        pi: ['皮', '批'],
        pian: ['片', '偏'],
        piao: ['票', '飘'],
        pin: ['品', '拼'],
        ping: ['平', '评'],
        po: ['破', '坡'],
        pu: ['普', '朴'],
        qi: ['起', '其', '七', '气', '期'],
        qia: ['恰'],
        qian: ['前', '钱', '千'],
        qiang: ['强', '墙'],
        qiao: ['桥', '巧'],
        qie: ['且', '切'],
        qin: ['亲', '琴'],
        qing: ['请', '清', '情', '轻'],
        qiong: ['穷'],
        qiu: ['求', '球'],
        qu: ['去', '取', '区'],
        quan: ['全', '权', '圈'],
        que: ['却', '确'],
        qun: ['群'],
        ran: ['然', '染'],
        rang: ['让'],
        rao: ['绕'],
        re: ['热'],
        ren: ['人', '认', '任'],
        ri: ['日'],
        rong: ['容', '荣'],
        rou: ['肉', '柔'],
        ru: ['如', '入'],
        ruan: ['软'],
        rui: ['瑞'],
        run: ['润'],
        ruo: ['若', '弱'],
        sa: ['撒'],
        sai: ['赛'],
        san: ['三', '散'],
        sang: ['桑'],
        sao: ['扫'],
        se: ['色'],
        sen: ['森'],
        seng: ['僧'],
        sha: ['啥', '沙', '杀'],
        shan: ['山', '善'],
        shang: ['上', '商', '伤'],
        shao: ['少', '烧'],
        she: ['社', '设', '射'],
        shei: ['谁'],
        shen: ['什', '身', '深', '神'],
        sheng: ['生', '声', '省'],
        shi: ['是', '时', '十', '事', '师', '使'],
        shou: ['手', '受', '首'],
        shu: ['书', '数', '树'],
        shua: ['刷'],
        shuai: ['帅'],
        shuan: ['栓'],
        shuang: ['双'],
        shui: ['水', '谁'],
        shun: ['顺'],
        shuo: ['说'],
        si: ['四', '思', '死'],
        song: ['送', '松'],
        sou: ['搜'],
        su: ['素', '速', '诉'],
        suan: ['算', '酸'],
        sui: ['虽', '随', '岁'],
        sun: ['孙', '损'],
        suo: ['所', '锁'],
        ta: ['他', '她', '它', '塔'],
        tai: ['太', '台'],
        tan: ['谈', '弹'],
        tang: ['烫', '汤', '堂'],
        tao: ['套', '逃', '桃'],
        te: ['特'],
        teng: ['疼'],
        ti: ['提', '体', '题'],
        tian: ['天', '田', '甜'],
        tiao: ['条', '跳'],
        tie: ['贴', '铁'],
        ting: ['听', '停', '庭'],
        tong: ['同', '通', '痛'],
        tou: ['头', '投'],
        tu: ['图', '土', '突'],
        tuan: ['团'],
        tui: ['退', '推'],
        tun: ['吞'],
        tuo: ['托', '拖'],
        wa: ['哇', '挖'],
        wai: ['外', '歪'],
        wan: ['完', '玩', '晚', '万'],
        wang: ['王', '往', '网', '忘'],
        wei: ['为', '位', '未', '微'],
        wen: ['问', '文', '闻'],
        weng: ['翁'],
        wo: ['我', '窝'],
        wu: ['五', '无', '物', '务'],
        xi: ['西', '喜', '系', '洗'],
        xia: ['下', '夏', '吓'],
        xian: ['先', '现', '线', '闲'],
        xiang: ['想', '向', '像', '相'],
        xiao: ['小', '笑', '校', '消'],
        xie: ['些', '写', '谢'],
        xin: ['新', '心', '信'],
        xing: ['行', '性', '星', '兴'],
        xiong: ['兄', '雄'],
        xiu: ['修', '休'],
        xu: ['需', '许', '续'],
        xuan: ['选', '宣'],
        xue: ['学', '雪', '血'],
        xun: ['寻', '训'],
        ya: ['呀', '牙', '压'],
        yan: ['眼', '言', '研', '严'],
        yang: ['样', '阳', '养', '洋'],
        yao: ['要', '药', '咬'],
        ye: ['也', '页', '夜', '业'],
        yi: ['一', '以', '已', '意', '易'],
        yin: ['因', '音', '银'],
        ying: ['应', '影', '英', '硬'],
        yo: ['哟'],
        yong: ['用', '永', '勇'],
        you: ['有', '又', '右', '友'],
        yu: ['与', '于', '雨', '鱼', '语'],
        yuan: ['元', '远', '原', '院'],
        yue: ['月', '越', '约'],
        yun: ['云', '运'],
        za: ['咱', '杂'],
        zai: ['在', '再', '载'],
        zan: ['咱', '赞'],
        zang: ['脏'],
        zao: ['早', '造'],
        ze: ['则', '责'],
        zei: ['贼'],
        zen: ['怎'],
        zeng: ['增'],
        zha: ['炸', '眨'],
        zhai: ['摘'],
        zhan: ['站', '战', '占'],
        zhang: ['张', '长', '掌'],
        zhao: ['找', '照', '着'],
        zhe: ['这', '着', '者'],
        zhen: ['真', '镇', '针'],
        zheng: ['正', '整', '证'],
        zhi: ['知', '只', '之', '直', '制'],
        zhong: ['中', '种', '重'],
        zhou: ['周', '州'],
        zhu: ['主', '住', '注', '助'],
        zhua: ['抓'],
        zhuai: ['拽'],
        zhuan: ['转', '专'],
        zhuang: ['装', '庄', '状'],
        zhui: ['追'],
        zhun: ['准'],
        zhuo: ['桌', '着'],
        zi: ['字', '自', '子'],
        zong: ['总', '宗'],
        zou: ['走'],
        zu: ['组', '足', '族'],
        zuan: ['钻'],
        zui: ['最', '嘴'],
        zun: ['尊'],
        zuo: ['做', '作', '坐', '左']
    };

    const el = {
        wrap: document.getElementById('kb-wrap'),
        candidates: document.getElementById('kb-candidates'),
        output: document.getElementById('kb-output'),
        conn: document.getElementById('conn-status'),
        live: document.getElementById('decode-live'),
        fps: document.getElementById('fps-value'),
        hits: document.getElementById('hit-count'),
        capsBadge: document.getElementById('caps-badge'),
        lastKey: document.getElementById('last-key-hint'),
        fbcca: document.getElementById('fbcca-hint'),
        bufHint: document.getElementById('buf-hint'),
        btnStart: document.getElementById('btn-start'),
        btnStop: document.getElementById('btn-stop'),
        btnClear: document.getElementById('btn-clear-out'),
        btnSync: document.getElementById('btn-sync-project'),
        projectSel: document.getElementById('cfg-project'),
        dutyWrap: document.getElementById('cfg-duty-wrap'),
        highBlank: document.getElementById('cfg-flicker-high-blank'),
        layout: document.getElementById('cfg-layout'),
        t9Mode: document.getElementById('cfg-t9-mode')
    };

    /** @type {{ id: string, keyId: string, label: string, frequency: number, phase: number, element: HTMLElement, meta?: object }[]} */
    let keyTargets = [];
    let eegBuffer = [];
    let eegSr = 250;
    let eegHooked = false;
    let running = false;
    let startTime = 0;
    let rafId = 0;
    let pollTimer = null;
    let decoding = false;
    let lastFireTs = 0;
    let lastIntervalFireTs = 0;
    let stableCandidateHz = null;
    let hitCount = 0;
    let capsOn = false;
    let frameCount = 0;
    let lastFpsAt = 0;
    let flickerOpacity = 1;
    let flickerHighBlank = false;
    let flickerDuty = 0.32;
    let flickerColorOn = '#ffffff';
    let flickerColorOff = '#000000';
    let decodeHoldKeyId = null;
    let decodeHoldTimer = null;

    /** t9: main | letters | candidates */
    let t9Stage = 'main';
    let t9Lang = 'en'; // en | zh
    let t9Pinyin = '';
    let t9LetterGroup = null;
    let t9Multi = { keyId: null, idx: 0, at: 0 };
    /** 换阶段后禁止解码直到缓冲重新积满 */
    let decodeResumeAt = 0;

    function resolveOrigin() {
        if (typeof window.ssvepResolveApiOrigin === 'function') {
            return window.ssvepResolveApiOrigin();
        }
        return 'http://127.0.0.1:8000';
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function currentFreqBand() {
        const id = document.getElementById('cfg-freq-band')?.value === 'high' ? 'high' : 'low';
        return FREQ_BANDS[id];
    }

    function freqPlanForCount(n) {
        const band = currentFreqBand();
        const count = Math.max(2, Math.round(n) || 2);
        const step = count <= 1 ? 0 : (band.end - band.base) / (count - 1);
        return { base: band.base, end: band.end, step, count };
    }

    function currentLayout() {
        return el.layout && el.layout.value === 't9' ? 't9' : 'qwerty';
    }

    function assignFreqPhase(list) {
        // 九宫格：按主屏 12 槽步进，二级界面目标更少、间隔更大
        const plan = freqPlanForCount(currentLayout() === 't9' ? T9_MAIN_SLOTS : list.length);
        return list.map((item, i) => ({
            ...item,
            frequency: Math.round((plan.base + i * plan.step) * 10000) / 10000,
            phase: Math.round(((i * PHI) % 1) * 10000) / 10000
        }));
    }

    /** 换布局/频段/九宫格阶段后：清 EEG，暂停解码一个窗长 */
    function onStimulusMapChanged(reason) {
        eegBuffer = [];
        const gm = window.globalDeviceManager;
        if (gm && typeof gm.clearBuffer === 'function') gm.clearBuffer();
        stableCandidateHz = null;
        lastFireTs = 0;
        lastIntervalFireTs = 0;
        decodeHoldKeyId = null;
        if (decodeHoldTimer != null) {
            clearTimeout(decodeHoldTimer);
            decodeHoldTimer = null;
        }
        const winSec = readParams().windowSec || 3;
        decodeResumeAt = performance.now() + winSec * 1000;
        if (running) {
            startTime = performance.now();
            setLive((reason || '刺激已切换') + `，请重新注视约 ${winSec.toFixed(1)}s 后再识别…`);
        }
        updateBufHint();
    }

    function setupEegListener() {
        const gm = window.globalDeviceManager;
        if (!gm || eegHooked) return;
        eegHooked = true;
        gm.addEventListener((event, message) => {
            if (event === 'data') {
                if (!message || !message.data || !message.data.length) return;
                if (typeof message.sampling_rate === 'number' && message.sampling_rate > 0) {
                    eegSr = message.sampling_rate;
                }
                eegBuffer.push(...message.data);
                const maxSamples = Math.ceil((eegSr || 250) * 12);
                if (eegBuffer.length > maxSamples) eegBuffer = eegBuffer.slice(-maxSamples);
                return;
            }
            if (event === 'connected' || event === 'disconnected' || event === 'statusChange') {
                refreshDeviceStatus();
            }
        });
    }

    function ensureEegStream() {
        const gm = window.globalDeviceManager;
        if (!gm) return;
        setupEegListener();
        if (typeof gm.connectWebSocket === 'function') {
            try {
                gm.connectWebSocket();
            } catch (_) {
                /* ignore */
            }
        }
        // 清空旧缓冲，从当前会话重新积攒
        eegBuffer = [];
        if (typeof gm.clearBuffer === 'function') gm.clearBuffer();
    }

    function rebuildKeyboard(opts) {
        if (currentLayout() === 't9') rebuildT9(opts);
        else rebuildQwerty();
        renderCandidatesUi();
        updateCapsBadge();
        if (opts && opts.mapChanged && currentLayout() !== 't9') {
            onStimulusMapChanged(opts.reason || '键盘布局已切换');
        }
    }

    function rebuildQwerty() {
        t9Stage = 'main';
        el.wrap.classList.remove('t9-grid');
        const phases = {};
        let idx = 0;
        for (const row of KB.KB_ROWS) {
            for (const cell of row) {
                phases[cell.id] = Math.round(((idx * PHI) % 1) * 10000) / 10000;
                idx += 1;
            }
        }
        const plan = freqPlanForCount(QWERTY_KEY_COUNT);
        const block = {
            id: 1,
            shape: 'ssvep_keyboard',
            color: '#00D9FF',
            keyboardLayout: 'qwerty40',
            keyboardKeyPhases: phases,
            keyboardFreqBase: plan.base,
            keyboardFreqStep: plan.step,
            opaqueFlickerRegion: !!document.getElementById('cfg-opaque-kb')?.checked,
            actions: [{ type: 'none', content: '', targetPage: null, delayMs: 0 }]
        };
        const virtuals = KB.buildKeyboardVirtualTargets(block);
        const byId = Object.fromEntries(virtuals.map((v) => [v.keyId, v]));
        el.wrap.innerHTML = '';
        el.wrap.style.background = block.opaqueFlickerRegion ? '#000' : 'transparent';
        keyTargets = [];
        for (const row of KB.KB_ROWS) {
            const rowEl = document.createElement('div');
            rowEl.className = 'ssvep-kb-row';
            for (const cell of row) {
                const vt = byId[cell.id];
                if (!vt) continue;
                const flex = cell.flex != null ? cell.flex : 1;
                const keyEl = document.createElement('div');
                keyEl.className = 'stimulus-kb-key' + (flex > 1.2 ? ' ssvep-kb-wide' : '');
                keyEl.style.flex = `${flex} 1 0`;
                keyEl.innerHTML = `<span class="stimulus-kb-label">${escapeHtml(vt.label)}</span>`;
                keyEl.title = `${vt.label} · ${Number(vt.frequency).toFixed(1)} Hz`;
                keyEl.addEventListener('click', () => onTargetActivated(vt.keyId, vt.label, { fromClick: true }));
                rowEl.appendChild(keyEl);
                keyTargets.push({
                    id: vt.id,
                    keyId: vt.keyId,
                    label: vt.label,
                    frequency: Number(vt.frequency),
                    phase: Number(vt.phase) || 0,
                    element: keyEl,
                    meta: { layout: 'qwerty' }
                });
            }
            el.wrap.appendChild(rowEl);
        }
    }

    function t9MainDefs() {
        const flat = [];
        for (const row of T9_KEYS) {
            for (const cell of row) {
                const sub =
                    cell.kind === 'letters'
                        ? cell.letters.split('').join(' ')
                        : cell.kind === 'punct'
                          ? '.,?!'
                          : cell.kind === 'space'
                            ? '空格'
                            : cell.kind === 'lang'
                              ? t9Lang === 'zh'
                                  ? '中'
                                  : '英'
                              : '确认';
                flat.push({
                    keyId: cell.id,
                    label: cell.title,
                    sub,
                    meta: { ...cell, layout: 't9', stage: 'main' }
                });
            }
        }
        return assignFreqPhase(flat);
    }

    function t9LetterDefs(group) {
        const letters = String(group.letters || '').split('');
        const items = letters.map((ch, i) => ({
            keyId: `tl_${group.id}_${ch}`,
            label: ch,
            sub: '',
            meta: { layout: 't9', stage: 'letters', ch, group }
        }));
        items.push({
            keyId: 'tl_back',
            label: '←',
            sub: '返回',
            meta: { layout: 't9', stage: 'letters', back: true }
        });
        return assignFreqPhase(items);
    }

    function t9CandidateDefs(chars) {
        const items = chars.slice(0, 8).map((ch, i) => ({
            keyId: `tc_${i}_${ch}`,
            label: ch,
            sub: String(i + 1),
            meta: { layout: 't9', stage: 'candidates', ch }
        }));
        items.push({
            keyId: 'tc_back',
            label: '←',
            sub: '返回',
            meta: { layout: 't9', stage: 'candidates', back: true }
        });
        return assignFreqPhase(items);
    }

    function mountTargetGrid(defs, columns) {
        el.wrap.innerHTML = '';
        el.wrap.classList.add('t9-grid');
        el.wrap.style.background = document.getElementById('cfg-opaque-kb')?.checked ? '#000' : 'transparent';
        keyTargets = [];
        const grid = document.createElement('div');
        grid.className = 't9-keys';
        grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
        for (const d of defs) {
            const keyEl = document.createElement('div');
            keyEl.className = 'stimulus-kb-key t9-key';
            keyEl.innerHTML = `<span class="stimulus-kb-label">${escapeHtml(d.label)}</span>${
                d.sub ? `<span class="t9-sub">${escapeHtml(d.sub)}</span>` : ''
            }`;
            keyEl.title = `${d.label} · ${d.frequency.toFixed(2)} Hz`;
            keyEl.addEventListener('click', () =>
                onTargetActivated(d.keyId, d.label, { fromClick: true, meta: d.meta })
            );
            grid.appendChild(keyEl);
            keyTargets.push({
                id: d.keyId,
                keyId: d.keyId,
                label: d.label,
                frequency: d.frequency,
                phase: d.phase,
                element: keyEl,
                meta: d.meta
            });
        }
        el.wrap.appendChild(grid);
    }

    function rebuildT9(opts) {
        if (t9Stage === 'letters' && t9LetterGroup) {
            mountTargetGrid(t9LetterDefs(t9LetterGroup), 3);
        } else if (t9Stage === 'candidates') {
            const cands = lookupPinyinCandidates(t9Pinyin);
            mountTargetGrid(t9CandidateDefs(cands.length ? cands : ['…']), 3);
        } else {
            t9Stage = 'main';
            mountTargetGrid(t9MainDefs(), 3);
        }
        if (opts && opts.mapChanged) {
            onStimulusMapChanged(opts.reason || '九宫格界面已切换');
        }
    }

    function lookupPinyinCandidates(py) {
        const key = String(py || '')
            .toLowerCase()
            .replace(/[^a-z]/g, '');
        if (!key) return [];
        if (PINYIN_DICT[key]) return PINYIN_DICT[key].slice();
        // 前缀匹配
        const hits = [];
        for (const k of Object.keys(PINYIN_DICT)) {
            if (k.startsWith(key)) {
                for (const ch of PINYIN_DICT[k]) {
                    if (!hits.includes(ch)) hits.push(ch);
                    if (hits.length >= 8) return hits;
                }
            }
        }
        return hits;
    }

    function renderCandidatesUi() {
        if (!el.candidates) return;
        if (currentLayout() !== 't9' || t9Lang !== 'zh') {
            el.candidates.hidden = true;
            el.candidates.innerHTML = '';
            return;
        }
        const cands = lookupPinyinCandidates(t9Pinyin);
        el.candidates.hidden = false;
        el.candidates.innerHTML =
            `<span class="cand-py">拼音：${escapeHtml(t9Pinyin || '—')}</span>` +
            (cands.length
                ? cands
                      .map(
                          (ch, i) =>
                              `<button type="button" class="cand-btn" data-ch="${escapeHtml(ch)}">${i + 1}.${escapeHtml(
                                  ch
                              )}</button>`
                      )
                      .join('')
                : '<span class="cand-empty">候选将显示在此</span>');
        el.candidates.querySelectorAll('.cand-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                insertText(btn.getAttribute('data-ch') || '');
                t9Pinyin = '';
                t9Stage = 'main';
                rebuildT9({ mapChanged: true, reason: '已选字，返回主键盘' });
                renderCandidatesUi();
            });
        });
    }

    function readParams() {
        const mode = document.getElementById('cfg-mode')?.value === 'interval' ? 'interval' : 'threshold';
        return {
            mode,
            windowSec: clampNum('cfg-window', 3.0, 0.3, 5),
            cooldownSec: clampNum('cfg-cooldown', 2.0, 0.3, 10),
            pollMs: Math.round(clampNum('cfg-poll', 400, 120, 2000)),
            intervalSec: clampNum('cfg-interval', 3, 0.5, 15),
            minProbability: clampNum('cfg-min-prob', 0.2, 0.03, 0.99),
            minMargin: clampNum('cfg-min-margin', 0.06, 0, 0.5),
            thresholdRequireStable: !!document.getElementById('cfg-require-stable')?.checked,
            flickerHighBlank: !!document.getElementById('cfg-flicker-high-blank')?.checked,
            flickerOnDutyPercent: Math.round(clampNum('cfg-duty', 32, 15, 50)),
            flickerBlockOpacityPercent: Math.round(clampNum('cfg-opacity', 100, 20, 100)),
            flickerColorOn: readFlickerColor('cfg-flicker-on', '#ffffff'),
            flickerColorOff: readFlickerColor('cfg-flicker-off', '#000000'),
            speakOnDecode: !!document.getElementById('cfg-speak')?.checked,
            systemKeys: !!document.getElementById('cfg-system-keys')?.checked,
            opaqueKeyboard: !!document.getElementById('cfg-opaque-kb')?.checked,
            layout: currentLayout(),
            freqBand: currentFreqBand().id,
            eegEnabled: true
        };
    }

    function readFlickerColor(id, fallback) {
        const el = document.getElementById(id);
        const raw = el && el.value;
        if (typeof window.normalizeHexColor === 'function') {
            return window.normalizeHexColor(raw, fallback);
        }
        return raw && String(raw).trim() ? String(raw).trim() : fallback;
    }

    function clampNum(id, fallback, lo, hi) {
        const v = Number(document.getElementById(id)?.value);
        if (!Number.isFinite(v)) return fallback;
        return Math.min(hi, Math.max(lo, v));
    }

    function applyFlickerParams(p) {
        flickerHighBlank = !!p.flickerHighBlank;
        flickerDuty = Math.max(0.12, Math.min(0.52, (p.flickerOnDutyPercent || 32) / 100));
        flickerOpacity = Math.max(0.2, Math.min(1, (p.flickerBlockOpacityPercent || 100) / 100));
        flickerColorOn = p.flickerColorOn || '#ffffff';
        flickerColorOff = p.flickerColorOff || '#000000';
    }

    function keyBrightness(freq, phase01, elapsedSec) {
        const phase = 2 * Math.PI * freq * elapsedSec + phase01 * 2 * Math.PI;
        if (!flickerHighBlank) {
            return Math.round((Math.sin(phase) + 1) * 127.5);
        }
        const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return p < 2 * Math.PI * flickerDuty ? 255 : 0;
    }

    function paintKey(el, brightness) {
        if (!el) return;
        if (typeof window.flickerColorCss === 'function') {
            el.style.backgroundColor = window.flickerColorCss(
                brightness,
                flickerColorOn,
                flickerColorOff,
                flickerOpacity
            );
            el.style.color = window.flickerLabelColor(brightness, flickerColorOn, flickerColorOff);
        } else {
            el.style.backgroundColor = `rgba(${brightness},${brightness},${brightness},${flickerOpacity})`;
            el.style.color = brightness > 140 ? '#111' : '#eee';
        }
    }

    function clearDecodeHighlightClasses() {
        document.querySelectorAll('.stimulus-kb-key').forEach((node) => {
            node.classList.remove('stimulus-kb-key-top', 'stimulus-kb-key-triggered');
            node.removeAttribute('data-decode-p');
        });
    }

    /** 与刺激页 applyDecodeHighlight 一致：标黄 + 概率徽标 */
    function applyDecodeHighlight(data, triggered) {
        const resolved = resolveTargetFromDecode(data);
        const ranked = data && data.ranked_by_probability;
        const top = ranked && ranked[0];
        const p = top ? Number(top.probability) : NaN;

        if (triggered) {
            clearDecodeHighlightClasses();
            if (!resolved || !resolved.target || !resolved.target.element) return;
            const el = resolved.target.element;
            el.classList.add('stimulus-kb-key-top', 'stimulus-kb-key-triggered');
            if (Number.isFinite(p)) el.setAttribute('data-decode-p', `${(p * 100).toFixed(0)}%`);
            decodeHoldKeyId = resolved.target.keyId;
            if (decodeHoldTimer != null) clearTimeout(decodeHoldTimer);
            const holdMs = Math.max(400, (readParams().cooldownSec || 2) * 1000);
            decodeHoldTimer = setTimeout(() => {
                decodeHoldTimer = null;
                decodeHoldKeyId = null;
                el.classList.remove('stimulus-kb-key-top', 'stimulus-kb-key-triggered');
                el.removeAttribute('data-decode-p');
            }, holdMs);
            return;
        }

        if (decodeHoldKeyId && decodeHoldTimer) return;
        clearDecodeHighlightClasses();
        if (!resolved || !resolved.target || !resolved.target.element) return;
        const el = resolved.target.element;
        el.classList.add('stimulus-kb-key-top');
        if (Number.isFinite(p)) el.setAttribute('data-decode-p', `${(p * 100).toFixed(0)}%`);
    }

    function flashKey(keyEl, p1) {
        if (!keyEl) return;
        keyEl.classList.add('stimulus-kb-key-top', 'stimulus-kb-key-triggered');
        if (p1 != null && Number.isFinite(Number(p1))) {
            keyEl.setAttribute('data-decode-p', `${(Number(p1) * 100).toFixed(0)}%`);
        }
        setTimeout(() => {
            if (decodeHoldKeyId) return;
            keyEl.classList.remove('stimulus-kb-key-top', 'stimulus-kb-key-triggered');
            keyEl.removeAttribute('data-decode-p');
        }, 480);
    }

    function renderFrame(now) {
        if (!running) return;
        const elapsed = (now - startTime) / 1000;
        for (const t of keyTargets) {
            const b = keyBrightness(t.frequency, t.phase, elapsed);
            paintKey(t.element, b);
        }
        frameCount += 1;
        if (now - lastFpsAt >= 1000) {
            const fps = Math.round((frameCount * 1000) / (now - lastFpsAt));
            if (el.fps) {
                el.fps.textContent = String(fps);
                el.fps.style.color = fps >= 55 ? '#4caf50' : fps >= 45 ? '#ffc107' : '#f44336';
            }
            frameCount = 0;
            lastFpsAt = now;
            updateBufHint();
        }
        rafId = requestAnimationFrame(renderFrame);
    }

    function updateBufHint() {
        if (!el.bufHint) return;
        const need = Math.round((eegSr || 250) * (readParams().windowSec || 3));
        el.bufHint.textContent = `EEG缓冲 ${eegBuffer.length}/${need} · ${eegSr}Hz`;
    }

    function setLive(text) {
        if (el.live) el.live.textContent = text;
    }

    function updateCapsBadge() {
        if (!el.capsBadge) return;
        if (currentLayout() === 't9') {
            el.capsBadge.textContent = t9Lang === 'zh' ? '中文九宫格' : '英文九宫格';
            el.capsBadge.style.color = '#ffc107';
        } else {
            el.capsBadge.textContent = capsOn ? 'Caps On' : 'Caps Off';
            el.capsBadge.style.color = capsOn ? '#ffc107' : '#666';
        }
    }

    function insertText(text) {
        const ta = el.output;
        if (!ta || text == null || text === '') return;
        let start = ta.selectionStart;
        let end = ta.selectionEnd;
        if (start == null) start = ta.value.length;
        if (end == null) end = start;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        ta.value = before + text + after;
        const pos = start + String(text).length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.focus();
    }

    function backspaceText() {
        const ta = el.output;
        if (!ta) return;
        let start = ta.selectionStart;
        let end = ta.selectionEnd;
        if (start == null) start = ta.value.length;
        if (end == null) end = start;
        if (start !== end) {
            ta.value = ta.value.slice(0, start) + ta.value.slice(end);
            ta.selectionStart = ta.selectionEnd = start;
        } else if (start > 0) {
            ta.value = ta.value.slice(0, start - 1) + ta.value.slice(start);
            ta.selectionStart = ta.selectionEnd = start - 1;
        }
        ta.focus();
    }

    function noteHit(label, meta) {
        hitCount += 1;
        if (el.hits) el.hits.textContent = String(hitCount);
        if (el.lastKey) {
            el.lastKey.textContent =
                '最近：' +
                label +
                (meta && meta.fromClick ? '（点击）' : '（识别）') +
                (meta && meta.p1 != null ? ` p=${(meta.p1 * 100).toFixed(1)}%` : '');
        }
        const p = readParams();
        if (p.speakOnDecode && !(meta && meta.fromClick && label === 'Caps')) {
            trySpeak(label);
        }
    }

    function trySpeak(text) {
        try {
            if (!window.speechSynthesis) return;
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(String(text));
            u.lang = 'zh-CN';
            u.rate = 1.05;
            window.speechSynthesis.speak(u);
        } catch (_) {
            /* ignore */
        }
    }

    function onTargetActivated(keyId, label, meta) {
        const tgt = keyTargets.find((t) => t.keyId === keyId);
        if (tgt) flashKey(tgt.element, meta && meta.p1);
        const m = (meta && meta.meta) || (tgt && tgt.meta) || {};
        if (currentLayout() === 't9' || m.layout === 't9') {
            handleT9Key(keyId, label, m, meta);
        } else {
            handleQwertyKey(keyId, label, meta);
        }
    }

    function handleQwertyKey(keyId, label, meta) {
        if (keyId === 'Caps') {
            capsOn = !capsOn;
            updateCapsBadge();
            noteHit('Caps', meta);
            return;
        }
        if (keyId === 'Backspace') {
            backspaceText();
            noteHit('Bksp', meta);
            if (readParams().systemKeys) void maybeInjectSystemKey('Backspace');
            return;
        }
        if (keyId === 'Enter') {
            insertText('\n');
            noteHit('Enter', meta);
            if (readParams().systemKeys) void maybeInjectSystemKey('Enter');
            return;
        }
        if (keyId === 'Space') {
            insertText(' ');
            noteHit('Space', meta);
            if (readParams().systemKeys) void maybeInjectSystemKey('Space');
            return;
        }
        let ch = label || keyId;
        if (/^[A-Z]$/.test(keyId)) ch = capsOn ? keyId : keyId.toLowerCase();
        else if (/^[0-9]$/.test(keyId)) ch = keyId;
        insertText(ch);
        noteHit(ch, meta);
        if (readParams().systemKeys) void maybeInjectSystemKey(keyId);
    }

    function handleT9Key(keyId, label, m, meta) {
        if (m.back) {
            t9Stage = 'main';
            t9LetterGroup = null;
            rebuildT9({ mapChanged: true, reason: '返回主键盘' });
            noteHit('返回', meta);
            return;
        }
        if (m.stage === 'candidates' && m.ch) {
            insertText(m.ch);
            t9Pinyin = '';
            t9Stage = 'main';
            rebuildT9({ mapChanged: true, reason: '已选字，返回主键盘' });
            renderCandidatesUi();
            noteHit(m.ch, meta);
            return;
        }
        if (m.stage === 'letters' && m.ch) {
            const ch = String(m.ch);
            if (t9Lang === 'zh') {
                t9Pinyin += ch.toLowerCase();
                renderCandidatesUi();
                const cands = lookupPinyinCandidates(t9Pinyin);
                if (cands.length === 1) {
                    // 唯一候选可继续输入拼音；不自动上屏
                }
            } else {
                insertText(capsOn ? ch.toUpperCase() : ch.toLowerCase());
            }
            t9Stage = 'main';
            t9LetterGroup = null;
            rebuildT9({ mapChanged: true, reason: '已选字母，返回主键盘' });
            noteHit(ch, meta);
            return;
        }
        // main stage
        if (m.kind === 'lang') {
            t9Lang = t9Lang === 'zh' ? 'en' : 'zh';
            t9Pinyin = '';
            updateCapsBadge();
            renderCandidatesUi();
            rebuildT9();
            noteHit(t9Lang === 'zh' ? '中文' : '英文', meta);
            return;
        }
        if (m.kind === 'space') {
            if (t9Lang === 'zh' && t9Pinyin) {
                const cands = lookupPinyinCandidates(t9Pinyin);
                if (cands.length) {
                    t9Stage = 'candidates';
                    rebuildT9({ mapChanged: true, reason: '进入候选字选择' });
                    noteHit('候选', meta);
                    return;
                }
            }
            insertText(' ');
            noteHit('空格', meta);
            return;
        }
        if (m.kind === 'confirm') {
            if (t9Lang === 'zh' && t9Pinyin) {
                const cands = lookupPinyinCandidates(t9Pinyin);
                if (cands.length) {
                    t9Stage = 'candidates';
                    rebuildT9({ mapChanged: true, reason: '进入候选字选择' });
                    noteHit('候选', meta);
                    return;
                }
                // 无候选则上屏拼音
                insertText(t9Pinyin);
                t9Pinyin = '';
                renderCandidatesUi();
                noteHit('拼音', meta);
                return;
            }
            insertText('\n');
            noteHit('确认', meta);
            return;
        }
        if (m.kind === 'punct') {
            // 多击标点
            const seq = '.,?!1';
            const now = performance.now();
            if (t9Multi.keyId === keyId && now - t9Multi.at < 1200) {
                t9Multi.idx = (t9Multi.idx + 1) % seq.length;
                // 替换上一个字符
                backspaceText();
            } else {
                t9Multi = { keyId, idx: 0, at: now };
            }
            t9Multi.at = now;
            insertText(seq[t9Multi.idx]);
            noteHit(seq[t9Multi.idx], meta);
            return;
        }
        if (m.kind === 'letters') {
            t9LetterGroup = m;
            t9Stage = 'letters';
            rebuildT9({ mapChanged: true, reason: '进入字母选择' });
            noteHit(m.digit + ' ' + m.letters, meta);
        }
    }

    async function maybeInjectSystemKey(keyId) {
        const action =
            typeof KB.defaultKeyboardKeyAction === 'function' ? KB.defaultKeyboardKeyAction(keyId) : null;
        if (!action || action.type !== 'keyboard' || !action.content) return;
        let binding = null;
        if (typeof window.parseKeyboardBinding === 'function') {
            binding = window.parseKeyboardBinding(action.content);
        }
        if (!binding || !binding.chords || !binding.chords.length) return;
        try {
            await fetch(`${resolveOrigin()}/api/system/keyboard/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chords: binding.chords })
            });
        } catch (e) {
            console.warn('系统按键注入失败', e);
        }
    }

    function getSsvepChannelIndices() {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.loadFullConfig === 'function') {
            const cfg = CFG.loadFullConfig();
            if (window.globalDeviceManager && typeof window.globalDeviceManager.applyChannelConfig === 'function') {
                window.globalDeviceManager.applyChannelConfig(cfg);
            }
            return cfg.ssvepChannelIndices;
        }
        if (CFG && typeof CFG.getGlobalSsvepChannelIndices === 'function') {
            return CFG.getGlobalSsvepChannelIndices();
        }
        return null;
    }

    async function decodeOnce(opts) {
        const gm = window.globalDeviceManager;
        const status = gm && typeof gm.getStatus === 'function' ? gm.getStatus() : null;
        const connected = !!(status && status.isConnected);
        if (!connected) {
            setLive('设备未连接：请先在设备管理连接 SEEKBCI');
            return null;
        }
        if (status && status.wsConnected === false) {
            setupEegListener();
            if (typeof gm.connectWebSocket === 'function') {
                try {
                    gm.connectWebSocket();
                } catch (_) {
                    /* ignore */
                }
            }
            setLive('数据通道未就绪，正在重连 WebSocket…');
            return null;
        }

        const sr = eegSr || (gm.deviceInfo && gm.deviceInfo.sampling_rate) || 250;
        const windowSec = opts.windowSec;
        const n = Math.max(50, Math.round(sr * windowSec));

        let slice = [];
        if (eegBuffer.length >= n) slice = eegBuffer.slice(-n);
        else if (gm && typeof gm.getRecentData === 'function') {
            const recent = gm.getRecentData(Math.min(8, Math.max(windowSec + 0.5, 2)));
            if (recent && recent.length >= n) slice = recent.slice(-n);
            else if (recent && recent.length > slice.length) slice = recent.slice();
        }

        if (slice.length < n || !Array.isArray(slice[0])) {
            setLive(`EEG 缓冲不足 ${slice.length}/${n}（需保持闪烁约 ${windowSec}s）`);
            updateBufHint();
            return null;
        }

        const frequencies_hz = keyTargets.map((t) => t.frequency);
        const phases = keyTargets.map((t) => t.phase);
        if (frequencies_hz.length < 2) {
            setLive('目标过少，无法解码');
            return null;
        }

        const body = {
            samples: slice,
            sampling_rate: sr,
            frequencies_hz,
            phases,
            window_sec: windowSec
        };
        const chIdx = getSsvepChannelIndices();
        if (chIdx && chIdx.length) body.channel_indices = chIdx;

        const resp = await fetch(`${resolveOrigin()}/api/ssvep/fbcca/decode_window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            let detail = data.detail;
            if (typeof detail !== 'string') detail = JSON.stringify(detail || resp.status);
            setLive('解码失败：' + detail);
            return null;
        }
        return data;
    }

    function resolveTargetFromDecode(data) {
        const ranked = data.ranked_by_probability || [];
        if (!ranked.length) return null;
        const top = ranked[0];
        let idx = Number.isInteger(top.index) ? top.index : -1;
        if (idx < 0 || idx >= keyTargets.length) {
            const hz = Number(top.frequency_hz);
            idx = keyTargets.findIndex((t) => Math.abs(t.frequency - hz) < 0.09);
        }
        if (idx < 0) return null;
        return { target: keyTargets[idx], top, ranked };
    }

    function shouldTrigger(data, opts, now) {
        const resolved = resolveTargetFromDecode(data);
        if (!resolved) return { ok: false, status: '无有效目标' };
        const { target, top, ranked } = resolved;
        const p1 = Number(top.probability);
        const hz = target.frequency;

        if (opts.mode === 'interval') {
            if (p1 < opts.minProbability) {
                return { ok: false, status: `定时：${target.label} p=${(p1 * 100).toFixed(1)}%（不足）` };
            }
            if (now - lastIntervalFireTs < opts.intervalSec * 1000) {
                return { ok: false, status: `定时等待… Top ${target.label}` };
            }
            return { ok: true, target, p1, status: `定时触发 ${target.label}` };
        }

        if (ranked.length < 2) return { ok: false, status: '置信度：候选不足' };
        const p2 = Number(ranked[1].probability);
        if (!(p1 >= opts.minProbability && p1 - p2 >= opts.minMargin)) {
            stableCandidateHz = null;
            return {
                ok: false,
                status: `注视：${target.label} p=${(p1 * 100).toFixed(1)}% Δ=${((p1 - p2) * 100).toFixed(1)}%`
            };
        }
        if (opts.thresholdRequireStable) {
            const same = stableCandidateHz != null && Math.abs(stableCandidateHz - hz) < 0.09;
            if (!same) {
                stableCandidateHz = hz;
                return { ok: false, status: `待确认稳定：${target.label}` };
            }
            stableCandidateHz = null;
        }
        return { ok: true, target, p1, status: `触发 ${target.label} p=${(p1 * 100).toFixed(1)}%` };
    }

    async function pollDecode() {
        if (!running || decoding) return;
        if (performance.now() < decodeResumeAt) {
            const remain = ((decodeResumeAt - performance.now()) / 1000).toFixed(1);
            setLive(`刺激切换冷却中… ${remain}s（请持续注视新界面）`);
            updateBufHint();
            return;
        }
        const opts = readParams();
        const now = performance.now();
        if (now - lastFireTs < opts.cooldownSec * 1000) return;
        decoding = true;
        try {
            const data = await decodeOnce(opts);
            if (!data) return;
            const decision = shouldTrigger(data, opts, now);
            setLive(decision.status || '解码中…');
            applyDecodeHighlight(data, !!(decision.ok && decision.target));
            if (decision.ok && decision.target) {
                lastFireTs = now;
                if (opts.mode === 'interval') lastIntervalFireTs = now;
                onTargetActivated(decision.target.keyId, decision.target.label, {
                    p1: decision.p1,
                    meta: decision.target.meta
                });
            }
        } catch (e) {
            setLive('解码异常：' + (e.message || e));
        } finally {
            decoding = false;
        }
    }

    function start() {
        if (running) return;
        const p = readParams();
        applyFlickerParams(p);
        ensureEegStream();
        rebuildKeyboard();
        running = true;
        startTime = performance.now();
        lastFpsAt = startTime;
        frameCount = 0;
        lastFireTs = 0;
        lastIntervalFireTs = 0;
        stableCandidateHz = null;
        decodeResumeAt = startTime + p.windowSec * 1000;
        el.btnStart.disabled = true;
        el.btnStop.disabled = false;
        setLive('闪烁中，积攒 EEG 窗长后开始解码…');
        rafId = requestAnimationFrame(renderFrame);
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => void pollDecode(), p.pollMs);
        saveUi();
    }

    function stop() {
        running = false;
        el.btnStart.disabled = false;
        el.btnStop.disabled = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        for (const t of keyTargets) {
            t.element.style.backgroundColor = 'rgba(136,136,136,0.9)';
            t.element.style.color = '#111';
        }
        setLive('已停止');
        if (el.fps) el.fps.textContent = '—';
    }

    function refreshDeviceStatus() {
        const gm = window.globalDeviceManager;
        const st = gm && gm.getStatus ? gm.getStatus() : { isConnected: false };
        const connected = !!st.isConnected;
        if (el.conn) {
            const ws = st.wsConnected ? 'WS✓' : 'WS✗';
            el.conn.textContent = connected
                ? `已连接 · ${gm.deviceInfo?.name || 'EEG'} · ${ws}`
                : '设备未连接';
            el.conn.className =
                'status-pill ' + (connected && st.wsConnected ? 'status-ok' : connected ? 'status-warn' : 'status-bad');
        }
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (el.fbcca && CFG && typeof CFG.formatFbccaChannelIndicesLabel === 'function') {
            el.fbcca.textContent = 'FBCCA：' + CFG.formatFbccaChannelIndicesLabel(getSsvepChannelIndices());
        }
        updateBufHint();
    }

    function fillProjects() {
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem('ssvep_projects') || '[]');
        } catch (_) {
            list = [];
        }
        if (!Array.isArray(list)) list = [];
        el.projectSel.innerHTML =
            '<option value="">（选择项目）</option>' +
            list
                .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`)
                .join('');
    }

    function syncToProject() {
        const id = el.projectSel.value;
        if (!id) {
            alert('请先选择目标项目');
            return;
        }
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem('ssvep_projects') || '[]');
        } catch (_) {
            list = [];
        }
        const idx = list.findIndex((p) => p.id === id);
        if (idx < 0) {
            alert('未找到项目');
            return;
        }
        const p = readParams();
        const patch = {
            eegEnabled: true,
            mode: p.mode,
            windowSec: p.windowSec,
            cooldownSec: p.cooldownSec,
            pollMs: p.pollMs,
            intervalSec: p.intervalSec,
            minProbability: p.minProbability,
            minMargin: p.minMargin,
            thresholdRequireStable: p.thresholdRequireStable,
            flickerHighBlank: p.flickerHighBlank,
            flickerOnDutyPercent: p.flickerOnDutyPercent,
            flickerBlockOpacityPercent: p.flickerBlockOpacityPercent,
            flickerColorOn: p.flickerColorOn,
            flickerColorOff: p.flickerColorOff,
            speakOnDecode: p.speakOnDecode
        };
        if (typeof window.normalizeStimulusRunConfig === 'function') {
            Object.assign(patch, window.normalizeStimulusRunConfig(patch));
        }
        list[idx].runConfig = { ...(list[idx].runConfig || {}), ...patch };
        list[idx].settings = {
            ...(list[idx].settings || {}),
            systemKeyboardBridge: !!p.systemKeys
        };
        list[idx].updated_at = new Date().toISOString();
        localStorage.setItem('ssvep_projects', JSON.stringify(list));
        try {
            const cur = JSON.parse(localStorage.getItem('ssvep_project') || 'null');
            if (cur && cur.id === id) {
                cur.runConfig = { ...(cur.runConfig || {}), ...patch };
                cur.settings = { ...(cur.settings || {}), systemKeyboardBridge: !!p.systemKeys };
                localStorage.setItem('ssvep_project', JSON.stringify(cur));
            }
        } catch (_) {
            /* ignore */
        }
        try {
            const E = window.SEEKBCI_EXPERIMENT;
            if (E && typeof E.saveExperimentConfig === 'function') {
                const cfg = E.loadExperimentConfig ? E.loadExperimentConfig() : {};
                cfg.keyboardTest = { ...patch, source: 'ssvep-keyboard-test' };
                E.saveExperimentConfig(cfg);
            }
        } catch (_) {
            /* ignore */
        }
        alert(`已同步到「${list[idx].name}」\n窗长 ${patch.windowSec}s · 冷却 ${patch.cooldownSec}s`);
        saveUi();
    }

    function saveUi() {
        try {
            const ids = [
                'cfg-mode',
                'cfg-window',
                'cfg-cooldown',
                'cfg-poll',
                'cfg-interval',
                'cfg-min-prob',
                'cfg-min-margin',
                'cfg-duty',
                'cfg-opacity',
                'cfg-layout',
                'cfg-freq-band',
                'cfg-flicker-on',
                'cfg-flicker-off'
            ];
            const data = { checks: {} };
            ids.forEach((id) => {
                const node = document.getElementById(id);
                if (node) data[id] = node.value;
            });
            [
                'cfg-require-stable',
                'cfg-flicker-high-blank',
                'cfg-opaque-kb',
                'cfg-speak',
                'cfg-system-keys'
            ].forEach((id) => {
                const node = document.getElementById(id);
                if (node) data.checks[id] = !!node.checked;
            });
            data.t9Lang = t9Lang;
            localStorage.setItem(STORAGE_UI, JSON.stringify(data));
        } catch (_) {
            /* ignore */
        }
    }

    function loadUi() {
        try {
            const raw = localStorage.getItem(STORAGE_UI);
            if (!raw) return;
            const data = JSON.parse(raw);
            Object.keys(data).forEach((id) => {
                if (id === 'checks' || id === 't9Lang') return;
                const node = document.getElementById(id);
                if (node && data[id] != null) node.value = data[id];
            });
            if (data.checks) {
                Object.keys(data.checks).forEach((id) => {
                    const node = document.getElementById(id);
                    if (node) node.checked = !!data.checks[id];
                });
            }
            if (data.t9Lang === 'zh' || data.t9Lang === 'en') t9Lang = data.t9Lang;
        } catch (_) {
            /* ignore */
        }
    }

    function syncDutyWrap() {
        if (el.dutyWrap) el.dutyWrap.hidden = !el.highBlank?.checked;
    }

    function onLayoutChange() {
        t9Stage = 'main';
        t9LetterGroup = null;
        rebuildKeyboard({ mapChanged: true, reason: '布局已切换' });
        saveUi();
    }

    function onFreqBandChange() {
        t9Stage = 'main';
        t9LetterGroup = null;
        rebuildKeyboard({ mapChanged: true, reason: '频段已切换' });
        saveUi();
    }

    el.btnStart.addEventListener('click', start);
    el.btnStop.addEventListener('click', stop);
    el.btnClear.addEventListener('click', () => {
        if (el.output) el.output.value = '';
        t9Pinyin = '';
        hitCount = 0;
        if (el.hits) el.hits.textContent = '0';
        renderCandidatesUi();
    });
    el.btnSync.addEventListener('click', syncToProject);
    el.highBlank?.addEventListener('change', syncDutyWrap);
    el.layout?.addEventListener('change', onLayoutChange);
    document.getElementById('cfg-freq-band')?.addEventListener('change', onFreqBandChange);
    document.getElementById('btn-flicker-bw')?.addEventListener('click', () => {
        const on = document.getElementById('cfg-flicker-on');
        const off = document.getElementById('cfg-flicker-off');
        if (on) on.value = '#ffffff';
        if (off) off.value = '#000000';
        applyFlickerParams(readParams());
        saveUi();
    });
    document.getElementById('cfg-flicker-on')?.addEventListener('input', () => {
        applyFlickerParams(readParams());
        saveUi();
    });
    document.getElementById('cfg-flicker-off')?.addEventListener('input', () => {
        applyFlickerParams(readParams());
        saveUi();
    });
    document.getElementById('cfg-opaque-kb')?.addEventListener('change', () => {
        rebuildKeyboard();
    });

    loadUi();
    syncDutyWrap();
    setupEegListener();
    rebuildKeyboard();
    fillProjects();
    refreshDeviceStatus();
    setInterval(refreshDeviceStatus, 1500);
})();
