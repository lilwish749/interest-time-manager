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
  var PART_FULL = { IL: '动脑强度', EL: '学习方式不合拍', ML: '兴趣不够浓', TL: '时间对不上', SL: '来回切换', PL: '要有成果的压力', UL: '太简单没劲(扣分项)' };
  var PART_COLORS = { IL: '#4B9FFF', EL: '#58A6FF', ML: '#D29922', TL: '#F0883E', SL: '#3FB950', PL: '#D29922', UL: '#39C5BB' };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 匹配度 5 级标识：高=绿，低=红，用于卡片视觉区分
  function matchTone(match) {
    if (match >= 85) return { color: '#3FB950', label: '非常合适', cls: 'match-high' };      // 绿
    if (match >= 70) return { color: '#39C5BB', label: '比较合适', cls: 'match-good' };      // 青
    if (match >= 55) return { color: '#D29922', label: '一般',      cls: 'match-mid' };      // 金
    if (match >= 35) return { color: '#F0883E', label: '不太合适',  cls: 'match-low' };      // 橙
    return { color: '#F85149', label: '不合适', cls: 'match-low' };                          // 红
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

  /* ── 周计划的日期小工具（仅用于决定「显示哪一周」，不参与排程计算；
        排程的时间一律由 scheduler.js 按显式传入的 weekStart 算） ── */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function monthDay(s) { return parseInt(s.slice(5, 7), 10) + '月' + parseInt(s.slice(8, 10), 10) + '日'; }
  // 本周一的日期字符串（本地日历日）
  function currentWeekStartStr() {
    var d = new Date();
    var back = (d.getDay() + 6) % 7; // 距上一个周一的天数
    var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
    return mon.getFullYear() + '-' + pad2(mon.getMonth() + 1) + '-' + pad2(mon.getDate());
  }
  // ISO 周序号（第 N 周）
  function isoWeek(dateStr) {
    var d = new Date(Date.UTC(parseInt(dateStr.slice(0, 4), 10), parseInt(dateStr.slice(5, 7), 10) - 1, parseInt(dateStr.slice(8, 10), 10)));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yStart) / 86400000) + 1) / 7);
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

    // 计划 A：轻松起步 —— 省力活动，周负荷 < 70%
    var lowActs = acts.filter(function (x) { return x.sc.score < 50; })
      .sort(function (a, b) { return a.sc.score - b.sc.score; });
    var planA = { name: '轻松起步', tag: '轻松', tone: '#3FB950',
      desc: '从最省力的事情开始，每天轻松学一点，先把学习习惯养起来。',
      items: [] };
    var hA = 0;
    for (var i = 0; i < lowActs.length && i < 3; i++) {
      var hrs = Math.max(1, Math.round((cap * 0.2) / Math.max(20, lowActs[i].sc.score)));
      planA.items.push({ activityId: lowActs[i].act.id, hours: Math.min(hrs, 2), weekday: i });
      hA += lowActs[i].sc.score * Math.min(hrs, 2);
    }
    planA.why = '这些都是对你来说很省力的事，凑在一起也不会累，帮你先把节奏带起来。';

    // 计划 B：难度刚好 —— 优先 optimal 区活动
    var optActs = acts.filter(function (x) { return x.sc.zone.key === 'optimal'; })
      .sort(function (a, b) { return b.sc.match - a.sc.match; });
    if (optActs.length < 2) {
      // 补充接近 optimal 的
      acts.forEach(function (x) {
        if (x.sc.score >= 50 && x.sc.score < 76 && optActs.indexOf(x) < 0) optActs.push(x);
      });
    }
    var planB = { name: '难度刚好', tag: '高效', tone: '#D29922',
      desc: '安排的都是对你来说难度正好的事，学得进去，效率也高。',
      items: [] };
    for (var j = 0; j < optActs.length && j < 3; j++) {
      var hrsB = Math.max(1.5, Math.round((cap * 0.28) / Math.max(40, optActs[j].sc.score)));
      planB.items.push({ activityId: optActs[j].act.id, hours: Math.min(hrsB, 3), weekday: j });
    }
    planB.why = '这些事和你的匹配度最高，保持这样的安排，学习效果最好。';

    // 计划 C：挑战突破 —— 含 1 个 high 区 + 省力活动搭配
    var highAct = acts.filter(function (x) { return x.sc.zone.key === 'high' || x.sc.score >= 76; })
      .sort(function (a, b) { return b.sc.score - a.sc.score; })[0];
    var planC = { name: '挑战突破', tag: '进阶', tone: '#F0883E',
      desc: '挑一件有点难度的事试试，再搭配几件轻松的事缓一缓，适合想突破自己的时候。',
      items: [] };
    if (highAct) {
      planC.items.push({ activityId: highAct.act.id, hours: 2, weekday: 1 });
      // 搭配 2 个低负荷恢复
      var recover = lowActs.filter(function (x) { return x.act.id !== highAct.act.id; }).slice(0, 2);
      recover.forEach(function (x, idx) {
        planC.items.push({ activityId: x.act.id, hours: 1.5, weekday: idx === 0 ? 3 : 5 });
      });
    }
    planC.why = '有点难度的事搭配轻松的事，一张一弛，不容易累过头。';

    // 剔除没有任何安排的方案，保证不出现全部空缺的选项
    return [planA, planB, planC].filter(function (ps) {
      return ps.items && ps.items.length > 0;
    }).map(function (ps) {
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
      hero.appendChild(el('p', '', '看看每件事学起来有多吃力，找到难度刚好的安排，轻松规划一周。不用安装，数据就保存在你自己的电脑上。'));
      var has = LMS.store.hasPerson();
      var btn = el('button', 'btn', has ? '完善我的画像' : '开始问卷（几个小问题）');
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
      fl.appendChild(el('div', 'card', '<h3>每件事都算得准</h3><p>从动脑程度、学习方式、兴趣、时间等各个方面，衡量每件事对你来说有多吃力。</p>'));
      fl.appendChild(el('div', 'card', '<h3>越用越懂你</h3><p>根据你的问卷回答和每次学习后的反馈，不断调整，越用越准。</p>'));
      fl.appendChild(el('div', 'card', '<h3>给你实际可行的建议</h3><p>告诉你怎么拆分任务、换个学法、挪个时段，每一条都能直接照做。</p>'));
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
      app.appendChild(el('p', 'page-sub', '看看每件事对你来说有多吃力、有多合适。点开卡片能看详细分析和建议。'));

      // 画像状态行
      var status = el('div', 'row', '');
      var hasPerson = LMS.store.hasPerson();
      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      if (!hasPerson) {
        status.appendChild(el('span', 'tag', '还没填问卷，先按一般情况估算，填了会更准'));
        var go = el('button', 'btn sm', '去填写问卷');
        go.onclick = function () { location.hash = '#/quiz'; };
        status.appendChild(go);
      } else {
        status.appendChild(el('span', 'tag', '已按你的情况评估每件事的吃力程度'));
      }
      app.appendChild(status);

      // ===== 推荐计划区块（3 套不同定位） =====
      if (hasPerson) {
        var scoredMap = {};
        DATA.ACTIVITIES.forEach(function (a) { scoredMap[a.id] = LMS.scoreActivity(p, a); });
        var planSets = buildPlans(p, scoredMap);

        app.appendChild(el('hr', 'section-divider'));
        if (planSets.length > 0) {
          var phead = el('div', 'plan-head');
          phead.appendChild(el('h2', 'section-title', '为你推荐的本周计划'));
          app.appendChild(phead);
          app.appendChild(el('p', 'page-sub', '根据你的情况准备了 ' + planSets.length + ' 套各有侧重的本周安排。每项时长都能改，改完点「采用此计划」一键生效。'));

          var pgrid = el('div', 'grid cols-3');
          planSets.forEach(function (ps) { pgrid.appendChild(makePlanCard(ps, p, scoredMap)); });
          app.appendChild(pgrid);
          app.appendChild(el('div', 'notice', '采用某套安排后，会替换「本周安排」页面里的清单；之后仍可在活动详情里单独增删。'));
        }
      }

      app.appendChild(el('hr', 'section-divider'));
      app.appendChild(el('h2', 'section-title', '全部活动'));

      // 工具栏：排序 + 筛选（统一样式）
      var toolbar = el('div', 'lib-toolbar');
      var sortSel = el('select', 'lib-select'); sortSel.id = 'lib-sort';
      [['match', '按合适程度'], ['score', '按吃力程度'], ['interest', '按兴趣']].forEach(function (o) {
        var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; sortSel.appendChild(op);
      });
      sortSel.onchange = function () { renderGrid(); };
      toolbar.appendChild(el('label', 'lib-label', '排序'));
      toolbar.appendChild(sortSel);

      var filterSel = el('select', 'lib-select'); filterSel.id = 'lib-filter';
      [['all', '全部'], ['optimal', '只看难度刚好的'], ['coding', '编程'], ['design', '设计'], ['reading', '阅读'], ['language', '语言'], ['music', '音乐'], ['writing', '写作'], ['photography', '摄影'], ['history', '历史']].forEach(function (o) {
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

      // 顶部匹配度等级 + 吃力程度
      var scoreCard = el('div', 'card');
      var ds = el('div', 'detail-score');
      // 匹配度等级大字号
      var tone = matchTone(sc.match);
      var lv = LMS.levelOf(sc.score);
      var matchDiv = el('div', '');
      matchDiv.appendChild(el('div', 'match-big', '<span style="color:' + tone.color + '">' + tone.label + '</span><span class="unit"> 合适程度</span>'));
      matchDiv.appendChild(el('div', 'match-sub', '吃力程度 <b style="color:' + lv.color + '">' + lv.label + '</b>'));
      ds.appendChild(matchDiv);
      var meta = el('div', 'meta');
      meta.innerHTML = '<div>领域：<span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span></div>';
      ds.appendChild(meta);
      scoreCard.appendChild(ds);
      app.appendChild(scoreCard);

      // 吃力原因拆解
      var partsCard = el('div', 'card');
      partsCard.appendChild(el('h3', '', '吃力在哪里？'));
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
      partsCard.appendChild(el('div', 'notice', '最吃力的原因：' + src));
      app.appendChild(partsCard);

      // 建议
      var rxCard = el('div', 'card');
      rxCard.appendChild(el('h3', '', '怎么让它更轻松'));
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
      function tiredWord(v) {
        v = +v;
        if (v <= 2) return '一点也不累';
        if (v <= 4) return '稍微有点累';
        if (v <= 6) return '比较累';
        if (v <= 8) return '很累';
        return '精疲力尽';
      }
      var v = el('div', 'range-value', tiredWord(r.value));
      r.oninput = function () { v.textContent = tiredWord(r.value); };
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
        fbWrap.appendChild(el('div', '', lowQuality ? '（问卷里的认真度小检查没通过，这次就先不自动调整啦）' : '记下啦！推荐会越来越贴合你。'));
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
      app.appendChild(el('h1', 'page-title', '本周安排'));
      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      var plan = LMS.store.getPlan();
      var scored = {};
      DATA.ACTIVITIES.forEach(function (a) { scored[a.id] = LMS.scoreActivity(p, a); });
      // 周负荷只有一个真相：有时间表就按时间表里的实际块算，没时间表才回退。
      // 看板与周计划页共用同一个函数，避免两处各算一遍导致数字打架。
      var tt = LMS.store.getTimetable();
      var ttForWeek = (tt && tt.days && tt.weekStart === currentWeekStartStr()) ? tt : null;
      var wl = LMS.scheduler.computeWeekLoad(p, plan, ttForWeek, scored);
      var wlv = LMS.levelOfPercent(wl.percent);

      var ringCard = el('div', 'card');
      var ringWrap = el('div', 'dash-ring');
      ringWrap.appendChild(makeRingSVG(wlv.label, wlv.color));
      var meta = el('div', '');
      meta.innerHTML = '<div style="font-size:14px;color:var(--text-dim)">这周安排得：</div>' +
        '<div style="font-size:32px;font-weight:800;color:' + wlv.color + '">' + wlv.label + '</div>' +
        '<div style="margin-top:8px;font-size:12px;color:var(--text-dim)">按你每周能学的时间和休息情况自动估算</div>';
      ringWrap.appendChild(meta);
      ringCard.appendChild(ringWrap);
      app.appendChild(ringCard);

      var note = el('div', 'notice');
      var tip = wl.percent < 40 ? '这周还有大把余量，想加就再加一件事。' :
        wl.percent < 70 ? '这周比较宽松，可以再加一件事。' :
        wl.percent <= 100 ? '安排得刚刚好，保持这个节奏。' :
        wl.percent < 120 ? '有点满了，建议减掉或缩短一件事。' :
        '太满了，建议先去掉本周最累的一件事，缓一缓。';
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
            warn.textContent = '本周最累的一项是「' + act.name + '」，建议缩短或移除它。';
            app.appendChild(warn);
          }
        }
      }

      // 计划清单
      var listCard = el('div', 'card');
      listCard.appendChild(el('h3', '', '本周安排清单（' + plan.length + ' 项）'));
      if (plan.length === 0) {
        listCard.appendChild(el('div', 'notice', '本周还没有安排。去活动库添加吧。'));
      } else {
        plan.forEach(function (it) {
          var act = DATA.ACTIVITIES.filter(function (a) { return a.id === it.activityId; })[0];
          if (!act) return;
          var sc = scored[it.activityId];
          var ilv = LMS.levelOf(sc.score);
          var row = el('div', 'plan-item');
          var dayTxt = it.weekday >= 0 ? WEEKDAYS[it.weekday] : '不限';
          row.innerHTML = '<div class="pi-name">' + esc(act.name) + ' <span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span></div>' +
            '<span class="pi-day">' + dayTxt + '</span>' +
            '<div>' + (it.hours || 0) + ' 小时</div>' +
            '<div class="pi-score" style="color:' + ilv.color + '">' + ilv.label + '</div>';
          var rm = el('button', 'btn ghost sm', '删除');
          rm.onclick = function () { LMS.store.removeFromPlan(it.activityId); views.dashboard(); };
          row.appendChild(rm);
          listCard.appendChild(row);
        });
      }
      app.appendChild(listCard);

      var cap = el('div', 'notice');
      cap.textContent = '这个评估会参考你每周能学的时间和休息情况，自动帮你算好，不用自己操心。';
      app.appendChild(cap);
    },

    // ===== 周计划（具体到几点做什么） =====
    week: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '周计划'));
      app.appendChild(el('p', 'page-sub', '具体到几点做什么。时间、顺序、间隔都由本机算，不联网。'));

      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      var plan = LMS.store.getPlan();
      var scored = scoredAll();
      var weekStart = currentWeekStartStr();

      function zoneColor(key) {
        var z = (LMS.ZONES || []).filter(function (x) { return x.key === key; })[0];
        return z ? z.color : '#58A6FF';
      }

      // 生成周计划（纯函数、同步算完，很快，不需要 loading 态）
      function generate() {
        var tt = LMS.scheduler.buildTimetable({
          person: p, activities: DATA.ACTIVITIES, plan: plan,
          availability: LMS.store.getAvailability(), done: LMS.store.getDone(),
          weekStart: weekStart, scored: scored
        });
        // 渲染前必须校验一次，不通过就报错，不许静默渲染
        var errs = LMS.scheduler.validateTimetable(tt);
        if (errs.length > 0) {
          app.innerHTML = '';
          app.appendChild(el('h1', 'page-title', '周计划'));
          app.appendChild(el('div', 'notice warn', '周计划没通过校验，已停止显示：' + errs.slice(0, 3).join('；')));
          return;
        }
        LMS.store.setTimetable(tt);
        views.week();
      }

      // 复制上周：按活动把上一次的安排拿过来，重新跑一遍排程（时间可能和上次不同）
      function copyLastWeek() {
        var old = LMS.store.getTimetable();
        if (!old || !old.days) {
          app.appendChild(el('div', 'notice', '还没有可以复制的周计划，先点「生成周计划」。'));
          return;
        }
        var acc = {};
        old.days.forEach(function (d) {
          (d.blocks || []).forEach(function (b) { acc[b.activityId] = (acc[b.activityId] || 0) + (b.minutes || 0); });
        });
        var ids = Object.keys(acc);
        if (ids.length === 0) {
          app.appendChild(el('div', 'notice', '上一次没有排下任何内容，没法复制。'));
          return;
        }
        var items = ids.map(function (id) {
          var h = Math.max(0.5, Math.round(acc[id] / 60 * 2) / 2); // 取整到 0.5 小时
          return { activityId: id, hours: h, weekday: -1 };
        });
        LMS.store.setPlan(items);
        plan = items;
        generate(); // 不直接搬时间，重新排一遍
      }

      // 导出 .ics：本地时间、不带时区后缀，避免手机端差 8 小时
      function downloadICS(tt) {
        function icsEsc(s) {
          return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
        }
        var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//学习配速器//周计划//CN', 'CALSCALE:GREGORIAN'];
        tt.days.forEach(function (d) {
          var ds = d.date.replace(/-/g, '');
          (d.blocks || []).forEach(function (b) {
            lines.push('BEGIN:VEVENT');
            lines.push('UID:' + ds + 'T' + b.start.replace(':', '') + '00-' + b.activityId + '@xuexipaisuqi');
            lines.push('DTSTART:' + ds + 'T' + b.start.replace(':', '') + '00');
            lines.push('DTEND:' + ds + 'T' + b.end.replace(':', '') + '00');
            lines.push('SUMMARY:' + icsEsc('学习配速器 · ' + b.title));
            lines.push('DESCRIPTION:' + icsEsc('产出：' + (b.deliverable || '') + ' ＋ 提示：' + (b.tip || '')));
            lines.push('END:VEVENT');
          });
        });
        lines.push('END:VCALENDAR');
        var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = el('a'); a.href = url; a.download = 'plan-' + tt.weekStart + '.ics';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }

      // 单个块的渲染（竖向时间轴的一行）
      function renderBlock(day, b, bi) {
        var row = el('div', 'week-block');
        row.style.borderLeftColor = zoneColor(b.zone);
        var time = el('div', 'wb-time', b.start + '–' + b.end);
        row.appendChild(time);
        var body = el('div', 'wb-body');

        var top = el('div', 'wb-top');
        top.appendChild(el('span', 'wb-title', esc(b.title)));
        top.appendChild(el('span', 'tag', '第 ' + b.step + '/' + b.stepTotal + ' 步' + (b.review ? ' · 复习' : '')));
        top.appendChild(el('span', 'spacer', ''));
        top.appendChild(el('span', 'wb-match', '匹配度 ' + b.match));
        var doneBox = el('label', 'wb-done');
        var cb = el('input'); cb.type = 'checkbox';
        cb.checked = LMS.store.isDone(day.date, b.activityId, b.step);
        cb.onchange = function () {
          // 只记录完成情况；这里不弹校准反馈弹窗（校准反馈按每周最多 3 次、寄生在别的流程里）
          if (cb.checked) { LMS.store.markDone(day.date, b.activityId, b.step); row.classList.add('is-done'); }
          else { LMS.store.unmarkDone(day.date, b.activityId, b.step); row.classList.remove('is-done'); }
        };
        if (cb.checked) row.classList.add('is-done');
        doneBox.appendChild(cb);
        doneBox.appendChild(el('span', '', '✓ 完成'));
        top.appendChild(doneBox);
        body.appendChild(top);

        if (b.deliverable) body.appendChild(el('div', 'wb-out', '产出：' + esc(b.deliverable)));
        if (b.tip) body.appendChild(el('div', 'wb-tip', '提示：' + esc(b.tip)));

        var actions = el('div', 'wb-actions');
        var moveBtn = el('button', 'btn ghost sm', '换时间');
        moveBtn.onclick = function () {
          var cur = LMS.store.getTimetable();
          var starts = LMS.scheduler.legalStartsFor({
            timetable: cur, availability: LMS.store.getAvailability(), person: p, scored: scored
          }, day.date, bi);
          if (document.querySelector('.modal-mask')) return;
          var mask = el('div', 'modal-mask');
          var modal = el('div', 'modal');
          modal.appendChild(el('h3', '', '换时间'));
          modal.appendChild(el('p', 'quiz-hint', day.weekday + ' ' + monthDay(day.date) + ' · ' + esc(b.title) + '（' + b.minutes + ' 分钟）'));
          if (starts.length === 0) {
            modal.appendChild(el('div', 'notice', '这一天没有别的合适空位了。'));
          } else {
            var grid = el('div', 'slot-grid');
            starts.forEach(function (s) {
              var sb = el('button', 'btn secondary sm', s);
              sb.onclick = function () {
                var cur2 = LMS.store.getTimetable();
                LMS.scheduler.applyMove({ timetable: cur2, plan: plan, person: p, scored: scored }, day.date, bi, s);
                LMS.store.setTimetable(cur2); // 立刻重算并重绘，顶部百分比跟着变
                mask.remove();
                views.week();
              };
              grid.appendChild(sb);
            });
            modal.appendChild(grid);
          }
          var acts = el('div', 'modal-actions');
          var cancel = el('button', 'btn ghost', '关闭');
          cancel.onclick = function () { mask.remove(); };
          acts.appendChild(cancel);
          modal.appendChild(acts);
          mask.appendChild(modal);
          mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
          document.body.appendChild(mask);
        };
        actions.appendChild(moveBtn);
        body.appendChild(actions);

        row.appendChild(body);
        return row;
      }

      // 状态一：还没有计划 → 引导页
      if (!plan || plan.length === 0) {
        var guide = el('div', 'card');
        guide.appendChild(el('div', 'notice', '还没有安排任何想学的事。先去活动库，把想学的加进本周计划。'));
        var goBtn = el('button', 'btn', '去活动库挑一挑');
        goBtn.onclick = function () { location.hash = '#/library'; };
        guide.appendChild(goBtn);
        app.appendChild(guide);
        return;
      }

      var stored = LMS.store.getTimetable();
      var ttValid = !!(stored && stored.days && stored.weekStart === weekStart);

      // 顶部条：本周负荷 + 剩余容量 + 生成 + 复制上周
      var bar = el('div', 'card week-top');
      var load = LMS.scheduler.computeWeekLoad(p, plan, ttValid ? stored : null, scored);
      var lv = LMS.levelOfPercent(load.percent);
      var loadBox = el('div', 'week-load');
      loadBox.innerHTML = '<div class="week-load-num" style="color:' + lv.color + '">' + Math.round(load.percent) + '%</div>' +
        '<div class="week-load-label">本周负荷：' + lv.label + '</div>' +
        '<div class="week-load-cap">剩余容量约 ' + Math.max(0, Math.round(100 - load.percent)) + '%</div>';
      bar.appendChild(loadBox);
      var barBtns = el('div', 'week-top-btns');
      var genBtn = el('button', 'btn', ttValid ? '重新生成' : '生成周计划');
      genBtn.onclick = generate;
      barBtns.appendChild(genBtn);
      var copyBtn = el('button', 'btn secondary', '复制上周');
      copyBtn.onclick = copyLastWeek;
      barBtns.appendChild(copyBtn);
      bar.appendChild(barBtns);
      app.appendChild(bar);

      // 计划里有、但这份旧时间表里没排到的项：提示重排。
      // 不自动重排，否则会冲掉用户手动「换时间」挪过的位置。
      if (ttValid) {
        var inTT = {}, wasUnsched = {};
        stored.days.forEach(function (d) {
          (d.blocks || []).forEach(function (b) { inTT[b.activityId] = true; });
        });
        (stored.unscheduled || []).forEach(function (u) { wasUnsched[u.activityId] = true; });
        var missing = [];
        plan.forEach(function (it) {
          if (it && it.activityId && !inTT[it.activityId] && !wasUnsched[it.activityId] && missing.indexOf(it.activityId) < 0) {
            missing.push(it.activityId);
          }
        });
        if (missing.length > 0) {
          var names = missing.map(function (id) {
            var a = DATA.ACTIVITIES.filter(function (x) { return x.id === id; })[0];
            return esc(a ? a.name : id);
          });
          app.appendChild(el('div', 'notice warn',
            '本周安排有更新：' + names.slice(0, 3).join('、') + (names.length > 3 ? ' 等 ' + names.length + ' 项' : '') +
            ' 还没排进这份时间表。点上面的「重新生成」重排一下。'));
        }
      }

      // 状态二：有计划但还没时间表 → 一个大按钮
      if (!ttValid) {
        var gen = el('div', 'card week-empty');
        gen.appendChild(el('div', 'week-empty-tip', '点一下就按你填的空档时间排好，很快，不用等，也不联网。'));
        var bigBtn = el('button', 'btn week-big-btn', '生成周计划');
        bigBtn.onclick = generate;
        gen.appendChild(bigBtn);
        app.appendChild(gen);
        return;
      }

      // 渲染前再校验一次，不通过就报错，不静默渲染
      var errs2 = LMS.scheduler.validateTimetable(stored);
      if (errs2.length > 0) {
        app.appendChild(el('div', 'notice warn', '周计划数据有问题，已停止显示：' + errs2.slice(0, 3).join('；')));
        return;
      }

      // 周标题
      app.appendChild(el('div', 'week-title',
        monthDay(stored.days[0].date) + ' – ' + monthDay(stored.days[6].date) + ' · 第 ' + isoWeek(stored.weekStart) + ' 周'));

      var totalBlocks = stored.days.reduce(function (s, d) { return s + d.blocks.length; }, 0);
      if (totalBlocks === 0) {
        app.appendChild(el('div', 'notice warn', '本周排不下，建议减少计划量，或去设置里加多一点空档时间。'));
      }

      // 七天的卡片
      var dayWrap = el('div', 'week-days');
      stored.days.forEach(function (day) {
        var card = el('div', 'week-day');
        card.appendChild(el('div', 'week-day-head', day.weekday + ' ' + monthDay(day.date) + ' · ' + day.totalMinutes + ' 分钟'));
        if (day.blocks.length === 0) {
          card.appendChild(el('div', 'week-rest', '留白'));
        } else {
          var bl = el('div', 'week-blocks');
          day.blocks.forEach(function (b, bi) { bl.appendChild(renderBlock(day, b, bi)); });
          card.appendChild(bl);
        }
        dayWrap.appendChild(card);
      });
      app.appendChild(dayWrap);

      // 没排下的活动（折叠区）
      if (stored.unscheduled && stored.unscheduled.length > 0) {
        var us = el('details', 'week-unsched');
        us.appendChild(el('summary', '', '没排下的 ' + stored.unscheduled.length + ' 项（点开看看）'));
        stored.unscheduled.forEach(function (u) {
          var act = DATA.ACTIVITIES.filter(function (a) { return a.id === u.activityId; })[0];
          var row = el('div', 'week-unsched-row');
          row.appendChild(el('div', 'week-unsched-name', (act ? act.name : u.activityId) + ' · ' + (u.reason || '')));
          var less = el('button', 'btn secondary sm', '减到 1 次试试');
          less.onclick = function () {
            plan = plan.map(function (it) {
              return it.activityId === u.activityId ? { activityId: it.activityId, hours: 0.5, weekday: it.weekday } : it;
            });
            LMS.store.setPlan(plan);
            generate();
          };
          row.appendChild(less);
          us.appendChild(row);
        });
        app.appendChild(us);
      }

      if (stored.warnings && stored.warnings.length > 0) {
        app.appendChild(el('div', 'notice', stored.warnings.join('；')));
      }

      // 底部：导出 .ics / 打印
      var foot = el('div', 'week-foot');
      var ics = el('button', 'btn secondary row', '导出 .ics');
      ics.onclick = function () { downloadICS(stored); };
      foot.appendChild(ics);
      var printBtn = el('button', 'btn secondary row', '打印');
      printBtn.onclick = function () { window.print(); };
      foot.appendChild(printBtn);
      app.appendChild(foot);
    },

    // ===== 设置页 =====
    settings: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '设置'));
      app.appendChild(el('p', 'page-sub', '管理你的画像与系统数据。'));

      var logs = LMS.store.getLogs();
      var card = el('div', 'card');
      card.appendChild(el('h3', '', '学习反馈'));
      card.appendChild(el('div', '', '你已经完成了 <b>' + logs.length + '</b> 次学习反馈'));
      var hasPerson = LMS.store.hasPerson();
      if (hasPerson) {
        card.appendChild(el('div', 'notice', '系统会根据你的反馈自动微调，用得越多，推荐越懂你。'));
      }
      app.appendChild(card);

      // 画像操作
      var opCard = el('div', 'card');
      opCard.appendChild(el('h3', '', '画像管理'));
      opCard.appendChild(el('p', 'quiz-hint', '你只有一份学习画像。重新作答会更新这份画像，之前的反馈记录会保留。'));
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
      wCard.appendChild(el('h3', '', '高级设置：哪些因素对你影响更大'));
      var config = LMS.store.getConfig();
      var weights = config.weights;
      var weightRows = {};
      ['IL', 'EL', 'ML', 'TL', 'SL', 'PL'].forEach(function (k) {
        var row = el('div', 'weight-row');
        row.appendChild(el('label', '', PART_FULL[k]));
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
      var saveBtn = el('button', 'btn', '保存调整');
      saveBtn.style.marginTop = '8px';
      saveBtn.onclick = function () { normalizeAndSave(); saveBtn.textContent = '已保存 ✓'; setTimeout(function () { saveBtn.textContent = '保存调整'; }, 1200); };
      wCard.appendChild(saveBtn);
      var resetW = el('button', 'btn ghost sm', '恢复默认');
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
      var fbLabel = el('label', '', '完成学习后记录反馈（让推荐越用越准）：');
      fbLabel.style.flex = '1';
      var fbToggle = el('input'); fbToggle.type = 'checkbox'; fbToggle.checked = !!config.feedbackEnabled;
      fbToggle.onchange = function () { config.feedbackEnabled = fbToggle.checked; LMS.store.setConfig(config); };
      fbRow.appendChild(fbLabel); fbRow.appendChild(fbToggle);
      cfgCard.appendChild(fbRow);
      app.appendChild(cfgCard);

      // ===== 「我的时间」：周计划排到哪些时间段 =====
      var avCard = el('div', 'card');
      avCard.appendChild(el('h3', '', '我的时间'));
      avCard.appendChild(el('p', 'page-sub', '告诉系统你平时哪些时间有空学习，排周计划时会只用这些时间。留白的星期不会被安排任何内容。'));
      var avail = LMS.store.getAvailability();

      function saveAvail() { LMS.store.setAvailability(avail); }

      // 一组时段（工作日 / 周末）
      function segEditor(title, key) {
        var box = el('div', 'avail-group');
        box.appendChild(el('div', 'avail-title', title));
        var listBox = el('div', '');
        box.appendChild(listBox);
        function redrawSegs() {
          listBox.innerHTML = '';
          (avail[key] || []).forEach(function (seg, i) {
            var row = el('div', 'avail-row');
            var s = el('input'); s.type = 'time'; s.value = seg.start;
            var dash = el('span', 'avail-dash', '—');
            var e2 = el('input'); e2.type = 'time'; e2.value = seg.end;
            s.onchange = function () { seg.start = s.value; saveAvail(); };
            e2.onchange = function () { seg.end = e2.value; saveAvail(); };
            var del = el('button', 'btn ghost sm', '删除');
            del.onclick = function () { avail[key].splice(i, 1); saveAvail(); redrawSegs(); };
            row.appendChild(s); row.appendChild(dash); row.appendChild(e2); row.appendChild(del);
            listBox.appendChild(row);
          });
          if ((avail[key] || []).length === 0) {
            listBox.appendChild(el('div', 'avail-empty', '没有可用的时间段，这段时间不会排任何内容。'));
          }
        }
        var addBtn = el('button', 'btn secondary sm', '＋ 加一段时间');
        addBtn.onclick = function () {
          if (!avail[key]) avail[key] = [];
          avail[key].push({ start: '20:00', end: '21:00' });
          saveAvail(); redrawSegs();
        };
        box.appendChild(addBtn);
        redrawSegs();
        return box;
      }

      avCard.appendChild(segEditor('工作日（周一至周五）', 'workday'));
      avCard.appendChild(segEditor('周末（周六、周日）', 'weekend'));

      var restBox = el('div', 'avail-group');
      restBox.appendChild(el('div', 'avail-title', '留白日（这一天不排任何内容）'));
      var restRow = el('div', 'avail-rest');
      ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach(function (name) {
        var lb = el('label', 'avail-rest-item');
        var cb = el('input'); cb.type = 'checkbox';
        cb.checked = (avail.restDay || []).indexOf(name) >= 0;
        cb.onchange = function () {
          var idx = avail.restDay.indexOf(name);
          if (cb.checked && idx < 0) avail.restDay.push(name);
          if (!cb.checked && idx >= 0) avail.restDay.splice(idx, 1);
          saveAvail();
        };
        lb.appendChild(cb);
        var txt = el('span', '', name);
        lb.appendChild(txt);
        restRow.appendChild(lb);
      });
      restBox.appendChild(restRow);
      avCard.appendChild(restBox);
      app.appendChild(avCard);
    }
  };

  // ===== 活动卡片（合适程度 5 级 + 吃力程度 5 级 + 梯度着色） =====
  function makeCard(act, sc) {
    var tone = matchTone(sc.match);
    var lv = LMS.levelOf(sc.score);
    var card = el('div', 'act-card ' + tone.cls);
    card.onclick = function () { location.hash = '#/activity/' + act.id; };
    card.appendChild(el('div', 'act-name', esc(act.name)));
    card.appendChild(el('div', '', '<span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span> ' +
      '<span class="tag match-tag" style="color:' + tone.color + ';border-color:' + tone.color + '">' + tone.label + '</span>'));
    var scoreRow = el('div', 'row');
    var num = el('span', 'act-match'); num.style.color = tone.color; num.textContent = tone.label;
    scoreRow.appendChild(num);
    scoreRow.appendChild(el('div', 'spacer', ''));
    scoreRow.appendChild(el('span', 'act-score', '吃力程度：' + lv.label));
    card.appendChild(scoreRow);
    var bar = el('div', 'zone-bar');
    var fill = el('div', ''); fill.style.width = sc.score + '%'; fill.style.background = lv.color;
    bar.appendChild(fill); card.appendChild(bar);
    var src = LMS.topContributor(sc.parts);
    card.appendChild(el('div', 'act-source', '最吃力的：' + src));
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
      var ilv = LMS.levelOf(sc.score);
      var row = el('div', 'plan-item');
      var nameDiv = el('div', 'pi-name');
      nameDiv.innerHTML = esc(act.name) + ' <span class="tag" style="color:' + ilv.color + ';border-color:' + ilv.color + '">' + ilv.label + '</span>';
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
      var lv = LMS.levelOfPercent(wl.percent);
      loadLine.innerHTML = '这样安排，这周会：<b style="color:' + lv.color + '">' + lv.label + '</b>';
    }
    updateLoad();

    var adopt = el('button', 'btn', '采用此计划');
    adopt.onclick = function () {
      var items = currentItems();
      if (items.length === 0) { adopt.textContent = '请先填写时长'; setTimeout(function () { adopt.textContent = '采用此计划'; }, 1200); return; }
      LMS.store.setPlan(items);
      adopt.textContent = '已采用 ✓ 去本周安排看看';
      adopt.onclick = function () { location.hash = '#/dashboard'; };
    };
    card.appendChild(adopt);

    card.appendChild(el('div', 'plan-why', '为什么适合你：' + ps.why));
    return card;
  }

  // ===== 环 SVG（中心显示 5 级标识文字） =====
  function makeRingSVG(levelText, color) {
    var r = 50, c = 2 * Math.PI * r;
    var svg = '<svg width="140" height="140" viewBox="0 0 140 140">' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="#30363D" stroke-width="10"/>' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="0" transform="rotate(-90 70 70)"/>' +
      '<text x="70" y="76" text-anchor="middle" fill="' + color + '" font-size="17" font-weight="700">' + levelText + '</text>' +
      '</svg>';
    var wrap = el('div', ''); wrap.innerHTML = svg;
    return wrap.firstChild;
  }

  // ===== 微问卷弹窗 =====
  function showMicroQuiz(act, p) {
    if (document.querySelector('.modal-mask')) return;
    var mask = el('div', 'modal-mask');
    var modal = el('div', 'modal');
    modal.appendChild(el('h3', '', '快速小问题'));
    modal.appendChild(el('p', 'quiz-hint', '为了更准确地评估「' + act.name + '」'));

    modal.appendChild(el('div', 'q-text', '你对这件事的兴趣有多大？'));
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
    var refine = el('button', 'btn secondary', '再答 4 个小问题，让推荐更准');
    refine.onclick = function () { renderExtraStandalone(body, person); };
    acts.appendChild(refine);
    wrap.appendChild(acts);
  };

  function renderExtraStandalone(body, person) {
    body.innerHTML = '';
    body.appendChild(el('h2', 'quiz-screen-title', '让推荐更准（可选）'));
    body.appendChild(el('p', 'quiz-hint', '下面 4 个小问题帮我们更懂你，大概 1 分半。'));
    var a = { motivation: 0.5, distraction: 0.5, slowTolerance: 0.5, evalAnxiety: 0.5 };

    function slider(label, getter, setter) {
      var q = el('div', 'quiz-question');
      q.appendChild(el('div', 'q-text', label));
      var r = el('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = getter();
      r.oninput = function () { setter(+r.value); };
      q.appendChild(r);
      return q;
    }

    body.appendChild(slider('你学习的劲头（左=比较被动，右=劲头十足）', function () { return a.motivation; }, function (v) { a.motivation = v; }));
    body.appendChild(slider('周围环境（左=很安静，右=很吵闹）', function () { return a.distraction; }, function (v) { a.distraction = v; }));
    body.appendChild(slider('学得慢的时候（左=容易着急，右=能沉住气）', function () { return a.slowTolerance; }, function (v) { a.slowTolerance = v; }));
    body.appendChild(slider('怕被别人评价（左=不在意，右=很在意）', function () { return a.evalAnxiety; }, function (v) { a.evalAnxiety = v; }));

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
