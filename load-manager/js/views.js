/* 视图层 —— 欢迎页/活动库(含推荐计划)/活动详情/周负荷看板/设置页，挂在 window.LMS.views */
(function (global) {
  'use strict';

  var LMS = global.LMS;
  var DATA = global.LMS_DATA;
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function $app() { return document.getElementById('app'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var DOMAIN_LABELS = {
    coding: '编程开发', data: '数据分析', language: '语言', design: '设计', writing: '写作',
    music: '音乐', photography: '摄影', history: '历史人文', reading: '阅读'
  };
  // 7 维全称与颜色（UL 为负向分量，用青色）
  var PART_FULL = { IL: '认知门槛', EL: '通道不匹配', ML: '兴趣偏低', TL: '时间不匹配', SL: '切换成本', PL: '产出压力', UL: '挑战不足(负向)' };
  var PART_COLORS = { IL: '#4B9FFF', EL: '#58A6FF', ML: '#D29922', TL: '#F0883E', SL: '#3FB950', PL: '#D29922', UL: '#39C5BB' };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 匹配度梯度着色：高=绿，低=红，用于卡片视觉区分
  // matchOf(66)=100，越接近理想点匹配度越高
  function matchTone(match) {
    if (match >= 85) return { color: '#3FB950', label: '高度匹配', cls: 'match-high' };      // 绿
    if (match >= 70) return { color: '#39C5BB', label: '良好匹配', cls: 'match-good' };       // 青
    if (match >= 55) return { color: '#D29922', label: '一般匹配', cls: 'match-mid' };        // 金
    return { color: '#F85149', label: '匹配偏低', cls: 'match-low' };                         // 红
  }

  // 缓存评分（新版 scoreActivity 只需 person + activity）
  function scoredAll() {
    var person = LMS.store.getPerson() || LMS.store.defaultPerson();
    var map = {};
    DATA.ACTIVITIES.forEach(function (act) {
      map[act.id] = LMS.scoreActivity(person, act);
    });
    return map;
  }

  // ===== 推荐计划生成：3 套不同定位 =====
  function buildPlans(p, scoredMap) {
    var acts = DATA.ACTIVITIES.map(function (a) {
      return { act: a, sc: scoredMap[a.id] };
    });
    var cap = LMS.weeklyCapacity(p);

    // 估算一组 items 的周负荷百分比
    function estLoad(items) {
      var wl = LMS.weeklyLoadPercent(p, items, scoredMap);
      return wl.percent;
    }

    // 计划 A：稳态起步 —— 低负荷活动，周负荷 < 70%
    var lowActs = acts.filter(function (x) { return x.sc.score < 50; })
      .sort(function (a, b) { return a.sc.score - b.sc.score; });
    var planA = { name: '稳态起步', tag: '轻松', tone: '#3FB950',
      desc: '从低负荷活动开始，每天轻松学一点，适合刚开始建立学习习惯。',
      items: [] };
    var hA = 0;
    for (var i = 0; i < lowActs.length && i < 3; i++) {
      var hrs = Math.max(1, Math.round((cap * 0.2) / Math.max(20, lowActs[i].sc.score)));
      planA.items.push({ activityId: lowActs[i].act.id, hours: Math.min(hrs, 2), weekday: i });
      hA += lowActs[i].sc.score * Math.min(hrs, 2);
    }
    planA.why = '这些活动负荷都低于 50 分，凑在一起也不会超载，帮你先形成节奏。';

    // 计划 B：最佳学习区 —— 优先 optimal 区活动，周负荷 80-100%
    var optActs = acts.filter(function (x) { return x.sc.zone.key === 'optimal'; })
      .sort(function (a, b) { return b.sc.match - a.sc.match; });
    if (optActs.length < 2) {
      // 补充接近 optimal 的
      acts.forEach(function (x) {
        if (x.sc.score >= 50 && x.sc.score < 76 && optActs.indexOf(x) < 0) optActs.push(x);
      });
    }
    var planB = { name: '最佳学习区', tag: '高效', tone: '#D29922',
      desc: '优先安排处在最佳学习区的活动，这是你高效学习的甜区。',
      items: [] };
    for (var j = 0; j < optActs.length && j < 3; j++) {
      var hrsB = Math.max(1.5, Math.round((cap * 0.28) / Math.max(40, optActs[j].sc.score)));
      planB.items.push({ activityId: optActs[j].act.id, hours: Math.min(hrsB, 3), weekday: j });
    }
    planB.why = '这些活动的匹配度最高，处在金色最佳学习区，保持当前安排效率最高。';

    // 计划 C：挑战突破 —— 含 1 个 high 区 + 低负荷搭配，周负荷 100-110%
    var highAct = acts.filter(function (x) { return x.sc.zone.key === 'high' || x.sc.score >= 76; })
      .sort(function (a, b) { return b.sc.score - a.sc.score; })[0];
    var planC = { name: '挑战突破', tag: '进阶', tone: '#F0883E',
      desc: '安排一个较高负荷的挑战活动，搭配轻松活动恢复，适合想突破时。',
      items: [] };
    if (highAct) {
      planC.items.push({ activityId: highAct.act.id, hours: 2, weekday: 1 });
      // 搭配 2 个低负荷恢复
      var recover = lowActs.filter(function (x) { return x.act.id !== highAct.act.id; }).slice(0, 2);
      recover.forEach(function (x, idx) {
        planC.items.push({ activityId: x.act.id, hours: 1.5, weekday: idx === 0 ? 3 : 5 });
      });
    }
    planC.why = '高强度活动配低负荷恢复，利用同天惩罚模型自然控制总负荷。';

    return [planA, planB, planC].map(function (ps) {
      ps.loadPercent = estLoad(ps.items);
      return ps;
    });
  }

  var views = {
    // ===== 欢迎页 =====
    welcome: function () {
      var app = $app(); app.innerHTML = '';
      var hero = el('div', 'welcome-hero');
      hero.appendChild(el('h1', '', '学习配速器'));
      hero.appendChild(el('div', 'tagline', '帮你把挑战调到刚好'));
      hero.appendChild(el('p', '', '识别每个学习活动的真实负荷，找到你的最佳学习区，规划一周节奏。纯静态、零依赖、数据本地存储。'));
      var has = LMS.store.hasPerson();
      var btn = el('button', 'btn', has ? '完善我的画像' : '开始问卷（约 5 分钟）');
      btn.onclick = function () { location.hash = '#/quiz'; };
      hero.appendChild(btn);
      if (has) {
        var cont = el('button', 'btn secondary', '查看我的画像');
        cont.style.marginLeft = '8px';
        cont.onclick = function () { location.hash = '#/result'; };
        hero.appendChild(cont);
      }
      app.appendChild(hero);

      var fl = el('div', 'feature-list');
      fl.appendChild(el('div', 'card', '<h3>7 维活动建模</h3><p>认知门槛、通道不匹配、兴趣、时间块、切换、产出压力 + 挑战不足，精确刻画每个活动。</p>'));
      fl.appendChild(el('div', 'card', '<h3>个人化校准</h3><p>基线锚点 + 通道偏好 + 在线反馈，越用越准。</p>'));
      fl.appendChild(el('div', 'card', '<h3>智能处方</h3><p>对每个活动给出拆解、换通道、挪时段等可执行建议。</p>'));
      app.appendChild(fl);
    },

    // ===== 问卷页（委托 quiz；已有画像则回填答案，覆盖更新同一份画像） =====
    quiz: function () {
      var existing = LMS.store.getPerson();
      var done = function () { location.hash = '#/library'; };
      if (existing) { LMS.quiz.continueFrom(existing, done); }
      else { LMS.quiz.start(done); }
    },

    // ===== 结果页 =====
    result: function () {
      var person = LMS.store.getPerson();
      if (!person) { location.hash = '#/quiz'; return; }
      LMS.quiz._renderResultInto(document.getElementById('app'), person);
    },

    // ===== 活动库（含推荐计划区块） =====
    library: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '活动库'));
      app.appendChild(el('p', 'page-sub', '每个活动的负荷分（0-100）与匹配度。点击卡片查看 7 维拆解与建议。'));

      // 画像状态行
      var status = el('div', 'row', '');
      var hasPerson = LMS.store.hasPerson();
      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      if (!hasPerson) {
        status.appendChild(el('span', 'tag', '还没填写问卷，当前按通用默认画像估算'));
        var go = el('button', 'btn sm', '去填写问卷');
        go.onclick = function () { location.hash = '#/quiz'; };
        status.appendChild(go);
      } else {
        status.appendChild(el('span', 'tag', '已按你的画像评分（吃力指数 ' + Math.round(p.baseline) + ' 分）'));
      }
      app.appendChild(status);

      // ===== 推荐计划区块（3 套不同定位） =====
      if (hasPerson) {
        var scoredMap = {};
        DATA.ACTIVITIES.forEach(function (a) { scoredMap[a.id] = LMS.scoreActivity(p, a); });
        var planSets = buildPlans(p, scoredMap);

        app.appendChild(el('hr', 'section-divider'));
        var phead = el('div', 'plan-head');
        phead.appendChild(el('h2', 'section-title', '为你推荐的本周计划'));
        app.appendChild(phead);
        app.appendChild(el('p', 'page-sub', '根据你的画像生成 3 套不同定位的本周计划。每项时长都能改，改完点「采用此计划」一键生效。'));

        var pgrid = el('div', 'grid cols-3');
        planSets.forEach(function (ps) { pgrid.appendChild(makePlanCard(ps, p, scoredMap)); });
        app.appendChild(pgrid);
        app.appendChild(el('div', 'notice', '采用某套计划后，会替换「周负荷」里的本周清单；之后仍可在活动详情页单独增删。'));
      }

      app.appendChild(el('hr', 'section-divider'));
      app.appendChild(el('h2', 'section-title', '全部活动'));

      // 工具栏：排序 + 筛选（统一样式）
      var toolbar = el('div', 'lib-toolbar');
      var sortSel = el('select', 'lib-select'); sortSel.id = 'lib-sort';
      [['match', '按匹配度'], ['score', '按负荷分'], ['interest', '按兴趣']].forEach(function (o) {
        var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; sortSel.appendChild(op);
      });
      sortSel.onchange = function () { renderGrid(); };
      toolbar.appendChild(el('label', 'lib-label', '排序'));
      toolbar.appendChild(sortSel);

      var filterSel = el('select', 'lib-select'); filterSel.id = 'lib-filter';
      [['all', '全部'], ['optimal', '只看最佳学习区'], ['coding', '编程'], ['design', '设计'], ['reading', '阅读'], ['language', '语言'], ['music', '音乐'], ['writing', '写作'], ['photography', '摄影'], ['history', '历史']].forEach(function (o) {
        var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; filterSel.appendChild(op);
      });
      filterSel.onchange = function () { renderGrid(); };
      toolbar.appendChild(el('label', 'lib-label', '筛选'));
      toolbar.appendChild(filterSel);
      app.appendChild(toolbar);

      var gridWrap = el('div', 'act-grid'); gridWrap.id = 'lib-grid';
      app.appendChild(gridWrap);

      function renderGrid() {
        var sortBy = sortSel.value, filterBy = filterSel.value;
        var items = DATA.ACTIVITIES.map(function (act) {
          var sc = LMS.scoreActivity(p, act);
          var dom = p.domains && p.domains[act.domain];
          var I = dom ? (dom.interest != null ? dom.interest : 0.3) : 0.3;
          return { act: act, sc: sc, I: I };
        });
        items = items.filter(function (it) {
          if (filterBy === 'all') return true;
          if (filterBy === 'optimal') return it.sc.zone.key === 'optimal';
          return it.act.domain === filterBy;
        });
        items.sort(function (a, b) {
          if (sortBy === 'score') return b.sc.score - a.sc.score;
          if (sortBy === 'interest') return b.I - a.I;
          return b.sc.match - a.sc.match; // match
        });

        gridWrap.innerHTML = '';
        items.forEach(function (it) {
          gridWrap.appendChild(makeCard(it.act, it.sc));
        });
        if (items.length === 0) {
          gridWrap.appendChild(el('div', 'notice', '没有符合筛选条件的活动。'));
        }
      }
      renderGrid();
    },

    // ===== 活动详情 =====
    activity: function (id) {
      var app = $app(); app.innerHTML = '';
      var act = DATA.ACTIVITIES.filter(function (a) { return a.id === id; })[0];
      if (!act) { app.appendChild(el('div', 'notice', '活动不存在。')); return; }
      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      var sc = LMS.scoreActivity(p, act);
      var rx = LMS.prescriptions(p, act, sc);

      var back = el('button', 'btn ghost sm', '← 返回活动库');
      back.onclick = function () { location.hash = '#/library'; };
      app.appendChild(back);

      // 顶部分数 + 匹配度
      var scoreCard = el('div', 'card');
      var ds = el('div', 'detail-score');
      // 匹配度大字号
      var matchDiv = el('div', '');
      matchDiv.appendChild(el('div', 'match-big', sc.match + '<span class="unit">匹配度</span>'));
      matchDiv.appendChild(el('div', 'match-sub', '负荷分 <b style="color:' + sc.zone.color + '">' + sc.score + '</b> · <span class="tag" style="color:' + sc.zone.color + ';border-color:' + sc.zone.color + '">' + sc.zone.label + '</span>'));
      ds.appendChild(matchDiv);
      var meta = el('div', 'meta');
      meta.innerHTML = '<div>领域：<span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span></div>' +
        '<div style="margin-top:6px">置信度：' + Math.round(sc.confidence * 100) + '%</div>' +
        '<div style="margin-top:6px">原始分：' + sc.raw + ' · 状态修正后：' + sc.stateAdj + '</div>';
      ds.appendChild(meta);
      scoreCard.appendChild(ds);
      app.appendChild(scoreCard);

      // 7 维拆解
      var partsCard = el('div', 'card');
      partsCard.appendChild(el('h3', '', '负荷 7 维拆解'));
      ['IL', 'EL', 'ML', 'TL', 'SL', 'PL', 'UL'].forEach(function (k) {
        var v = sc.parts[k] || 0;
        var row = el('div', 'bar-row' + (k === 'UL' ? ' bar-negative' : ''));
        row.appendChild(el('div', 'bar-label', PART_FULL[k]));
        var track = el('div', 'bar-track');
        var fill = el('div', 'bar-fill'); fill.style.width = (v * 100) + '%'; fill.style.background = PART_COLORS[k];
        track.appendChild(fill); row.appendChild(track);
        row.appendChild(el('div', 'bar-val', Math.round(v * 100) + '%'));
        partsCard.appendChild(row);
      });
      var src = LMS.topContributor(sc.parts);
      partsCard.appendChild(el('div', 'notice', '主要负荷来源：' + src));
      app.appendChild(partsCard);

      // 处方
      var rxCard = el('div', 'card');
      rxCard.appendChild(el('h3', '', '处方建议'));
      rx.forEach(function (r) {
        var c = el('div', 'rx-card');
        c.appendChild(el('div', 'rx-title', r.title));
        c.appendChild(el('div', '', r.text));
        rxCard.appendChild(c);
      });
      app.appendChild(rxCard);

      // 加入本周计划 + 完成反馈
      var planCard = el('div', 'card');
      planCard.appendChild(el('h3', '', '加入本周计划'));
      var row = el('div', 'row', '');
      var hoursInp = el('input'); hoursInp.type = 'number'; hoursInp.min = 0.5; hoursInp.max = 40; hoursInp.step = 0.5; hoursInp.value = 1.5; hoursInp.style.width = '80px';
      row.appendChild(el('label', '', '时长（小时）：'));
      row.appendChild(hoursInp);
      var daySel = el('select');
      [['-1', '不限日期']].concat(WEEKDAYS.map(function (d, i) { return [String(i), d]; })).forEach(function (o) {
        var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; daySel.appendChild(op);
      });
      row.appendChild(el('label', '', '星期：'));
      row.appendChild(daySel);
      var addBtn = el('button', 'btn', '加入本周计划');
      addBtn.onclick = function () {
        var h = parseFloat(hoursInp.value) || 1.5;
        var wd = parseInt(daySel.value, 10);
        LMS.store.addToPlan(act.id, h, wd);
        var n = el('span', 'tag', '已加入 ✓'); n.style.color = 'var(--zone-low)'; n.style.borderColor = 'var(--zone-low)';
        row.appendChild(n);
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1500);
      };
      row.appendChild(addBtn);
      planCard.appendChild(row);

      // 内联反馈
      var fbWrap = el('div', 'feedback-inline');
      fbWrap.appendChild(el('div', 'fb-title', '完成这次活动后，告诉我实际有多累'));
      var fbRow = el('div', 'fb-row');
      var r = el('input'); r.type = 'range'; r.min = 0; r.max = 10; r.value = Math.round(sc.score / 10);
      var v = el('div', 'range-value', r.value);
      r.oninput = function () { v.textContent = r.value; };
      fbRow.appendChild(r);
      fbRow.appendChild(v);
      var submit = el('button', 'btn sm', '提交反馈');
      submit.onclick = function () {
        var observed = +r.value * 10;
        var person = LMS.store.getPerson();
        if (!person) return;
        var lowQuality = !!person.lowQuality;
        var logs = LMS.store.getLogs();
        if (!lowQuality) {
          var newCal = LMS.updateCalibration(person.calibration, sc.raw, observed, logs, false);
          person.calibration = newCal;
          // 更新今日状态指数
          person.stateIndex = LMS.updateStateIndex(person.stateIndex, observed / 100);
          LMS.store.setPerson(person);
        }
        LMS.store.addLog({ activityId: act.id, predicted: sc.score, observed: observed, at: Date.now(), lowQuality: lowQuality });
        fbWrap.innerHTML = '';
        fbWrap.appendChild(el('div', 'fb-title', '已记录反馈 ✓'));
        fbWrap.appendChild(el('div', '', lowQuality ? '（本次注意检查未通过，未更新校准）' : '校准与状态指数已更新，推荐会更准。'));
      };
      fbRow.appendChild(submit);
      fbWrap.appendChild(fbRow);
      planCard.appendChild(fbWrap);

      // 微问卷（首次点击某活动且该 domain 兴趣未设置）
      var needMicro = (!p.domains || !p.domains[act.domain] || p.domains[act.domain].interest == null);
      if (needMicro && !views._microShown) {
        views._microShown = true;
        setTimeout(function () { showMicroQuiz(act, p); }, 300);
      }
      app.appendChild(planCard);
    },

    // ===== 周负荷看板 =====
    dashboard: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '本周负荷看板'));
      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      var plan = LMS.store.getPlan();
      var scored = {};
      DATA.ACTIVITIES.forEach(function (a) { scored[a.id] = LMS.scoreActivity(p, a); });
      var wl = LMS.weeklyLoadPercent(p, plan, scored);

      var ringCard = el('div', 'card');
      var ringWrap = el('div', 'dash-ring');
      ringWrap.appendChild(makeRingSVG(wl.percent, wl.zone.color));
      var meta = el('div', '');
      meta.innerHTML = '<div style="font-size:14px;color:var(--text-dim)">本周负荷</div>' +
        '<div style="font-size:32px;font-weight:800;color:' + wl.zone.color + '">' + wl.percent + '%</div>' +
        '<div style="margin-top:4px"><span class="tag" style="color:' + wl.zone.color + ';border-color:' + wl.zone.color + '">' + wl.zone.label + '</span></div>' +
        '<div style="margin-top:8px;font-size:12px;color:var(--text-dim)">容量上限：' + wl.capacity + ' 分·小时</div>';
      ringWrap.appendChild(meta);
      ringCard.appendChild(ringWrap);
      app.appendChild(ringCard);

      var note = el('div', 'notice');
      var tip = wl.percent < 70 ? '有余量，可以再加一项活动。' :
        wl.percent <= 100 ? '负荷正常，保持当前节奏。' :
        wl.percent <= 110 ? '略偏满，建议适当降载。' :
        '过载，建议移除或缩短本周负荷最高的一项。';
      note.textContent = tip;
      app.appendChild(note);

      // 最高项提醒
      if (plan.length > 0) {
        var topItem = null, topLoad = -1;
        plan.forEach(function (it) {
          var sc = scored[it.activityId];
          var load = sc ? sc.score * (it.hours || 0) : 0;
          if (load > topLoad) { topLoad = load; topItem = it; }
        });
        if (topItem && wl.percent > 100) {
          var act = DATA.ACTIVITIES.filter(function (a) { return a.id === topItem.activityId; })[0];
          if (act) {
            var warn = el('div', 'notice warn');
            warn.textContent = '本周负荷最高的一项是「' + act.name + '」，建议缩短或移除。';
            app.appendChild(warn);
          }
        }
      }

      // 计划清单
      var listCard = el('div', 'card');
      listCard.appendChild(el('h3', '', '本周活动清单（' + plan.length + ' 项）'));
      if (plan.length === 0) {
        listCard.appendChild(el('div', 'notice', '本周还没有计划。去活动库添加吧。'));
      } else {
        plan.forEach(function (it) {
          var act = DATA.ACTIVITIES.filter(function (a) { return a.id === it.activityId; })[0];
          if (!act) return;
          var sc = scored[it.activityId];
          var row = el('div', 'plan-item');
          var dayTxt = it.weekday >= 0 ? WEEKDAYS[it.weekday] : '不限';
          row.innerHTML = '<div class="pi-name">' + esc(act.name) + ' <span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span></div>' +
            '<span class="pi-day">' + dayTxt + '</span>' +
            '<div>' + (it.hours || 0) + ' 小时</div>' +
            '<div class="pi-score" style="color:' + sc.zone.color + '">' + sc.score + ' 分</div>';
          var rm = el('button', 'btn ghost sm', '删除');
          rm.onclick = function () { LMS.store.removeFromPlan(it.activityId); views.dashboard(); };
          row.appendChild(rm);
          listCard.appendChild(row);
        });
      }
      app.appendChild(listCard);

      var cap = el('div', 'notice');
      cap.innerHTML = '容量 = weeklyHours × 50 × (0.7 + 0.6 × recovery) = ' + LMS.weeklyCapacity(p) + '<br>weekLoad = Σ(score × hours × 同天惩罚) / capacity × 100';
      app.appendChild(cap);
    },

    // ===== 设置页 =====
    settings: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '设置'));
      app.appendChild(el('p', 'page-sub', '管理你的画像与系统数据。'));

      var logs = LMS.store.getLogs();
      var card = el('div', 'card');
      card.appendChild(el('h3', '', '学习反馈'));
      card.appendChild(el('div', '', '已学习 <b>' + logs.length + '</b> 次反馈'));
      var hasPerson = LMS.store.hasPerson();
      if (hasPerson) {
        var p = LMS.store.getPerson();
        card.appendChild(el('div', 'notice', '当前校准：k=' + p.calibration.k + '，b=' + p.calibration.b + ' · 状态指数：' + (p.stateIndex != null ? p.stateIndex : 0.6)));
      }
      app.appendChild(card);

      // 画像操作
      var opCard = el('div', 'card');
      opCard.appendChild(el('h3', '', '画像管理'));
      opCard.appendChild(el('p', 'quiz-hint', '每个账号只有一份画像。重新作答会覆盖更新同一份画像，校准与反馈记录会保留。'));
      var refill = el('button', 'btn row', '完善我的画像（重新作答）');
      refill.onclick = function () { location.hash = '#/quiz'; };
      opCard.appendChild(refill);

      var exportBtn = el('button', 'btn secondary row', '导出全部数据');
      exportBtn.onclick = function () {
        var data = LMS.store.exportAll();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = el('a'); a.href = url; a.download = 'lms-all.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      };
      opCard.appendChild(exportBtn);

      var importWrap = el('div', 'row', '');
      importWrap.style.marginTop = '8px';
      var importLabel = el('label', 'btn secondary', '导入数据');
      var importInp = el('input'); importInp.type = 'file'; importInp.accept = '.json'; importInp.style.display = 'none';
      importInp.onchange = function () {
        var f = importInp.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(reader.result);
            LMS.store.importAll(data);
            views.settings();
          } catch (e) { alert('导入失败：文件格式不正确'); }
        };
        reader.readAsText(f);
      };
      importLabel.appendChild(importInp);
      importWrap.appendChild(importLabel);
      opCard.appendChild(importWrap);

      var reset = el('button', 'btn danger row', '重置全部数据');
      reset.style.marginTop = '8px';
      reset.onclick = function () {
        if (confirm('确定重置全部数据？此操作不可恢复。')) {
          LMS.store.resetAll();
          location.hash = '#/welcome';
        }
      };
      opCard.appendChild(reset);
      app.appendChild(opCard);

      // 权重高级（6 维含 PL）
      var wCard = el('div', 'card');
      wCard.appendChild(el('h3', '', '高级：评分权重（6 维，自动归一化）'));
      var config = LMS.store.getConfig();
      var weights = config.weights;
      var weightRows = {};
      ['IL', 'EL', 'ML', 'TL', 'SL', 'PL'].forEach(function (k) {
        var row = el('div', 'weight-row');
        row.appendChild(el('label', '', PART_FULL[k] + ' (' + k + ')'));
        var inp = el('input'); inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.01; inp.value = weights[k] != null ? weights[k] : LMS.WEIGHTS[k];
        var vv = el('span', 'wv', (+inp.value).toFixed(2));
        inp.oninput = function () { vv.textContent = (+inp.value).toFixed(2); normalizeAndSave(); };
        row.appendChild(inp);
        row.appendChild(vv);
        wCard.appendChild(row);
        weightRows[k] = inp;
      });
      function normalizeAndSave() {
        var w2 = {};
        Object.keys(weightRows).forEach(function (k) { w2[k] = +weightRows[k].value; });
        var norm = LMS.normalizeWeights(w2);
        config.weights = norm;
        LMS.store.setConfig(config);
      }
      var saveBtn = el('button', 'btn', '保存权重');
      saveBtn.style.marginTop = '8px';
      saveBtn.onclick = function () { normalizeAndSave(); saveBtn.textContent = '已保存 ✓'; setTimeout(function () { saveBtn.textContent = '保存权重'; }, 1200); };
      wCard.appendChild(saveBtn);
      var resetW = el('button', 'btn ghost sm', '恢复默认权重');
      resetW.style.marginLeft = '8px';
      resetW.onclick = function () {
        config.weights = { IL: 0.26, EL: 0.20, ML: 0.18, TL: 0.14, SL: 0.12, PL: 0.10 };
        LMS.store.setConfig(config);
        views.settings();
      };
      wCard.appendChild(resetW);
      app.appendChild(wCard);

      // 提醒与反馈开关
      var cfgCard = el('div', 'card');
      cfgCard.appendChild(el('h3', '', '提醒与反馈'));
      var fbRow = el('div', 'row');
      var fbLabel = el('label', '', '开启完成反馈校准：');
      fbLabel.style.flex = '1';
      var fbToggle = el('input'); fbToggle.type = 'checkbox'; fbToggle.checked = !!config.feedbackEnabled;
      fbToggle.onchange = function () { config.feedbackEnabled = fbToggle.checked; LMS.store.setConfig(config); };
      fbRow.appendChild(fbLabel); fbRow.appendChild(fbToggle);
      cfgCard.appendChild(fbRow);
      app.appendChild(cfgCard);
    }
  };

  // ===== 活动卡片（匹配度大字号 + 负荷分小字号 + 匹配度梯度着色） =====
  function makeCard(act, sc) {
    var tone = matchTone(sc.match);
    var card = el('div', 'act-card ' + tone.cls);
    card.onclick = function () { location.hash = '#/activity/' + act.id; };
    card.appendChild(el('div', 'act-name', esc(act.name)));
    card.appendChild(el('div', '', '<span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span> ' +
      '<span class="tag match-tag" style="color:' + tone.color + ';border-color:' + tone.color + '">' + tone.label + '</span>'));
    var scoreRow = el('div', 'row');
    var num = el('span', 'act-match'); num.style.color = tone.color; num.textContent = sc.match;
    num.appendChild(el('span', 'unit', ' 匹配'));
    scoreRow.appendChild(num);
    scoreRow.appendChild(el('div', 'spacer', ''));
    scoreRow.appendChild(el('span', 'act-score', sc.score + ' 分 · ' + sc.zone.label));
    card.appendChild(scoreRow);
    var bar = el('div', 'zone-bar');
    var fill = el('div', ''); fill.style.width = sc.score + '%'; fill.style.background = sc.zone.color;
    bar.appendChild(fill); card.appendChild(bar);
    var src = LMS.topContributor(sc.parts);
    card.appendChild(el('div', 'act-source', '主要：' + src));
    card.appendChild(el('div', 'act-conf', '置信度 ' + Math.round(sc.confidence * 100) + '%'));
    return card;
  }

  // ===== 推荐计划卡片 =====
  function makePlanCard(ps, p, scoredMap) {
    var card = el('div', 'card plan-set');

    var head = el('div', 'row');
    head.appendChild(el('h3', '', ps.name));
    head.appendChild(el('div', 'spacer', ''));
    var toneTag = el('span', 'tag', ps.tag);
    toneTag.style.color = ps.tone; toneTag.style.borderColor = ps.tone;
    head.appendChild(toneTag);
    card.appendChild(head);

    card.appendChild(el('p', 'plan-desc', ps.desc));

    var listWrap = el('div', 'plan-items');
    var hourInputs = [];
    ps.items.forEach(function (it) {
      var act = DATA.ACTIVITIES.filter(function (a) { return a.id === it.activityId; })[0];
      if (!act) return;
      var sc = scoredMap[it.activityId];
      var row = el('div', 'plan-item');
      var nameDiv = el('div', 'pi-name');
      nameDiv.innerHTML = esc(act.name) + ' <span class="tag" style="color:' + sc.zone.color + ';border-color:' + sc.zone.color + '">' + sc.score + ' 分</span>';
      row.appendChild(nameDiv);
      var hInp = el('input'); hInp.type = 'number'; hInp.min = 0.5; hInp.max = 14; hInp.step = 0.5; hInp.value = it.hours;
      hInp.onchange = function () { updateLoad(); };
      hourInputs.push({ activityId: it.activityId, weekday: it.weekday, inp: hInp });
      row.appendChild(el('label', '', '小时'));
      row.appendChild(hInp);
      listWrap.appendChild(row);
    });
    card.appendChild(listWrap);

    var loadLine = el('div', 'plan-load');
    card.appendChild(loadLine);

    function currentItems() {
      var out = [];
      hourInputs.forEach(function (h) {
        var v = parseFloat(h.inp.value);
        if (v > 0) out.push({ activityId: h.activityId, hours: v, weekday: h.weekday });
      });
      return out;
    }
    function updateLoad() {
      var wl = LMS.weeklyLoadPercent(p, currentItems(), scoredMap);
      loadLine.innerHTML = '预计本周负荷：<b style="color:' + wl.zone.color + '">' + wl.percent + '%</b> ' +
        '<span class="tag" style="color:' + wl.zone.color + ';border-color:' + wl.zone.color + '">' + wl.zone.label + '</span>';
    }
    updateLoad();

    var adopt = el('button', 'btn', '采用此计划');
    adopt.onclick = function () {
      var items = currentItems();
      if (items.length === 0) { adopt.textContent = '请先填写时长'; setTimeout(function () { adopt.textContent = '采用此计划'; }, 1200); return; }
      LMS.store.setPlan(items);
      adopt.textContent = '已采用 ✓ 去周负荷看看';
      adopt.onclick = function () { location.hash = '#/dashboard'; };
    };
    card.appendChild(adopt);

    card.appendChild(el('div', 'plan-why', '为什么适合你：' + ps.why));
    return card;
  }

  // ===== 环 SVG =====
  function makeRingSVG(percent, color) {
    var r = 50, c = 2 * Math.PI * r;
    var off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    var svg = '<svg width="140" height="140" viewBox="0 0 140 140">' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="#30363D" stroke-width="10"/>' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 70 70)"/>' +
      '<text x="70" y="76" text-anchor="middle" fill="#E6EDF3" font-size="20" font-weight="700">' + Math.round(percent) + '%</text>' +
      '</svg>';
    var wrap = el('div', ''); wrap.innerHTML = svg;
    return wrap.firstChild;
  }

  // ===== 微问卷弹窗 =====
  function showMicroQuiz(act, p) {
    if (document.querySelector('.modal-mask')) return;
    var mask = el('div', 'modal-mask');
    var modal = el('div', 'modal');
    modal.appendChild(el('h3', '', '快速微问卷（20秒）'));
    modal.appendChild(el('p', 'quiz-hint', '为了更准地评估「' + act.name + '」'));

    modal.appendChild(el('div', 'q-text', '你对这个活动的兴趣？'));
    var intSel = el('select');
    for (var i = 1; i <= 5; i++) { var op = el('option', ''); op.value = i; op.textContent = i + ' 分'; intSel.appendChild(op); }
    modal.appendChild(intSel);

    var acts = el('div', 'modal-actions');
    var skip = el('button', 'btn ghost', '跳过');
    skip.onclick = function () { mask.remove(); };
    var save = el('button', 'btn', '保存');
    save.onclick = function () {
      var interest = (+intSel.value - 1) / 4;
      var person = LMS.store.getPerson();
      if (!person) person = LMS.store.defaultPerson();
      if (!person.domains) person.domains = {};
      if (!person.domains[act.domain]) person.domains[act.domain] = { experience: 0.25, interest: interest };
      else person.domains[act.domain].interest = interest;
      if (!person.answered) person.answered = { baseline: false, channel: false, pace: false, structure: false, social: false, domains: false };
      person.answered.domains = true;
      person.confidence = LMS.computeConfidence(person);
      LMS.store.setPerson(person);
      mask.remove();
      views.activity(act.id);
    };
    acts.appendChild(skip); acts.appendChild(save);
    modal.appendChild(acts);
    mask.appendChild(modal);
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
  }

  // 把 quiz 的结果渲染暴露一个适配方法（views.result 调用）
  LMS.quiz._renderResultInto = function (container, person) {
    container.innerHTML = '';
    var wrap = el('div', 'quiz-wrap');
    container.appendChild(wrap);
    wrap.appendChild(el('div', 'quiz-meta', '<span>结果</span><span>画像已生成</span>'));
    var body = el('div', 'quiz-body');
    wrap.appendChild(body);
    LMS.quiz._renderProfile(body, person);
    var acts = el('div', 'quiz-actions');
    var viewLib = el('button', 'btn', '看看为我推荐的计划');
    viewLib.onclick = function () { location.hash = '#/library'; };
    acts.appendChild(viewLib);
    var refine = el('button', 'btn secondary', '再答 4 题，让推荐更准（约 90 秒）');
    refine.onclick = function () { renderExtraStandalone(body, person); };
    acts.appendChild(refine);
    wrap.appendChild(acts);
  };

  function renderExtraStandalone(body, person) {
    body.innerHTML = '';
    body.appendChild(el('h2', 'quiz-screen-title', '精细化画像（可选）'));
    body.appendChild(el('p', 'quiz-hint', '以下 4 题仅微调评分权重，约 90 秒。'));
    var a = { motivation: 0.5, distraction: 0.5, slowTolerance: 0.5, evalAnxiety: 0.5 };

    function slider(label, getter, setter) {
      var q = el('div', 'quiz-question');
      q.appendChild(el('div', 'q-text', label));
      var r = el('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = getter();
      var v = el('div', 'range-value', getter().toFixed(2));
      r.oninput = function () { setter(+r.value); v.textContent = (+r.value).toFixed(2); };
      q.appendChild(r); q.appendChild(v);
      return q;
    }

    body.appendChild(slider('学习动机强度（0=被动 1=主动）', function () { return a.motivation; }, function (v) { a.motivation = v; }));
    body.appendChild(slider('环境干扰程度（0=安静 1=嘈杂）', function () { return a.distraction; }, function (v) { a.distraction = v; }));
    body.appendChild(slider('学得慢容忍度（0=急于求成 1=能耐住性子）', function () { return a.slowTolerance; }, function (v) { a.slowTolerance = v; }));
    body.appendChild(slider('评价焦虑（0=不在意 1=很在意）', function () { return a.evalAnxiety; }, function (v) { a.evalAnxiety = v; }));

    var done = el('button', 'btn', '应用并返回');
    done.style.marginTop = '12px';
    done.onclick = function () {
      var cfg = LMS.store.getConfig();
      var w = cfg.weights;
      var w2 = {
        IL: (w.IL != null ? w.IL : LMS.WEIGHTS.IL) + (a.distraction - 0.5) * 0.04,
        EL: (w.EL != null ? w.EL : LMS.WEIGHTS.EL) + (a.distraction - 0.5) * 0.04,
        ML: (w.ML != null ? w.ML : LMS.WEIGHTS.ML) - (a.motivation - 0.5) * 0.04,
        TL: (w.TL != null ? w.TL : LMS.WEIGHTS.TL) + (a.evalAnxiety - 0.5) * 0.03,
        SL: (w.SL != null ? w.SL : LMS.WEIGHTS.SL) - (a.slowTolerance - 0.5) * 0.03,
        PL: (w.PL != null ? w.PL : LMS.WEIGHTS.PL)
      };
      cfg.weights = LMS.normalizeWeights(w2);
      LMS.store.setConfig(cfg);
      body.innerHTML = '';
      LMS.quiz._renderProfile(body, person);
    };
    body.appendChild(done);
  }

  LMS.views = views;
})(window);
