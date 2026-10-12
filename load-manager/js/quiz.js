/* 问卷模块 —— 6 屏 19 答题点，挂在 window.LMS.quiz */
(function (global) {
  'use strict';

  // 时段映射
  var TIME_LABELS = { morning: '早晨', forenoon: '上午', afternoon: '下午', evening: '傍晚', night: '深夜' };
  var CHANNEL_LABELS = { read: '读图文', audiovisual: '看视频听讲解', hands: '自己上手试错', social: '和人讨论请教' };
  var DOMAIN_OPTIONS = [
    { key: 'coding', label: '编程开发' }, { key: 'data', label: '数据分析' },
    { key: 'language', label: '语言' }, { key: 'design', label: '设计' },
    { key: 'writing', label: '写作' }, { key: 'music', label: '音乐' },
    { key: 'photography', label: '摄影' }, { key: 'history', label: '历史人文' },
    { key: 'reading', label: '阅读' }
  ];
  var EXP_OPTIONS = [
    { v: 0, label: '从未接触' }, { v: 0.25, label: '看过介绍' },
    { v: 0.5, label: '跟教程做过' }, { v: 0.75, label: '独立小项目' }, { v: 1, label: '熟练能教' }
  ];

  var state = {
    screen: 0, // 0..5
    answers: {}, // screen -> data
    extra: false, // 是否进入精细化
    startTime: 0,
    onComplete: null
  };

  // 屏 1: 基线锚点
  var SCR_BASELINE = 1;
  // 屏 2: 通道偏好
  var SCR_CHANNEL = 2;
  // 屏 3: 节奏与结构
  var SCR_PACE = 3;
  // 屏 4: 社交与资源
  var SCR_SOCIAL = 4;
  // 屏 5: 领域
  var SCR_DOMAINS = 5;
  // 屏 6: 结果
  var SCR_RESULT = 6;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  // ===== 默认答案 =====
  function defaultAnswers() {
    return {
      baseline: { q1: 5, q2: 5, answered: false },
      channel: { order: ['read', 'audiovisual', 'hands', 'social'], answered: false },
      pace: { block: 32, stuck: 'search', peakTime: 'morning', attention: null, structureNeed: 0.5, answered: false },
      social: { openLoop: 0.5, socialPref: 0.3, recovery: 0.65, weeklyHours: 5, answered: false },
      domains: { picks: [], matrix: {}, answered: false },
      extra: { motivation: 0.5, distraction: 0.5, slowTolerance: 0.5, evalAnxiety: 0.5, answered: false }
    };
  }

  var quiz = {
    start: function (onComplete) {
      state.screen = 1;
      state.answers = defaultAnswers();
      state.extra = false;
      state.startTime = Date.now();
      state.onComplete = onComplete;
      this.render();
    },
    // 从已有 person 继续（用于"继续精细化"或重填）
    continueFrom: function (person, onComplete) {
      state.answers = defaultAnswers();
      // 回填已有值
      if (person) {
        var b = person.baseline != null ? person.baseline : 50;
        // 反推 q1,q2: 取 T=(q1+(10-q2))/2*10 -> q1+(10-q2)=T/5；这里简单取 q1=T/10, q2=10-T/10
        state.answers.baseline = { q1: Math.max(0, Math.min(10, Math.round(b / 10))), q2: Math.max(0, Math.min(10, Math.round(10 - b / 10))), answered: !!(person.answered && person.answered.baseline) };
        if (person.channel) {
          var chOrder = Object.keys(person.channel).sort(function (a, b) { return person.channel[b] - person.channel[a]; });
          state.answers.channel = { order: chOrder, answered: !!(person.answered && person.answered.channel) };
        }
        if (person.block != null) {
          state.answers.pace.block = person.block;
          state.answers.pace.stuck = person.stuck || 'search';
          state.answers.pace.peakTime = person.peakTime || 'morning';
          state.answers.pace.structureNeed = person.structureNeed != null ? person.structureNeed : 0.5;
          state.answers.pace.answered = !!(person.answered && person.answered.pace);
        }
        if (person.socialPref != null) {
          state.answers.social.openLoop = person.openLoop;
          state.answers.social.socialPref = person.socialPref;
          state.answers.social.recovery = person.recovery;
          state.answers.social.weeklyHours = person.weeklyHours;
          state.answers.social.answered = !!(person.answered && person.answered.social);
        }
        if (person.domains) {
          var picks = Object.keys(person.domains);
          var matrix = {};
          picks.forEach(function (d) {
            matrix[d] = {
              exp: person.domains[d].experience != null ? person.domains[d].experience : 0.3,
              int: person.domains[d].interest != null ? person.domains[d].interest : 0.3
            };
          });
          state.answers.domains = { picks: picks, matrix: matrix, answered: !!(person.answered && person.answered.domains) };
        }
      }
      state.startTime = Date.now();
      state.onComplete = onComplete;
      state.screen = 1;
      this.render();
    },

    currentScreen: function () { return state.screen; },

    // ===== 渲染 =====
    render: function () {
      var container = $('#app') || document.body;
      container.innerHTML = '';
      var wrap = el('div', 'quiz-wrap');
      container.appendChild(wrap);
      this._renderProgress(wrap);
      var body = el('div', 'quiz-body');
      wrap.appendChild(body);

      switch (state.screen) {
        case SCR_BASELINE: this._renderBaseline(body); break;
        case SCR_CHANNEL: this._renderChannel(body); break;
        case SCR_PACE: this._renderPace(body); break;
        case SCR_SOCIAL: this._renderSocial(body); break;
        case SCR_DOMAINS: this._renderDomains(body); break;
        case SCR_RESULT: this._renderResult(body); break;
        default: this._renderBaseline(body);
      }

      this._renderActions(wrap);
    },

    _renderProgress: function (wrap) {
      var total = 6;
      var pct = (state.screen - 1) / (total - 1) * 100;
      if (state.screen === 1) pct = 4;
      wrap.appendChild(el('div', 'quiz-meta',
        '<span>第 ' + state.screen + ' / ' + (total - 1) + ' 屏</span>' +
        '<span id="quiz-eta">预计还需 ' + this._eta() + ' 秒</span>'
      ));
      var bar = el('div', 'quiz-progress');
      var inner = el('div', ''); inner.style.width = pct + '%';
      bar.appendChild(inner); wrap.appendChild(bar);
    },

    _eta: function () {
      var remaining = 6 - state.screen; // 每屏约 45 秒
      return remaining * 45;
    },

    _renderActions: function (wrap) {
      var self = this;
      var actions = el('div', 'quiz-actions');
      var back = el('button', 'btn secondary', '上一步');
      back.onclick = function () {
        if (state.screen > 1) { state.screen--; self.render(); }
      };
      if (state.screen === 1) back.style.visibility = 'hidden';
      actions.appendChild(back);

      var right = el('div', 'row');
      if (state.screen < SCR_DOMAINS) {
        var skip = el('button', 'btn ghost sm', '跳过本题');
        skip.onclick = function () { self._skipCurrent(); };
        right.appendChild(skip);
        var next = el('button', 'btn', '下一屏');
        next.onclick = function () { self._next(); };
        right.appendChild(next);
      } else if (state.screen === SCR_DOMAINS) {
        var skip2 = el('button', 'btn ghost sm', '跳过本题');
        skip2.onclick = function () { self._skipCurrent(); };
        right.appendChild(skip2);
        var finish = el('button', 'btn', '完成画像');
        finish.onclick = function () { self._finish(); };
        right.appendChild(finish);
      }
      actions.appendChild(right);
      wrap.appendChild(actions);
    },

    _skipCurrent: function () {
      // 标记当前屏未答，使用默认值
      var key = this._screenKey();
      state.answers[key].answered = false;
      this._next();
    },

    _screenKey: function () {
      return { 1: 'baseline', 2: 'channel', 3: 'pace', 4: 'social', 5: 'domains' }[state.screen];
    },

    _next: function () {
      if (state.screen < SCR_RESULT) {
        state.screen++;
        this.render();
      }
    },

    _finish: function () {
      state.screen = SCR_RESULT;
      this.render();
    },

    // ===== 屏 1 基线锚点 =====
    _renderBaseline: function (body) {
      body.appendChild(el('h2', 'quiz-screen-title', '基线锚点'));
      body.appendChild(el('p', 'quiz-hint', '请回忆你最近一次认真学新东西的经历，凭直觉作答。'));

      var a = state.answers.baseline;
      var q1 = el('div', 'quiz-question');
      q1.appendChild(el('div', 'q-text', '① 整体来说你有多累？（0=一点也不累，10=精疲力尽）'));
      var r1 = el('input'); r1.type = 'range'; r1.min = 0; r1.max = 10; r1.value = a.q1;
      var v1 = el('div', 'range-value', a.q1);
      r1.oninput = function () { a.q1 = +r1.value; v1.textContent = r1.value; a.answered = true; };
      q1.appendChild(r1);
      q1.appendChild(el('div', 'range-labels', '<span>一点也不累</span><span>精疲力尽</span>'));
      q1.appendChild(v1);
      body.appendChild(q1);

      var q2 = el('div', 'quiz-question');
      q2.appendChild(el('div', 'q-text', '② 这个难度你应付得了吗？（0=很吃力，10=很轻松，反向计分）'));
      var r2 = el('input'); r2.type = 'range'; r2.min = 0; r2.max = 10; r2.value = a.q2;
      var v2 = el('div', 'range-value', a.q2);
      r2.oninput = function () { a.q2 = +r2.value; v2.textContent = r2.value; a.answered = true; };
      q2.appendChild(r2);
      q2.appendChild(el('div', 'range-labels', '<span>很吃力</span><span>很轻松</span>'));
      q2.appendChild(v2);
      body.appendChild(q2);
    },

    // ===== 屏 2 通道偏好 =====
    _renderChannel: function (body) {
      body.appendChild(el('h2', 'quiz-screen-title', '通道偏好'));
      body.appendChild(el('p', 'quiz-hint', '按「对你更有效」从上到下排序 4 种学习方式（可拖拽或用上下箭头）。'));

      var a = state.answers.channel;
      var list = el('div', 'sort-list');
      list.id = 'channel-sort';
      body.appendChild(list);

      function buildList() {
        list.innerHTML = '';
        a.order.forEach(function (key, idx) {
          var item = el('div', 'sort-item');
          item.draggable = true;
          item.dataset.key = key;
          item.appendChild(el('div', 'pos', String(idx + 1)));
          item.appendChild(el('div', 'label', CHANNEL_LABELS[key] || key));
          var btns = el('div', 'sort-btns');
          var up = el('button', '', '↑'); up.onclick = function (e) { e.stopPropagation(); _move(key, -1); };
          var dn = el('button', '', '↓'); dn.onclick = function (e) { e.stopPropagation(); _move(key, 1); };
          btns.appendChild(up); btns.appendChild(dn);
          item.appendChild(btns);
          list.appendChild(item);
        });
      }
      function _move(key, dir) {
        var idx = a.order.indexOf(key);
        var ni = idx + dir;
        if (ni < 0 || ni >= a.order.length) return;
        var tmp = a.order[ni]; a.order[ni] = key; a.order[idx] = tmp;
        a.answered = true; buildList();
      }

      // 拖拽
      var dragKey = null;
      list.addEventListener('dragstart', function (e) {
        var t = e.target.closest('.sort-item'); if (!t) return;
        dragKey = t.dataset.key; t.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
      });
      list.addEventListener('dragend', function (e) {
        var t = e.target.closest('.sort-item'); if (t) t.classList.remove('dragging');
      });
      list.addEventListener('dragover', function (e) { e.preventDefault(); });
      list.addEventListener('drop', function (e) {
        e.preventDefault();
        var t = e.target.closest('.sort-item'); if (!t || !dragKey) return;
        var targetKey = t.dataset.key;
        if (dragKey === targetKey) return;
        var from = a.order.indexOf(dragKey);
        var to = a.order.indexOf(targetKey);
        a.order.splice(to, 0, a.order.splice(from, 1)[0]);
        a.answered = true; buildList();
      });

      buildList();
      a.answered = a.answered || false;
    },

    // ===== 屏 3 节奏与结构 =====
    _renderPace: function (body) {
      body.appendChild(el('h2', 'quiz-screen-title', '节奏与结构'));
      body.appendChild(el('p', 'quiz-hint', '请根据你的真实习惯作答。'));
      var a = state.answers.pace;

      function single(label, opts, current, setter) {
        var q = el('div', 'quiz-question');
        q.appendChild(el('div', 'q-text', label));
        var ol = el('div', 'opt-list');
        opts.forEach(function (o) {
          var item = el('div', 'opt' + (current === o.v ? ' selected' : ''));
          var inp = el('input'); inp.type = 'radio'; inp.name = label; inp.checked = (current === o.v);
          inp.onchange = function () {
            setter(o.v); a.answered = true;
            ol.querySelectorAll('.opt').forEach(function (x) { x.classList.remove('selected'); });
            item.classList.add('selected');
          };
          item.appendChild(inp);
          item.appendChild(el('span', '', o.label));
          ol.appendChild(item);
        });
        q.appendChild(ol);
        return q;
      }

      var blockOpts = [
        { v: 15, label: '≤20 分钟' }, { v: 32, label: '20-45 分钟' },
        { v: 65, label: '45-90 分钟' }, { v: 100, label: '>90 分钟' }
      ];
      var stuckOpts = [
        { v: 'ask', label: '立刻问人' }, { v: 'search', label: '自己查资料' }, { v: 'switch', label: '先放下去做别的' }
      ];
      var peakOpts = [
        { v: 'morning', label: '早晨' }, { v: 'forenoon', label: '上午' }, { v: 'afternoon', label: '下午' },
        { v: 'evening', label: '傍晚' }, { v: 'night', label: '深夜' }
      ];
      var attOpts = [
        { v: 'disagree_strong', label: '非常不同意' }, { v: 'disagree', label: '比较不同意' },
        { v: 'agree', label: '比较同意' }, { v: 'agree_strong', label: '非常同意' }
      ];
      var structOpts = [
        { v: 1.0, label: '明确步骤和验收' }, { v: 0.5, label: '给大方向自规划' }, { v: 0.15, label: '完全自由探索' }
      ];

      body.appendChild(single('① 一次能高效专注多久？', blockOpts, a.block, function (v) { a.block = v; }));
      body.appendChild(single('② 卡住时第一反应？', stuckOpts, a.stuck, function (v) { a.stuck = v; }));
      body.appendChild(single('③ 思路最清醒的时段？', peakOpts, a.peakTime, function (v) { a.peakTime = v; }));

      // 注意检查题
      var q4 = el('div', 'quiz-question');
      q4.appendChild(el('div', 'q-text', '④ 注意检查：请选择「比较同意」'));
      var ol4 = el('div', 'opt-list');
      function buildAtt() {
        ol4.innerHTML = '';
        attOpts.forEach(function (o) {
          var item = el('div', 'opt' + (a.attention === o.v ? ' selected' : ''));
          var inp = el('input'); inp.type = 'radio'; inp.name = 'attention'; inp.checked = (a.attention === o.v);
          inp.onchange = function () {
            a.attention = o.v; a.lowQuality = (o.v !== 'agree'); a.answered = true; buildAtt();
          };
          item.appendChild(inp); item.appendChild(el('span', '', o.label)); ol4.appendChild(item);
        });
      }
      buildAtt();
      q4.appendChild(ol4);
      body.appendChild(q4);

      body.appendChild(single('⑤ 新任务你希望？', structOpts, a.structureNeed, function (v) { a.structureNeed = v; }));
    },

    // ===== 屏 4 社交与资源 =====
    _renderSocial: function (body) {
      body.appendChild(el('h2', 'quiz-screen-title', '社交与资源'));
      var a = state.answers.social;

      function single(label, opts, current, setter) {
        var q = el('div', 'quiz-question');
        q.appendChild(el('div', 'q-text', label));
        var ol = el('div', 'opt-list');
        opts.forEach(function (o) {
          var item = el('div', 'opt' + (current === o.v ? ' selected' : ''));
          var inp = el('input'); inp.type = 'radio'; inp.name = label; inp.checked = (current === o.v);
          inp.onchange = function () {
            setter(o.v); a.answered = true;
            // 局部更新样式
            ol.querySelectorAll('.opt').forEach(function (x) { x.classList.remove('selected'); });
            item.classList.add('selected');
          };
          item.appendChild(inp); item.appendChild(el('span', '', o.label)); ol.appendChild(item);
        });
        q.appendChild(ol);
        return q;
      }

      var openOpts = [{ v: 1.0, label: '很焦虑必须做完' }, { v: 0.5, label: '有点惦记' }, { v: 0.1, label: '无所谓' }];
      var socOpts = [{ v: 0.0, label: '完全独自' }, { v: 0.5, label: '偶尔交流' }, { v: 1.0, label: '必须有人一起' }];
      var recOpts = [{ v: 0.3, label: '经常熬夜睡不够' }, { v: 0.65, label: '一般' }, { v: 1.0, label: '规律充足' }];
      var hrsOpts = [{ v: 2, label: '<3 小时' }, { v: 5, label: '3-7 小时' }, { v: 10, label: '7-14 小时' }, { v: 18, label: '>14 小时' }];

      body.appendChild(single('① 未完成的事悬着，你的感受？', openOpts, a.openLoop, function (v) { a.openLoop = v; }));
      body.appendChild(single('② 你更喜欢怎么学？', socOpts, a.socialPref, function (v) { a.socialPref = v; }));
      body.appendChild(single('③ 睡眠休息状况？', recOpts, a.recovery, function (v) { a.recovery = v; }));
      body.appendChild(single('④ 每周可支配学习时间？', hrsOpts, a.weeklyHours, function (v) { a.weeklyHours = v; }));
    },

    // ===== 屏 5 领域与经验兴趣 =====
    _renderDomains: function (body) {
      body.innerHTML = '';
      body.appendChild(el('h2', 'quiz-screen-title', '领域与经验兴趣'));
      body.appendChild(el('p', 'quiz-hint', '勾选你关注的方向（最多 3 个），勾选后对每一项评估经验和兴趣。'));
      var a = state.answers.domains;

      var grid = el('div', 'opt-list');
      DOMAIN_OPTIONS.forEach(function (d) {
        var checked = a.picks.indexOf(d.key) >= 0;
        var item = el('div', 'opt' + (checked ? ' selected' : ''));
        var inp = el('input'); inp.type = 'checkbox'; inp.checked = checked;
        inp.onchange = function () {
          if (inp.checked) {
            if (a.picks.length >= 3) { inp.checked = false; return; }
            a.picks.push(d.key);
            if (!a.matrix[d.key]) { a.matrix[d.key] = { exp: 0.25, int: 0.5 }; }
          } else {
            a.picks = a.picks.filter(function (k) { return k !== d.key; });
          }
          a.answered = a.picks.length > 0;
          this._renderDomains(body);
        }.bind(this);
        item.appendChild(inp);
        item.appendChild(el('span', '', d.label));
        grid.appendChild(item);
      }, this);
      body.appendChild(grid);

      // 矩阵
      if (a.picks.length > 0) {
        var wrap = el('div', 'card', '');
        wrap.style.marginTop = '14px';
        var tbl = el('table', 'matrix');
        tbl.innerHTML = '<thead><tr><th>方向</th><th>经验</th><th>兴趣(1-5)</th></tr></thead>';
        var tb = el('tbody');
        a.picks.forEach(function (key) {
          var dom = DOMAIN_OPTIONS.filter(function (d) { return d.key === key; })[0];
          var m = a.matrix[key] || { exp: 0.25, int: 0.5 };
          var tr = el('tr');
          tr.appendChild(el('td', '', dom.label));
          // 经验
          var tdE = el('td');
          var selE = el('select');
          EXP_OPTIONS.forEach(function (o) {
            var op = el('option', ''); op.value = o.v; op.textContent = o.label;
            if (Math.abs(m.exp - o.v) < 0.01) op.selected = true;
            selE.appendChild(op);
          });
          selE.onchange = function () { m.exp = +selE.value; };
          tdE.appendChild(selE); tr.appendChild(tdE);
          // 兴趣
          var tdI = el('td');
          var selI = el('select');
          for (var i = 1; i <= 5; i++) {
            var op = el('option', ''); op.value = i; op.textContent = i + ' 分';
            if (Math.round(m.int * 4 + 1) === i) op.selected = true;
            selI.appendChild(op);
          }
          selI.onchange = function () { m.int = (+selI.value - 1) / 4; };
          tdI.appendChild(selI); tr.appendChild(tdI);
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        wrap.appendChild(tbl);
        body.appendChild(wrap);
      }
    },

    // ===== 屏 6 结果页 =====
    _renderResult: function (body) {
      var person = this._buildPerson();
      var conf = global.LMS.engine.computeConfidence(person);
      person.confidence = conf;
      // 回写到 store
      global.LMS.store.setPerson(person);

      body.appendChild(el('h2', 'quiz-screen-title', '你的学习画像已生成'));
      body.appendChild(el('p', 'quiz-hint', '以下是基于你的作答生成的个人基线与画像。'));

      var grid = el('div', 'result-grid');

      // 基线卡
      var card1 = el('div', 'card');
      card1.appendChild(el('div', '', '基线负荷 T'));
      var num = el('div', 'big-number', person.baseline.toFixed(0) + '<span class="unit">分</span>');
      card1.appendChild(num);
      card1.appendChild(el('div', '', '<span class="tag">校准 k=' + person.calibration.k + ' b=' + person.calibration.b + '</span>'));
      grid.appendChild(card1);

      // 置信度环
      var card2 = el('div', 'card');
      card2.appendChild(el('div', '', '画像置信度'));
      var ringWrap = el('div', 'confidence-ring');
      ringWrap.appendChild(this._confidenceRingSVG(conf));
      var ringMeta = el('div', '');
      ringMeta.innerHTML = '<div style="font-size:28px;font-weight:800;">' + Math.round(conf * 100) + '<span style="font-size:12px;color:var(--text-dim)">%</span></div>';
      if (conf < 0.6) ringMeta.innerHTML += '<div class="notice warn">补答可提升精度</div>';
      ringWrap.appendChild(ringMeta);
      card2.appendChild(ringWrap);
      grid.appendChild(card2);

      // 通道雷达
      var card3 = el('div', 'card');
      card3.appendChild(el('div', '', '通道偏好'));
      var radarWrap = el('div', 'radar-wrap');
      radarWrap.appendChild(this._channelRadarSVG(person.channel));
      card3.appendChild(radarWrap);
      grid.appendChild(card3);

      body.appendChild(grid);

      // 按钮
      var self = this;
      var acts = el('div', 'row', '');
      acts.style.marginTop = '18px';
      var viewLib = el('button', 'btn', '查看活动负荷');
      viewLib.onclick = function () { if (state.onComplete) state.onComplete(person); };
      acts.appendChild(viewLib);
      var refine = el('button', 'btn secondary', '继续精细化画像（+90秒可选）');
      refine.onclick = function () { self._renderExtra(body); };
      acts.appendChild(refine);
      body.appendChild(acts);
    },

    _renderExtra: function (body) {
      body.innerHTML = '';
      body.appendChild(el('h2', 'quiz-screen-title', '精细化画像（可选）'));
      body.appendChild(el('p', 'quiz-hint', '以下 4 题仅微调评分权重，约 90 秒。'));
      var a = state.answers.extra;

      function slider(label, getter, setter) {
        var q = el('div', 'quiz-question');
        q.appendChild(el('div', 'q-text', label));
        var r = el('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = getter();
        var v = el('div', 'range-value', getter().toFixed(2));
        r.oninput = function () { setter(+r.value); v.textContent = r.value; a.answered = true; };
        q.appendChild(r); q.appendChild(v);
        return q;
      }

      body.appendChild(slider('学习动机强度（0=被动 1=主动）', function () { return a.motivation; }, function (v) { a.motivation = v; }));
      body.appendChild(slider('环境干扰程度（0=安静 1=嘈杂）', function () { return a.distraction; }, function (v) { a.distraction = v; }));
      body.appendChild(slider('学得慢容忍度（0=急于求成 1=能耐住性子）', function () { return a.slowTolerance; }, function (v) { a.slowTolerance = v; }));
      body.appendChild(slider('评价焦虑（0=不在意 1=很在意）', function () { return a.evalAnxiety; }, function (v) { a.evalAnxiety = v; }));

      var done = el('button', 'btn', '应用并返回');
      done.style.marginTop = '12px';
      var self = this;
      done.onclick = function () {
        // 微调权重：动机高->ML 权重略降；干扰高->EL 略升；慢容忍高->SL 略降；焦虑高->TL 略升
        var cfg = global.LMS.store.getConfig();
        var w = cfg.weights;
        var w2 = {
          IL: w.IL + (a.distraction - 0.5) * 0.04,
          EL: w.EL + (a.distraction - 0.5) * 0.04,
          ML: w.ML - (a.motivation - 0.5) * 0.04,
          TL: w.TL + (a.evalAnxiety - 0.5) * 0.03,
          SL: w.SL - (a.slowTolerance - 0.5) * 0.03
        };
        cfg.weights = global.LMS.engine.normalizeWeights(w2);
        global.LMS.store.setConfig(cfg);
        state.screen = SCR_RESULT;
        self.render();
      };
      body.appendChild(done);
    },

    // ===== 构建画像 =====
    _buildPerson: function () {
      var p = global.LMS.store.defaultPerson();
      var a = state.answers;

      // 基线
      var b = a.baseline;
      if (b.answered) {
        p.baseline = Math.round((b.q1 + (10 - b.q2)) / 2 * 10);
        p.answered.baseline = true;
      } else {
        p.answered.baseline = false;
      }
      // 校准初始 k=1, b=T-50
      p.calibration = { k: 1, b: p.baseline - 50 };

      // 通道
      var c = a.channel;
      var weights = [4, 3, 2, 1];
      var sum = 4 + 3 + 2 + 1;
      var ch = { read: 0, audiovisual: 0, hands: 0, social: 0 };
      if (c.answered) {
        c.order.forEach(function (key, idx) { ch[key] = weights[idx] / sum; });
        p.answered.channel = true;
      } else {
        // 群体默认均匀
        ch = { read: 0.25, audiovisual: 0.25, hands: 0.25, social: 0.25 };
        p.answered.channel = false;
      }
      p.channel = ch;

      // 节奏与结构
      var pa = a.pace;
      if (pa.answered) {
        p.block = pa.block;
        p.stuck = pa.stuck;
        p.peakTime = pa.peakTime;
        p.structureNeed = pa.structureNeed;
        p.lowQuality = !!pa.lowQuality;
        p.answered.pace = true;
      } else {
        p.answered.pace = false;
      }

      // 社交与资源
      var so = a.social;
      if (so.answered) {
        p.openLoop = so.openLoop;
        p.socialPref = so.socialPref;
        p.recovery = so.recovery;
        p.weeklyHours = so.weeklyHours;
        p.answered.social = true;
      } else {
        p.answered.social = false;
      }

      // 领域
      var dm = a.domains;
      if (dm.answered) {
        dm.picks.forEach(function (key) {
          var m = dm.matrix[key] || { exp: 0.25, int: 0.5 };
          p.domains[key] = { experience: m.exp, interest: m.int };
        });
        p.answered.domains = true;
      } else {
        p.answered.domains = false;
      }

      p.version = 1;
      return p;
    },

    // ===== SVG: 置信度环 =====
    _confidenceRingSVG: function (conf) {
      var r = 38, c = 2 * Math.PI * r;
      var off = c * (1 - conf);
      var svg = '<svg width="96" height="96" viewBox="0 0 96 96">' +
        '<circle cx="48" cy="48" r="' + r + '" fill="none" stroke="#30363D" stroke-width="8"/>' +
        '<circle cx="48" cy="48" r="' + r + '" fill="none" stroke="#4B9FFF" stroke-width="8" stroke-linecap="round" ' +
        'stroke-dasharray="' + c.toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" ' +
        'transform="rotate(-90 48 48)"/>' +
        '</svg>';
      var wrap = el('div', ''); wrap.innerHTML = svg;
      return wrap.firstChild;
    },

    // ===== SVG: 通道雷达 =====
    _channelRadarSVG: function (channel) {
      var keys = ['read', 'audiovisual', 'hands', 'social'];
      var labels = ['读图文', '看/听', '上手', '讨论'];
      var cx = 80, cy = 80, R = 60;
      var pts = [];
      var grid = [];
      for (var ring = 1; ring <= 4; ring++) {
        var rr = R * ring / 4;
        var ringPts = [];
        for (var i = 0; i < 4; i++) {
          var ang = -Math.PI / 2 + i * 2 * Math.PI / 4;
          ringPts.push((cx + rr * Math.cos(ang)).toFixed(1) + ',' + (cy + rr * Math.sin(ang)).toFixed(1));
        }
        grid.push('<polygon points="' + ringPts.join(' ') + '" fill="none" stroke="#30363D" stroke-width="1" opacity="0.6"/>');
      }
      keys.forEach(function (k, i) {
        var v = channel[k] || 0;
        var ang = -Math.PI / 2 + i * 2 * Math.PI / 4;
        pts.push((cx + R * v * Math.cos(ang)).toFixed(1) + ',' + (cy + R * v * Math.sin(ang)).toFixed(1));
      });
      var axes = keys.map(function (k, i) {
        var ang = -Math.PI / 2 + i * 2 * Math.PI / 4;
        var x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
        var lx = cx + (R + 12) * Math.cos(ang), ly = cy + (R + 12) * Math.sin(ang) + 3;
        return '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#30363D"/>' +
          '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#8B949E" font-size="11" text-anchor="middle">' + labels[i] + '</text>';
      }).join('');
      var svg = '<svg width="180" height="170" viewBox="0 0 160 160" style="overflow:visible">' +
        grid.join('') + axes +
        '<polygon points="' + pts.join(' ') + '" fill="rgba(75,159,255,0.3)" stroke="#4B9FFF" stroke-width="2"/>' +
        pts.map(function (p) {
          var xy = p.split(',');
          return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="2.5" fill="#4B9FFF"/>';
        }).join('') +
        '</svg>';
      var wrap = el('div', ''); wrap.innerHTML = svg;
      return wrap.firstChild;
    }
  };

  global.LMS = global.LMS || {};
  global.LMS.quiz = quiz;
})(window);
