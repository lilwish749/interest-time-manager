/* =========================================================================
   兴趣池界面 —— InterestView
   -------------------------------------------------------------------------
   职责：把 InterestPool / InterestPlanner 的结果渲染成用户能直接看懂的界面。

   约定（重要）：本文件不得以任何形式展示、暴露或引用原始数据内容，
   包括不显示数据原文、字段名称、字段结构或数据结构；
   只呈现经过处理后的用户可见结果，例如类别中文名、相对时间、
   「负荷区间：最佳学习区」这类自然语言结论。
   ========================================================================= */
(function (root) {
  'use strict';

  var doc = root.document;
  var P = root.InterestPool;
  var PL = root.InterestPlanner;
  if (!doc || !P || !PL) { return; }

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
      box._t = root.setTimeout(function () { box.className = 'ip-notice'; }, 3600);
    }
  }

  /* 与根应用既有存储对接：只读「已经处理好的对象」用于渲染与换算，
     本层不写安排表——安排表的落盘在 index 主程序自己的入口里。 */
  function currentPhone() {
    if (typeof currentUser === 'function') { var u = currentUser(); return u ? u.phone : null; }
    var s = P.readLocal('tm_session', null);
    return s ? s.phone : null;
  }
  function toMin(t) {
    var p = String(t == null ? '' : t).split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }
  function goTab(tab) { if (typeof switchTab === 'function') { switchTab(tab); } }
  /* index 主程序挂出来的安排表入口。桌面原型页（没有安排表）里它不存在，
     此时所有与安排表有关的入口一律不出现，免得点了没反应。 */
  function scheduleBridge() {
    var b = root.LMSBridge;
    return (b && typeof b.scheduleItems === 'function' && typeof b.applySchedule === 'function') ? b : null;
  }
  /* 是否可以把兴趣直接排进「新增事项」——预览页没有该表单，此时隐藏相关入口 */
  function canTakeToSchedule() {
    return !!scheduleBridge() &&
      !!(doc.getElementById('fProject') && doc.getElementById('fStart') && doc.getElementById('fEnd'));
  }

  /* ---------- 录入区：实时联想 ---------- */
  var suggestBox = null;
  var activeIdx = -1;

  function currentLine() {
    var ta = $('ipInput');
    if (!ta) { return null; }
    var pos = ta.selectionStart, val = ta.value;
    var start = val.lastIndexOf('\n', pos - 1) + 1;
    var nl = val.indexOf('\n', pos);
    var end = nl === -1 ? val.length : nl;
    return { line: val.slice(start, end), start: start, end: end };
  }
  function hideSuggest() { if (suggestBox) { suggestBox.hidden = true; } activeIdx = -1; }
  function highlight() {
    if (!suggestBox) { return; }
    Array.prototype.forEach.call(suggestBox.children, function (el, i) {
      el.className = 'ip-sug-item' + (i === activeIdx ? ' active' : '');
    });
  }
  function pickSuggest(item, cur) {
    var ta = $('ipInput');
    if (!ta) { return; }
    var before = ta.value.slice(0, cur.start);
    var after = ta.value.slice(cur.end);
    ta.value = before + item.term + after;
    var pos = (before + item.term).length;
    ta.focus();
    try { ta.setSelectionRange(pos, pos); } catch (e) { /* 忽略 */ }
    hideSuggest();
  }
  function updateSuggest() {
    if (!suggestBox) { return; }
    var cur = currentLine();
    if (!cur) { return; }
    var q = cur.line.trim();
    if (!q) { hideSuggest(); return; }
    var list = P.suggest(q, 8);
    if (!list.length) { hideSuggest(); return; }
    suggestBox.innerHTML = list.map(function (s, i) {
      return '<div class="ip-sug-item' + (i === activeIdx ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="ip-sug-term">' + esc(s.term) + '</span>' +
        '<span class="ip-sug-cat">' + esc(s.label) + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(suggestBox.children, function (el, i) {
      el.onmousedown = function (e) { e.preventDefault(); pickSuggest(list[i], cur); };
    });
    suggestBox.hidden = false;
  }

  /* ---------- 识别结果卡片 ---------- */
  function interestCard(item, mount) {
    var card = doc.createElement('div');
    card.className = 'ip-item';
    var tags = (item.matchedKeywords && item.matchedKeywords.length)
      ? item.matchedKeywords.slice(0, 6).map(function (k) { return '<span class="ip-tag">' + esc(k) + '</span>'; }).join('')
      : '';
    card.innerHTML =
      '<div class="ip-item-top"><span class="ip-name">' + esc(item.input) + '</span>' +
      (item.type === 'category' ? '<span class="ip-badge">自动识别</span>' : '<span class="ip-badge gray">手动指定</span>') +
      '</div>' +
      '<div class="ip-item-meta">属于「' + esc(item.categoryLabel) + '」' + (tags ? ' · 相关：' + tags : '') + '</div>';

    var add = doc.createElement('button');
    add.className = 'btn sm';
    add.textContent = '加入兴趣池';
    add.onclick = function () {
      var res = P.add(item.input, { categoryKey: item.type === 'custom' ? item.category : null });
      if (!res.ok) {
        if (res.reason === 'duplicate') { msg('这个兴趣已经在兴趣池里了', 'warn'); }
        else if (res.reason === 'unrecognized') { msg('暂时认不出它属于哪一类，请从下面的候选里选一个', 'warn'); }
        else { msg('请先写下兴趣名称', 'warn'); }
        return;
      }
      add.disabled = true;
      add.textContent = '已加入';
      renderList();
      var hint = P.storageHint();
      msg('已加入兴趣池：' + res.item.name + (hint ? '（' + hint + '）' : ''), 'ok');
    };
    if (P.has(item.input)) { add.disabled = true; add.textContent = '已在兴趣池'; }

    var row = doc.createElement('div');
    row.className = 'ip-item-actions';
    row.appendChild(add);
    card.appendChild(row);
    mount.appendChild(card);
  }

  function unknownCard(item, mount) {
    var card = doc.createElement('div');
    card.className = 'ip-item';
    card.innerHTML =
      '<div class="ip-item-top"><span class="ip-name">' + esc(item.input) + '</span>' +
      '<span class="ip-badge warn">需要确认</span></div>' +
      '<div class="ip-item-meta">没找到完全对得上的类别，请选一个最接近的：</div>';

    var row = doc.createElement('div');
    row.className = 'ip-item-actions';
    var sugs = item.suggestions || [];
    if (sugs.length) {
      sugs.forEach(function (s) {
        var b = doc.createElement('button');
        b.className = 'btn ghost sm';
        b.textContent = s.label;
        b.onclick = function () {
          var fixed = P.classify(item.input, s.key);
          var holder = doc.createElement('div');
          interestCard(fixed, holder);
          card.parentNode.replaceChild(holder.firstChild, card);
          updateCount();
        };
        row.appendChild(b);
      });
    } else {
      var sel = doc.createElement('select');
      sel.className = 'input ip-select';
      sel.innerHTML = P.categories().map(function (c) {
        return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>';
      }).join('');
      var go = doc.createElement('button');
      go.className = 'btn sm';
      go.textContent = '就用这个类别';
      go.onclick = function () {
        var fixed = P.classify(item.input, sel.value);
        var box = card.parentNode;
        var holder = doc.createElement('div');
        interestCard(fixed, holder);
        box.replaceChild(holder.firstChild, card);
        updateCount();
      };
      row.appendChild(sel);
      row.appendChild(go);
    }
    card.appendChild(row);
    mount.appendChild(card);
  }

  function doClassify() {
    var ta = $('ipInput');
    var box = $('ipResults');
    if (!ta || !box) { return; }
    var lines = ta.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    box.innerHTML = '';
    if (!lines.length) { msg('先写下一个兴趣，再点识别', 'warn'); return; }
    lines.forEach(function (l) {
      var r = P.classify(l);
      if (r.recognized) { interestCard(r, box); } else { unknownCard(r, box); }
    });
    if (lines.length > 6) { msg('已识别 ' + lines.length + ' 条，加入后会出现在右侧清单里', 'ok'); }
  }

  /* ---------- 兴趣池清单 ---------- */
  function renderList() {
    var box = $('ipList');
    if (!box) { return; }
    var kw = ($('ipSearch') && $('ipSearch').value || '').trim();
    var cat = ($('ipFilter') && $('ipFilter').value) || '';
    var items = P.list({ keyword: kw, category: cat });

    if (!items.length) {
      box.innerHTML = '<div class="ip-empty">' +
        (kw || cat ? '没有符合条件的兴趣。' : '兴趣池还是空的。左边写下一个兴趣，识别后就能加进来。') +
        '</div>';
      updateCount();
      return;
    }

    var canTake = canTakeToSchedule();
    box.innerHTML = items.map(function (it) {
      var meta = [esc(it.categoryLabel), P.whenText(it.createdAt) + '加入'];
      if (it.useCount) { meta.push('已安排 ' + it.useCount + ' 次'); }
      return '<div class="ip-row" data-id="' + esc(it.id) + '">' +
        '<div class="ip-row-main">' +
        '<div class="ip-row-name">' + esc(it.name) +
        (it.type === 'custom' ? '<span class="ip-badge gray">自定类别</span>' : '') + '</div>' +
        '<div class="ip-row-meta">' + meta.join(' · ') + '</div>' +
        '</div>' +
        '<div class="ip-row-actions">' +
        '<button class="btn sm" data-act="plan">生成计划</button>' +
        (canTake ? '<button class="btn ghost sm" data-act="take">排进安排表</button>' : '') +
        '<button class="btn ghost sm" data-act="remove">移除</button>' +
        '</div></div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-act]'), function (btn) {
      btn.onclick = function () {
        var id = btn.closest('.ip-row').getAttribute('data-id');
        if (btn.getAttribute('data-act') === 'plan') { openPlanForInterest(id); }
        else if (btn.getAttribute('data-act') === 'take') { takeToSchedule(id); }
        else { removeInterest(id); }
      };
    });
    updateCount();
  }

  function updateCount() {
    var el = $('ipCount');
    if (!el) { return; }
    var n = P.count();
    el.textContent = n ? ('共 ' + n + ' 个兴趣') : '还没有兴趣';
  }

  function removeInterest(id) {
    var rec = P.get(id);
    if (!rec) { return; }
    if (!root.confirm('确定把「' + rec.name + '」从兴趣池移除吗？')) { return; }
    P.remove(id);
    renderList();
    msg('已移除：' + rec.name, 'ok');
  }

  /* ---------- 取出：排进安排表 ---------- */
  function takeToSchedule(id) {
    var rec = P.get(id);
    if (!rec) { return; }
    if (!canTakeToSchedule()) { msg('当前页面没有安排表，请到主程序里操作', 'warn'); return; }
    if (!currentPhone()) { msg('请先登录，再把兴趣排进安排表', 'warn'); return; }
    var res = P.take(id, 'schedule');
    if (!res.ok) { msg('没有找到这个兴趣', 'warn'); return; }

    var f = {
      project: $('fProject'), desc: $('fDesc'), date: $('fDate'),
      start: $('fStart'), end: $('fEnd')
    };
    if (!f.project) { msg('页面还在加载，请稍后再试', 'warn'); return; }
    f.project.value = res.prefill.project;
    f.desc.value = res.prefill.description || '';
    f.date.value = res.prefill.date;
    f.start.value = res.prefill.start;
    f.end.value = res.prefill.end;

    goTab('add');
    if (typeof renderFreeList === 'function') { renderFreeList(); }
    msg('已把「' + rec.name + '」填进新增事项，时间是' + (res.slotLabel || '合适时段') +
      ' ' + res.prefill.start + '–' + res.prefill.end + '，确认后保存即可。', 'sticky');
    renderList();
  }

  /* ---------- 计划面板 ---------- */
  /*  plans     系统生成的三档方案，保持原样不动
      overrides 用户在某档上「先改一改」的结果；有它就用它，采用时也用它。
                 这样「恢复系统生成的版本」随时能做，也不会把生成结果弄丢。 */
  var state = { plans: null, index: 0, rec: null, context: null, overrides: {} };

  function currentPlan() {
    if (!state.plans || !state.plans.length) { return null; }
    return state.overrides[state.index] || state.plans[state.index];
  }
  function isOverridden(i) { return !!state.overrides[i]; }

  /* 主流程只有一条：兴趣池里的兴趣 → 生成计划。
     不提供「直接写一句话就生成计划」的旁路，免得同一件事有两种走法、
     也免得用户写下的东西没进兴趣池、下次就找不到了。 */
  function openPlanForInterest(id) {
    var rec = P.get(id);
    if (!rec) { return; }
    buildPlans({ text: rec.name, sourceInterestId: id }, rec.name);
  }

  function buildPlans(input, label) {
    var panel = $('ipPlan');
    if (!panel) { return; }
    var rec = PL.recognize(input.text, { sourceInterestId: input.sourceInterestId });
    var cands = [];
    if (rec.domain) { cands.push({ key: rec.domain, label: rec.categoryLabel }); }
    (rec.suggestions || []).forEach(function (s) {
      if (s.key !== rec.domain) { cands.push({ key: s.key, label: s.label }); }
    });

    /* 完全认不出、也没有可参考的候选：说明白，并给一个换说法的提示 */
    if (!cands.length) {
      panel.innerHTML = '<div class="ip-card"><h3>没能识别出这是什么活动</h3>' +
        '<p class="ip-hint">可以换个说法再试，例如加上你在做什么（学、练、做、读、拍）。</p></div>';
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    /* 有候选但不够确定：交给用户确认，绝不替他做主 */
    if (rec.needConfirm) {
      panel.innerHTML = '<div class="ip-card"><h3>先确认一下这是不是你要做的事</h3>' +
        '<p class="ip-hint">「' + esc(rec.name) + '」最接近的类别是：</p>' +
        '<div class="ip-item-actions" id="ipConfirm"></div></div>';
      var wrap = $('ipConfirm');
      cands.forEach(function (c) {
        var b = doc.createElement('button');
        b.className = 'btn ghost sm';
        b.textContent = c.label;
        b.onclick = function () {
          var fixed = PL.confirm(input.text, c.key);
          fixed.sourceInterestId = input.sourceInterestId;
          renderPlans(fixed, label);
        };
        wrap.appendChild(b);
      });
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    renderPlans(rec, label);
  }

  function loadLine(plan) {
    var l = plan.load || {};
    if (!l.available) { return '负荷评估：打开一次「负荷管理系统」并完成问卷后，这里会显示这件事对你的负荷高低。'; }
    var parts = [];
    if (l.zone) { parts.push('这件事对你的负荷：' + l.zone); }
    if (l.weeklyPercent != null) {
      parts.push('加入后本周负荷 ' + l.weeklyPercent + '%（' + (l.weeklyZone || '—') + '）');
    }
    return parts.join(' · ') || '负荷评估：暂无结论';
  }

  function renderPlans(rec, label) {
    var panel = $('ipPlan');
    var plans = PL.variants(rec, {});
    state.plans = plans; state.index = 0; state.rec = rec; state.context = label;
    state.overrides = {};
    paintPlans();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function paintPlans() {
    var panel = $('ipPlan');
    if (!panel || !state.plans || !state.plans.length) { return; }
    var plan = currentPlan();
    var edited = isOverridden(state.index);

    var tabs = state.plans.map(function (p, i) {
      return '<button class="ip-tab' + (i === state.index ? ' active' : '') + '" data-i="' + i + '">' +
        esc(p.variantName || p.level) + (isOverridden(i) ? ' · 已改' : '') + '</button>';
    }).join('');

    var steps = plan.steps.map(function (s) {
      return '<li class="ip-step">' +
        '<div class="ip-step-line"><span class="ip-step-no">' + s.seq + '</span>' +
        '<span class="ip-step-title">' + esc(s.title) + '</span></div>' +
        '<div class="ip-step-detail">' + esc(s.detail) + '</div>' +
        '<div class="ip-step-foot">单次 ' + s.durationMin + ' 分钟 · 共 ' + s.sessions + ' 次' +
        ' · 完成判据：' + esc(s.check) + '</div>' +
        '</li>';
    }).join('');

    var sch = plan.schedule[0];
    var dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var schHtml =
      '<div class="ip-kv"><span>开始日期</span><b>' + esc(sch.date) + '（' + dayNames[sch.day % 7] + '）</b></div>' +
      '<div class="ip-kv"><span>每次时间</span><b>' + esc(sch.start) + ' – ' + esc(sch.end) + '（' + sch.sessionMin + ' 分钟）</b></div>' +
      '<div class="ip-kv"><span>每周次数</span><b>' + sch.slots + ' 次</b></div>' +
      '<div class="ip-kv"><span>为什么排这个时间</span><b>' + esc(sch.rationale) + '</b></div>';

    var kindName = { tool: '工具设备', material: '材料', place: '环境', people: '人', budget: '花费', knowledge: '前置知识' };
    var res = plan.resources.map(function (r) {
      return '<div class="ip-res' + (r.ready ? '' : ' need') + '">' +
        '<span class="ip-res-kind">' + (kindName[r.kind] || '资源') + '</span>' +
        '<span class="ip-res-name">' + esc(r.name) + '</span>' +
        (r.ready ? '' : '<span class="ip-badge warn">要先准备</span>') +
        (r.note ? '<span class="ip-res-note">' + esc(r.note) + '</span>' : '') +
        '</div>';
    }).join('');

    var metrics = plan.metrics.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('');
    var risks = plan.risk.map(function (r) {
      return '<li><b>' + esc(r.text) + '</b> → ' + esc(r.fallback) + '</li>';
    }).join('');

    panel.innerHTML =
      '<div class="ip-card">' +
      '<div class="ip-plan-head">' +
      '<div><h3>' + esc(plan.title) + '</h3>' +
      '<p class="ip-hint">' + esc(plan.categoryLabel) + ' · ' + esc(plan.goal.level) + '难度 · ' + loadLine(plan) +
      (edited ? ' · <b>这一版你已经改过了</b>' : '') + '</p></div>' +
      '<button class="ip-close" id="ipPlanClose">收起</button>' +
      '</div>' +

      '<div class="ip-tabs">' + tabs + '</div>' +
      '<p class="ip-hint">' + esc(plan.variantWhy || '') + '</p>' +

      '<div class="ip-block"><h4>目标</h4>' +
      '<div class="ip-kv"><span>做到什么</span><b>' + esc(plan.goal.outcome) + '</b></div>' +
      '<div class="ip-kv"><span>留下的东西</span><b>' + esc(plan.goal.deliverables.join('、')) + '</b></div>' +
      '<div class="ip-kv"><span>周期</span><b>' + plan.goal.horizonDays + ' 天</b></div></div>' +

      '<div class="ip-block"><h4>步骤（照着做就行）</h4>' +
      '<ol class="ip-steps">' + steps + '</ol></div>' +

      '<div class="ip-block"><h4>时间安排</h4>' + schHtml + '</div>' +

      '<div class="ip-block"><h4>需要准备</h4>' + res + '</div>' +

      '<div class="ip-block"><h4>怎么算完成</h4><ul class="ip-list">' + metrics + '</ul></div>' +

      '<div class="ip-block"><h4>可能卡住的地方，以及退一步怎么办</h4><ul class="ip-list">' + risks + '</ul></div>' +

      '<div class="ip-plan-foot">' +
      '<button class="btn" id="ipAdopt">采用这个计划</button>' +
      (canTakeToSchedule() ? '<button class="btn ghost" id="ipAdoptBoth">采用，并编入安排表</button>' : '') +
      (canPreEdit() ? '<button class="btn ghost" id="ipPreEdit">先改一改，再采用</button>' : '') +
      (edited ? '<button class="btn ghost" id="ipPreReset">恢复系统生成的版本</button>' : '') +
      '<span class="ip-hint" id="ipAdoptHint"></span>' +
      '</div></div>';

    Array.prototype.forEach.call(panel.querySelectorAll('.ip-tab'), function (b) {
      b.onclick = function () { state.index = +b.getAttribute('data-i'); paintPlans(); };
    });
    $('ipPlanClose').onclick = function () {
      panel.innerHTML = '';
      state.plans = null;
      state.overrides = {};
      if (root.PlanEditView && root.PlanEditView.isDraft && root.PlanEditView.isDraft()) {
        root.PlanEditView.close();
      }
    };
    $('ipAdopt').onclick = function () { doAdopt(false); };
    var both = $('ipAdoptBoth');
    if (both) { both.onclick = function () { doAdopt(true); }; }
    var pre = $('ipPreEdit');
    if (pre) { pre.onclick = openPreEdit; }
    var preReset = $('ipPreReset');
    if (preReset) { preReset.onclick = doPreReset; }
  }

  /* 有编辑模块才给「先改一改」的入口，免得点了没反应 */
  function canPreEdit() {
    return !!(root.PlanEditView && typeof root.PlanEditView.openDraft === 'function');
  }

  /* 保存前先改：在内存里改这一版，改完回填到计划面板。
     采用时用的就是回填后的结果，所以「保存时以最新编辑内容为准」是结构上保证的。 */
  function openPreEdit() {
    if (!canPreEdit()) { msg('当前页面没有编辑功能，请到主程序里操作', 'warn'); return; }
    var idx = state.index;
    var base = currentPlan();
    if (!base) { return; }
    root.PlanEditView.openDraft(base, {
      onApply: function (edited) {
        state.overrides[idx] = edited;
        paintPlans();
        msg('改动已经带上。点「采用这个计划」就会按你现在看到的样子存下来。', 'ok');
        var panel = $('ipPlan');
        if (panel && panel.scrollIntoView) { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    });
  }

  function doPreReset() {
    delete state.overrides[state.index];
    msg('已恢复成系统生成的那一版', 'ok');
    paintPlans();
  }

  function doAdopt(syncSchedule) {
    /* 关键：采用的是「当前这一版」，也就是用户在保存前改过的那一份 */
    var plan = currentPlan();
    if (!plan) { return; }
    var hint = $('ipAdoptHint');
    /* 没有安排表就不给这一步（桌面原型页），免得点了只得到一句「没有安排表」 */
    if (syncSchedule && !scheduleBridge()) { syncSchedule = false; }

    var res = PL.adopt(plan, {});
    var texts = ['已采用：' + plan.name];
    if (res.weekly && res.weekly.percent != null) {
      texts.push('本周负荷 ' + res.weekly.percent + '%（' + res.weekly.zone.label + '）');
      if (res.weekly.zone.key === 'over') { texts.push('已经超量，建议先去周负荷看板调一调'); }
    } else if (!PL.hasLoadEngine()) {
      texts.push('本周计划已记下');
    }

    /* 采用之后再编入安排表。两件事分开：编入的规模由确认框说清楚，
       用户在确认框上点了取消也只影响编入这一步，采用本身照旧生效。 */
    var syncKind = 'ok', syncRes = null;
    if (syncSchedule) {
      syncRes = doSyncPlan(res.plan || plan, { quiet: true });
      texts.push(syncRes.words);
      if (!syncRes.ok) { syncKind = 'warn'; }
    }

    var btnA = $('ipAdopt'), btnB = $('ipAdoptBoth');
    if (btnA) { btnA.disabled = true; btnA.textContent = '已采用'; }
    if (btnB) { btnB.disabled = true; btnB.textContent = '已采用'; }
    if (hint) { hint.textContent = texts.join('；'); }

    var foot = hint && hint.parentNode;

    /* 真的编进去了就给个入口去看结果，不让用户自己去猜安排表里多了什么 */
    if (foot && syncRes && syncRes.ok && root.LMSBridge &&
        root.LMSBridge.focusSchedule && !$('ipGoSchedule')) {
      var where = (syncRes.result && syncRes.result.focus) || syncRes.first;
      var goSch = doc.createElement('button');
      goSch.className = 'btn ghost';
      goSch.id = 'ipGoSchedule';
      goSch.textContent = '去安排表看看';
      goSch.onclick = function () { root.LMSBridge.focusSchedule(where); };
      foot.insertBefore(goSch, hint);
    }

    /* 采用之后计划就归用户了，顺手给一个「去改」的入口，
       不让「改计划」这件事藏在一个他不知道的地方。 */
    if (foot && res.plan && res.plan.id && root.PlanEditView && !$('ipGoEdit')) {
      var go = doc.createElement('button');
      go.className = 'btn ghost';
      go.id = 'ipGoEdit';
      go.textContent = '去修改这份计划';
      go.onclick = function () { root.PlanEditView.open(res.plan.id, 'edit'); };
      foot.insertBefore(go, hint);
    }
    if (root.PlanEditView && root.PlanEditView.renderSavedList) { root.PlanEditView.renderSavedList(); }

    msg(texts.join('；'), syncKind);
    renderList();
  }

  /* ---------- 把计划编进安排表 ----------
     安排表是 index 主程序内置的组成部分，所以这一层只做三件事：
     把计划的节奏摊成具体场次、逐条决定「新增 / 更新 / 跳过 / 清理」、
     再交给主程序自己的安排表入口落盘。本层不碰存储，也不画表。 */

  function dateText(d) {
    var p = String(d).split('-');
    return (+p[1]) + '月' + (+p[2]) + '日';
  }
  /* 版本号：没有版本记录的老计划按第 1 版看待，两边口径必须一致，
     否则「安排表落后于计划」的提醒会永远亮着。 */
  function revOf(plan) { return (plan && plan.revision) || 1; }

  /* 一次「编入」的完整意图：先算清楚会动到哪些条目，
     让用户在真正落盘之前就看到规模，而不是点完才发现日程表多了几十条。 */
  function planSync(plan) {
    var b = scheduleBridge();
    if (!b) { return { ok: false, reason: 'noschedule' }; }
    if (!currentPhone()) { return { ok: false, reason: 'nologin' }; }
    if (typeof PL.occurrences !== 'function') { return { ok: false, reason: 'noschedule' }; }
    if (!plan || !plan.id) { return { ok: false, reason: 'noplan' }; }

    var occ = PL.occurrences(plan, {});
    if (!occ.length) { return { ok: false, reason: 'noslot' }; }

    var mine = b.scheduleItems() || [];
    /* 认得出来的老朋友：同一条计划编进来的，编号就是它在这条计划里的门牌号。
       所以今天点、明天再点，同一次对上的还是同一个编号，不会越点越多。 */
    var known = {};
    mine.forEach(function (it) {
      if (it && it.origin === 'plan' && it.planId === plan.id && it.slot != null) {
        known[it.slot] = it;
      }
    });

    /* 占用表：同一天里已经被别的事占掉的时段。
       自己这条计划上一次编进来的条目先摘出去，否则「原地更新」会永远和自己撞上。 */
    var busy = {};
    mine.forEach(function (it) {
      if (it && it.origin === 'plan' && it.planId === plan.id) { return; }
      (busy[it.date] = busy[it.date] || []).push({ s: toMin(it.start), e: toMin(it.end), what: it.project });
    });

    var live = {}, adds = [], moves = [], restamps = [], skipped = [], unchanged = 0;

    occ.forEach(function (o) {
      live[o.index] = 1;
      var span = { s: toMin(o.start), e: toMin(o.end) };
      if (span.e <= span.s) { span.e += 1440; }

      /* 时段被别人占了就不写：宁可少排这一次让用户自己去挪，
         也不把两件事悄悄叠在同一段时间里——那既看不出来，又会让当日负荷算高。 */
      var hit = (busy[o.date] || []).filter(function (t) { return span.s < t.e && t.s < span.e; })[0];
      if (hit) { skipped.push({ date: o.date, start: o.start, end: o.end, with: hit.what }); return; }

      var next = {
        date: o.date, start: o.start, end: o.end,
        project: plan.name, description: sessionText(plan, o),
        planId: plan.id, planRev: revOf(plan), slot: o.index
      };
      var old = known[o.index];
      if (old) {
        next.id = old.id;
        var same = old.date === next.date && old.start === next.start && old.end === next.end &&
          old.project === next.project && old.description === next.description &&
          old.planRev === next.planRev;
        if (same) { unchanged++; return; }
        /* 时间或内容真的改了，才叫「更新」。
           只是计划版本号变了（比如只改了计划标题），对安排表来说一点没动，
           这种只把版本戳刷新一下，不能拿「改成旧时间」这种话去吓用户。 */
        var moved = old.date !== next.date || old.start !== next.start || old.end !== next.end ||
          old.project !== next.project || old.description !== next.description;
        if (moved) { moves.push(next); } else { restamps.push(next); }
      } else {
        adds.push(next);
      }
      /* 同一次编入内部不要自己和自己撞 */
      (busy[o.date] = busy[o.date] || []).push({ s: span.s, e: span.e, what: plan.name });
    });

    /* 上一次编入留下、这一次已经不在计划里的条目：
       留着就会变成日程表里凭空多出来的事，所以列出来一并清掉。 */
    var orphans = [];
    Object.keys(known).forEach(function (k) {
      if (!live[known[k].slot]) { orphans.push(known[k].id); }
    });

    return {
      ok: true, plan: plan, occ: occ,
      adds: adds, moves: moves, restamps: restamps, orphans: orphans,
      skipped: skipped, unchanged: unchanged,
      first: occ[0].date, last: occ[occ.length - 1].date
    };
  }

  /* 安排表那一列「事项明细」写什么：第几次、这次多久、这次做什么 */
  function sessionText(plan, o) {
    var head = '第 ' + (o.index + 1) + ' 次';
    var min = o.sessionMin || plan.sessionMin || 0;
    if (min) { head += '，约 ' + min + ' 分钟'; }
    var steps = (plan.steps || []).slice(0, 3).map(function (s, i) {
      return '第' + (i + 1) + '步：' + (s.title || '');
    }).join('；');
    return steps ? (head + '。' + steps) : head;
  }

  /* 真正落盘。判断都在 planSync 里做完了，这里只负责写。 */
  function applySync(intent) {
    var b = scheduleBridge();
    if (!b) { return { ok: false, reason: 'noschedule' }; }
    var upserts = intent.adds.concat(intent.moves).concat(intent.restamps);
    var r = b.applySchedule(upserts, intent.orphans);
    return r || { ok: false, reason: 'write' };
  }

  function syncWhy(reason) {
    return {
      nologin: '编入安排表需要先登录',
      noschedule: '当前页面没有安排表，请到主程序里操作',
      noplan: '这份计划已经找不到了',
      noslot: '这份计划还没有排好具体时间，先去改一改再编入',
      empty: '没有可以编入的场次',
      write: '安排表写入失败，稍后再试，或者到安排表里手动添加'
    }[reason] || '这次没有编进去，稍后再试';
  }

  function skipDetail(intent) {
    var s = intent.skipped.slice(0, 3).map(function (k) {
      return dateText(k.date) + ' ' + k.start + ' 已经有「' + k.with + '」';
    }).join('；');
    return s + (intent.skipped.length > 3 ? ' 等' : '');
  }

  /* 动手之前把规模说清楚：新增几次、改几次、跳过几次、清掉几条 */
  function syncAsk(intent) {
    var lines = ['把「' + intent.plan.name + '」编进安排表？', ''];
    lines.push('· 计划共 ' + intent.occ.length + ' 次，落在 ' + dateText(intent.first) +
      ' 到 ' + dateText(intent.last) + '。');
    var parts = [];
    if (intent.adds.length) { parts.push('新增 ' + intent.adds.length + ' 次'); }
    if (intent.moves.length) { parts.push('改 ' + intent.moves.length + ' 次的旧时间'); }
    if (intent.unchanged) { parts.push(intent.unchanged + ' 次和现在一样，不动'); }
    if (parts.length) { lines.push('· ' + parts.join('，') + '。'); }
    if (intent.orphans.length) {
      lines.push('· 有 ' + intent.orphans.length + ' 条是上次编入留下的、已经不在计划里了，这次一并清掉。');
    }
    if (intent.skipped.length) {
      lines.push('· 有 ' + intent.skipped.length + ' 次的时间已经被别的事占了，这次跳过：' +
        skipDetail(intent) + '。');
    }
    return lines.join('\n');
  }

  /* 结果用一句话说清楚。只有次数与日期，不含任何字段名与数据结构。 */
  function syncWords(intent, r) {
    var bits = [];
    if (r.added) { bits.push('新增 ' + r.added + ' 次'); }
    if (intent.moves.length) { bits.push('更新 ' + intent.moves.length + ' 次'); }
    if (r.removed) { bits.push('清掉 ' + r.removed + ' 条旧的'); }
    var head = bits.length
      ? ('已编入安排表：' + bits.join('，') + '（' + dateText(intent.first) + ' 起）')
      : ('这 ' + intent.occ.length + ' 次已经在安排表里了，没有重复添加');
    if (intent.skipped.length) {
      head += '；另外 ' + intent.skipped.length + ' 次没排进去：' + skipDetail(intent) +
        '，可以到安排表里把冲突的挪一挪、或者回计划里改时间，再点一次「编入安排表」';
    }
    return head;
  }

  /* 入口：算清楚 → 让用户确认 → 落盘 → 反馈。失败一律给一句人话，不抛错。 */
  function doSyncPlan(plan, opts) {
    opts = opts || {};
    var say = function (t, k) { if (!opts.quiet) { msg(t, k); } };

    var intent = planSync(plan);
    if (!intent.ok) {
      var why = syncWhy(intent.reason);
      say(why, 'warn');
      return { ok: false, reason: intent.reason, words: why };
    }

    /* 安排表这边其实没东西要动——可能只是计划版本号变了（比如只改了标题）。
       版本戳还是要刷新，否则清单会一直提醒「安排表落后了」；
       但不值得为它拦一次确认，也不该跟用户说「改了时间」。 */
    var meaningful = intent.adds.length + intent.moves.length + intent.orphans.length;
    if (!meaningful) {
      if (intent.restamps.length) { applySync(intent); }
      var idle = syncWords(intent, { added: 0, updated: 0, removed: 0 });
      say(idle, 'ok');
      intent.words = idle;
      if (root.PlanEditView && root.PlanEditView.renderSavedList) { root.PlanEditView.renderSavedList(); }
      return intent;
    }

    if (!root.confirm(syncAsk(intent))) {
      return { ok: false, reason: 'cancel', words: '编入安排表这一步先跳过了' };
    }

    var r = applySync(intent);
    if (!r.ok) {
      var err = syncWhy(r.reason);
      say(err, 'warn');
      return { ok: false, reason: r.reason, words: err };
    }

    intent.result = r;
    intent.words = syncWords(intent, r);
    say(intent.words, 'ok');
    if (root.PlanEditView && root.PlanEditView.renderSavedList) { root.PlanEditView.renderSavedList(); }
    return intent;
  }

  /* 这份计划编过没有、编的是不是现在这一版。只回结论，不回原始数据。
     用途：在清单里给一句提醒，让用户知道安排表已经落后于计划了——
     但仍然要他亲手点一下，绝不替他把日程改了。 */
  function syncStateOf(plan) {
    var b = scheduleBridge();
    if (!b || !plan || !plan.id) { return { synced: 0, stale: false }; }
    var mine = b.scheduleItems() || [];
    var n = 0, stale = false, rev = revOf(plan);
    mine.forEach(function (it) {
      if (it && it.origin === 'plan' && it.planId === plan.id) {
        n++;
        if ((it.planRev || 1) !== rev) { stale = true; }
      }
    });
    return { synced: n, stale: stale };
  }

  /* ---------- 初始化 ---------- */
  function init() {
    suggestBox = $('ipSuggest');

    var btnClassify = $('ipClassify');
    if (btnClassify) { btnClassify.onclick = doClassify; }

    var btnExample = $('ipExample');
    if (btnExample) {
      btnExample.onclick = function () {
        $('ipInput').value = '学钢琴\n用 App 学日语\n周末爬山健身\n读一本认知科学书';
      };
    }
    var btnClearInput = $('ipClearInput');
    if (btnClearInput) {
      btnClearInput.onclick = function () { $('ipInput').value = ''; $('ipResults').innerHTML = ''; };
    }

    var ta = $('ipInput');
    if (ta) {
      ta.addEventListener('input', function () { activeIdx = -1; updateSuggest(); });
      ta.addEventListener('focus', updateSuggest);
      ta.addEventListener('blur', function () { root.setTimeout(hideSuggest, 140); });
      ta.addEventListener('keydown', function (e) {
        if (!suggestBox || suggestBox.hidden) { return; }
        var n = suggestBox.children.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, n - 1); highlight(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); highlight(); }
        else if (e.key === 'Enter' && activeIdx >= 0 && suggestBox.children[activeIdx]) {
          e.preventDefault();
          suggestBox.children[activeIdx].dispatchEvent(new MouseEvent('mousedown'));
        } else if (e.key === 'Escape') { hideSuggest(); }
      });
    }

    var search = $('ipSearch');
    if (search) { search.oninput = renderList; }
    var filter = $('ipFilter');
    if (filter) {
      filter.innerHTML = '<option value="">全部类别</option>' + P.categories().map(function (c) {
        return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>';
      }).join('');
      filter.onchange = renderList;
    }

    if (!PL.hasLoadEngine()) {
      var hint = $('ipStorageHint');
      if (hint) { hint.textContent = '提示：完成一次「负荷管理系统」的问卷后，这里的计划会带上负荷评估。'; }
    }
    renderList();
  }

  var API = {
    init: init,
    render: function () { renderList(); updateCount(); },
    /* 供「已保存的计划」清单调用：能不能编、编过没有、以及真的编一次。
       清单那边只调这三个入口，不自己拼安排表的条目、也不自己碰存储。 */
    canSync: function () { return !!scheduleBridge() && !!currentPhone(); },
    syncState: function (plan) { return syncStateOf(plan); },
    syncPlan: function (plan) { return doSyncPlan(plan); }
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  else { root.InterestView = API; }
})(typeof window !== 'undefined' ? window : globalThis);
