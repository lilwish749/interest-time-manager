/* =========================================================================
   计划编辑界面 —— PlanEditView
   -------------------------------------------------------------------------
   职责：把「已经保存的计划」交给用户去改——改内容、换顺序、调时间安排、
   调优先级；同时把「改完会不会打架」「改错了能不能退回去」这几件事
   用大白话说清楚。

   约定（与 InterestView 一致，重要）：本文件不得以任何形式展示、暴露或引用
   原始数据内容，包括不显示数据原文、字段名称、字段结构或数据结构；
   只呈现经过处理后的用户可见结果，例如「第 2 步 · 做什么」这类中文说法。

   三个设计取舍，直接对应需求里的三个约束：
   1) 编辑改的是「内存草稿」，点一次保存才落一次盘。
      → 一次修改只产生一条版本记录，不会被连续输入刷屏。
   2) 保存时带上「我打开时看到的版本号」，新旧比对与合并交给逻辑层。
      → 同一个人的另一个窗口、另一台设备也不会互相覆盖。
   3) 冲突不替用户做主，逐处摆出「我这边的写法 / 另一处的写法」让他自己选。

   注：计划是私人的。此前这里还有一套「共享给同事、再决定他能改还是只能看」
   的界面（共享设置页、可见范围、授权名单、他人编辑占位），按需求已整体移除，
   所以现在清单上的每一行都是自己的，不存在「能看不能改」的第二种情况。
   ========================================================================= */
(function (root) {
  'use strict';

  var doc = root.document;
  var E = root.PlanEditor;
  if (!doc || !E) { return; }

  var PRIORITIES = E.PRIORITIES || [];
  var LIMITS = E.LIMITS || {};
  var STEPS_MAX = LIMITS.stepsMax || 12;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ---------- 通用小工具 ---------- */
  function $(id) { return doc.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function msg(text, kind) {
    var box = $('ipNotice');
    if (!box) { return; }
    box.className = 'ip-notice show ' + (kind || '');
    box.textContent = text;
    if (kind !== 'sticky') {
      root.clearTimeout(box._t);
      box._t = root.setTimeout(function () { box.className = 'ip-notice'; }, 4200);
    }
  }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) { if (list[i] && list[i].id === id) { return list[i]; } }
    return null;
  }
  function newStepId() { return 'st-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function joinList(a) { return (a || []).join('、'); }
  function splitList(s) {
    return String(s == null ? '' : s).split(/[、,，;；\n]/)
      .map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 6);
  }
  /* 「怎么算完成」一行一条 */
  function splitLines(s, max) {
    return String(s == null ? '' : s).split('\n')
      .map(function (t) { return t.trim(); }).filter(Boolean).slice(0, max || 8);
  }
  /* 「可能卡住的地方」写成「卡点 → 退一步怎么办」，用户照着写就行，不必知道内部长什么样 */
  function parseRisks(s) {
    return splitLines(s, 8).map(function (line) {
      var m = line.split(/\s*(?:→|->|=>|—>)\s*/);
      if (m.length > 1) { return { text: m[0].trim(), fallback: m.slice(1).join(' ').trim() }; }
      return { text: line, fallback: '' };
    }).filter(function (r) { return r.text || r.fallback; });
  }
  function riskLine(r) { return r.fallback ? (r.text + ' → ' + r.fallback) : r.text; }
  var DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function dayText(date) {
    var p = String(date || '').split('-');
    if (p.length !== 3) { return ''; }
    var w = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
    return DAY_NAMES[w] || '';
  }
  function relTime(ts) {
    if (!ts) { return '刚刚'; }
    var d = Date.now() - ts;
    if (d < 60000) { return '刚刚'; }
    if (d < 3600000) { return Math.floor(d / 60000) + ' 分钟前'; }
    if (d < 86400000) { return Math.floor(d / 3600000) + ' 小时前'; }
    if (d < 2592000000) { return Math.floor(d / 86400000) + ' 天前'; }
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
  }
  function priorityLabel(k) { return E.priorityLabel ? E.priorityLabel(k) : k; }
  function priorityOptions(cur) {
    return PRIORITIES.map(function (p) {
      return '<option value="' + esc(p.key) + '"' + (p.key === cur ? ' selected' : '') + '>' +
        esc(p.label) + '</option>';
    }).join('');
  }

  /* ---------- 状态 ---------- */
  /*  draft        正在进行的工作副本，所有改动先落在这里
      mode         'saved' 改的是已经存下来的计划；'draft' 改的是还没采用的那一份
      original     进入草稿模式时系统生成的原样，用来「恢复成系统生成的样子」
      onApply      草稿模式下点「保存并采用」时把结果交回调用方
      baseRevision 我打开时看到的版本号，保存时交给逻辑层做新旧比对
      conflict     出现并发冲突时的结算上下文（含原始凭据与逐项选择）
      remote       这份计划在我手上这份底稿之后被改过（另一个窗口 / 另一台设备）  */
  var st = {
    planId: null, draft: null, mode: 'saved', original: null, onApply: null,
    baseRevision: null, tab: 'edit',
    perm: null, view: null, conflict: null, conflictStale: false,
    remote: null, dirty: false
  };

  function isDraft() { return st.mode === 'draft'; }
  /* 草稿还没落盘，一定是可改的；已保存的计划能打开就说明是自己的，
    这里仍然按归属再判一次，免得将来某处漏了过滤就悄悄出现只读不了也改不了的界面。 */
  function editable() {
    if (isDraft()) { return true; }
    return !!(st.perm && st.perm.mine);
  }

  /* ---------- 已保存的计划清单 ---------- */
  function renderSavedList() {
    var box = $('ipSavedPlans');
    if (!box) { return; }
    var actor = E.currentActor();
    var plans = E.list(actor);

    var cnt = $('ipSavedCount');
    if (cnt) { cnt.textContent = plans.length ? ('共 ' + plans.length + ' 份') : ''; }

    if (!plans.length) {
      box.innerHTML = '<div class="ip-empty">还没有保存下来的计划。<br>' +
        '在上面生成一套计划，点「采用这个计划」，它就会出现在这里，之后随时可以改。</div>';
      return;
    }

    /* 安排表的入口只有在「当前页面真的有安排表、并且登录了」的时候才给。
       桌面原型页没有安排表，这里就整条不出现。 */
    var canSync = !!(root.InterestView && typeof root.InterestView.canSync === 'function' &&
      root.InterestView.canSync());

    box.innerHTML = plans.map(function (p) {
      var v = E.viewOf(p, actor) || {};
      var meta = [v.statusLabel || '已保存', '第 ' + (v.revision || 1) + ' 版', (v.stepCount || 0) + ' 个步骤'];
      if (v.startDate) {
        meta.push(v.startDate + '（' + dayText(v.startDate) + '）起 ' + v.startTime + '–' + v.endTime);
      }
      meta.push('最近一次修改：' + (v.updatedByName || '某人') + '，' + relTime(v.updatedAt));

      /* 安排表那边的情况：编过几次、还是不是这一版。
         只出现结论，不出现任何原始数据。 */
      var sy = canSync ? root.InterestView.syncState(p) : { synced: 0, stale: false };
      if (sy.synced) {
        meta.push(sy.stale
          ? ('已编入安排表 ' + sy.synced + ' 次，但这之后计划又改过，安排表那边还是旧时间')
          : ('已编入安排表 ' + sy.synced + ' 次'));
      }

      /* 落后了就把它标成主按钮：不是替他改，是让他一眼看见这里该点一下 */
      var syncCls = sy.stale ? 'btn sm' : 'btn ghost sm';

      return '<div class="ip-row" data-id="' + esc(v.id) + '">' +
        '<div class="ip-row-main">' +
        '<div class="ip-row-name">' + esc(v.title || '未命名计划') + '</div>' +
        '<div class="ip-row-meta">' + esc(meta.join(' · ')) + '</div>' +
        '</div>' +
        '<div class="ip-row-actions">' +
        /* 这里列出来的都是自己的计划：能改、能删，没有第二种情况 */
        (canSync ? '<button class="' + syncCls + '" data-act="sync">编入安排表</button>' : '') +
        '<button class="btn sm" data-act="open">打开修改</button>' +
        '<button class="btn ghost sm" data-act="history">变更记录</button>' +
        '<button class="btn ghost sm danger" data-act="remove">删除</button>' +
        '</div></div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-act]'), function (btn) {
      btn.onclick = function () {
        var id = btn.closest('.ip-row').getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        if (act === 'remove') { deleteSavedPlan(id); return; }
        if (act === 'sync') { syncSavedPlan(id); return; }
        open(id, act === 'history' ? 'history' : 'edit');
      };
    });
  }

  /* ---------- 把这份计划编进安排表 ----------
     换算、查重、冲突判定、落盘、全部反馈都在兴趣池那一层（它们属于「计划 -> 安排表」的换算策略），
     这里只负责把「用户点的是哪一份」传过去，传完刷新清单。
     安排表的落盘始终发生在 index 主程序自己的入口里，本文件不碰安排表的存储。 */
  function syncSavedPlan(planId) {
    var actor = E.currentActor();
    var plan = E.get(planId, actor);
    if (!plan) {
      msg('这份计划已经不在了，列表已经刷新', 'warn');
      renderSavedList();
      return;
    }
    if (root.InterestView && typeof root.InterestView.syncPlan === 'function') {
      root.InterestView.syncPlan(plan);
    } else {
      msg('当前页面没有安排表，请到主程序里操作', 'warn');
    }
    renderSavedList();
  }

  /* ---------- 删除已保存的计划 ----------
     交互：列表里点「删除」→ 弹一句确认，把将要发生的事写全 → 确认才真的删。
     存储：从 lms.interest.plans.v1 的那条记录整体移除，连同它的全部变更记录；
           不碰 lms.interest.v1（兴趣池），也不碰 lms.plan.v1（本周负荷计划）。
     删除后：列表与计数立刻刷新；如果删掉的正好是编辑器里打开的那一份，
             编辑器自动收起；该计划在清单、按编号查询里都再也找不到。 */
  function deleteSavedPlan(planId) {
    var actor = E.currentActor();
    var plan = E.get(planId, actor);
    if (!plan) {
      msg('这份计划已经不在了，列表已经刷新', 'warn');
      renderSavedList();
      return;
    }
    if (!E.isMine(actor, plan)) {
      msg('这不是你的计划，删不了', 'warn');
      return;
    }

    var name = plan.title || '这份计划';
    /* 编进安排表的时间不会被一起删掉：安排表记的是用户真要花的时间，
       删计划不等于取消已经答应自己的安排。所以先在确认框里说清楚。 */
    var sy = (root.InterestView && typeof root.InterestView.syncState === 'function')
      ? root.InterestView.syncState(plan) : { synced: 0 };
    var asked = root.confirm(
      '删除「' + name + '」？\n\n' +
      '· 计划内容和它的全部变更记录都会被删掉，删了不能恢复。\n' +
      '· 兴趣池里的兴趣不受影响。\n' +
      '· 本周负荷计划不受影响。' +
      (sy.synced
        ? ('\n· 已经编进安排表的 ' + sy.synced + ' 次不会被一起删掉，需要的话请到安排表里自己移除。')
        : '')
    );
    if (!asked) { return; }

    var res = E.remove(plan, actor);
    if (!res.ok && !res.alreadyGone) {
      msg(res.message || '没能删除，请稍后再试', 'warn');
      renderSavedList();
      return;
    }

    /* 如果被删的正是编辑器里打开的那一份，编辑器不能继续挂着 */
    if (st.planId === planId) { close(true); }
    renderSavedList();
    msg('已删除「' + name + '」。兴趣池和本周负荷计划都没有动。', 'ok');
  }

  /* ---------- 打开 / 关闭 ---------- */
  function open(planId, tab) {
    var actor = E.currentActor();
    var plan = E.get(planId, actor);
    if (!plan) { msg('这份计划已经不在了，可能已经被删除', 'warn'); close(true); renderSavedList(); return; }

    st.planId = planId;
    st.draft = clone(plan);
    st.mode = 'saved';
    st.original = null;
    st.onApply = null;
    st.baseRevision = plan.revision;
    st.perm = E.permissionOf(actor, plan);
    st.view = E.viewOf(plan, actor);
    st.tab = tab || 'edit';
    st.conflict = null;
    st.conflictStale = false;
    st.remote = null;
    st.dirty = false;

    paint();
    var box = $('ipEditor');
    if (box && box.scrollIntoView) { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  function close(silent) {
    if (!st.planId && !st.draft) {
      var emptyBox = $('ipEditor');
      if (emptyBox) { emptyBox.innerHTML = ''; }
      return;
    }
    var wasSaved = !isDraft();
    st.planId = null;
    st.draft = null;
    st.mode = 'saved';
    st.original = null;
    st.onApply = null;
    st.perm = null;
    st.view = null;
    st.conflict = null;
    st.remote = null;
    st.dirty = false;
    var box = $('ipEditor');
    if (box) { box.innerHTML = ''; }
    if (!silent && wasSaved) { renderSavedList(); }
  }

  /* ---------- 保存前的编辑（草稿模式） ----------
     生成的计划先是「还没保存」的一份草稿。用户可以先按自己的情况改好再采用，
     改的是内存里的副本，不碰任何已存下来的数据；点「保存并采用」时才交回去落盘。
     这样「采用」这个动作拿到的一定是用户最后看到的那个版本。 */
  function openDraft(plan, opts) {
    opts = opts || {};
    if (!plan) { return; }
    var d = E.normalize(clone(plan));
    st.mode = 'draft';
    st.planId = null;
    st.original = clone(d);
    st.draft = d;
    st.onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
    st.baseRevision = null;
    st.conflict = null;
    st.conflictStale = false;
    st.remote = null;
    st.dirty = false;
    st.tab = 'edit';
    /* 草稿没有归属、没有版本——这些都要等采用之后才存在，
       所以这里给一份「不会误导用户」的说明，而不是借用已保存计划的那套措辞。 */
    st.perm = { mine: true, isOwner: false, readable: true, editable: true, deletable: false,
      actor: { id: '', name: '' }, owner: '', ownerName: '' };
    st.view = {
      title: d.title, status: 'draft', statusLabel: '还没保存', revision: 0,
      stepCount: (d.steps || []).length, startDate: d.schedule[0].date,
      startTime: d.schedule[0].start, endTime: d.schedule[0].end,
      sessionMin: d.schedule[0].sessionMin, slots: d.schedule[0].slots,
      updatedAt: Date.now(), updatedByName: '', versionCount: 0
    };
    paint();
    var box = $('ipEditor');
    if (box && box.scrollIntoView) { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  /* ---------- 派生显示：本地即时算，不等落盘 ---------- */
  function localEnd() {
    var s = (st.draft && st.draft.schedule && st.draft.schedule[0]) || {};
    if (!TIME_RE.test(String(s.start))) { return null; }
    var p = String(s.start).split(':');
    var total = (+p[0]) * 60 + (+p[1]) + num(s.sessionMin);
    var cross = total >= 1440;
    total = ((total % 1440) + 1440) % 1440;
    return { text: pad2(Math.floor(total / 60)) + ':' + pad2(total % 60), cross: cross };
  }
  function localDeadline() {
    var d = st.draft;
    if (!d) { return ''; }
    var date = d.schedule[0].date;
    var p = String(date || '').split('-');
    if (p.length !== 3) { return ''; }
    var days = Math.max(1, num(d.goal.horizonDays));
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    dt.setDate(dt.getDate() + days - 1);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }
  function localWeeklyHours() {
    var s = st.draft.schedule[0];
    return Math.round(num(s.sessionMin) * num(s.slots) / 60 * 10) / 10;
  }
  /* ---------- 实时预览 ----------
     用户改一个字，右边就长成什么样。预览里出现的就是采用之后会看到的计划，
     所以「保存时以最新编辑内容为准」这件事是看得见的，不用靠相信。 */
  function previewHtml() {
    var d = st.draft;
    if (!d) { return ''; }
    var sch = d.schedule[0];
    var end = localEnd();
    var dl = localDeadline();

    var steps = (d.steps || []).map(function (s, i) {
      return '<li class="ep-pv-step">' +
        '<div class="ep-pv-step-line"><span class="ip-step-no">' + (i + 1) + '</span>' +
        '<b>' + esc(s.title || '（还没写名称）') + '</b>' +
        '<span class="ep-pv-pri">' + esc(priorityLabel(s.priority)) + '</span></div>' +
        (s.detail ? '<div class="ep-pv-detail">' + esc(s.detail) + '</div>' : '') +
        '<div class="ep-pv-foot">每次 ' + num(s.durationMin) + ' 分钟 · 共 ' + num(s.sessions) + ' 次' +
        (s.check ? ' · 判据：' + esc(s.check) : '') +
        '</div></li>';
    }).join('');

    function row(label, value) {
      return '<div class="ep-pv-row"><span>' + label + '</span><b>' + value + '</b></div>';
    }
    function block(title, items) {
      return '<h5>' + title + '</h5><ul class="ep-pv-list">' + items + '</ul>';
    }

    return '<div class="ep-pv">' +
      '<div class="ep-pv-title">' + esc(d.title || '（还没起名字）') + '</div>' +
      '<div class="ep-pv-sub">' + esc(d.categoryLabel || '计划') + ' · ' + esc(d.goal.level || '') +
      ' · 整份计划' + esc(priorityLabel(d.priority)) + '</div>' +

      row('做到什么', esc(d.goal.outcome || '（还没写）')) +
      row('周期', num(d.goal.horizonDays) + ' 天' + (dl ? '（预计做到 ' + esc(dl) + '）' : '')) +
      (d.goal.deliverables && d.goal.deliverables.length
        ? row('留下的东西', esc(joinList(d.goal.deliverables))) : '') +

      '<h5>步骤（照着这个顺序做）</h5>' +
      '<ol class="ep-pv-steps">' + steps + '</ol>' +

      '<h5>时间安排</h5>' +
      row('开始', esc(sch.date) + '（' + esc(dayText(sch.date)) + '）') +
      row('每次', esc(sch.start) + ' – ' + esc(end ? end.text : sch.end) +
        '（' + num(sch.sessionMin) + ' 分钟' + (end && end.cross ? '，到次日凌晨' : '') + '）') +
      row('每周', num(sch.slots) + ' 次 · 合计 ' + localWeeklyHours() + ' 小时') +
      (sch.rationale ? '<div class="ep-pv-note">' + esc(sch.rationale) + '</div>' : '') +

      (d.metrics && d.metrics.length
        ? block('怎么算完成', d.metrics.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('')) : '') +
      (d.risk && d.risk.length
        ? block('可能卡住的地方', d.risk.map(function (r) {
            return '<li><b>' + esc(r.text) + '</b>' + (r.fallback ? ' → ' + esc(r.fallback) : '') + '</li>';
          }).join('')) : '') +
      (d.resources && d.resources.length
        ? block('需要准备', d.resources.map(function (r) {
            return '<li>' + esc(r.name) + (r.ready ? '' : '（要先准备）') + '</li>';
          }).join('')) : '') +
      '</div>';
  }

  function refreshDerived() {
    var e = localEnd();
    var set = function (id, text) { var el = $(id); if (el) { el.textContent = text; } };
    if (e) {
      set('epEndText', e.text + (e.cross ? '（次日凌晨）' : '') + ' · 共 ' + num(st.draft.schedule[0].sessionMin) + ' 分钟');
    } else {
      set('epEndText', '请填成 时:分 的形式，例如 19:30');
    }
    set('epDeadlineText', localDeadline() ? ('预计做到 ' + localDeadline()) : '');
    set('epHoursText', localWeeklyHours() + ' 小时');
    set('epDirty', st.dirty ? (isDraft() ? '有改动还没保存到计划里' : '有改动还没保存') : '');
    /* 提示条随输入实时显隐，用户不必先做别的操作才能看见「还没保存」 */
    var bar = $('epDirtyBanner');
    if (bar) { bar.hidden = !st.dirty; }
    /* 实时预览：改一个字就重画一次，改完看到的就是采用之后的样子 */
    var pv = $('epPreview');
    if (pv) { pv.innerHTML = previewHtml(); }
  }

  /* ---------- 渲染 ---------- */
  function editableAttr() { return editable() ? '' : ' disabled'; }

  function bannerHtml() {
    var out = '';
    if (!st.perm) { return out; }

    if (isDraft()) {
      out += '<div class="ep-banner plain"><b>这份计划还没保存。</b>' +
        '你先按自己的情况改好，点「保存并采用」才会真正存下来；' +
        '不点保存就直接关掉，什么都不会留下。</div>';
      return out;
    }

    if (st.remote) {
      out += '<div class="ep-banner warn">这份计划在别处改过了（现在是第 ' + st.remote.rev +
        ' 版）。你保存时系统会先把两边的改动比一遍，只把不一样的地方交给你定，不会直接盖掉。</div>';
    }
    return out;
  }

  /* 把「到底能改哪些」一条条摆出来，不让用户自己猜。
     特别是「不提供修改」的那部分也要写明白，否则用户会以为是自己没找到。 */
  function permissionHintHtml() {
    if (isDraft()) {
      return '<p class="ip-hint">' +
        '<b>现在可以改：</b>计划名称、整份计划的优先级、做到什么、周期、完成后留下的东西；' +
        '每一步的名称与说明、单次时长、次数、完成判据、每一步的优先级；步骤顺序；' +
        '开始日期与开始时间、单次时长、每周次数、为什么排这个时间；' +
        '怎么算完成、可能卡住的地方及其退一步的办法。' +
        '<br><b>不在这里改的：</b>需要准备的东西——它是按活动类型推出来的，会跟着计划一起保存。' +
        '</p>';
    }
    return '<p class="ip-hint">' +
      '这是你自己的计划：内容、顺序、时间和优先级都可以改；' +
      '改坏了可以恢复到任意一版，不想留了就删掉。' +
      '</p>';
  }

  function stepHtml(s, index) {
    var dis = editableAttr();
    return '<div class="ep-step" data-id="' + esc(s.id) + '">' +
      '<div class="ep-step-head">' +
      '<span class="ip-step-no">' + (index + 1) + '</span>' +
      '<input class="input ep-grow" data-step="' + esc(s.id) + '" data-k="title" value="' + esc(s.title) + '"' +
      ' placeholder="这一步做什么"' + dis + '>' +
      '<div class="ep-tools">' +
      '<button class="ep-icon" data-act="step-up" data-id="' + esc(s.id) + '" title="上移"' + dis + '>↑</button>' +
      '<button class="ep-icon" data-act="step-down" data-id="' + esc(s.id) + '" title="下移"' + dis + '>↓</button>' +
      '<button class="ep-icon danger" data-act="step-del" data-id="' + esc(s.id) + '" title="删除这一步"' + dis + '>×</button>' +
      '</div></div>' +

      '<textarea class="input" rows="2" data-step="' + esc(s.id) + '" data-k="detail"' +
      ' placeholder="具体怎么做"' + dis + '>' + esc(s.detail) + '</textarea>' +

      '<div class="ep-grid3">' +
      '<label>每次多久（分钟）<input class="input" type="number" min="5" max="240" data-step="' + esc(s.id) +
      '" data-k="durationMin" value="' + esc(s.durationMin) + '"' + dis + '></label>' +
      '<label>要做几次<input class="input" type="number" min="1" max="30" data-step="' + esc(s.id) +
      '" data-k="sessions" value="' + esc(s.sessions) + '"' + dis + '></label>' +
      '<label>这一步的优先级<select class="input" data-step="' + esc(s.id) + '" data-k="priority"' + dis + '>' +
      priorityOptions(s.priority) + '</select></label>' +
      '</div>' +

      '<label class="ep-label">怎么算这一步做完<input class="input" data-step="' + esc(s.id) + '" data-k="check" value="' +
      esc(s.check) + '" placeholder="例如：不看谱也能弹下来"' + dis + '></label>' +
      '</div>';
  }

  /* 左栏：可改的字段。右栏：改完长什么样。两栏同源，改一个字右边就跟着变。 */
  function editTabHtml() {
    var d = st.draft;
    var sch = d.schedule[0];
    var end = localEnd();
    var dis = editableAttr();
    var draftMode = isDraft();

    var form =
      '<div class="ip-block"><h4>计划名称</h4>' +
      '<input class="input" data-field="title" value="' + esc(d.title) + '" placeholder="给这份计划起个名字"' + dis + '>' +
      '<div class="ep-inline"><span>整份计划的优先级</span>' +
      '<select class="input ep-w-auto" data-field="priority"' + dis + '>' + priorityOptions(d.priority) + '</select></div>' +
      '</div>' +

      '<div class="ip-block"><h4>目标</h4>' +
      '<label class="ep-label">做到什么（描述）' +
      '<textarea class="input" rows="2" data-field="outcome" placeholder="例如：能完整弹下一首曲子"' + dis + '>' +
      esc(d.goal.outcome) + '</textarea></label>' +
      '<div class="ep-inline"><span>计划周期（天）</span>' +
      '<input class="input ep-w-num" type="number" min="3" max="365" data-field="horizon" value="' +
      esc(d.goal.horizonDays) + '"' + dis + '>' +
      '<span class="ip-hint" id="epDeadlineText"></span></div>' +
      '<label class="ep-label">完成后留下的东西（顿号隔开）' +
      '<input class="input" data-field="deliverables" value="' + esc(joinList(d.goal.deliverables)) +
      '" placeholder="例如：一份练习记录、一段录音"' + dis + '></label>' +
      '</div>' +

      '<div class="ip-block"><div class="ep-block-head"><h4>步骤（照着做的顺序）</h4>' +
      '<button class="btn ghost sm" data-act="step-sort"' + dis + '>按优先级重排</button></div>' +
      '<p class="ip-hint">用 ↑ ↓ 调顺序。顺序变了，步骤之间的前后关系会自动跟着调整。</p>' +
      (d.steps || []).map(stepHtml).join('') +
      '<button class="btn ghost sm" data-act="step-add"' + dis + '>再加一步</button>' +
      '</div>' +

      '<div class="ip-block"><h4>时间安排</h4>' +
      '<div class="ep-grid2">' +
      '<label>开始日期<input class="input" type="date" data-field="date" value="' + esc(sch.date) + '"' + dis + '></label>' +
      '<label>每次开始时间<input class="input" type="time" data-field="start" value="' + esc(sch.start) + '"' + dis + '></label>' +
      '</div>' +
      '<div class="ep-grid2">' +
      '<label>每次多久（分钟）<input class="input" type="number" min="15" max="180" data-field="sessionMin" value="' +
      esc(sch.sessionMin) + '"' + dis + '></label>' +
      '<label>每周做几次<input class="input" type="number" min="1" max="14" data-field="slots" value="' +
      esc(sch.slots) + '"' + dis + '></label>' +
      '</div>' +
      '<div class="ip-kv"><span>每次结束</span><b id="epEndText"></b></div>' +
      '<div class="ip-kv"><span>每周合计</span><b id="epHoursText"></b></div>' +
      '<label class="ep-label">为什么排这个时间' +
      '<textarea class="input" rows="2" data-field="rationale"' + dis + '>' + esc(sch.rationale) + '</textarea></label>' +
      (end && end.cross
        ? '<p class="ip-hint">注意：这个时间会练到第二天凌晨，确认一下是不是你想要的。</p>' : '') +
      '</div>' +

      '<div class="ip-block"><h4>怎么算完成</h4>' +
      '<label class="ep-label">一行一条，写清什么程度算做到了' +
      '<textarea class="input" rows="3" data-field="metrics" placeholder="例如：不看谱也能完整弹下来"' + dis + '>' +
      esc((d.metrics || []).join('\n')) + '</textarea></label>' +
      '</div>' +

      '<div class="ip-block"><h4>可能卡住的地方</h4>' +
      '<label class="ep-label">一行一条，写成「卡在哪 → 退一步怎么办」' +
      '<textarea class="input" rows="3" data-field="risk"' + dis + '>' +
      esc((d.risk || []).map(riskLine).join('\n')) + '</textarea></label>' +
      '</div>' +

      otherBlocksHtml();

    var preview =
      '<div class="ep-col-pv">' +
      '<div class="ep-pv-head">实时预览' +
      (draftMode ? '<span class="ip-badge">还没保存</span>' : '<span class="ip-badge gray">正在编辑</span>') +
      '</div>' +
      '<p class="ip-hint">右边就是改完之后的计划长什么样，改一个字就跟着变。</p>' +
      '<div id="epPreview"></div>' +
      '</div>';

    var hint = draftMode
      ? '下面的改动还没保存到计划里。「保存并采用」之后才会真正存下来。'
      : '下面的改动还没保存，点「保存修改」才会生效。';

    var foot = draftMode
      ? '<button class="btn" data-act="apply-draft">保存并采用</button>' +
        '<button class="btn ghost" data-act="reset-draft">恢复成系统生成的样子</button>' +
        '<button class="btn ghost" data-act="close">先不采用</button>'
      : (editable() ? '<button class="btn" data-act="save">保存修改</button>' : '') +
        (editable() ? '<button class="btn ghost" data-act="revert">放弃未保存的改动</button>' : '') +
        '<button class="btn ghost" data-act="remove">删除这份计划</button>';

    return '<div class="ep-banner plain" id="epDirtyBanner"' + (st.dirty ? '' : ' hidden') + '>' +
      hint + '</div>' +
      '<div class="ep-split">' +
      '<div class="ep-col">' + form + '</div>' +
      preview +
      '</div>' +
      '<div class="ip-plan-foot">' + foot +
      '<span class="ip-hint" id="epDirty"></span>' +
      '</div>';
  }

  /* 需要准备的东西：由活动类型推出来，跟着计划一起保存，用户改内容不会把它弄丢。
     这里如实说明「不提供修改」，而不是把它藏起来让用户以为丢了。 */
  function otherBlocksHtml() {
    var d = st.draft;
    var kindName = {
      tool: '工具设备', material: '材料', place: '环境', people: '人',
      budget: '花费', knowledge: '前置知识'
    };
    var res = (d.resources || []).map(function (r) {
      return '<div class="ip-res' + (r.ready ? '' : ' need') + '">' +
        '<span class="ip-res-kind">' + (kindName[r.kind] || '资源') + '</span>' +
        '<span class="ip-res-name">' + esc(r.name) + '</span>' +
        (r.ready ? '' : '<span class="ip-badge warn">要先准备</span>') +
        '</div>';
    }).join('');
    if (!res) { return ''; }
    return '<div class="ip-block"><h4>需要准备的东西</h4>' +
      '<p class="ip-hint">按这类活动推出来的，跟着计划一起保存。这里不提供修改。</p>' +
      res + '</div>';
  }

  function historyTabHtml() {
    var actor = E.currentActor();
    var plan = E.get(st.planId, actor);
    if (!plan) { return '<div class="ip-block"><h4>变更记录</h4><p class="ip-hint">这份计划已经不在了。</p></div>'; }
    var hist = E.historyOf(plan);

    return '<div class="ip-block"><h4>变更记录</h4>' +
      '<p class="ip-hint">每次保存都会留下一条记录，最多保留最近 ' + (E.MAX_VERSIONS || 12) +
      ' 版。挑一版恢复，恢复这个动作本身也会记成新的一版，所以怎么改都不会彻底回不去。</p>' +
      hist.map(function (h) {
        var lines = (h.summary || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
        return '<div class="ep-ver' + (h.isCurrent ? ' current' : '') + '">' +
          '<div class="ep-ver-head">' +
          '<b>第 ' + h.rev + ' 版</b>' +
          (h.isCurrent ? '<span class="ip-badge">当前</span>' : '') +
          '<span class="ep-ver-meta">' + esc(h.byName) + ' · ' + esc(h.actionLabel) + ' · ' + relTime(h.at) + '</span>' +
          '</div>' +
          (lines ? '<ul class="ip-list ep-ver-list">' + lines + '</ul>' : '<p class="ip-hint">这一版没有留下说明。</p>') +
          (h.isCurrent || !editable() ? '' :
            '<button class="btn ghost sm" data-act="restore" data-rev="' + h.rev + '">恢复到这一版</button>') +
          '</div>';
      }).join('') +
      '</div>';
  }

  function conflictHtml() {
    var c = st.conflict;
    if (!c) { return ''; }
    var list = (c.res.conflicts || []);

    return '<div class="ep-conflict">' +
      '<h4>有 ' + list.length + ' 处改动要你定一下</h4>' +
      '<p class="ip-hint">你打开这份计划之后，它又在别处（另一个窗口或另一台设备）被改过，' +
      '下面这几处两边写的不一样。每一处挑一个留下的就行，没挑的默认保留你这边写的。</p>' +
      (st.conflictStale
        ? '<div class="ep-banner warn">这份计划刚刚又被改了一次，你现在看到的两种写法可能已经过时。' +
          '建议放弃合并、重新打开一次再改。</div>' : '') +
      list.map(function (item) {
        var picked = c.decisions[item.id] === 'theirs' ? 'theirs' : 'mine';
        return '<div class="ep-cf" data-cid="' + esc(item.id) + '">' +
          '<div class="ep-cf-label">' + esc(item.label) + '</div>' +
          '<label class="ep-cf-opt' + (picked === 'mine' ? ' picked' : '') + '">' +
          '<input type="radio" name="' + esc(item.id) + '" data-act="cf-pick" data-cid="' + esc(item.id) +
          '" value="mine"' + (picked === 'mine' ? ' checked' : '') + '>' +
          '<span>保留我这边的</span><b>' + esc(item.mineText) + '</b></label>' +
          '<label class="ep-cf-opt' + (picked === 'theirs' ? ' picked' : '') + '">' +
          '<input type="radio" name="' + esc(item.id) + '" data-act="cf-pick" data-cid="' + esc(item.id) +
          '" value="theirs"' + (picked === 'theirs' ? ' checked' : '') + '>' +
          '<span>用另一处的</span><b>' + esc(item.theirsText) + '</b></label>' +
          '<div class="ep-cf-base">你开头看到的写法：' + esc(item.baseText) + '</div>' +
          '</div>';
      }).join('') +
      '<div class="ep-actions">' +
      '<button class="btn" data-act="cf-apply">就按这些选择合并保存</button>' +
      '<button class="btn ghost" data-act="cf-reopen">放弃合并，重新打开</button>' +
      '</div></div>';
  }

  function paint() {
    var box = $('ipEditor');
    if (!box) { return; }
    if (!st.draft) { box.innerHTML = ''; return; }

    var v = st.view || {};
    var head, tabs;

    if (isDraft()) {
      head = '<div class="ip-plan-head"><div><h3>先改一改，再采用</h3>' +
        '<p class="ip-hint">' + esc(v.title || '') + ' · ' + (v.stepCount || 0) + ' 个步骤 · ' +
        '还没保存 · 系统生成后你可以按自己的情况改</p></div>' +
        '<button class="ip-close" data-act="close">收起</button></div>';
      tabs = '<div class="ip-tabs">' +
        '<button class="ip-tab active" data-act="tab" data-tab="edit">改内容</button>' +
        '<span class="ep-tab-note">采用之后才会有「变更记录」</span></div>';
    } else {
      head = '<div class="ip-plan-head"><div><h3>修改这份计划</h3>' +
        '<p class="ip-hint">' + esc(v.title || '') + ' · 第 ' + (v.revision || 1) + ' 版 · 最近由' +
        esc(v.updatedByName || '某人') + relTime(v.updatedAt) + '修改</p></div>' +
        '<button class="ip-close" data-act="close">收起</button></div>';
      tabs = '<div class="ip-tabs">' +
        [['edit', '改内容'], ['history', '变更记录']].map(function (t) {
          return '<button class="ip-tab' + (st.tab === t[0] ? ' active' : '') + '" data-act="tab" data-tab="' +
            t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div>';
    }

    /* 草稿还没有历史，这个页签在这里只会误导人 */
    var body = isDraft() ? editTabHtml()
      : (st.conflict ? conflictHtml()
        : (st.tab === 'history' ? historyTabHtml() : editTabHtml()));

    box.innerHTML = '<div class="ip-card">' + head + bannerHtml() + tabs +
      (st.tab === 'edit' && !st.conflict ? permissionHintHtml() : '') +
      body + '</div>';

    refreshDerived();
  }

  /* ---------- 交互 ---------- */
  function onField(el) {
    if (!editable() || !st.draft) { paint(); return; }
    var v = el.value;
    var sid = el.getAttribute('data-step');

    if (sid) {
      var s = byId(st.draft.steps, sid);
      if (!s) { return; }
      var k = el.getAttribute('data-k');
      s[k] = (k === 'durationMin' || k === 'sessions') ? num(v) : v;
    } else {
      var f = el.getAttribute('data-field');
      if (!f) { return; }
      var sch = st.draft.schedule[0];
      switch (f) {
        case 'title': st.draft.title = v; break;
        case 'priority': st.draft.priority = v; break;
        case 'outcome': st.draft.goal.outcome = v; break;
        case 'horizon': st.draft.goal.horizonDays = num(v); break;
        case 'deliverables': st.draft.goal.deliverables = splitList(v); break;
        case 'metrics': st.draft.metrics = splitLines(v, 8); break;
        case 'risk': st.draft.risk = parseRisks(v); break;
        case 'date': sch.date = v; break;
        case 'start': sch.start = v; break;
        case 'sessionMin': sch.sessionMin = num(v); break;
        case 'slots': sch.slots = num(v); break;
        case 'rationale': sch.rationale = v; break;
        default: return;
      }
    }
    st.dirty = true;
    refreshDerived();
  }

  function onChange(el) {
    var act = el.getAttribute('data-act');
    if (act === 'cf-pick') {
      if (st.conflict) { st.conflict.decisions[el.getAttribute('data-cid')] = el.value; }
      paint();
      return;
    }
    onField(el);
  }

  function onClick(el) {
    var act = el.getAttribute('data-act');
    if (!act) { return; }
    var actor = E.currentActor();

    switch (act) {
      case 'close':
        /* 草稿模式下「收起」等于放弃这次编辑，得先问一句，别让用户白改一通 */
        if (isDraft() && st.dirty && !root.confirm('改动还没保存到计划里，收起来就丢了。确定收起吗？')) { return; }
        close();
        return;
      case 'tab':
        st.tab = el.getAttribute('data-tab');
        if (st.tab !== 'edit') { st.conflict = null; }
        paint();
        return;

      case 'step-up': moveStep(el.getAttribute('data-id'), -1); return;
      case 'step-down': moveStep(el.getAttribute('data-id'), 1); return;
      case 'step-del': removeStep(el.getAttribute('data-id')); return;
      case 'step-add': addStep(); return;
      case 'step-sort': sortSteps(); return;

      case 'apply-draft': doApplyDraft(); return;
      case 'reset-draft': doResetDraft(); return;

      case 'save': doSave(); return;
      case 'revert': doRevert(); return;
      case 'remove': doRemove(); return;

      case 'restore': doRestore(num(el.getAttribute('data-rev'))); return;

      case 'cf-apply': doResolve(); return;
      case 'cf-reopen':
        st.conflict = null;
        open(st.planId, 'edit');
        return;
      default: return;
    }
  }

  /* 结构类改动：本地改草稿 + 整块重绘（不落盘） */
  function moveStep(id, delta) {
    if (!editable()) { return; }
    var list = st.draft.steps;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) { continue; }
      var j = i + delta;
      if (j < 0 || j >= list.length) { msg(delta > 0 ? '已经在最后一步了' : '已经在第一步了', 'warn'); return; }
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      st.dirty = true;
      paint();
      return;
    }
  }
  function removeStep(id) {
    if (!editable()) { return; }
    if (st.draft.steps.length <= 1) { msg('计划至少要保留 1 个步骤', 'warn'); return; }
    st.draft.steps = st.draft.steps.filter(function (s) { return s.id !== id; });
    st.dirty = true;
    paint();
  }
  function addStep() {
    if (!editable()) { return; }
    if (st.draft.steps.length >= STEPS_MAX) { msg('步骤最多 ' + STEPS_MAX + ' 个，再多就执行不下去了', 'warn'); return; }
    st.draft.steps.push({
      id: newStepId(), title: '第 ' + (st.draft.steps.length + 1) + ' 步', detail: '',
      durationMin: 30, sessions: 1, deliverable: '', check: '', priority: 'normal'
    });
    st.dirty = true;
    paint();
  }
  function sortSteps() {
    if (!editable()) { return; }
    var rank = {};
    PRIORITIES.forEach(function (p) { rank[p.key] = p.rank; });
    st.draft.steps = st.draft.steps.map(function (s, i) { return { s: s, i: i }; })
      .sort(function (a, b) {
        var ra = rank[a.s.priority], rb = rank[b.s.priority];
        if (ra == null) { ra = 1; }
        if (rb == null) { rb = 1; }
        return ra !== rb ? ra - rb : a.i - b.i;
      })
      .map(function (x) { return x.s; });
    st.dirty = true;
    msg('已按优先级重排，还没保存。确认后点「保存修改」。', 'ok');
    paint();
  }
  function doRevert() {
    var actor = E.currentActor();
    var plan = E.get(st.planId, actor);
    if (!plan) { msg('这份计划已经不在了', 'warn'); close(); return; }
    st.draft = clone(plan);
    st.baseRevision = plan.revision;
    st.dirty = false;
    msg('已回到上次保存的样子', 'ok');
    paint();
  }

  /* 把草稿整理成一次提交要带的内容 */
  function draftPatch() {
    return {
      title: st.draft.title,
      priority: st.draft.priority,
      goal: st.draft.goal,
      steps: st.draft.steps,
      schedule: st.draft.schedule,
      resources: st.draft.resources,
      metrics: st.draft.metrics,
      risk: st.draft.risk
    };
  }

  /* 这次到底改的是哪一类？版本记录上要写清楚，用户翻记录时才知道这一版动了什么。
     优先按「最显眼的那一处」归类：只动优先级就记「调整优先级」，只动时间安排就记
     「调整时间安排」，只调了步骤先后就记「调整顺序」，其余一律记「修改内容」。 */
  function localAction(before, after) {
    var keys = ['title', 'priority', 'goal', 'steps', 'schedule', 'resources', 'metrics', 'risk'];
    var changed = keys.filter(function (k) {
      return JSON.stringify(before[k]) !== JSON.stringify(after[k]);
    });
    if (changed.length === 1) {
      if (changed[0] === 'priority') { return 'priority'; }
      if (changed[0] === 'schedule') { return 'schedule'; }
      if (changed[0] === 'steps') {
        var bIds = (before.steps || []).map(function (s) { return s.id; }).join('|');
        var aIds = (after.steps || []).map(function (s) { return s.id; }).join('|');
        return bIds === aIds ? 'step' : 'reorder';
      }
    }
    return 'content';
  }

  function doSave() {
    if (!editable()) { msg('这不是你的计划，改不了', 'warn'); return; }
    var actor = E.currentActor();
    var action = 'content';
    var plan = E.get(st.planId, actor);
    if (plan) { action = localAction(plan, st.draft); }
    var res = E.updateContent(st.draft, actor, draftPatch(), {
      baseRevision: st.baseRevision,
      action: action
    });
    handleResult(res, '已保存', E.ACTION_LABELS ? E.ACTION_LABELS[action] : '');
  }

  /* ---------- 草稿模式的两个出口 ---------- */
  /* 保存并采用：先把草稿收敛成一份自洽的计划再交回去，
     这样调用方拿到的、将来落盘的，一定是用户最后看到的那一版。 */
  function doApplyDraft() {
    var d = E.normalize(clone(st.draft));
    var v = E.validate(d);
    if (!v.ok) {
      msg('还有地方没填对：' + v.errors.map(function (e) { return e.message; }).join('；'), 'warn');
      paint();
      return;
    }
    st.draft = d;
    var cb = st.onApply;
    close(true);
    if (cb) { cb(d); }
  }

  function doResetDraft() {
    if (!st.original) { return; }
    if (!root.confirm('恢复成系统刚生成的样子？你在这里的改动会全部丢掉。')) { return; }
    st.draft = E.normalize(clone(st.original));
    st.dirty = false;
    msg('已恢复成系统生成的样子', 'ok');
    paint();
  }

  /* 保存 / 合并 / 恢复的结果形状一致，统一在这里翻译成人话 */
  function handleResult(res, okWord, actionLabel) {
    var actor = E.currentActor();

    if (res.ok) {
      st.conflict = null;
      st.conflictStale = false;
      st.remote = null;
      st.draft = clone(res.plan);
      st.baseRevision = res.plan.revision;
      st.perm = E.permissionOf(actor, res.plan);
      st.view = E.viewOf(res.plan, actor);
      st.dirty = false;
      renderSavedList();

      var text;
      if (res.unchanged) {
        /* 改完跟现状一模一样（例如冲突结算时全选了对方的写法），不必凭空多出一版；
           但也要说清楚「你的操作生效了，只是结果没变」，不能让用户以为点击失败了。 */
        text = okWord === '已保存'
          ? '没有需要保存的改动'
          : (okWord + '：处理完了，结果和现在的内容一致');
      } else {
        var sum = (res.summary || []).join('；');
        text = okWord + '（第 ' + res.revision + ' 版' + (actionLabel ? '·' + actionLabel : '') + '）' +
          (sum ? '：' + sum : '');
      }
      if (res.mergedFrom) {
        text += '。这期间这份计划在别处也被改过，那些改动一并保留了。';
      }
      msg(text, 'ok');
      paint();
      return;
    }

    switch (res.reason) {
      case 'conflict':
        st.conflict = { res: res, decisions: {} };
        st.conflictStale = false;
        paint();
        msg('这份计划在别处也改过，有几处两边写的不一样，请逐处确认一下', 'warn');
        return;

      case 'invalid':
        msg('还有地方没填对：' + (res.errors || []).map(function (e) { return e.message; }).join('；'), 'warn');
        return;

      case 'rejected':
        msg(res.message, 'warn');
        paint();
        return;

      case 'forbidden':
        st.perm = E.permissionOf(actor, E.get(st.planId, actor) || {});
        msg('这份计划已经不属于你了，这一次的修改没有保存', 'warn');
        paint();
        return;

      case 'stale':
      case 'conflict-again':
        st.conflict = null;
        msg(res.message + '。已为你重新载入最新内容，请再改一次。', 'warn');
        open(st.planId, st.tab);
        return;

      case 'deleted':
        msg(res.message, 'warn');
        close();
        return;

      default:
        msg(res.message || '没能保存，请稍后再试', 'warn');
        paint();
    }
  }

  function doResolve() {
    if (!st.conflict) { return; }
    var actor = E.currentActor();
    var res = E.resolve(st.planId, actor, st.conflict.res, st.conflict.decisions || {}, {});
    handleResult(res, '已按你的选择合并保存', '合并他人改动');
  }

  function doRestore(rev) {
    var actor = E.currentActor();
    var plan = E.get(st.planId, actor);
    if (!plan) { msg('这份计划已经不在了', 'warn'); close(); return; }
    if (!root.confirm('恢复到第 ' + rev + ' 版？当前内容会被换成那一版，这次恢复本身也会记为新的一版。')) { return; }
    var res = E.restore(plan, actor, rev, { baseRevision: st.baseRevision });
    handleResult(res, '已恢复', '恢复到历史版本');
  }

  /* 编辑器里的「删除这份计划」和列表里的「删除」是同一件事，走同一条路径，
     免得两个入口的确认话术、删除范围、删除后的反馈各说各话。 */
  function doRemove() {
    if (!st.planId) { return; }
    deleteSavedPlan(st.planId);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    var box = $('ipEditor');
    if (box) {
      box.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (el && box.contains(el)) { onClick(el); }
      });
      box.addEventListener('input', function (e) { onField(e.target); });
      box.addEventListener('change', function (e) { onChange(e.target); });
    }

    /* 这份计划变了而我手上的底稿还是旧的：刷新清单，并提示一声，
       但不打断当前输入——保存时逻辑层会做新旧比对。 */
    E.subscribe('plan:updated', function (p) {
      renderSavedList();
      if (!st.planId || !p || !p.plan || p.plan.id !== st.planId) { return; }
      /* 计划只属于你自己，所以「落后了」只可能来自另一个窗口或另一台设备。
         这里不再按「是谁改的」区分，因为没有第二个人。 */
      if (p.revision !== st.baseRevision) {
        st.remote = { rev: p.revision };
        if (st.conflict) { st.conflictStale = true; }
        paint();
      }
    });
    E.subscribe('plan:deleted', function (p) {
      renderSavedList();
      if (st.planId && p && p.planId === st.planId) {
        msg('这份计划已经被删除了', 'warn');
        close();
      }
    });

    renderSavedList();
  }

  var API = {
    init: init,
    open: open,
    openDraft: openDraft,
    close: close,
    renderSavedList: renderSavedList,
    isOpen: function () { return !!st.draft; },
    isDraft: isDraft
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  else { root.PlanEditView = API; }
})(typeof window !== 'undefined' ? window : globalThis);
