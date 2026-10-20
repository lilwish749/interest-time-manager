/* =========================================================================
   计划编辑 —— PlanEditor
   -------------------------------------------------------------------------
   职责：在「计划生成」之后，让用户对已生成的计划行使修改权：
         改内容 / 改顺序 / 改时间安排 / 改优先级，并在改动后保持数据一致。

   设计要点
   1) 归属：计划是私人的，谁建的归谁。读取、修改、删除一律只认一条——
      「这是不是我的计划」。在「打开编辑器时」和「提交保存时」各校验一次，
      中途身份变了也拦得住。
      （此前这里是一套 owner + visibility + acl 的角色矩阵，用来支持
       「把计划共享给同事、再决定他能改还是只能看」。按需求已整体移除：
       现在没有第二个人，判断只剩下「是不是我自己的」。）
   2) 一致性：所有改动都经 commit() 单一入口，先归一化再校验，
      派生字段（步骤序号、依赖、周工时、开始/结束时刻、完成日期）一律重算，
      不允许出现「步骤序号断了」「结束时间早于开始时间」这类脏数据。
   3) 版本：每次提交 revision +1，并把这一版的内容完整存档（上限 MAX_VERSIONS）。
      历史只增不改，回滚 = 以旧版本内容产生一个新版本。
   4) 并发：乐观锁。提交时带上打开编辑器时的 revision；
      对不上就走三方合并（base / 我的 / 另一处的），能自动合就合，
      真正冲突才交给用户逐项选择，绝不静默覆盖。
      这不是为多人准备的——同一个人的另一个窗口、另一台设备同样会撞上，
      所以这一层保留。

   依赖：InterestPool（存储层，readLocal/writeLocal）。
   注意：本模块只处理数据，不渲染界面；界面层只呈现处理后的自然语言结果。
   ========================================================================= */
(function (root) {
  'use strict';

  var P = root.InterestPool;
  if (!P) { throw new Error('PlanEditor 依赖 interest-pool.js，请先加载'); }

  var VERSION = '1.0';

  /* ---------- 常量 ---------- */
  var MAX_VERSIONS = 12;      /* 每份计划最多保留的版本数（避免本地存储膨胀） */
  var MAX_STEPS = 12;         /* 一份计划最多几个步骤，再多就不叫计划了 */

  var PRIORITIES = [
    { key: 'high', label: '优先做', rank: 0 },
    { key: 'normal', label: '照常做', rank: 1 },
    { key: 'low', label: '有空再做', rank: 2 }
  ];
  var PRIORITY_KEYS = PRIORITIES.map(function (p) { return p.key; });
  function priorityLabel(k) {
    for (var i = 0; i < PRIORITIES.length; i++) { if (PRIORITIES[i].key === k) { return PRIORITIES[i].label; } }
    return '照常做';
  }
  function priorityRank(k) {
    for (var i = 0; i < PRIORITIES.length; i++) { if (PRIORITIES[i].key === k) { return PRIORITIES[i].rank; } }
    return 1;
  }

  var LIMITS = {
    titleLen: 60,
    stepTitleLen: 60,
    detailLen: 400,
    deliverableLen: 120,
    checkLen: 120,
    outcomeLen: 160,
    metricLen: 160,
    riskLen: 160,
    sessionMinMin: 15, sessionMinMax: 180,
    slotsMin: 1, slotsMax: 14,
    stepDurationMin: 5, stepDurationMax: 240,
    stepSessionsMin: 1, stepSessionsMax: 30,
    horizonMin: 3, horizonMax: 365,
    stepsMin: 1, stepsMax: MAX_STEPS
  };

  /* 参与版本存档与差异比较的内容字段（元信息不在其中） */
  var CONTENT_KEYS = ['title', 'priority', 'goal', 'steps', 'schedule', 'resources', 'metrics', 'risk'];
  /* 归一化时重算、不参与差异比较的派生字段 */
  var DERIVED_STEP_KEYS = { seq: 1, dependsOn: 1 };

  /* ---------- 通用小工具 ---------- */
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function clampInt(x, lo, hi, dflt) {
    var n = parseInt(x, 10);
    if (isNaN(n)) { return dflt; }
    return clamp(n, lo, hi);
  }
  function str(x) { return x == null ? '' : String(x); }
  function trimLen(s, max) { return str(s).trim().slice(0, max); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isPlain(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }
  function union(a, b) { return uniq(a.concat(b)); }

  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(s))) { return false; }
    var p = str(s).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getFullYear() === +p[0] && d.getMonth() === +p[1] - 1 && d.getDate() === +p[2];
  }
  function isoDay(s) { var p = str(s).split('-'); var w = new Date(+p[0], +p[1] - 1, +p[2]).getDay(); return w === 0 ? 7 : w; }
  function addDays(s, n) {
    var p = str(s).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(str(s)); }
  function toMin(t) { var p = str(t).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function toHHMM(m) { m = ((m % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------- 身份 ---------- */
  /* 未登录时用本机身份，保证「开箱即用」不会因为没账号就不能用自己的计划 */
  function currentActor() {
    var s = P.readLocal('tm_session', null);
    var phone = s && s.phone ? s.phone : null;
    if (!phone) { return { id: 'local', name: '本机用户', isAdmin: false }; }
    var users = P.readLocal('tm_users', []);
    var u = (Array.isArray(users) ? users : []).filter(function (x) { return x && x.phone === phone; })[0];
    return { id: phone, name: (u && u.nickname) || phone, isAdmin: !!(u && u.isAdmin) };
  }
  function normActor(a) {
    if (!a || !a.id) { return currentActor(); }
    return { id: str(a.id), name: str(a.name || a.id), isAdmin: !!a.isAdmin };
  }

  /* ---------- 归属 ----------
     计划是私人的：谁建的归谁，只有创建者本人能看、能改、能删。
     这就是全部的规则——没有「别人」，也就没有角色、可见范围和授权名单。 */
  function isMine(actor, plan) {
    if (!plan) { return false; }
    var me = normActor(actor).id;
    return !!me && str(plan.owner) === me;
  }

  /* 给界面层用的结论，不返回原始数据。
     几个「能不能」字段现在同真同假（是自己的就都能），保留它们是为了让
     界面读起来仍然是「能改吗 / 能删吗」，而不是散落一地 isMine。 */
  function permissionOf(actor, plan) {
    var a = normActor(actor);
    var mine = isMine(a, plan);
    return {
      mine: mine,
      isOwner: mine,
      readable: mine,
      editable: mine,
      deletable: mine,
      actor: { id: a.id, name: a.name },
      owner: str(plan && plan.owner),
      ownerName: str((plan && plan.ownerName) || (plan && plan.owner) || '')
    };
  }

  /* ---------- 归一化：把任意输入收敛成一份自洽的计划 ---------- */
  function normStep(raw, index, prevId) {
    raw = isPlain(raw) ? raw : {};
    /* 名称「缺失」时补一个默认名（修复脏数据）；
       名称「被清空」时保持空，交给 validate 拒绝——不能让用户以为改成功了。 */
    var rawTitle = raw.title;
    var title = (rawTitle === undefined || rawTitle === null)
      ? ('第 ' + (index + 1) + ' 步')
      : trimLen(rawTitle, LIMITS.stepTitleLen);
    var st = {
      id: str(raw.id) || ('st-' + newId()),
      seq: index + 1,
      title: title,
      detail: trimLen(raw.detail, LIMITS.detailLen),
      durationMin: clampInt(raw.durationMin, LIMITS.stepDurationMin, LIMITS.stepDurationMax, 30),
      sessions: clampInt(raw.sessions, LIMITS.stepSessionsMin, LIMITS.stepSessionsMax, 1),
      deliverable: trimLen(raw.deliverable, LIMITS.deliverableLen),
      check: trimLen(raw.check, LIMITS.checkLen),
      priority: PRIORITY_KEYS.indexOf(raw.priority) >= 0 ? raw.priority : 'normal',
      dependsOn: prevId ? [prevId] : [],
      channel: str(raw.channel) || 'read',
      difficulty: raw.difficulty != null ? raw.difficulty : 0.4
    };
    if (isPlain(raw.preferredBand) || typeof raw.preferredBand === 'string') {
      st.preferredBand = str(raw.preferredBand);
    }
    return st;
  }

  function normGoal(raw, horizonDays, startDate) {
    raw = isPlain(raw) ? raw : {};
    var days = clampInt(raw.horizonDays, LIMITS.horizonMin, LIMITS.horizonMax, horizonDays || 14);
    return {
      outcome: trimLen(raw.outcome, LIMITS.outcomeLen),
      level: str(raw.level) || '进阶',
      deliverables: (Array.isArray(raw.deliverables) ? raw.deliverables : [])
        .map(function (d) { return trimLen(d, LIMITS.deliverableLen); })
        .filter(Boolean),
      horizonDays: days,
      deadline: isDate(startDate) ? addDays(startDate, days - 1) : ''
    };
  }

  function normSchedule(raw, fallback) {
    raw = isPlain(raw) ? raw : {};
    var fb = isPlain(fallback) ? fallback : {};
    var date = isDate(raw.date) ? raw.date : (isDate(fb.date) ? fb.date : todayStr());
    var sessionMin = clampInt(raw.sessionMin != null ? raw.sessionMin : fb.sessionMin,
      LIMITS.sessionMinMin, LIMITS.sessionMinMax, 30);
    var slots = clampInt(raw.slots != null ? raw.slots : fb.slots, LIMITS.slotsMin, LIMITS.slotsMax, 3);
    var start = isTime(raw.start) ? raw.start : (isTime(fb.start) ? fb.start : '19:00');
    /* 单次时长是真源，结束时间一律由「开始 + 单次时长」推出。
       夜里 23:30 练 150 分钟到次日凌晨，是合理需求，不能因此报错，
       所以这里允许跨天，并用 crossMidnight 明确标出来。 */
    var wrapped = toMin(start) + sessionMin;
    var cross = wrapped >= 1440;
    return {
      day: isoDay(date),
      date: date,
      start: start,
      end: toHHMM(wrapped),
      crossMidnight: cross,
      sessionMin: sessionMin,
      slots: slots,
      bestTime: (Array.isArray(raw.bestTime) ? raw.bestTime : (Array.isArray(fb.bestTime) ? fb.bestTime : []))
        .map(function (b) { return str(b); }).filter(Boolean),
      /* 说明文字里若写了旧的单次时长，改完就跟事实对不上，这里顺手修正 */
      rationale: fixRationaleText(trimLen(raw.rationale != null ? raw.rationale : fb.rationale, LIMITS.detailLen),
        { sessionMin: sessionMin })
    };
  }

  function normResources(raw) {
    var KINDS = ['tool', 'material', 'place', 'people', 'budget', 'knowledge'];
    var list = (Array.isArray(raw) ? raw : []).filter(isPlain).map(function (r) {
      return {
        kind: KINDS.indexOf(r.kind) >= 0 ? r.kind : 'tool',
        name: trimLen(r.name, LIMITS.deliverableLen) || '不需要',
        ready: r.ready !== false,
        note: trimLen(r.note, LIMITS.metricLen)
      };
    });
    return list;
  }

  /* 重算所有派生字段，保证「改完之后数据自洽」 */
  function normalize(plan) {
    plan = isPlain(plan) ? plan : {};
    var out = clone(plan);

    out.steps = (Array.isArray(out.steps) ? out.steps : []).slice(0, LIMITS.stepsMax);
    if (!out.steps.length) {
      out.steps = [{ id: 'st-' + newId(), title: '第 1 步' }];
    }
    var prevId = null;
    out.steps = out.steps.map(function (raw, i) {
      var s = normStep(raw, i, prevId);
      prevId = s.id;
      return s;
    });

    var oldSch = Array.isArray(out.schedule) && out.schedule.length ? out.schedule[0] : {};
    var sch = normSchedule(oldSch, oldSch);
    out.schedule = [sch];

    out.goal = normGoal(out.goal, out.goal && out.goal.horizonDays, sch.date);
    out.resources = normResources(out.resources);
    out.metrics = (Array.isArray(out.metrics) ? out.metrics : [])
      .map(function (m) { return trimLen(m, LIMITS.metricLen); }).filter(Boolean);
    out.risk = (Array.isArray(out.risk) ? out.risk : []).filter(isPlain).map(function (r) {
      return { text: trimLen(r.text, LIMITS.riskLen), fallback: trimLen(r.fallback, LIMITS.riskLen) };
    }).filter(function (r) { return r.text || r.fallback; });
    /* 名称「缺失」才补默认名，被清空则保持空，交给 validate 说明原因 */
    var rawTitle = out.title;
    out.title = (rawTitle === undefined || rawTitle === null)
      ? (str(out.name) ? str(out.name) + ' 计划' : '我的计划')
      : trimLen(rawTitle, LIMITS.titleLen);
    out.priority = PRIORITY_KEYS.indexOf(out.priority) >= 0 ? out.priority : 'normal';

    /* 派生：工时、星期、单次时长、每周次数 */
    var hours = round1(sch.sessionMin * sch.slots / 60);
    out.entry = isPlain(out.entry) ? out.entry : {};
    out.entry.activityId = str(out.entry.activityId || out.activityId);
    out.entry.hours = hours;
    out.entry.weekday = sch.day % 7;
    out.totalHours = hours;
    out.sessionMin = sch.sessionMin;
    out.slots = sch.slots;

    /* 版本与归属：缺失时给安全默认，不覆盖已有值 */
    out.revision = clampInt(out.revision, 1, 1e9, 1);
    out.versions = Array.isArray(out.versions) ? out.versions : [];
    /* 早期版本把「共享范围」「授权名单」「编辑占位」存在计划上。
       功能移除之后这些字段不该再跟着计划走，一律抹掉，免得老数据里的残留
       被当成还有意义的东西。 */
    delete out.visibility;
    delete out.acl;
    delete out.lock;

    return out;
  }

  /* ---------- 校验：归一化修不了的问题才报错（面向用户的中文说明） ---------- */
  function validate(plan) {
    var errors = [];
    function bad(field, message) { errors.push({ field: field, message: message }); }

    if (!plan || !isPlain(plan)) { return { ok: false, errors: [{ field: 'plan', message: '计划内容读不出来' }] }; }

    if (!str(plan.title).trim()) { bad('title', '计划名称不能为空'); }

    var steps = Array.isArray(plan.steps) ? plan.steps : [];
    if (steps.length < LIMITS.stepsMin) { bad('steps', '计划至少要保留 1 个步骤'); }
    if (steps.length > LIMITS.stepsMax) { bad('steps', '步骤最多 ' + LIMITS.stepsMax + ' 个，再多就执行不下去了'); }
    steps.forEach(function (s, i) {
      if (!str(s.title).trim()) { bad('steps.' + i + '.title', '第 ' + (i + 1) + ' 步的名称不能为空'); }
      if (s.durationMin < LIMITS.stepDurationMin || s.durationMin > LIMITS.stepDurationMax) {
        bad('steps.' + i + '.durationMin', '第 ' + (i + 1) + ' 步的单次时长要在 ' +
          LIMITS.stepDurationMin + '–' + LIMITS.stepDurationMax + ' 分钟之间');
      }
    });

    var sch = Array.isArray(plan.schedule) ? plan.schedule[0] : null;
    if (!sch) { bad('schedule', '时间安排不能为空'); }
    else {
      if (!isDate(sch.date)) { bad('schedule.0.date', '开始日期格式不对，应为 年-月-日'); }
      if (!isTime(sch.start)) { bad('schedule.0.start', '开始时间格式不对，应为 时:分'); }
      if (!isTime(sch.end)) { bad('schedule.0.end', '结束时间格式不对，应为 时:分'); }
      if (sch.sessionMin < LIMITS.sessionMinMin || sch.sessionMin > LIMITS.sessionMinMax) {
        bad('schedule.0.sessionMin', '单次时长要在 ' + LIMITS.sessionMinMin + '–' + LIMITS.sessionMinMax + ' 分钟之间');
      }
      if (sch.slots < LIMITS.slotsMin || sch.slots > LIMITS.slotsMax) {
        bad('schedule.0.slots', '每周次数要在 ' + LIMITS.slotsMin + '–' + LIMITS.slotsMax + ' 次之间');
      }
    }

    var g = plan.goal || {};
    if (g.horizonDays < LIMITS.horizonMin || g.horizonDays > LIMITS.horizonMax) {
      bad('goal.horizonDays', '计划周期要在 ' + LIMITS.horizonMin + '–' + LIMITS.horizonMax + ' 天之间');
    }

    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------- 内容快照 ---------- */
  function contentOf(plan) {
    var out = {};
    CONTENT_KEYS.forEach(function (k) { out[k] = clone(plan[k]); });
    out.entry = clone(plan.entry);
    out.totalHours = plan.totalHours;
    out.sessionMin = plan.sessionMin;
    out.slots = plan.slots;
    out.load = clone(plan.load);
    return out;
  }
  function applyContent(target, content) {
    var out = clone(target);
    Object.keys(content || {}).forEach(function (k) { out[k] = clone(content[k]); });
    return out;
  }

  /* ---------- 版本 ---------- */
  function versionEntry(rev, actor, action, summary, plan) {
    return {
      rev: rev,
      at: Date.now(),
      by: actor.id,
      byName: actor.name,
      action: action,
      summary: Array.isArray(summary) ? summary.slice(0, 8) : [],
      snapshot: contentOf(plan)
    };
  }
  function pushVersion(plan, entry) {
    var vs = Array.isArray(plan.versions) ? plan.versions.slice() : [];
    vs.push(entry);
    while (vs.length > MAX_VERSIONS) { vs.shift(); }
    plan.versions = vs;
    return plan;
  }
  /* 取某一版的内容；rev 缺失时返回 null（说明这一版已被裁掉） */
  function contentAt(plan, rev) {
    if (!plan) { return null; }
    if (rev === plan.revision) { return contentOf(plan); }
    var vs = Array.isArray(plan.versions) ? plan.versions : [];
    for (var i = 0; i < vs.length; i++) {
      if (vs[i] && vs[i].rev === rev && vs[i].snapshot) { return clone(vs[i].snapshot); }
    }
    return null;
  }
  function snapshotToPlan(plan, content) {
    var base = clone(plan);
    delete base.versions;
    var out = applyContent(base, content);
    out.revision = plan.revision;
    out.versions = clone(plan.versions);
    return normalize(out);
  }

  function historyOf(plan) {
    var vs = Array.isArray(plan && plan.versions) ? plan.versions : [];
    return vs.slice().sort(function (a, b) { return b.rev - a.rev; }).map(function (v, i) {
      return {
        rev: v.rev,
        at: v.at,
        by: v.by,
        byName: v.byName || v.by,
        action: v.action,
        actionLabel: ACTION_LABELS[v.action] || '修改',
        summary: (v.summary || []).slice(),
        isCurrent: i === 0
      };
    });
  }
  var ACTION_LABELS = {
    create: '生成计划',
    content: '修改内容',
    reorder: '调整顺序',
    schedule: '调整时间安排',
    priority: '调整优先级',
    step: '修改步骤',
    restore: '恢复到历史版本',
    merge: '合并他人改动',
    adopt: '采用计划'
  };

  /* ---------- 路径读写：统一支持普通字段与步骤字段 ---------- */
  function readPath(plan, path) {
    var parts = str(path).split('.');
    if (parts[0] === 'steps') {
      var steps = (plan && plan.steps) || [];
      if (parts[1] === 'order') { return steps.map(function (s) { return s.id; }); }
      var st = steps.filter(function (s) { return s.id === parts[1]; })[0];
      if (!st) { return undefined; }
      return parts.length === 2 ? clone(st) : clone(st[parts[2]]);
    }
    var cur = plan;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) { return undefined; }
      cur = cur[parts[i]];
    }
    return clone(cur);
  }

  function writePath(plan, path, value) {
    var parts = str(path).split('.');
    if (parts[0] === 'steps') {
      var steps = Array.isArray(plan.steps) ? plan.steps : (plan.steps = []);
      if (parts[1] === 'order') {
        var byId = {};
        steps.forEach(function (s) { byId[s.id] = s; });
        var next = [];
        (Array.isArray(value) ? value : []).forEach(function (id) {
          if (byId[id]) { next.push(byId[id]); delete byId[id]; }
        });
        steps.forEach(function (s) { if (byId[s.id]) { next.push(s); delete byId[s.id]; } });
        plan.steps = next;
        return true;
      }
      var idx = -1;
      for (var i = 0; i < steps.length; i++) { if (steps[i].id === parts[1]) { idx = i; break; } }
      if (parts.length === 2) {
        if (value === undefined || value === null) {
          if (idx >= 0) { steps.splice(idx, 1); }
        } else if (idx >= 0) { steps[idx] = clone(value); }
        else { steps.push(clone(value)); }
        return true;
      }
      if (idx < 0) { return false; }
      steps[idx][parts[2]] = clone(value);
      return true;
    }
    var cur = plan;
    for (var k = 0; k < parts.length - 1; k++) {
      if (cur[parts[k]] == null) { cur[parts[k]] = /^\d+$/.test(parts[k + 1]) ? [] : {}; }
      cur = cur[parts[k]];
    }
    if (value === undefined) { delete cur[parts[parts.length - 1]]; }
    else { cur[parts[parts.length - 1]] = clone(value); }
    return true;
  }

  /* ---------- 差异：只比较内容字段，并跳过派生字段 ----------
     派生字段由 normalize 重算，把它们算进差异会制造大量假冲突。 */
  var DERIVED_PATHS = {
    'goal.deadline': 1, 'schedule.0.day': 1,
    'schedule.0.rationale': 1, 'schedule.0.crossMidnight': 1
  };

  function isDerivedPath(path) {
    if (DERIVED_PATHS[path]) { return true; }
    var parts = str(path).split('.');
    if (parts[0] === 'steps' && parts.length >= 3) { return !!DERIVED_STEP_KEYS[parts[2]]; }
    return false;
  }

  function diffList(base, other) {
    var out = [];
    CONTENT_KEYS.forEach(function (k) {
      walkDiff(base ? base[k] : undefined, other ? other[k] : undefined, k, out);
    });
    return out;
  }
  function walkDiff(a, b, path, out) {
    if (path && isDerivedPath(path)) { return; }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (path === 'steps') {
        var aIds = a.map(function (s) { return s.id; });
        var bIds = b.map(function (s) { return s.id; });
        if (aIds.join('|') !== bIds.join('|')) { out.push({ path: 'steps.order', from: aIds, to: bIds }); }
        var aMap = {}, bMap = {};
        a.forEach(function (s) { aMap[s.id] = s; });
        b.forEach(function (s) { bMap[s.id] = s; });
        b.forEach(function (s) { if (aMap[s.id]) { walkDiff(aMap[s.id], s, 'steps.' + s.id, out); } });
        a.forEach(function (s) { if (!bMap[s.id]) { out.push({ path: 'steps.' + s.id, from: clone(s), to: undefined }); } });
        b.forEach(function (s) { if (!aMap[s.id]) { out.push({ path: 'steps.' + s.id, from: undefined, to: clone(s) }); } });
        return;
      }
      var n = Math.max(a.length, b.length);
      for (var i = 0; i < n; i++) { walkDiff(a[i], b[i], path ? path + '.' + i : String(i), out); }
      return;
    }
    if (isPlain(a) && isPlain(b)) {
      var keys = {};
      Object.keys(a).forEach(function (k) { keys[k] = 1; });
      Object.keys(b).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) { walkDiff(a[k], b[k], path ? path + '.' + k : k, out); });
      return;
    }
    if (!same(a, b)) { out.push({ path: path, from: clone(a), to: clone(b) }); }
  }

  function indexDiff(list) {
    var m = {};
    list.forEach(function (d) { m[d.path] = d; });
    return m;
  }

  /* 相对顺序是否被动过（纯增删不算改顺序） */
  function relativeOrderChanged(baseIds, sideIds) {
    var common = baseIds.filter(function (id) { return sideIds.indexOf(id) >= 0; });
    var relBase = baseIds.filter(function (id) { return common.indexOf(id) >= 0; });
    var relSide = sideIds.filter(function (id) { return common.indexOf(id) >= 0; });
    return relBase.join('|') !== relSide.join('|');
  }

  /* ---------- 三方合并 ---------- */
  /* 返回 { ok, merged, conflicts, autoMerged } */
  function threeWay(base, mine, theirs) {
    var dm = indexDiff(diffList(base, mine));
    var dt = indexDiff(diffList(base, theirs));
    var merged = clone(base);
    var conflicts = [];
    var paths = union(Object.keys(dm), Object.keys(dt)).filter(function (p) { return p !== 'steps.order'; });

    paths.forEach(function (p) {
      var m = dm[p], t = dt[p];
      if (m && t) {
        if (same(m.to, t.to)) { writePath(merged, p, m.to); }
        else { conflicts.push({ path: p, mine: clone(m.to), theirs: clone(t.to), base: clone(m.from) }); }
      } else if (m) { writePath(merged, p, m.to); }
      else if (t) { writePath(merged, p, t.to); }
    });

    /* 顺序单独处理：双方都只是增删（没动相对顺序）就自动合 */
    var oM = dm['steps.order'], oT = dt['steps.order'];
    var baseIds = ((base && base.steps) || []).map(function (s) { return s.id; });
    var mIds = oM ? oM.to : baseIds;
    var tIds = oT ? oT.to : baseIds;
    var chgM = oM ? relativeOrderChanged(baseIds, mIds) : false;
    var chgT = oT ? relativeOrderChanged(baseIds, tIds) : false;
    var order = null;
    if (chgM && chgT) {
      if (mIds.join('|') === tIds.join('|')) { order = mIds; }
      else if (same(mIds.filter(function (i) { return tIds.indexOf(i) >= 0; }), tIds.filter(function (i) { return mIds.indexOf(i) >= 0; }))) { order = mIds; }
      else { conflicts.push({ path: 'steps.order', mine: mIds, theirs: tIds, base: baseIds }); }
    } else if (chgM) { order = mIds; }
    else if (chgT) { order = tIds; }

    if (order) {
      /* 合并后的顺序：沿用选中的顺序，然后把双方新增、且未出现在该顺序里的步骤按「我的在前、对方的在后」补上 */
      var present = ((merged.steps) || []).map(function (s) { return s.id; });
      var extras = present.filter(function (id) { return order.indexOf(id) < 0; });
      writePath(merged, 'steps.order', order.concat(extras));
    }

    merged = normalize(merged);
    return { ok: conflicts.length === 0, merged: merged, conflicts: conflicts, autoMerged: conflicts.length === 0 };
  }

  /* 冲突项的中文说明，供界面直接展示。
     对外只给「第几处冲突 + 这是什么 + 双方各是什么」，
     不暴露内部字段路径——路径只留在 rawConflicts 里供程序自己使用。 */
  function describeConflict(plan, c, index) {
    var parts = str(c.path).split('.');
    var label = '计划内容';
    var stepIdx = -1;
    if (parts[0] === 'steps') {
      var steps = (plan && plan.steps) || [];
      if (parts[1] === 'order') { label = '步骤顺序'; }
      else {
        for (var i = 0; i < steps.length; i++) { if (steps[i].id === parts[1]) { stepIdx = i; break; } }
        var stepName = '第 ' + (stepIdx >= 0 ? stepIdx + 1 : '?') + ' 步';
        var fieldNames = {
          title: '做什么', detail: '具体怎么做', durationMin: '每次多久', sessions: '做几次',
          deliverable: '产出什么', check: '怎么算做完', priority: '优先级'
        };
        label = parts.length === 2 ? stepName : stepName + ' · ' + (fieldNames[parts[2]] || '内容');
      }
    } else {
      var map = {
        'title': '计划名称',
        'priority': '整体优先级',
        'goal.outcome': '目标',
        'goal.horizonDays': '计划周期',
        'goal.deliverables.0': '要留下的东西',
        'schedule.0.date': '开始日期',
        'schedule.0.start': '每次开始时间',
        'schedule.0.end': '每次结束时间',
        'schedule.0.sessionMin': '单次时长',
        'schedule.0.slots': '每周次数'
      };
      if (map[c.path]) { label = map[c.path]; }
      else if (parts[0] === 'metrics') { label = '完成判据第 ' + ((+parts[1]) + 1) + ' 条'; }
      else if (parts[0] === 'risk') { label = '注意事项第 ' + ((+parts[1]) + 1) + ' 条'; }
      else if (parts[0] === 'resources') { label = '要准备的东西第 ' + ((+parts[1]) + 1) + ' 项'; }
    }
    return {
      id: 'c' + ((index || 0) + 1),
      label: label,
      mineText: wholeStepText(c, c.mine),
      theirsText: wholeStepText(c, c.theirs),
      baseText: formatValue(c.path, c.base)
    };
  }
  /* 整步层面的冲突（新增/删除），说的是「留还是删」，不是「内容不同」 */
  function wholeStepText(c, v) {
    var parts = str(c.path).split('.');
    if (parts[0] === 'steps' && parts.length === 2) {
      if (v === undefined || v === null) { return '删掉了这一步'; }
      return '保留了这一步「' + trimLen(v.title, 20) + '」';
    }
    return formatValue(c.path, v);
  }

  function formatValue(path, v) {
    if (v === undefined || v === null || v === '') { return '（空）'; }
    var parts = str(path).split('.');
    var leaf = parts[parts.length - 1];
    if (Array.isArray(v)) {
      if (leaf === 'order') { return '共 ' + v.length + ' 步，顺序不同'; }
      return v.map(function (x) { return str(x); }).join('、') || '（空）';
    }
    if (leaf === 'priority') { return priorityLabel(v); }
    if (leaf === 'durationMin' || leaf === 'sessionMin') { return v + ' 分钟'; }
    if (leaf === 'sessions' || leaf === 'slots') { return v + ' 次'; }
    if (leaf === 'horizonDays') { return v + ' 天'; }
    if (leaf === 'date') { return str(v) + '（' + ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][isoDay(v)] + '）'; }
    if (isPlain(v)) { return '（整项内容不同）'; }
    return str(v).slice(0, 60);
  }

  /* 按用户的选择结算冲突 */
  function resolveConflicts(merged, base, mine, theirs, conflicts, decisions, plan) {
    var out = clone(merged);
    var orderConflicts = conflicts.filter(function (c) { return c.path === 'steps.order'; });
    conflicts.forEach(function (c) {
      if (c.path === 'steps.order') { return; }
      var choice = (decisions && decisions[c.path] === 'theirs') ? 'theirs' : 'mine';
      var src = choice === 'mine' ? mine : theirs;
      writePath(out, c.path, readPath(src, c.path));
    });
    orderConflicts.forEach(function (c) {
      var choice = (decisions && decisions[c.path] === 'theirs') ? 'theirs' : 'mine';
      var src = choice === 'mine' ? mine : theirs;
      var ids = (src.steps || []).map(function (s) { return s.id; });
      var present = (out.steps || []).map(function (s) { return s.id; });
      writePath(out, 'steps.order', ids.concat(present.filter(function (id) { return ids.indexOf(id) < 0; })));
    });
    return normalize(out);
  }

  /* ---------- 变更摘要：给用户看的，不是给程序看的 ---------- */
  function summarize(diff, before) {
    var stepsBefore = (before && before.steps) || [];
    function stepNo(id) {
      for (var i = 0; i < stepsBefore.length; i++) { if (stepsBefore[i].id === id) { return i + 1; } }
      return null;
    }
    var out = [];
    diff.forEach(function (d) {
      var parts = str(d.path).split('.');
      if (parts[0] === 'steps') {
        if (parts[1] === 'order') { out.push('调整了步骤顺序'); return; }
        var no = stepNo(parts[1]);
        var name = no ? ('第 ' + no + ' 步') : '某一步';
        if (parts.length === 2) {
          if (d.to === undefined) { out.push('删掉了' + name + '「' + trimLen(d.from && d.from.title, 20) + '」'); }
          else { out.push('新增了步骤「' + trimLen(d.to && d.to.title, 20) + '」'); }
          return;
        }
        var fn = {
          title: '名称', detail: '说明', durationMin: '每次时长', sessions: '次数',
          deliverable: '产出', check: '完成判据', priority: '优先级'
        }[parts[2]] || '内容';
        if (parts[2] === 'priority') {
          out.push(name + '优先级：' + priorityLabel(d.from) + ' → ' + priorityLabel(d.to));
        } else {
          out.push(name + fn + '：' + formatValue(d.path, d.from) + ' → ' + formatValue(d.path, d.to));
        }
        return;
      }
      var map = {
        'title': '计划名称',
        'priority': '整体优先级',
        'goal.outcome': '目标',
        'goal.horizonDays': '计划周期',
        'schedule.0.date': '开始日期',
        'schedule.0.start': '开始时间',
        'schedule.0.sessionMin': '单次时长',
        'schedule.0.slots': '每周次数'
      };
      if (parts[0] === 'resources') { out.push('调整了要准备的东西'); return; }
      var label = map[d.path] || (parts[0] === 'metrics' ? '完成判据' : (parts[0] === 'risk' ? '注意事项' : '计划内容'));
      if (d.path === 'priority') {
        out.push(label + '：' + priorityLabel(d.from) + ' → ' + priorityLabel(d.to));
      } else {
        out.push(label + '：' + formatValue(d.path, d.from) + ' → ' + formatValue(d.path, d.to));
      }
    });
    return uniq(out).slice(0, 8);
  }

  /* ---------- 存储 ---------- */
  function readDoc() {
    var doc = P.readLocal(P.KEYS.PLANS, null);
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.plans)) {
      return { version: 1, updatedAt: Date.now(), plans: [] };
    }
    if (doc.version == null) { doc.version = 1; }
    return doc;
  }
  function writeDoc(doc) {
    doc.version = 1;
    doc.updatedAt = Date.now();
    return P.writeLocal(P.KEYS.PLANS, doc);
  }
  function findIn(doc, id) {
    for (var i = 0; i < doc.plans.length; i++) { if (doc.plans[i] && doc.plans[i].id === id) { return doc.plans[i]; } }
    return null;
  }

  /* 把老数据升级到带归属与版本的新形态（老计划没有 owner，归当前使用者） */
  function migrate(plan, actor) {
    var out = plan;
    var changed = false;
    if (!out.owner) { out.owner = actor.id; out.ownerName = actor.name; changed = true; }
    /* 共享年代留下的字段：清掉，让存储里的形状和现在的功能一致 */
    if (out.visibility !== undefined) { delete out.visibility; changed = true; }
    if (out.acl !== undefined) { delete out.acl; changed = true; }
    if (out.lock !== undefined) { delete out.lock; changed = true; }
    if (out.revision == null) { out.revision = 1; changed = true; }
    if (!Array.isArray(out.versions) || !out.versions.length) {
      out.versions = [versionEntry(1, { id: out.owner, name: out.ownerName || out.owner }, 'create',
        ['这一版是系统最初生成的计划'], out)];
      changed = true;
    }
    if (!out.updatedAt) { out.updatedAt = out.adoptedAt || out.createdAt || Date.now(); changed = true; }
    if (!out.updatedBy) { out.updatedBy = out.owner; changed = true; }
    return { plan: out, changed: changed };
  }

  function list(actor) {
    var a = normActor(actor);
    var doc = readDoc();
    var changed = false;
    var items = [];
    doc.plans.forEach(function (p) {
      var m = migrate(p, a);
      if (m.changed) { changed = true; }
      if (isMine(a, m.plan)) { items.push(m.plan); }
    });
    if (changed) { writeDoc(doc); }
    items.sort(function (x, y) { return (y.updatedAt || 0) - (x.updatedAt || 0); });
    return items;
  }

  function get(id, actor) {
    var a = normActor(actor);
    var doc = readDoc();
    var hit = findIn(doc, id);
    if (!hit) { return null; }
    var m = migrate(hit, a);
    if (m.changed) { writeDoc(doc); }
    if (!isMine(a, m.plan)) { return null; }
    return m.plan;
  }

  /* 供界面层使用：不返回原始数据，只返回处理后的结论 */
  function viewOf(plan, actor) {
    if (!plan) { return null; }
    var a = normActor(actor);
    var perm = permissionOf(a, plan);
    var sch = (plan.schedule && plan.schedule[0]) || {};
    return {
      id: plan.id,
      title: plan.title,
      status: plan.status,
      statusLabel: { draft: '草稿', adopted: '已采用', done: '已完成', abandoned: '已放弃' }[plan.status] || '已保存',
      priority: plan.priority,
      priorityLabel: priorityLabel(plan.priority),
      stepCount: (plan.steps || []).length,
      startDate: sch.date,
      startTime: sch.start,
      endTime: sch.end,
      sessionMin: sch.sessionMin,
      slots: sch.slots,
      weeklyHours: plan.totalHours,
      horizonDays: plan.goal ? plan.goal.horizonDays : null,
      revision: plan.revision,
      versionCount: (plan.versions || []).length,
      updatedAt: plan.updatedAt,
      updatedByName: plan.updatedByName || plan.updatedBy || ''
    };
  }

  /* ---------- 采纳时建立初始版本 ---------- */
  function prepare(plan, actor) {
    var a = normActor(actor);
    var out = normalize(plan);
    out.owner = a.id;
    out.ownerName = a.name;
    out.revision = 1;
    out.versions = [versionEntry(1, a, 'create', ['这一版是系统生成的初始计划'], out)];
    out.updatedAt = Date.now();
    out.updatedBy = a.id;
    out.updatedByName = a.name;
    return normalize(out);
  }

  /* 新建并落盘（planner.adopt 调用） */
  function saveNew(plan, actor) {
    var a = normActor(actor);
    var prepared = refreshLoad(prepare(plan, a));
    prepared.status = plan.status === 'adopted' ? 'adopted' : (plan.status || 'adopted');
    prepared.adoptedAt = plan.adoptedAt || Date.now();
    prepared.createdAt = plan.createdAt || Date.now();
    var doc = readDoc();
    var replaced = false;
    for (var i = 0; i < doc.plans.length; i++) {
      if (doc.plans[i] && doc.plans[i].id === prepared.id) { doc.plans[i] = prepared; replaced = true; break; }
    }
    if (!replaced) { doc.plans.push(prepared); }
    writeDoc(doc);
    emit('plan:created', { plan: prepared });
    return { ok: true, plan: prepared, revision: prepared.revision };
  }
  /* ---------- 提交：所有改动的唯一入口 ---------- */
  /*  改了单次时长或每周次数，本周负荷就会变。
      这里顺手把负荷结论重算一遍，免得界面上还挂着改动前的旧数字。
      依赖可选的 InterestPlanner；缺失时静默跳过，不影响编辑本身。 */
  function refreshLoad(plan) {
    var PL = root.InterestPlanner;
    if (!PL || typeof PL.estimateLoad !== 'function' || !plan.activity || !plan.entry) { return plan; }
    try {
      plan.load = PL.estimateLoad({
        activityId: plan.entry.activityId || plan.activityId,
        name: plan.name,
        domain: plan.domain,
        axes: plan.activity,
        hours: plan.entry.hours
      }, plan.entry.hours);
    } catch (e) { /* 画像缺失等情况保持原有结论 */ }
    return plan;
  }

  /*  opts: { action, baseRevision, summary, allowMerge }
      mutate(draft) 就地修改并返回 draft；返回 {__reject:'原因'} 表示业务性拒绝 */
  function commit(planId, actor, mutate, opts) {
    opts = opts || {};
    var a = normActor(actor);
    var action = opts.action || 'edit';

    var doc = readDoc();
    var cur = findIn(doc, planId);
    if (!cur) { return { ok: false, reason: 'deleted', message: '这份计划已经不在了，可能被删除了' }; }

    var mig = migrate(cur, a);
    cur = mig.plan;

    /* 归属：提交时再校验一次，防止「打开编辑器之后身份变了」 */
    if (!isMine(a, cur)) {
      return { ok: false, reason: 'forbidden', message: '这不是你的计划，改不了' };
    }

    var baseRev = opts.baseRevision != null ? opts.baseRevision : cur.revision;
    var baseContent = contentAt(cur, baseRev);
    var mine;
    var mergedFrom = null;

    if (baseRev !== cur.revision) {
      if (!baseContent) {
        return {
          ok: false, reason: 'stale', plan: cur,
          message: '这份计划在你编辑期间被改过，而且改动较早的记录已经不在，请重新打开再改一次'
        };
      }
      /* 先把「我的改动」重放在旧版本上，再做三方合并。
         注意必须传副本：mutate 是就地修改，直接传 draftFromBase 会让
         「合并的基准」和「我的版本」变成同一个对象，差异就永远是空的。 */
      var draftFromBase = snapshotToPlan(cur, baseContent);
      var draftMine = mutate(clone(draftFromBase));
      if (draftMine && draftMine.__reject) {
        return { ok: false, reason: 'rejected', message: draftMine.__reject };
      }
      var res = threeWay(draftFromBase, draftMine, cur);
      if (!res.ok) {
        return {
          ok: false, reason: 'conflict',
          plan: cur,
          conflicts: res.conflicts.map(function (c, i) { return describeConflict(cur, c, i); }),
          rawConflicts: res.conflicts,
          merged: res.merged,
          mine: draftMine,
          theirs: cur,
          base: draftFromBase,
          baseRevision: baseRev,
          message: '这份计划在你编辑期间也被改过，有 ' + res.conflicts.length + ' 处冲突需要你确认'
        };
      }
      mine = res.merged;
      mergedFrom = res.autoMerged
        ? { fromRevision: baseRev, intoRevision: cur.revision, by: cur.updatedByName || cur.updatedBy }
        : null;
    } else {
      mine = mutate(clone(cur));
      if (mine && mine.__reject) {
        return { ok: false, reason: 'rejected', message: mine.__reject };
      }
    }

    var next = normalize(mine);
    /* 元信息沿用现有值：归属、创建时间、状态这些不允许通过内容编辑通道改动。
       （归一化已经把老数据里的共享范围 / 授权名单 / 编辑占位一并抹掉。） */
    next.id = cur.id;
    next.owner = cur.owner;
    next.ownerName = cur.ownerName;
    next.createdAt = cur.createdAt;
    next.adoptedAt = cur.adoptedAt;
    next.status = cur.status;
    next.activityId = cur.activityId;
    next.interestId = cur.interestId;
    next.name = cur.name;
    next.domain = cur.domain;
    next.categoryLabel = cur.categoryLabel;
    next.level = cur.level;
    next.variantName = cur.variantName;
    next.variantWhy = cur.variantWhy;
    next.entry = cur.entry ? clone(cur.entry) : next.entry;
    next.entry.weekday = next.schedule[0].day % 7;
    next.entry.hours = round1(next.schedule[0].sessionMin * next.schedule[0].slots / 60);
    next.totalHours = next.entry.hours;

    var v = validate(next);
    if (!v.ok) {
      return { ok: false, reason: 'invalid', errors: v.errors, message: v.errors[0].message };
    }

    var diff = diffList(cur, next);
    if (!diff.length && !mergedFrom) {
      /* 改完跟现状一模一样（例如冲突结算时全选了对方的写法）：
         不必凭空多出一版，但返回结构保持一致，调用方不用特判 */
      return { ok: true, plan: cur, unchanged: true, revision: cur.revision, summary: [], diff: [] };
    }

    next.revision = cur.revision + 1;
    next.versions = clone(cur.versions);
    next.updatedAt = Date.now();
    next.updatedBy = a.id;
    next.updatedByName = a.name;
    refreshLoad(next);
    var summary = opts.summary && opts.summary.length ? opts.summary : summarize(diff, cur);
    if (mergedFrom) {
      summary = ['同时保留了「' + (mergedFrom.by || '另一个人') + '」在你这段时间里的改动'].concat(summary);
    }
    pushVersion(next, versionEntry(next.revision, a, mergedFrom ? 'merge' : action, summary, next));

    doc.plans[doc.plans.indexOf(cur)] = next;
    writeDoc(doc);
    emit('plan:updated', { plan: next, revision: next.revision, action: action, summary: next.versions[next.versions.length - 1].summary });
    return { ok: true, plan: next, revision: next.revision, summary: next.versions[next.versions.length - 1].summary, mergedFrom: mergedFrom, diff: diff };
  }

  /* ---------- 冲突结算 ----------
     decisions 以冲突项编号为键（c1 / c2 …），值为 'mine' 或 'theirs'；
     编号与冲突列表一一对应，界面上不出现任何内部路径。 */
  function resolve(planId, actor, payload, decisions, opts) {
    opts = opts || {};
    var a = normActor(actor);
    var doc = readDoc();
    var cur = findIn(doc, planId);
    if (!cur) { return { ok: false, reason: 'deleted', message: '这份计划已经不在了' }; }
    var mig = migrate(cur, a); cur = mig.plan;
    if (!isMine(a, cur)) { return { ok: false, reason: 'forbidden', message: '这不是你的计划，改不了' }; }
    if (payload.theirs && payload.theirs.revision !== cur.revision) {
      return { ok: false, reason: 'conflict-again', message: '这份计划又被改过了，请重新打开再合并一次' };
    }
    var raw = payload.rawConflicts || [];
    var byPath = {};
    raw.forEach(function (c, i) {
      var id = 'c' + (i + 1);
      if (decisions && decisions[id] === 'theirs') { byPath[c.path] = 'theirs'; }
    });
    var mergedPlan = resolveConflicts(payload.merged, payload.base, payload.mine, payload.theirs, raw, byPath, cur);
    return commit(planId, a, function () { return mergedPlan; }, {
      action: 'merge', baseRevision: cur.revision,
      summary: ['合并了你和对方的改动，冲突处按你的选择处理']
    });
  }

  /* ---------- 对外动作 ---------- */
  function updateContent(plan, actor, patch, opts) {
    patch = isPlain(patch) ? patch : {};
    return commit(plan.id, actor, function (draft) {
      ['title', 'priority', 'goal', 'steps', 'schedule', 'metrics', 'risk', 'resources'].forEach(function (k) {
        if (patch[k] !== undefined) { draft[k] = clone(patch[k]); }
      });
      return draft;
    }, mergeOpts(opts, { action: opts && opts.action ? opts.action : 'content' }));
  }

  function updateStep(plan, actor, stepId, changes, opts) {
    return commit(plan.id, actor, function (draft) {
      var st = (draft.steps || []).filter(function (s) { return s.id === stepId; })[0];
      if (!st) { return { __reject: '这一步已经不在了，可能被删除过' }; }
      Object.keys(changes || {}).forEach(function (k) {
        if (k === 'seq' || k === 'dependsOn' || k === 'id') { return; }
        st[k] = changes[k];
      });
      return draft;
    }, mergeOpts(opts, { action: 'step' }));
  }

  function addStep(plan, actor, atIndex, step, opts) {
    return commit(plan.id, actor, function (draft) {
      if ((draft.steps || []).length >= LIMITS.stepsMax) {
        return { __reject: '步骤最多 ' + LIMITS.stepsMax + ' 个，再多就执行不下去了' };
      }
      var idx = clampInt(atIndex, 0, draft.steps.length, draft.steps.length);
      draft.steps.splice(idx, 0, clone(step || { title: '新的一步' }));
      return draft;
    }, mergeOpts(opts, { action: 'step' }));
  }

  function removeStep(plan, actor, stepId, opts) {
    return commit(plan.id, actor, function (draft) {
      if ((draft.steps || []).length <= LIMITS.stepsMin) {
        return { __reject: '计划至少要保留 1 个步骤' };
      }
      var before = draft.steps.length;
      draft.steps = draft.steps.filter(function (s) { return s.id !== stepId; });
      if (draft.steps.length === before) { return { __reject: '这一步已经不在了' }; }
      return draft;
    }, mergeOpts(opts, { action: 'step' }));
  }

  /* delta: -1 上移 / +1 下移 */
  function moveStep(plan, actor, stepId, delta, opts) {
    return commit(plan.id, actor, function (draft) {
      var list = draft.steps || [];
      var i = -1;
      for (var k = 0; k < list.length; k++) { if (list[k].id === stepId) { i = k; break; } }
      if (i < 0) { return { __reject: '这一步已经不在了' }; }
      var j = i + (delta > 0 ? 1 : -1);
      if (j < 0 || j >= list.length) { return { __reject: delta > 0 ? '已经在最后一步了' : '已经在第一步了' }; }
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      return draft;
    }, mergeOpts(opts, { action: 'reorder' }));
  }

  function reorderSteps(plan, actor, orderedIds, opts) {
    return commit(plan.id, actor, function (draft) {
      var ids = (draft.steps || []).map(function (s) { return s.id; });
      var given = (Array.isArray(orderedIds) ? orderedIds : []).filter(function (id) { return ids.indexOf(id) >= 0; });
      var rest = ids.filter(function (id) { return given.indexOf(id) < 0; });
      writePath(draft, 'steps.order', given.concat(rest));
      return draft;
    }, mergeOpts(opts, { action: 'reorder' }));
  }

  /* 按优先级重排：稳定排序，同优先级保持原有先后 */
  function sortByPriority(plan, actor, opts) {
    return reorderSteps(plan, actor, (plan.steps || []).slice()
      .map(function (s, i) { return { id: s.id, r: priorityRank(s.priority), i: i }; })
      .sort(function (a, b) { return a.r !== b.r ? a.r - b.r : a.i - b.i; })
      .map(function (x) { return x.id; }), mergeOpts(opts, { action: 'priority' }));
  }

  function setPriority(plan, actor, priority, stepId, opts) {
    return commit(plan.id, actor, function (draft) {
      if (stepId) {
        var st = (draft.steps || []).filter(function (s) { return s.id === stepId; })[0];
        if (!st) { return { __reject: '这一步已经不在了' }; }
        st.priority = priority;
      } else {
        draft.priority = priority;
      }
      return draft;
    }, mergeOpts(opts, { action: 'priority' }));
  }

  function updateSchedule(plan, actor, changes, opts) {
    return commit(plan.id, actor, function (draft) {
      var sch = draft.schedule[0];
      var c = changes || {};
      if (c.date !== undefined) { sch.date = c.date; }
      if (c.start !== undefined) { sch.start = c.start; }
      if (c.sessionMin !== undefined) { sch.sessionMin = c.sessionMin; }
      if (c.slots !== undefined) { sch.slots = c.slots; }
      /* 结束时间：用户直接改结束时间时，反推出单次时长，仍保持「时长是真源」；
         否则结束时间一律由「开始 + 单次时长」推出，不可能出现自相矛盾 */
      if (c.end !== undefined && c.end !== null && c.end !== '' && isTime(c.end)) {
        var st0 = isTime(sch.start) ? sch.start : '19:00';
        var dur = ((toMin(c.end) - toMin(st0)) + 1440) % 1440;
        if (dur > 0) { sch.sessionMin = dur; }
      }
      return draft;
    }, mergeOpts(opts, { action: 'schedule' }));
  }

  /* 「为什么排这个时间」这段说明里如果写了旧的单次时长，改完就跟事实对不上了。
     这里只做一处最低限度的修正，避免界面上出现自相矛盾的描述。 */
  function fixRationaleText(text, sch) {
    return str(text).replace(/单次\s*\d+\s*分钟/g, '单次 ' + sch.sessionMin + ' 分钟');
  }

  function restore(plan, actor, rev, opts) {
    var content = contentAt(plan, rev);
    if (!content) { return { ok: false, reason: 'no-version', message: '这一版的历史记录已经不在，无法恢复' }; }
    return commit(plan.id, actor, function () { return applyContent(plan, content); }, {
      action: 'restore',
      baseRevision: opts && opts.baseRevision != null ? opts.baseRevision : plan.revision,
      summary: ['恢复到第 ' + rev + ' 次修改时的内容（这次恢复本身也记为一版）']
    });
  }

  function remove(plan, actor) {
    var a = normActor(actor);
    var doc = readDoc();
    var cur = findIn(doc, plan.id);
    if (!cur) { return { ok: true, alreadyGone: true }; }
    var mig = migrate(cur, a); cur = mig.plan;
    if (!isMine(a, cur)) { return { ok: false, reason: 'forbidden', message: '这不是你的计划，删不了' }; }
    doc.plans = doc.plans.filter(function (p) { return p.id !== plan.id; });
    writeDoc(doc);
    emit('plan:deleted', { planId: plan.id });
    return { ok: true };
  }

  /* ---------- 事件 ---------- */
  var listeners = {};
  function subscribe(evt, fn) {
    if (typeof fn !== 'function') { return function () {}; }
    if (!listeners[evt]) { listeners[evt] = []; }
    listeners[evt].push(fn);
    return function () {
      listeners[evt] = (listeners[evt] || []).filter(function (x) { return x !== fn; });
    };
  }
  function emit(evt, payload) {
    (listeners[evt] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { /* 单个订阅者异常不影响主流程 */ }
    });
  }

  function mergeOpts(a, b) {
    var o = {};
    Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; });
    return o;
  }

  /* ---------- 导出 ---------- */
  var API = {
    VERSION: VERSION,
    MAX_VERSIONS: MAX_VERSIONS,
    LIMITS: LIMITS,
    PRIORITIES: PRIORITIES,
    priorityLabel: priorityLabel,

    /* 归属 */
    currentActor: currentActor,
    isMine: isMine,
    permissionOf: permissionOf,

    /* 读写 */
    list: list,
    get: get,
    viewOf: viewOf,
    prepare: prepare,
    saveNew: saveNew,
    remove: remove,

    /* 一致性 */
    normalize: normalize,
    validate: validate,

    /* 修改 */
    commit: commit,
    updateContent: updateContent,
    updateStep: updateStep,
    addStep: addStep,
    removeStep: removeStep,
    moveStep: moveStep,
    reorderSteps: reorderSteps,
    sortByPriority: sortByPriority,
    setPriority: setPriority,
    updateSchedule: updateSchedule,
    restore: restore,

    /* 版本 */
    historyOf: historyOf,
    contentAt: contentAt,
    ACTION_LABELS: ACTION_LABELS,

    /* 并发 */
    diffList: diffList,
    threeWay: threeWay,
    resolve: resolve,
    describeConflict: describeConflict,
    summarize: summarize,

    subscribe: subscribe
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  else { root.PlanEditor = API; }
})(typeof window !== 'undefined' ? window : globalThis);
