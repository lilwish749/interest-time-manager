/* 视图层 —— 欢迎页/活动库/活动详情/周负荷看板/设置页，挂在 window.LMS.views */
(function (global) {
  'use strict';

  var LMS = global.LMS;
  var DATA = global.LMS_DATA;
  var el = LMS.views_el || function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  function $app() { return document.getElementById('app'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var DOMAIN_LABELS = {
    coding: '编程开发', data: '数据分析', language: '语言', design: '设计', writing: '写作',
    music: '音乐', photography: '摄影', history: '历史人文', reading: '阅读'
  };
  var PART_FULL = { IL: '内在认知', EL: '外在环境', ML: '动机兴趣', TL: '时间块', SL: '切换成本' };
  var PART_COLORS = { IL: '#4B9FFF', EL: '#58A6FF', ML: '#D29922', TL: '#F0883E', SL: '#3FB950' };

  // 缓存评分
  function scoredAll() {
    var person = LMS.store.getPerson() || LMS.store.defaultPerson();
    var config = LMS.store.getConfig();
    var map = {};
    DATA.ACTIVITIES.forEach(function (act) {
      map[act.id] = LMS.engine.scoreActivity(person, act, config);
    });
    return map;
  }

  var views = {
    // ===== 欢迎页 =====
    welcome: function () {
      var app = $app(); app.innerHTML = '';
      var hero = el('div', 'welcome-hero');
      hero.appendChild(el('h1', '', '兴趣学习负荷管理系统'));
      hero.appendChild(el('p', '', '帮你识别每个学习活动的真实负荷，找到最佳学习区，规划一周节奏。纯静态、零依赖、数据本地存储。'));
      var has = LMS.store.hasPerson();
      var btn = el('button', 'btn', has ? '重新填写问卷' : '开始问卷（约 5 分钟）');
      btn.onclick = function () { location.hash = '#/quiz'; };
      hero.appendChild(btn);
      if (has) {
        var cont = el('button', 'btn secondary', '继续查看我的画像');
        cont.style.marginLeft = '8px';
        cont.onclick = function () { location.hash = '#/result'; };
        hero.appendChild(cont);
      }
      app.appendChild(hero);

      var fl = el('div', 'feature-list');
      fl.appendChild(el('div', 'card', '<h3>📊 8 轴活动建模</h3><p>认知强度、知识门槛、社交需求等 8 维度精确刻画每个活动。</p>'));
      fl.appendChild(el('div', 'card', '<h3>🎯 个人化校准</h3><p>基线锚点 + 通道偏好 + 在线反馈，越用越准。</p>'));
      fl.appendChild(el('div', 'card', '<h3>💡 智能处方</h3><p>对每个活动给出拆解、换通道、挪时段等可执行建议。</p>'));
      app.appendChild(fl);
    },

    // ===== 问卷页（委托 quiz） =====
    quiz: function () {
      LMS.quiz.start(function () { location.hash = '#/library'; });
    },

    // ===== 结果页 =====
    result: function () {
      var person = LMS.store.getPerson();
      if (!person) { location.hash = '#/quiz'; return; }
      LMS.quiz._renderResultInto(document.getElementById('app'), person);
    },

    // ===== 活动库 =====
    library: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '活动库'));
      app.appendChild(el('p', 'page-sub', '每个活动的负荷分（0-100）与区间。点击卡片查看拆解与处方。'));

      // 演示按钮
      var demo = el('div', 'row', '');
      var da = el('button', 'btn secondary sm', '载入画像 A');
      da.onclick = function () {
        LMS.store.setPerson(JSON.parse(JSON.stringify(DATA.DEMO_PROFILE_A)));
        views.library();
      };
      var db = el('button', 'btn secondary sm', '载入画像 B');
      db.onclick = function () {
        LMS.store.setPerson(JSON.parse(JSON.stringify(DATA.DEMO_PROFILE_B)));
        views.library();
      };
      demo.appendChild(da); demo.appendChild(db);

      var hasPerson = LMS.store.hasPerson();
      if (!hasPerson) {
        demo.appendChild(el('span', 'tag', '尚未填写画像，使用默认画像'));
      } else {
        demo.appendChild(el('span', 'tag', '当前：' + (person().baseline) + ' 分基线'));
      }
      app.appendChild(demo);

      // 工具栏：排序 + 筛选
      var toolbar = el('div', 'row', '');
      toolbar.style.marginTop = '10px';
      var sortSel = el('select'); sortSel.id = 'lib-sort';
      [['score', '按负荷分'], ['interest', '按兴趣'], ['rx', '按处方优先级']].forEach(function (o) {
        var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; sortSel.appendChild(op);
      });
      sortSel.onchange = function () { renderGrid(); };
      toolbar.appendChild(el('label', '', '排序：'));
      toolbar.appendChild(sortSel);

      var filterSel = el('select'); filterSel.id = 'lib-filter';
      [['all', '全部'], ['optimal', '只看最佳学习区'], ['coding', '编程'], ['design', '设计'], ['reading', '阅读'], ['language', '语言'], ['music', '音乐'], ['writing', '写作'], ['photography', '摄影'], ['history', '历史']].forEach(function (o) {
        var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; filterSel.appendChild(op);
      });
      filterSel.onchange = function () { renderGrid(); };
      toolbar.appendChild(el('label', '', '筛选：'));
      toolbar.appendChild(filterSel);
      app.appendChild(toolbar);

      var gridWrap = el('div', 'act-grid'); gridWrap.id = 'lib-grid';
      app.appendChild(gridWrap);

      function person() { return LMS.store.getPerson() || LMS.store.defaultPerson(); }

      function renderGrid() {
        var p = person();
        var config = LMS.store.getConfig();
        var sortBy = sortSel.value, filterBy = filterSel.value;
        var items = DATA.ACTIVITIES.map(function (act) {
          var sc = LMS.engine.scoreActivity(p, act, config);
          var dom = p.domains && p.domains[act.domain];
          var I = dom ? (dom.interest != null ? dom.interest : 0.3) : 0.3;
          var rx = LMS.engine.prescriptions(p, act, sc, config);
          return { act: act, sc: sc, I: I, rx: rx };
        });
        // 筛选
        items = items.filter(function (it) {
          if (filterBy === 'all') return true;
          if (filterBy === 'optimal') return it.sc.zone.key === 'optimal';
          return it.act.domain === filterBy;
        });
        // 排序
        items.sort(function (a, b) {
          if (sortBy === 'score') return b.sc.score - a.sc.score;
          if (sortBy === 'interest') return b.I - a.I;
          // rx 优先级：处方条数多者靠前
          return b.rx.length - a.rx.length || b.sc.score - a.sc.score;
        });

        gridWrap.innerHTML = '';
        items.forEach(function (it) {
          gridWrap.appendChild(makeCard(it.act, it.sc, it.rx, p, config));
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
      var config = LMS.store.getConfig();
      var sc = LMS.engine.scoreActivity(p, act, config);
      var rx = LMS.engine.prescriptions(p, act, sc, config);

      var back = el('button', 'btn ghost sm', '← 返回活动库');
      back.onclick = function () { location.hash = '#/library'; };
      app.appendChild(back);

      // 顶部分数
      var scoreCard = el('div', 'card');
      var ds = el('div', 'detail-score');
      var num = el('div', 'num'); num.style.color = sc.zone.color;
      num.textContent = sc.score;
      ds.appendChild(num);
      var unit = el('span', 'unit', '分');
      unit.style.color = sc.zone.color;
      num.appendChild(unit);
      var meta = el('div', 'meta');
      meta.innerHTML = '<div><span class="tag" style="color:' + sc.zone.color + ';border-color:' + sc.zone.color + '">' + sc.zone.label + '</span></div>' +
        '<div style="margin-top:6px">领域：<span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span></div>' +
        '<div style="margin-top:6px">置信度：' + Math.round(sc.confidence * 100) + '%</div>' +
        '<div style="margin-top:6px">原始分：' + sc.raw + '</div>';
      ds.appendChild(meta);
      scoreCard.appendChild(ds);
      app.appendChild(scoreCard);

      // 五维拆解
      var partsCard = el('div', 'card');
      partsCard.appendChild(el('h3', '', '负荷五维拆解'));
      ['IL', 'EL', 'ML', 'TL', 'SL'].forEach(function (k) {
        var v = sc.parts[k];
        var row = el('div', 'bar-row');
        row.appendChild(el('div', 'bar-label', PART_FULL[k]));
        var track = el('div', 'bar-track');
        var fill = el('div', 'bar-fill'); fill.style.width = (v * 100) + '%'; fill.style.background = PART_COLORS[k];
        track.appendChild(fill); row.appendChild(track);
        row.appendChild(el('div', 'bar-val', Math.round(v * 100) + '%'));
        partsCard.appendChild(row);
      });
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

      // 加入本周计划
      var planCard = el('div', 'card');
      planCard.appendChild(el('h3', '', '加入本周计划'));
      var row = el('div', 'row', '');
      var hoursInp = el('input'); hoursInp.type = 'number'; hoursInp.min = 0.5; hoursInp.max = 40; hoursInp.step = 0.5; hoursInp.value = 1.5; hoursInp.style.width = '80px';
      row.appendChild(el('label', '', '时长（小时）：'));
      row.appendChild(hoursInp);
      var addBtn = el('button', 'btn', '加入本周计划');
      addBtn.onclick = function () {
        var h = parseFloat(hoursInp.value) || 1.5;
        LMS.store.addToPlan(act.id, h);
        var n = el('span', 'tag', '已加入 ✓'); n.style.color = 'var(--zone-low)'; n.style.borderColor = 'var(--zone-low)';
        row.appendChild(n);
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1500);
      };
      row.appendChild(addBtn);
      planCard.appendChild(row);

      // 完成反馈
      var doneBtn = el('button', 'btn secondary', '我完成了这次活动');
      doneBtn.style.marginTop = '12px';
      doneBtn.onclick = function () { showFeedbackModal(act, sc); };
      planCard.appendChild(doneBtn);

      // 微问卷（首次点击某活动）—— 若该 domain 兴趣未设置，弹微问卷
      var needMicro = (!p.domains || !p.domains[act.domain] || p.domains[act.domain].interest == null);
      if (needMicro && !views._microShown) {
        views._microShown = true;
        // 进入页面后稍后弹
        setTimeout(function () { showMicroQuiz(act, p); }, 300);
      }
      app.appendChild(planCard);
    },

    // ===== 周负荷看板 =====
    dashboard: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '本周负荷看板'));
      var p = LMS.store.getPerson() || LMS.store.defaultPerson();
      var config = LMS.store.getConfig();
      var plan = LMS.store.getPlan();
      var scored = {};
      DATA.ACTIVITIES.forEach(function (a) { scored[a.id] = LMS.engine.scoreActivity(p, a, config); });
      var wl = LMS.engine.weeklyLoadPercent(p, plan, scored, config);

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

      // 说明
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
          row.innerHTML = '<div class="pi-name">' + esc(act.name) + ' <span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span></div>' +
            '<div>' + (it.hours || 0) + ' 小时</div>' +
            '<div class="pi-score" style="color:' + sc.zone.color + '">' + sc.score + ' 分</div>';
          var rm = el('button', 'btn ghost sm', '删除');
          rm.onclick = function () { LMS.store.removeFromPlan(it.activityId); views.dashboard(); };
          row.appendChild(rm);
          listCard.appendChild(row);
        });
      }
      app.appendChild(listCard);

      // 容量说明
      var cap = el('div', 'notice');
      cap.innerHTML = '容量 = weeklyHours × 50 × (0.7 + 0.6 × recovery) = ' + LMS.engine.weeklyCapacity(p) + '<br>weekLoad = Σ(score × hours) / capacity × 100';
      app.appendChild(cap);
    },

    // ===== 设置页 =====
    settings: function () {
      var app = $app(); app.innerHTML = '';
      app.appendChild(el('h1', 'page-title', '设置'));
      app.appendChild(el('p', 'page-sub', '管理你的画像与系统数据。'));

      // 反馈计数
      var logs = LMS.store.getLogs();
      var card = el('div', 'card');
      card.appendChild(el('h3', '', '学习反馈'));
      card.appendChild(el('div', '', '已学习 <b>' + logs.length + '</b> 次反馈'));
      var hasPerson = LMS.store.hasPerson();
      if (hasPerson) {
        var p = LMS.store.getPerson();
        card.appendChild(el('div', 'notice', '当前校准：k=' + p.calibration.k + '，b=' + p.calibration.b));
      }
      app.appendChild(card);

      // 画像操作
      var opCard = el('div', 'card');
      opCard.appendChild(el('h3', '', '画像管理'));
      var refill = el('button', 'btn row', '重新填写问卷');
      refill.onclick = function () { location.hash = '#/quiz'; };
      opCard.appendChild(refill);

      var exportBtn = el('button', 'btn secondary row', '导出 person.json');
      exportBtn.onclick = function () {
        var data = LMS.store.exportAll();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = el('a'); a.href = url; a.download = 'lms-person.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      };
      opCard.appendChild(exportBtn);

      var importWrap = el('div', 'row', '');
      importWrap.style.marginTop = '8px';
      var importLabel = el('label', 'btn secondary', '导入 person.json');
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

      // 权重高级
      var wCard = el('div', 'card');
      wCard.appendChild(el('h3', '', '高级：评分权重（自动归一化）'));
      var config = LMS.store.getConfig();
      var weights = config.weights;
      var weightRows = {};
      ['IL', 'EL', 'ML', 'TL', 'SL'].forEach(function (k) {
        var row = el('div', 'weight-row');
        row.appendChild(el('label', '', PART_FULL[k] + ' (' + k + ')'));
        var inp = el('input'); inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.01; inp.value = weights[k];
        var vv = el('span', 'wv', weights[k].toFixed(2));
        inp.oninput = function () { vv.textContent = (+inp.value).toFixed(2); normalizeAndSave(); };
        row.appendChild(inp);
        row.appendChild(vv);
        wCard.appendChild(row);
        weightRows[k] = inp;
      });
      function normalizeAndSave() {
        var w2 = {};
        Object.keys(weightRows).forEach(function (k) { w2[k] = +weightRows[k].value; });
        var norm = LMS.engine.normalizeWeights(w2);
        // 仅保存，不重置滑块（避免跳动）
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
        config.weights = { IL: 0.30, EL: 0.25, ML: 0.20, TL: 0.15, SL: 0.10 };
        LMS.store.setConfig(config);
        views.settings();
      };
      wCard.appendChild(resetW);
      app.appendChild(wCard);
    }
  };

  // ===== 卡片构建 =====
  function makeCard(act, sc, rx, p, config) {
    var card = el('div', 'act-card');
    card.onclick = function () { location.hash = '#/activity/' + act.id; };
    card.appendChild(el('div', 'act-name', esc(act.name)));
    card.appendChild(el('div', '', '<span class="tag">' + esc(DOMAIN_LABELS[act.domain] || act.domain) + '</span>'));
    var scoreRow = el('div', 'row');
    var num = el('span', 'act-score'); num.style.color = sc.zone.color; num.textContent = sc.score;
    num.appendChild(el('span', 'unit', ' 分'));
    scoreRow.appendChild(num);
    scoreRow.appendChild(el('div', 'spacer', ''));
    scoreRow.appendChild(el('span', 'tag', sc.zone.label));
    card.appendChild(scoreRow);
    var bar = el('div', 'zone-bar');
    var fill = el('div', ''); fill.style.width = sc.score + '%'; fill.style.background = sc.zone.color;
    bar.appendChild(fill); card.appendChild(bar);
    var src = LMS.engine.topContributor(sc.parts, config.weights);
    card.appendChild(el('div', 'act-source', '主要：' + src));
    card.appendChild(el('div', 'act-conf', '置信度 ' + Math.round(sc.confidence * 100) + '%'));
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
    if (document.querySelector('.modal-mask')) return; // 已有弹窗
    var mask = el('div', 'modal-mask');
    var modal = el('div', 'modal');
    modal.appendChild(el('h3', '', '快速微问卷（20秒）'));
    modal.appendChild(el('p', 'quiz-hint', '为了更准地评估「' + act.name + '」'));

    // 兴趣
    modal.appendChild(el('div', 'q-text', '你对这个活动的兴趣？'));
    var intSel = el('select');
    for (var i = 1; i <= 5; i++) { var op = el('option', ''); op.value = i; op.textContent = i + ' 分'; intSel.appendChild(op); }
    modal.appendChild(intSel);

    modal.appendChild(el('div', 'q-text', '你打算每周投入多久？'));
    var hrsSel = el('select');
    [['0.5', '<1 小时'], ['2', '1-3 小时'], ['4.5', '3-6 小时'], ['7', '6 小时+']].forEach(function (o) {
      var op = el('option', ''); op.value = o[0]; op.textContent = o[1]; hrsSel.appendChild(op);
    });
    modal.appendChild(hrsSel);

    var acts = el('div', 'modal-actions');
    var skip = el('button', 'btn ghost', '跳过');
    skip.onclick = function () { mask.remove(); };
    var save = el('button', 'btn', '保存');
    save.onclick = function () {
      var interest = (+intSel.value - 1) / 4;
      // 写入 person.domains[domain].interest
      var person = LMS.store.getPerson();
      if (!person) person = LMS.store.defaultPerson();
      if (!person.domains) person.domains = {};
      if (!person.domains[act.domain]) person.domains[act.domain] = { experience: 0.25, interest: interest };
      else person.domains[act.domain].interest = interest;
      if (!person.answered) person.answered = { baseline: false, channel: false, pace: false, structure: false, social: false, domains: false };
      person.answered.domains = true;
      person.confidence = LMS.engine.computeConfidence(person);
      LMS.store.setPerson(person);
      mask.remove();
      // 刷新详情
      views.activity(act.id);
    };
    acts.appendChild(skip); acts.appendChild(save);
    modal.appendChild(acts);
    mask.appendChild(modal);
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
  }

  // ===== 完成反馈弹窗 =====
  function showFeedbackModal(act, sc) {
    var mask = el('div', 'modal-mask');
    var modal = el('div', 'modal');
    modal.appendChild(el('h3', '', '完成反馈'));
    modal.appendChild(el('p', 'quiz-hint', '刚才实际有多累？（0=一点也不累，10=精疲力尽）'));
    var r = el('input'); r.type = 'range'; r.min = 0; r.max = 10; r.value = Math.round(sc.score / 10);
    var v = el('div', 'range-value', r.value);
    r.oninput = function () { v.textContent = r.value; };
    modal.appendChild(r);
    modal.appendChild(el('div', 'range-labels', '<span>一点也不累</span><span>精疲力尽</span>'));
    modal.appendChild(v);

    var acts = el('div', 'modal-actions');
    var cancel = el('button', 'btn ghost', '取消');
    cancel.onclick = function () { mask.remove(); };
    var submit = el('button', 'btn', '提交反馈');
    submit.onclick = function () {
      var observed = +r.value * 10;
      var person = LMS.store.getPerson();
      if (!person) { mask.remove(); return; }
      var lowQuality = !!person.lowQuality;
      if (!lowQuality) {
        var newCal = LMS.engine.updateCalibration(person.calibration, sc.raw, observed, 0.15);
        person.calibration = newCal;
        LMS.store.setPerson(person);
      }
      LMS.store.addLog({ activityId: act.id, predicted: sc.score, observed: observed, at: Date.now(), lowQuality: lowQuality });
      mask.remove();
      var notice = el('div', 'notice', '已记录反馈。' + (lowQuality ? '（本次因注意检查未通过，未更新校准）' : '校准已更新。'));
      document.getElementById('app').appendChild(notice);
      setTimeout(function () { views.activity(act.id); }, 800);
    };
    acts.appendChild(cancel); acts.appendChild(submit);
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
    renderResultStandalone(body, person);
    var acts = el('div', 'quiz-actions');
    var viewLib = el('button', 'btn', '查看活动负荷');
    viewLib.onclick = function () { location.hash = '#/library'; };
    acts.appendChild(viewLib);
    var refine = el('button', 'btn secondary', '继续精细化画像（+90秒可选）');
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
        IL: w.IL + (a.distraction - 0.5) * 0.04,
        EL: w.EL + (a.distraction - 0.5) * 0.04,
        ML: w.ML - (a.motivation - 0.5) * 0.04,
        TL: w.TL + (a.evalAnxiety - 0.5) * 0.03,
        SL: w.SL - (a.slowTolerance - 0.5) * 0.03
      };
      cfg.weights = LMS.engine.normalizeWeights(w2);
      LMS.store.setConfig(cfg);
      renderResultStandalone(body, person);
    };
    body.appendChild(done);
  }

  function renderResultStandalone(body, person) {
    var conf = person.confidence != null ? person.confidence : LMS.engine.computeConfidence(person);
    body.appendChild(el('h2', 'quiz-screen-title', '你的学习画像'));
    body.appendChild(el('p', 'quiz-hint', '基线负荷、画像置信度与通道偏好。'));

    var grid = el('div', 'result-grid');

    var card1 = el('div', 'card');
    card1.appendChild(el('div', '', '基线负荷 T'));
    card1.appendChild(el('div', 'big-number', Math.round(person.baseline) + '<span class="unit">分</span>'));
    card1.appendChild(el('div', '', '<span class="tag">校准 k=' + person.calibration.k + ' b=' + person.calibration.b + '</span>'));
    grid.appendChild(card1);

    var card2 = el('div', 'card');
    card2.appendChild(el('div', '', '画像置信度'));
    var ringWrap = el('div', 'confidence-ring');
    ringWrap.appendChild(LMS.quiz._confidenceRingSVG(conf));
    var ringMeta = el('div', '');
    ringMeta.innerHTML = '<div style="font-size:28px;font-weight:800;">' + Math.round(conf * 100) + '<span style="font-size:12px;color:var(--text-dim)">%</span></div>';
    if (conf < 0.6) ringMeta.innerHTML += '<div class="notice warn">补答可提升精度</div>';
    ringWrap.appendChild(ringMeta);
    card2.appendChild(ringWrap);
    grid.appendChild(card2);

    var card3 = el('div', 'card');
    card3.appendChild(el('div', '', '通道偏好'));
    var radarWrap = el('div', 'radar-wrap');
    radarWrap.appendChild(LMS.quiz._channelRadarSVG(person.channel));
    card3.appendChild(radarWrap);
    grid.appendChild(card3);

    body.appendChild(grid);
  }

  LMS.views = views;
})(window);
