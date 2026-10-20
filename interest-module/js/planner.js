/* =========================================================================
   兴趣 -> 计划生成 —— InterestPlanner
   -------------------------------------------------------------------------
   职责：认出这条兴趣属于哪一类活动 -> 结合个人画像打分 ->
         生成一套可直接执行的具体计划
         （目标 / 步骤 / 时间安排 / 所需资源 / 验收指标 / 风险与降级）。

   调用方：兴趣池界面。界面层的入口只有一条——从兴趣池里挑一条兴趣点「生成计划」，
           本模块认的也是这条兴趣的名字，不提供「随手写一句话就出计划」的旁路。
   依赖：InterestClassifier（识别）、InterestPool（兴趣池与时段推导）、
         window.LMS（负荷评分，复用 load-manager 既有纯函数，不重复实现）。
   注意：本模块只产出数据，不渲染界面；界面层只呈现处理后的自然语言结果。
   ========================================================================= */
(function (root) {
  'use strict';

  var C = root.InterestClassifier;
  var P = root.InterestPool;
  if (!C || !P) { throw new Error('InterestPlanner 依赖 interest-classifier.js 与 interest-pool.js，请先加载'); }

  var VERSION = '1.0';
  var LEVELS = ['轻松', '标准', '挑战'];
  var LEVEL_TAG = { '轻松': '轻松', '标准': '推荐', '挑战': '进阶' };

  /* ---------- 领域计划模板 ----------
     每个类别给出：一句话目标、最终产出与完成判据、六类资源、风险与降级动作，
     以及「正规培养流程」六个阶段各自的具体动作（aim / prep / model / drill / make / keep）。

     这六个字段不是随便凑的动作清单，而是一条有先后依赖的培养路径：
       定向 → 摸底与准备 → 入门模仿 → 分块练习 → 做成成品 → 复盘与固化
     没有目标的练习是瞎练，没有起点记录的练习看不出进步，
     没有复盘的练习留不下来。所以顺序固定，每个类别只替换「具体做什么」。 */
  var TEMPLATES = {
    music: {
      goal: '完整弹奏一首入门曲，并录下一段 30 秒演奏',
      deliverable: '一段完整演奏的录音',
      check: '连续 3 遍不出明显错误',
      aim: '写下要完整弹出哪一首、到什么程度算过',
      prep: '调好音，把曲子听三遍，标出最难的两个小节',
      model: '跟示范用最慢速度把全曲走一遍，只求走通',
      drill: '每次只攻一个卡点，拆成半小节循环五遍',
      make: '把全曲连起来，用原速录一遍留作对照',
      keep: '回听录音对照标准挑出三处问题，定下练习频率',
      tools: ['乐器或琴房'], materials: ['入门曲谱'], place: ['安静房间，注意别扰邻'], knowledge: ['识谱基础'],
      risk: '连续两次都练不下来', fallback: '降到每次 10 分钟只练一小节，节奏不断'
    },
    coding: {
      goal: '独立做出一个能跑起来的小功能',
      deliverable: '一个能跑起来的小功能',
      check: '自己从零操作一遍能重现结果',
      aim: '定一个能跑起来的小功能，写下输入和输出',
      prep: '装好环境，先手动把最小例子跑通一次',
      model: '照官方文档手敲一遍最小版本，不复制粘贴',
      drill: '每次只加一个能力，加完立刻跑一次',
      make: '补上出错处理，整理成一个文件并写下用法',
      keep: '照说明从零再跑一遍，记下最容易卡的那一步',
      tools: ['电脑', '代码编辑器'], materials: ['官方文档或教程'], place: ['安静的桌面'], knowledge: ['基本的文件与命令概念'],
      risk: '报错卡住超过 30 分钟', fallback: '把报错原样拿去搜索，或退回上一个能跑的版本'
    },
    reading: {
      goal: '读完一本书，并留下一页自己的笔记',
      deliverable: '一页纸的读书笔记',
      check: '能对着笔记把这本书讲给别人听',
      aim: '定下读哪本书、要能讲清什么，写下三个想得到的答案',
      prep: '翻目录标出最相关的三章，备好笔和便签',
      model: '先精读其中一章，边读边写三句自己的想法',
      drill: '每次固定页数，只回答一个预设问题',
      make: '把批注串成一页纸的笔记，能对着它讲给别人听',
      keep: '一周后回看笔记，补上当时没想通的地方',
      tools: ['书或阅读器'], materials: ['便签或笔记本'], place: ['光线好且安静的位置'], knowledge: [],
      risk: '读不进去、总是走神', fallback: '换成同主题的入门版或听书，先读完一遍再回头精读'
    },
    language: {
      goal: '能在真实场景里用这门语言完成一次对话',
      deliverable: '一段对话演练的录音',
      check: '不看稿能说出其中 8 句以上',
      aim: '定下在什么场景、用这门语言做成什么事',
      prep: '列出这个场景马上要用的十句高频句，抄下来',
      model: '跟着音频逐句跟读，先把十句说顺，不管语法',
      drill: '每次脱稿复述，再把句子换成自己的信息重说',
      make: '录一次完整的对话演练',
      keep: '回听录音挑出最别扭的两句，定下每天几分钟',
      tools: ['手机或电脑'], materials: ['教材或学习应用'], place: ['可以出声的地方'], knowledge: [],
      risk: '只背不开口', fallback: '每次先开口复述，再回头看拼写'
    },
    design: {
      goal: '完成一幅自己的作品并导出成图',
      deliverable: '一张完成的作品图',
      check: '退远看整体是协调的，没有明显别扭的地方',
      aim: '定下主题、尺寸和用途，找两张同风格参考图',
      prep: '建好画布与图层，把参考图放在画面旁',
      model: '照着参考图临一遍大体结构，只求位置比例对',
      drill: '每次只练一个短板，要么铺大形要么抠细节',
      make: '完整画完一张，只改最碍眼的一处再导出',
      keep: '把成品和参考图并排看，写下差距最大的一点',
      tools: ['绘图软件或数位板'], materials: ['参考图'], place: ['光线稳定的桌面'], knowledge: [],
      risk: '越画越糊、改不动', fallback: '把画面缩小看整体，一次只改一处'
    },
    writing: {
      goal: '写出一篇完整的文章并发布出去',
      deliverable: '一篇发布出去的文章',
      check: '自己从头读完一遍不觉得卡',
      aim: '定下写给谁看、看完要记住哪一句话',
      prep: '收集素材，列三条大纲，标出最有把握的一条',
      model: '照最像样的范文搭骨架，写出开头三段',
      drill: '每次只攻一节，顺着大纲往下写，不回头改',
      make: '通读删掉一半废话，定稿并发布',
      keep: '隔一天重读，标出下次要改的写法存成模板',
      tools: ['电脑或笔记本'], materials: ['素材与笔记'], place: ['不被打断的时段'], knowledge: [],
      risk: '卡在开头写不下去', fallback: '从中间最想写的那段开始，最后再回来写开头'
    },
    history: {
      goal: '把一个历史问题梳理清楚，画成一条时间线',
      deliverable: '一条时间线加上一段自己的结论',
      check: '能不看资料把这条线讲一遍',
      aim: '定一个一句话能说清的具体问题，写下初步猜想',
      prep: '找两三个可靠来源，确认它们能回答这个问题',
      model: '精读一段最典型的材料，边读边记时间和人物',
      drill: '每次只查一个线索，矛盾的说法单独列出来',
      make: '画成一条时间线，末尾写下自己的结论',
      keep: '不看资料讲一遍，讲不通的地方回去补',
      tools: ['电脑或书籍'], materials: ['时间线模板'], place: ['安静的桌位'], knowledge: [],
      risk: '资料越看越散', fallback: '只保留与问题直接相关的线索，其余先放一边'
    },
    photography: {
      goal: '拍出一组主题一致的照片并选出成片',
      deliverable: '3 张主题一致的成片',
      check: '放在一起看风格统一',
      aim: '定下拍摄主题，说清一张好照片要有什么',
      prep: '确认电量与存储，选好时间和地点',
      model: '按参考图构图先拍十张，只调角度不看参数',
      drill: '每次只改一个变量，同主题拍到三十张',
      make: '挑三张最像的，统一调色后导出成片',
      keep: '和参考图并排看，写下差在哪、下次拍什么',
      tools: ['相机或手机'], materials: ['存储卡或云盘'], place: ['外景或家中固定光源处'], knowledge: [],
      risk: '拍不出想要的感觉', fallback: '一次只改一个变量，比如只换角度'
    },
    sport: {
      goal: '稳定完成一次目标强度的训练',
      deliverable: '一次完整训练的记录',
      check: '全程没有中途放弃，动作没有明显变形',
      aim: '定下练什么、练到什么程度，写下具体指标',
      prep: '确认场地装备，热身五分钟，记下现在能做多少',
      model: '按标准动作做一组，宁可轻也不要变形',
      drill: '每次只盯一个要点，按固定组数完成',
      make: '完整完成一次目标强度的训练，中途不放弃',
      keep: '拉伸放松，记录完成度，定下每周几次和休息日',
      tools: ['合适的运动鞋'], materials: ['训练计划'], place: ['场地或家里的空地'], knowledge: [],
      risk: '太累或身体不适', fallback: '换成低强度版本，习惯不能断'
    },
    cooking: {
      goal: '独立做出一道成菜，并请人尝一尝',
      deliverable: '一道自己完成的成菜',
      check: '别人尝过愿意再吃一次',
      aim: '定下做哪道菜、给谁吃，说清怎样算成功',
      prep: '核对菜谱与食材，缺的写进采购清单',
      model: '严格照菜谱做一遍，不改配方，先认标准味道',
      drill: '每次只改一个变量，比如只调盐量或火候',
      make: '独立完成一道成菜，装盘并留一张照片',
      keep: '请人尝一尝，记下偏差，写下下次要改的一处',
      tools: ['锅具与灶'], materials: ['食材'], place: ['厨房'], knowledge: [],
      risk: '味道不稳定', fallback: '一次只改一个变量（比如只用盐量）再试一次'
    },
    craft: {
      goal: '做出一件完整的小作品',
      deliverable: '一件完成的小作品',
      check: '拿在手里看不出半成品的痕迹',
      aim: '定下做一件什么、给谁用，画草图并标好尺寸',
      prep: '核对材料工具，先裁一小块边角料试手',
      model: '跟教程把主体结构做一遍，先不管细节',
      drill: '每次只练最容易出问题的那道工序',
      make: '完成整体组装，修整到看不出半成品痕迹',
      keep: '找三处不满意的记下原因，留作下一件改进',
      tools: ['基础工具'], materials: ['主材料'], place: ['不容易弄脏的桌面'], knowledge: [],
      risk: '卡在某个细节上', fallback: '先跳过，把主体做完再回头修'
    },
    gaming: {
      goal: '按计划推进，达成一个明确的进度目标',
      deliverable: '一个达成的进度目标，加上一条复盘',
      check: '目标达成，且下次的起点已经写清楚',
      aim: '定下这次推进到哪一步，写下一句话',
      prep: '复看上次的进度与卡点，设一个时长上限',
      model: '用最稳的打法把会的内容走一遍找回手感',
      drill: '只攻一个卡点，反复试同一种解法不换任务',
      make: '达成这次定的进度目标，截图留证',
      keep: '写三行复盘：卡在哪、怎么过的、下次从哪继续',
      tools: ['设备'], materials: [], place: ['固定的休闲时段'], knowledge: [],
      risk: '一玩就超时', fallback: '先设一个闹钟，到点就停并记下进度'
    },
    science: {
      goal: '把一个原理讲清楚，并做出一个小实验',
      deliverable: '一段能说清楚的结论，加上实验记录',
      check: '别人听完能复述这个原理',
      aim: '提出一个能用小实验回答的问题，写下猜想',
      prep: '查基础资料确认常识，列好材料与安全注意',
      model: '照现成做法复现一次，先看到现象再谈解释',
      drill: '每次只留一个变量，改它、观察、记录',
      make: '把结论写成一段能讲给别人听的说明',
      keep: '让别人听完复述一遍，讲错的就回去补',
      tools: ['记录本'], materials: ['实验材料'], place: ['允许动手的地方'], knowledge: [],
      risk: '现象不明显', fallback: '只保留一个变量再试一次'
    },
    life: {
      goal: '把一个生活环节固定成习惯',
      deliverable: '一周不间断的记录',
      check: '连续 7 天都有记录，没有断档',
      aim: '选一个想固定的生活环节，写下怎样算成功',
      prep: '把动作缩到五分钟内能做完，工具放在手边',
      model: '今天就完整做一次，感受放在哪个位置最顺',
      drill: '固定在同一个时间重复，做完立刻打勾',
      make: '连续做完一周，断了也从最小动作接上',
      keep: '回看一周记录，给最容易断的那天加个提醒',
      tools: ['手机提醒'], materials: ['记录表或笔记'], place: ['顺手能拿到的地方'], knowledge: [],
      risk: '断了两天', fallback: '从最小动作重新开始，不清零重来'
    }
  };

  /* ---------- 基础工具 ---------- */
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clamp(x, lo, hi) { return Math.max(lo, hi == null ? lo : Math.min(hi, x)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(dateStr, n) {
    var p = String(dateStr).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function toMinutes(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function toHHMM(min) { var m = ((min % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  /* 星期：1=周一 … 7=周日（写入周计划时再换算为 0=周日） */
  function isoDay(dateStr) {
    var p = String(dateStr).split('-');
    var w = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
    return w === 0 ? 7 : w;
  }
  function person() {
    if (root.LMS && root.LMS.store) {
      try { return root.LMS.store.getPerson() || root.LMS.store.defaultPerson(); } catch (e) { /* ignore */ }
    }
    return {};
  }
  function hasLMS() { return !!(root.LMS && root.LMS.scoreActivity && root.LMS.weeklyLoadPercent); }

  /* 在既有活动库里找同领域的近似活动，以便复用已标定的 8 轴 */
  function matchLibrary(name, domain) {
    var acts = (root.LMS_DATA && root.LMS_DATA.ACTIVITIES) || [];
    var n = String(name).toLowerCase();
    var best = null;
    acts.forEach(function (a) {
      if (a.domain !== domain) { return; }
      var an = String(a.name).toLowerCase();
      var score = 0;
      if (an === n) { score = 3; }
      else if (an.indexOf(n) >= 0 || n.indexOf(an) >= 0) { score = 2; }
      else {
        n.split(/[\s，,、。]+/).filter(function (k) { return k.length > 1; }).forEach(function (k) {
          if (an.indexOf(k) >= 0) { score += 1; }
        });
      }
      if (score > 0 && (!best || score > best.score)) { best = { act: a, score: score }; }
    });
    return best ? best.act : null;
  }

  function axesFor(rec) {
    if (rec.libraryActivity) {
      var a = rec.libraryActivity;
      return { D1: a.D1, D2: a.D2, focusNeedMin: a.focusNeedMin, D4: a.D4, D5: a.D5, D6: a.D6, D7: a.D7, channel: a.channel, bestTime: a.bestTime };
    }
    var base = C.axesOf(rec.domain) || {};
    return {
      D1: rec.D1 != null ? rec.D1 : base.D1,
      D2: rec.D2 != null ? rec.D2 : base.D2,
      focusNeedMin: rec.focusNeedMin != null ? rec.focusNeedMin : base.focusNeedMin,
      D4: rec.D4 != null ? rec.D4 : base.D4,
      D5: rec.D5 != null ? rec.D5 : base.D5,
      D6: rec.D6 != null ? rec.D6 : base.D6,
      D7: rec.D7 != null ? rec.D7 : base.D7,
      channel: rec.channel || base.channel,
      bestTime: (rec.bestTime && rec.bestTime.length ? rec.bestTime : base.bestTime) || ['evening']
    };
  }
  function dominantChannel(axes) {
    var ch = axes.channel || {}; var best = 'hands', v = -1;
    ['read', 'audiovisual', 'hands', 'social'].forEach(function (k) { if ((ch[k] || 0) > v) { v = ch[k] || 0; best = k; } });
    return best;
  }

  /* ---------- 识别 ---------- */
  /* recognize(text, opts) -> RecognizedActivity
     opts: { sourceInterestId } —— 来自兴趣池时，直接沿用其类别与 8 轴 */
  function recognize(text, opts) {
    opts = opts || {};
    var name = String(text || '').trim();
    var rec = opts.sourceInterestId ? P.get(opts.sourceInterestId) : null;
    var r;
    if (rec) {
      r = {
        input: rec.name, recognized: true, category: rec.category, categoryLabel: rec.categoryLabel,
        type: rec.type, matchedKeywords: (rec.matchedKeywords || []).slice(),
        matchDegree: rec.matchDegree != null ? rec.matchDegree : 1, matchType: 'manual', suggestions: []
      };
    } else {
      r = C.classify(name);
    }

    var libAct = r.recognized ? matchLibrary(name, r.category) : null;
    var confidence = 0;
    if (r.recognized) {
      /* keyword / keyword-plain 直接命中关键词，可信度最高；
         alias 一类是别名推断，打个折；manual 是用户自己选的，最可信 */
      confidence = r.matchType === 'manual' ? 1
        : (r.matchType.indexOf('keyword') === 0 ? r.matchDegree : Math.round(r.matchDegree * 90) / 100);
    }

    /* 组装 8 轴取值：来自兴趣池记录时优先用记录值，否则用被匹配到的库内活动 */
    var partial = { domain: r.category, libraryActivity: libAct };
    if (rec) {
      partial.D1 = rec.D1; partial.D2 = rec.D2; partial.focusNeedMin = rec.focusNeedMin;
      partial.D4 = rec.D4; partial.D5 = rec.D5; partial.D6 = rec.D6; partial.D7 = rec.D7;
      partial.channel = rec.channel; partial.bestTime = rec.bestTime;
    }

    return {
      activityId: rec ? rec.id : ('ip-' + (slugify(name) || 'x') + '-' + newId()),
      name: name,
      domain: r.category,
      categoryLabel: r.categoryLabel,
      matchType: r.matchType,
      confidence: confidence,
      needConfirm: !r.recognized || confidence < 0.6,
      sourceInterestId: rec ? rec.id : null,
      matchedKeywords: r.matchedKeywords.slice(),
      suggestions: r.suggestions || [],
      libraryActivity: libAct,
      axes: r.recognized ? axesFor(partial) : null
    };
  }

  function confirm(text, categoryKey) {
    var r = C.classify(text, categoryKey);
    var rec = recognize(text, {});
    rec.domain = r.category;
    rec.categoryLabel = r.categoryLabel;
    rec.matchType = 'manual';
    rec.confidence = 1;
    rec.needConfirm = false;
    rec.libraryActivity = matchLibrary(text, r.category);
    rec.axes = axesFor({ domain: r.category, libraryActivity: rec.libraryActivity });
    return rec;
  }

  /* 把识别结果转成活动对象 */
  function activityOf(rec) {
    var axes = rec.axes || axesFor(rec);
    return {
      id: rec.activityId, name: rec.name, domain: rec.domain,
      D1: axes.D1, D2: axes.D2, focusNeedMin: axes.focusNeedMin,
      D4: axes.D4, D5: axes.D5, D6: axes.D6, D7: axes.D7,
      channel: axes.channel, bestTime: axes.bestTime
    };
  }

  /* ---------- 负荷评估（复用 load-manager 的纯函数） ---------- */
  function scoreOf(activity) {
    if (!hasLMS()) { return null; }
    try { return root.LMS.scoreActivity(person(), activity); } catch (e) { return null; }
  }
  function estimateWeekly(entry, activity) {
    if (!hasLMS() || !(root.LMS.store && root.LMS.store.getPlan)) { return null; }
    try {
      var p = person();
      var scored = {};
      var acts = (root.LMS_DATA && root.LMS_DATA.ACTIVITIES) ? root.LMS_DATA.ACTIVITIES : [];
      acts.forEach(function (a) { scored[a.id] = root.LMS.scoreActivity(p, a); });
      if (activity) { scored[activity.id] = root.LMS.scoreActivity(p, activity); }
      var plan = (root.LMS.store.getPlan() || []).slice();
      var replaced = false;
      for (var i = 0; i < plan.length; i++) {
        if (plan[i].activityId === entry.activityId) { plan[i] = entry; replaced = true; break; }
      }
      if (!replaced) { plan.push(entry); }
      return root.LMS.weeklyLoadPercent(p, plan, scored);
    } catch (e) { return null; }
  }
  function loadOf(entry, activity) {
    if (!hasLMS()) {
      return { available: false, score: null, zone: null, match: null, weeklyPercent: null, weeklyZone: null };
    }
    var sc = scoreOf(activity);
    var wk = estimateWeekly(entry, activity);
    return {
      available: true,
      score: sc ? sc.score : null,
      zone: sc ? sc.zone.label : null,
      match: sc ? sc.match : null,
      weeklyPercent: wk ? wk.percent : null,
      weeklyZone: wk ? wk.zone.label : null
    };
  }

  /* ---------- 生成 ---------- */
  function sessionFor(level, axes, p) {
    var need = axes.focusNeedMin || 30;
    var block = (p && p.block) || need;
    var base = Math.max(15, Math.min(need, block));
    if (level === '轻松') { return Math.max(15, Math.round(base * 0.6)); }
    if (level === '挑战') { return Math.max(15, Math.min(90, Math.round(base * 1.4))); }
    return base;
  }
  function slotsFor(sessionMin, rec, p) {
    var weekly = (rec && rec.hours != null) ? rec.hours : ((p && p.weeklyHours) ? p.weeklyHours * 0.25 : 2);
    return clamp(Math.round((weekly * 60) / Math.max(15, sessionMin)), 1, 7);
  }
  /* 时段选择。返回的不只是「哪个时段」，还包括「有没有被特殊规则改过」——
     用户偏好被推翻的时候，必须能给他一个说得清的理由。 */
  function bandFor(axes, p, domain) {
    var bands = axes.bestTime || [];
    var peak = p && p.peakTime;
    if (P && typeof P.bandForDomain === 'function') {
      return P.bandForDomain(domain, bands, peak);
    }
    /* 极端降级：兴趣池不在场时，至少别把结果弄丢 */
    return { band: (peak || bands[0] || 'evening'), moved: false, banned: '', why: '' };
  }

  /* ---------- 正规培养流程的六个阶段 ----------
     顺序固定，每个类别只替换「具体做什么」（见 TEMPLATES 的六个字段）。
     这是从「一时兴起」到「真的会了」的必经路径：想清楚要什么 → 知道从哪起步 →
     跟着做一遍 → 拆开反复练 → 连起来做成一件完整的东西 → 回头看一遍并把频率固定下来。

     跳掉任何一步都会出问题：跳过定向就是瞎练，跳过摸底就看不出进步，
     跳过复盘则大概率停在「做过几次」，而不是「会了」。 */
  var STAGES = [
    { key: 'aim', name: '定向', difficulty: 0.10, channel: 'read',
      detail: '先别急着动手。把目标写成一句能验收的话，再写下判断标准——后面每一步都对着它检查。',
      deliverable: '一句话的目标和判断标准',
      check: '能说清「做到什么算成了」，并且自己认可这个标准' },
    { key: 'prep', name: '摸底与准备', difficulty: 0.15, channel: 'read',
      detail: '记下现在的水平（能做多少、卡在哪），再把要用的东西备齐。起点不清楚，后面就看不出进步。',
      deliverable: '一份起点记录和一张要备齐的清单',
      check: '东西到位，而且知道自己的起点在哪' },
    { key: 'model', name: '入门模仿', difficulty: 0.30, channel: null,
      detail: '跟着示范或教程，用放慢或减量的方式把整件事完整走一遍。这一步只求走通，不求做好。',
      deliverable: '一次走完全流程的记录',
      check: '全程没卡死，能一个人从头走到尾' },
    { key: 'drill', name: '分块练习', difficulty: 0.55, channel: null,
      detail: function (slots) {
        return '把整件事拆成小块，每次只练最弱的那一块，练完立刻对照标准看差在哪；每周 ' + slots + ' 次。';
      },
      deliverable: '每次练习的记录和一张问题清单',
      check: function (slots) { return '连续 ' + slots + ' 次按量完成，卡点明显变少'; } },
    { key: 'make', name: '做成成品', difficulty: 0.70, channel: null,
      detail: '把练过的部分连起来，做出一件完整的、能拿给别人看的成果。允许不完美，但必须是完整的。',
      deliverable: '',   /* 留空：用模板里的「最终产出」 */
      check: '' },       /* 留空：用模板里的「完成判据」 */
    { key: 'keep', name: '复盘与固化', difficulty: 0.20, channel: 'read',
      detail: '对照第 1 步定下的标准自评一遍，写下下次要改的一个点，并定下能长期维持的频率。',
      deliverable: '一份自评和下一步的练习频率',
      check: '能指出自己最该改的一处，并且知道下次从哪开始' }
  ];

  function buildSteps(t, sessionMin, slots, channel) {
    /* 头尾两步是轻量的「想一想 / 看一看」，中间三步才是真正的练习量 */
    var mins = [15, 20, sessionMin, sessionMin, sessionMin, 20];
    var times = [1, 1, 1, slots, 1, 1];
    function textOf(v) { return typeof v === 'function' ? v(slots) : (v || ''); }
    return STAGES.map(function (st, i) {
      return {
        seq: i + 1,
        title: st.name + '：' + (t[st.key] || ''),
        detail: textOf(st.detail),
        durationMin: mins[i],
        sessions: times[i],
        deliverable: st.deliverable || t.deliverable,
        check: textOf(st.check) || t.check,
        dependsOn: i === 0 ? [] : [i],
        channel: st.channel || channel,
        difficulty: st.difficulty
      };
    });
  }

  function buildResources(t) {
    function firstOr(list, dflt) { return (list && list.length) ? list[0] : (dflt || '不需要'); }
    var know = (t.knowledge && t.knowledge.length) ? t.knowledge[0] : '';
    return [
      { kind: 'tool', name: firstOr(t.tools), ready: true,
        note: (t.tools && t.tools.length) ? '如果还没准备，开始前先备齐' : '' },
      { kind: 'material', name: firstOr(t.materials), ready: true,
        note: (t.materials && t.materials.length) ? '具体清单会在第 1 步里一起列出来' : '' },
      { kind: 'place', name: firstOr(t.place), ready: true, note: '' },
      { kind: 'people', name: '不需要', ready: true, note: '如果想找人一起，可以拉一个同伴' },
      { kind: 'budget', name: '不需要额外花费', ready: true, note: '如需报班或买设备，先按最小投入起步' },
      { kind: 'knowledge', name: know || '无', ready: !know, note: know ? '第 1 步会带上，不需要提前学' : '' }
    ];
  }

  function planFor(rec, level, opts) {
    var p = person();
    var axes = rec.axes || axesFor(rec);
    var t = TEMPLATES[rec.domain] || TEMPLATES.life;
    var rec0 = rec.sourceInterestId ? P.get(rec.sourceInterestId) : null;
    var startDate = opts.startDate || todayStr();

    var sessionMin = opts.sessionMin || sessionFor(level, axes, p);
    var slots = opts.slots || slotsFor(sessionMin, rec0, p);
    var horizonDays = opts.horizonDays || (level === '轻松' ? 21 : (level === '挑战' ? 10 : 14));
    /* 时段：特殊时段规则优先于用户偏好（例如运动不进夜晚），
       没被规则改过时，仍然按「用户最清醒的时段」来排。 */
    var bandRes = bandFor(axes, p, rec.domain);
    var band = bandRes.band;
    var start = P.TIME_BANDS[band] || '19:00';
    var end = toHHMM(toMinutes(start) + sessionMin);
    var activity = activityOf(rec);
    var channel = dominantChannel(axes);
    var day = isoDay(startDate);

    var entry = {
      activityId: rec.activityId,
      hours: Math.round((sessionMin * slots / 60) * 10) / 10,
      weekday: day % 7
    };

    var peakLabel = p.peakTime ? P.bandLabel(p.peakTime) : '';
    var bandLabel = P.bandLabel(band);
    var blockText = p.block ? ('，不超出你一次能专注的 ' + p.block + ' 分钟') : '';
    /* 为什么排这个时间：被特殊规则改过时，必须把「为什么不听你的偏好」讲明白 */
    var whyTime, whenText;
    if (bandRes.moved) {
      whyTime = '你精力最好的时段是' + P.bandLabel(bandRes.banned) + '，但' + bandRes.why +
        '，所以这次不排在' + P.bandLabel(bandRes.banned) + '，改到' + bandLabel;
      whenText = '，排在 ' + start;
    } else if (peakLabel) {
      whyTime = '你最清醒的时段是' + peakLabel + '，这个兴趣也适合' + bandLabel;
      whenText = '，所以排在 ' + start;
    } else {
      whyTime = '这个兴趣适合' + bandLabel;
      whenText = '，所以排在 ' + start;
    }

    var plan = {
      id: 'plan-' + newId(),
      activityId: rec.activityId,
      interestId: rec.sourceInterestId || null,
      name: rec.name,
      domain: rec.domain,
      categoryLabel: rec.categoryLabel,
      title: horizonDays + ' 天' + LEVEL_TAG[level] + '计划 · ' + rec.name,
      level: level,
      goal: {
        outcome: horizonDays + ' 天内：' + t.goal,
        level: level === '轻松' ? '入门' : (level === '挑战' ? '挑战' : '进阶'),
        deliverables: [t.deliverable],
        horizonDays: horizonDays
      },
      steps: buildSteps(t, sessionMin, slots, channel),
      schedule: [{
        day: day, date: startDate, start: start, end: end,
        sessionMin: sessionMin, slots: slots,
        bestTime: axes.bestTime.slice(),
        rationale: whyTime + whenText +
          '；单次 ' + sessionMin + ' 分钟' + blockText + '。'
      }],
      resources: buildResources(t),
      metrics: [t.check, '完成后留下' + t.deliverable],
      risk: [
        { text: t.risk, fallback: t.fallback },
        { text: '连续 2 天都没做', fallback: '降到最小版本只做 10 分钟，计划顺延，不重新开始' }
      ],
      entry: entry,
      activity: activity,
      totalHours: entry.hours,
      sessionMin: sessionMin,
      slots: slots,
      status: 'draft',
      createdAt: Date.now(),
      adoptedAt: null
    };
    plan.load = loadOf(entry, activity);
    return plan;
  }

  /* 周负荷超容量时自动降载：先减单次时长，再减每周次数 */
  function autoDownshift(rec, level, opts, plan) {
    if (!plan.load || !plan.load.available || plan.load.weeklyPercent == null) { return plan; }
    if (plan.load.weeklyPercent <= 100) { return plan; }
    var tries = 0;
    var sessionMin = plan.sessionMin;
    var slots = plan.slots;
    var cur = plan;
    while (cur.load.weeklyPercent > 100 && tries < 8) {
      tries++;
      if (sessionMin > 20) { sessionMin -= 5; }
      else if (slots > 1) { slots -= 1; sessionMin = plan.sessionMin; }
      else { break; }
      cur = planFor(rec, level, mergeOpts(opts, { sessionMin: sessionMin, slots: slots }));
    }
    if (cur.load.weeklyPercent <= 100 && plan.load.weeklyPercent > 100) {
      cur.schedule[0].rationale += ' 加入后本周负荷会偏高（' + plan.load.weeklyPercent + '%），已自动把单次时长调到 ' +
        cur.sessionMin + ' 分钟、每周 ' + cur.slots + ' 次。';
      cur.downshifted = true;
    }
    return cur;
  }
  function mergeOpts(a, b) {
    var o = {};
    Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; });
    return o;
  }

  /* generate(rec, opts) -> Plan */
  function generate(rec, opts) {
    opts = opts || {};
    var level = LEVELS.indexOf(opts.level) >= 0 ? opts.level : '标准';
    var plan = planFor(rec, level, opts);
    if (opts.autoDownshift !== false) { plan = autoDownshift(rec, level, opts, plan); }
    return plan;
  }

  /* variants(rec, opts) -> Plan[3]：轻松 / 标准 / 挑战 */
  function variants(rec, opts) {
    return LEVELS.map(function (lv) {
      var plan = generate(rec, mergeOpts(opts, { level: lv }));
      plan.variantName = lv === '轻松' ? '轻松起步' : (lv === '挑战' ? '挑战突破' : '稳步推进');
      plan.variantWhy = lv === '轻松'
        ? '单次时间短、次数少，先把节奏建起来，最适合久没开始的兴趣。'
        : (lv === '挑战'
          ? '时间更长、频次更高，适合这段时间状态好、想快点看到结果。'
          : '按你的专注时长与每周可支配时间算出来的平衡方案，最不容易半途而废。');
      return plan;
    });
  }

  /* estimateLoad(rec, hours) */
  function estimateLoad(rec, hours) {
    var activity = rec.axes ? activityOf(rec) : activityOf(rec);
    var entry = { activityId: rec.activityId, hours: hours, weekday: -1 };
    return loadOf(entry, activity);
  }

  /* 采用：写入本周计划，并把计划存档 */
  function adopt(plan, opts) {
    opts = opts || {};
    var entry = plan.entry || {
      activityId: plan.activityId,
      hours: plan.totalHours || 1,
      weekday: plan.schedule && plan.schedule[0] ? plan.schedule[0].day % 7 : -1
    };

    var wrote = false;
    if (root.LMS && root.LMS.store && root.LMS.store.addToPlan) {
      try { root.LMS.store.addToPlan(entry.activityId, entry.hours, entry.weekday); wrote = true; } catch (e) { wrote = false; }
    }

    /* 计划存档：统一经存储层读写，本模块不直接接触原始数据形态。
       若编辑模块在场，则由它建立带归属与版本记录的初始存档。 */
    var saved = null;
    if (root.PlanEditor && typeof root.PlanEditor.saveNew === 'function') {
      try { saved = root.PlanEditor.saveNew(plan, root.PlanEditor.currentActor()); } catch (e) { saved = null; }
    }
    if (saved && saved.ok) { plan = saved.plan; }
    else {
      var doc = P.readLocal(P.KEYS.PLANS, null);
      if (!doc || !Array.isArray(doc.plans)) { doc = { version: 1, updatedAt: Date.now(), plans: [] }; }
      plan.status = 'adopted';
      plan.adoptedAt = Date.now();
      var replaced = false;
      for (var i = 0; i < doc.plans.length; i++) {
        if (doc.plans[i].id === plan.id) { doc.plans[i] = plan; replaced = true; break; }
      }
      if (!replaced) { doc.plans.push(plan); }
      doc.updatedAt = Date.now();
      P.writeLocal(P.KEYS.PLANS, doc);
    }

    /* 登记活动，使负荷管理系统也能识别这个兴趣 */
    if (typeof P.registerActivity === 'function') {
      var recFull = plan.interestId ? P.get(plan.interestId) : null;
      P.registerActivity(recFull || {
        id: plan.activityId, name: plan.name, category: plan.domain || 'life',
        D1: undefined, D2: undefined, focusNeedMin: undefined,
        D4: undefined, D5: undefined, D6: undefined, D7: undefined,
        channel: undefined, bestTime: undefined
      });
    }

    return {
      ok: true,
      planEntry: entry,
      wroteToPlan: wrote,
      weekly: estimateWeekly(entry, plan.activity || null),
      plan: plan
    };
  }

  /* ---------- 计划 -> 具体场次 ----------
     计划本身只钉住「第一次」的日期与时段，节奏写在「单次多久 / 每周几次 / 一共多少天」里。
     这里把节奏摊成一串确定的日期，供「把计划编进安排表」使用。
     纯计算：不读存储、不碰界面、不认识安排表。

     关键：index 是「从计划开始日算起的第几次」，不是「这次结果里的第几条」。
     这样今天同步和明天再同步，同一次拿到的是同一个编号，重复编入才能对上号。 */
  function occurrences(plan, opts) {
    opts = opts || {};
    var cap = opts.max == null ? 60 : opts.max;
    var from = opts.from || todayStr();
    var sch = plan && plan.schedule && plan.schedule[0];
    if (!sch || !sch.date || !sch.start || !sch.end) { return []; }

    var sessionMin = plan.sessionMin || sch.sessionMin || 0;
    var slots = clamp(plan.slots || sch.slots || 1, 1, 7);
    var horizon = (plan.goal && plan.goal.horizonDays) || 21;

    /* 一周里排哪几天：以计划开始那天为第 0 天，把每周几次尽量均匀铺开。
       每周 1 次就固定同一天，每周 3 次就是第 0、2、5 天。 */
    var offsets = [];
    for (var i = 0; i < slots; i++) {
      var off = Math.round(i * 7 / slots) % 7;
      if (offsets.indexOf(off) < 0) { offsets.push(off); }
    }

    var list = [];
    var ordinal = 0;
    for (var d = 0; d < horizon; d++) {
      if (offsets.indexOf(d % 7) < 0) { continue; }
      var k = ordinal++;
      var date = addDays(sch.date, d);
      /* 已经过去的日子不再补排，但编号照留，避免今天的编号和明天对不上 */
      if (date < from) { continue; }
      if (list.length >= cap) { continue; }
      list.push({
        index: k,
        date: date,
        start: sch.start,
        end: sch.end,
        sessionMin: sessionMin
      });
    }
    return list;
  }

  function templates(domain) { return TEMPLATES[domain] || null; }

  var API = {
    VERSION: VERSION,
    LEVELS: LEVELS,
    recognize: recognize,
    confirm: confirm,
    activityOf: activityOf,
    generate: generate,
    variants: variants,
    estimateLoad: estimateLoad,
    occurrences: occurrences,
    adopt: adopt,
    templates: templates,
    hasLoadEngine: hasLMS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.InterestPlanner = API;
})(typeof window !== 'undefined' ? window : globalThis);
