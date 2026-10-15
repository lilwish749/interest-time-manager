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
      baseline: { q1: 5, q2: 5, touched: { q1: false, q2: false }, answered: false },
      channel: { order: ['read', 'audiovisual', 'hands', 'social'], answered: false },
      pace: {
        block: 32, stuck: 'search', peakTime: 'morning', attention: null, structureNeed: 0.5,
        answeredQ: { block: false, stuck: false, peak: false, attention: false, structure: false },
        answered: false
      },
      social: {
        openLoop: 0.5, socialPref: 0.3, recovery: 0.65, weeklyHours: 5,
        answeredQ: { open: false, socialPref: false, recovery: false, hours: false },
        answered: false
      },
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
        var bAns = !!(person.answered && person.answered.baseline);
        state.answers.baseline = {
          q1: Math.max(0, Math.min(10, Math.round(b / 10))),
          q2: Math.max(0, Math.min(10, Math.round(10 - b / 10))),
          touched: { q1: bAns, q2: bAns },
          answered: bAns
        };
        if (person.channel) {
          var chOrder = Object.keys(person.channel).sort(function (a, b) { return person.channel[b] - person.channel[a]; });
          state.answers.channel = { order: chOrder, answered: !!(person.answered && person.answered.channel) };
        }
        if (person.block != null) {
          var pAns = !!(person.answered && person.answered.pace);
          state.answers.pace.block = person.block;
          state.answers.pace.stuck = person.stuck || 'search';
          state.answers.pace.peakTime = person.peakTime || 'morning';
          state.answers.pace.structureNeed = person.structureNeed != null ? person.structureNeed : 0.5;
          state.answers.pace.answeredQ = { block: pAns, stuck: pAns, peak: pAns, attention: pAns, structure: pAns };
          state.answers.pace.answered = pAns;
        }
        if (person.socialPref != null) {
          var sAns = !!(person.answered && person.answered.social);
          state.answers.social.openLoop = person.openLoop;
          state.answers.social.socialPref = person.socialPref;
          state.answers.social.recovery = person.recovery;
          state.answers.social.weeklyHours = person.weeklyHours;
          state.answers.social.answeredQ = { open: sAns, socialPref: sAns, recovery: sAns, hours: sAns };
          state.answers.social.answered = sAns;
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
      var left = state.screen === SCR_RESULT ? '已完成' : '第 ' + state.screen + ' / ' + (total - 1) + ' 屏';
      var n = this._remainingCount();
      var rightTxt = state.screen === SCR_RESULT
        ? '画像已生成'
        : (n > 0 ? '还剩 ' + n + ' 题没答' : '这一屏都答完了');
      wrap.appendChild(el('div', 'quiz-meta',
        '<span>' + left + '</span>' +
        '<span id="quiz-remaining">' + rightTxt + '</span>'
      ));
      var bar = el('div', 'quiz-progress');
      var inner = el('div', ''); inner.style.width = pct + '%';
      bar.appendChild(inner); wrap.appendChild(bar);
    },

    // 剩余题目数量：从当前屏到最后一屏，累加尚未完成的答题点
    _remainingCount: function () {
      var keyMap = { 1: 'baseline', 2: 'channel', 3: 'pace', 4: 'social', 5: 'domains' };
      var n = 0;
      for (var s = state.screen; s <= SCR_DOMAINS; s++) {
        n += this._validateScreen(keyMap[s]).messages.length;
      }
      return n;
    },

    _renderActions: function (wrap) {
      var self = this;
      var actions = el('div', 'quiz-actions');
      var back = el('button', 'btn secondary', '上一步');
      back.onclick = function () {
        if (state.screen > 1) { state.screen--; self.render(); }
      };
      if (state.screen === 1 || state.screen === SCR_RESULT) back.style.visibility = 'hidden';
      actions.appendChild(back);

      var right = el('div', 'row');
      if (state.screen < SCR_DOMAINS) {
        var next = el('button', 'btn', '下一屏');
        next.onclick = function () {
          if (!self._guardCurrent()) return;
          self._next();
        };
        right.appendChild(next);
      } else if (state.screen === SCR_DOMAINS) {
        var finish = el('button', 'btn', '生成我的学习画像');
        finish.onclick = function () { self._tryFinish(); };
        right.appendChild(finish);
      }
      actions.appendChild(right);
      wrap.appendChild(actions);
    },

    _screenKey: function () {
      return { 1: 'baseline', 2: 'channel', 3: 'pace', 4: 'social', 5: 'domains' }[state.screen];
    },

    // 校验某一屏，返回 { messages: [...], qkeys: [...] }，全部通过时 messages 为空
    _validateScreen: function (key) {
      var a = state.answers[key];
      var msgs = [], qkeys = [];
      if (key === 'baseline') {
        if (!a.touched.q1) { msgs.push('第 ① 题：拖一拖滑块，告诉我们你有多累'); qkeys.push('baseline-q1'); }
        if (!a.touched.q2) { msgs.push('第 ② 题：拖一拖滑块，告诉我们难度如何'); qkeys.push('baseline-q2'); }
      } else if (key === 'channel') {
        if (!a.answered) { msgs.push('请按你的偏好调整 4 种学习方式的先后顺序（拖动或点箭头均可）'); }
      } else if (key === 'pace') {
        var P = { block: '第 ① 题', stuck: '第 ② 题', peak: '第 ③ 题', attention: '第 ④ 题', structure: '第 ⑤ 题' };
        Object.keys(P).forEach(function (k) {
          if (!a.answeredQ[k]) { msgs.push(P[k] + '还没有选择'); qkeys.push(k); }
        });
      } else if (key === 'social') {
        var S = { open: '第 ① 题', socialPref: '第 ② 题', recovery: '第 ③ 题', hours: '第 ④ 题' };
        Object.keys(S).forEach(function (k) {
          if (!a.answeredQ[k]) { msgs.push(S[k] + '还没有选择'); qkeys.push(k); }
        });
      } else if (key === 'domains') {
        if (!a.picks || a.picks.length === 0) { msgs.push('请至少勾选 1 个你感兴趣的方向'); }
      }
      return { messages: msgs, qkeys: qkeys };
    },

    // 在当前屏展示缺失提示并高亮未答题
    _showMissing: function (v) {
      var body = $('.quiz-body');
      if (!body) return;
      var old = $('.quiz-missing'); if (old) old.parentNode.removeChild(old);
      body.querySelectorAll('.quiz-question.missing').forEach(function (q) { q.classList.remove('missing'); });
      var n = el('div', 'notice warn quiz-missing',
        '<b>还有 ' + v.messages.length + ' 处未完成：</b>' + v.messages.join('；') + '。完成后才能继续哦。');
      body.insertBefore(n, body.firstChild);
      v.qkeys.forEach(function (qk) {
        var q = body.querySelector('[data-qkey="' + qk + '"]');
        if (q) q.classList.add('missing');
      });
      n.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    // 进入下一屏前的守卫：当前屏必须全部作答
    _guardCurrent: function () {
      var v = this._validateScreen(this._screenKey());
      if (v.messages.length > 0) { this._showMissing(v); return false; }
      return true;
    },

    // 点击"生成学习画像"：所有屏都必须完成，否则跳到第一个未完成的屏
    _tryFinish: function () {
      var order = [SCR_BASELINE, SCR_CHANNEL, SCR_PACE, SCR_SOCIAL, SCR_DOMAINS];
      for (var i = 0; i < order.length; i++) {
        var key = { 1: 'baseline', 2: 'channel', 3: 'pace', 4: 'social', 5: 'domains' }[order[i]];
        var v = this._validateScreen(key);
        if (v.messages.length > 0) {
          state.screen = order[i];
          this.render();
          this._showMissing(v);
          return;
        }
      }
      this._finish();
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
      body.appendChild(el('h2', 'quiz-screen-title', '先说说你的感受'));
      body.appendChild(el('p', 'quiz-hint', '回忆你最近一次认真学新东西的经历，凭直觉作答就好。'));

      var a = state.answers.baseline;
      var q1 = el('div', 'quiz-question'); q1.dataset.qkey = 'baseline-q1';
      q1.appendChild(el('div', 'q-text', '① 学完之后，你感觉有多累？'));
      var r1 = el('input'); r1.type = 'range'; r1.min = 0; r1.max = 10; r1.value = a.q1;
      function tiredWord(v) {
        if (v <= 2) return '一点也不累';
        if (v <= 4) return '稍微有点累';
        if (v <= 6) return '比较累';
        if (v <= 8) return '很累';
        return '精疲力尽';
      }
      var v1 = el('div', 'range-value', tiredWord(a.q1));
      r1.oninput = function () {
        a.q1 = +r1.value; v1.textContent = tiredWord(a.q1);
        a.touched.q1 = true; a.answered = a.touched.q1 && a.touched.q2;
        q1.classList.remove('missing');
      };
      q1.appendChild(r1);
      q1.appendChild(el('div', 'range-labels', '<span>一点也不累</span><span>精疲力尽</span>'));
      q1.appendChild(v1);
      body.appendChild(q1);

      var q2 = el('div', 'quiz-question'); q2.dataset.qkey = 'baseline-q2';
      q2.appendChild(el('div', 'q-text', '② 这个难度对你来说怎么样？'));
      var r2 = el('input'); r2.type = 'range'; r2.min = 0; r2.max = 10; r2.value = a.q2;
      function hardWord(v) {
        if (v <= 2) return '很吃力';
        if (v <= 4) return '有点吃力';
        if (v <= 6) return '还行';
        if (v <= 8) return '比较轻松';
        return '很轻松';
      }
      var v2 = el('div', 'range-value', hardWord(a.q2));
      r2.oninput = function () {
        a.q2 = +r2.value; v2.textContent = hardWord(a.q2);
        a.touched.q2 = true; a.answered = a.touched.q1 && a.touched.q2;
        q2.classList.remove('missing');
      };
      q2.appendChild(r2);
      q2.appendChild(el('div', 'range-labels', '<span>很吃力</span><span>很轻松</span>'));
      q2.appendChild(v2);
      body.appendChild(q2);
    },

    // ===== 屏 2 通道偏好 =====
    _renderChannel: function (body) {
      body.appendChild(el('h2', 'quiz-screen-title', '你喜欢的学习方式'));
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
        a.answered = true; // 任何排序交互都视为已作答
        if (ni < 0 || ni >= a.order.length) return;
        var tmp = a.order[ni]; a.order[ni] = key; a.order[idx] = tmp;
        buildList();
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
      body.appendChild(el('h2', 'quiz-screen-title', '你的学习习惯'));
      body.appendChild(el('p', 'quiz-hint', '按你的真实习惯选，点选项整行都可以。'));
      var a = state.answers.pace;

      function syncAnswered() {
        var q = a.answeredQ;
        a.answered = q.block && q.stuck && q.peak && q.attention && q.structure;
      }

      function single(qkey, label, opts, current, setter) {
        var q = el('div', 'quiz-question'); q.dataset.qkey = qkey;
        q.appendChild(el('div', 'q-text', label));
        var ol = el('div', 'opt-list');
        opts.forEach(function (o) {
          var item = el('div', 'opt' + (current === o.v ? ' selected' : ''));
          var inp = el('input'); inp.type = 'radio'; inp.name = 'pace-' + qkey; inp.checked = (current === o.v);
          item.appendChild(inp);
          item.appendChild(el('span', '', o.label));
          item.onclick = function () {
            setter(o.v);
            a.answeredQ[qkey] = true; syncAnswered();
            ol.querySelectorAll('.opt').forEach(function (x) { x.classList.remove('selected'); });
            item.classList.add('selected');
            inp.checked = true;
            q.classList.remove('missing');
          };
          ol.appendChild(item);
        });
        q.appendChild(ol);
        return q;
      }

      var blockOpts = [
        { v: 15, label: '20 分钟以内' }, { v: 32, label: '20–45 分钟' },
        { v: 65, label: '45–90 分钟' }, { v: 100, label: '90 分钟以上' }
      ];
      var stuckOpts = [
        { v: 'ask', label: '马上问别人' }, { v: 'search', label: '自己查资料' }, { v: 'switch', label: '先放一放，换件事做' }
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
        { v: 1.0, label: '告诉我具体步骤' }, { v: 0.5, label: '给我方向，我自己安排' }, { v: 0.15, label: '让我自由探索' }
      ];

      body.appendChild(single('block', '① 你一次大约能高效专注多久？', blockOpts, a.block, function (v) { a.block = v; }));
      body.appendChild(single('stuck', '② 学不下去卡住时，你的第一反应是？', stuckOpts, a.stuck, function (v) { a.stuck = v; }));
      body.appendChild(single('peak', '③ 你一天中脑子最清醒的时段？', peakOpts, a.peakTime, function (v) { a.peakTime = v; }));
      // 注意力检查：选错不静默惩罚 —— 当场温和提示，选回「比较同意」即恢复
      var attHint = el('div', 'quiz-att-hint',
        '小提醒：这题是个认真度小检查。只有选「比较同意」，之后你给的反馈才能帮推荐越调越准。选错了没关系，随时点回去就行。');
      attHint.style.display = (a.attention != null && a.attention !== 'agree') ? 'block' : 'none';
      var attQ = single('attention', '④ 注意力检查：本题请选「比较同意」', attOpts, a.attention, function (v) {
        a.attention = v; a.lowQuality = (v !== 'agree');
        attHint.style.display = (v !== 'agree') ? 'block' : 'none';
      });
      attQ.appendChild(attHint);
      body.appendChild(attQ);
      body.appendChild(single('structure', '⑤ 面对新任务，你更希望？', structOpts, a.structureNeed, function (v) { a.structureNeed = v; }));
    },

    // ===== 屏 4 社交与资源 =====
    _renderSocial: function (body) {
      body.appendChild(el('h2', 'quiz-screen-title', '你的时间和精力'));
      body.appendChild(el('p', 'quiz-hint', '按你的真实情况选，点选项整行都可以。'));
      var a = state.answers.social;

      function syncAnswered() {
        var q = a.answeredQ;
        a.answered = q.open && q.socialPref && q.recovery && q.hours;
      }

      function single(qkey, label, opts, current, setter) {
        var q = el('div', 'quiz-question'); q.dataset.qkey = qkey;
        q.appendChild(el('div', 'q-text', label));
        var ol = el('div', 'opt-list');
        opts.forEach(function (o) {
          var item = el('div', 'opt' + (current === o.v ? ' selected' : ''));
          var inp = el('input'); inp.type = 'radio'; inp.name = 'social-' + qkey; inp.checked = (current === o.v);
          item.appendChild(inp);
          item.appendChild(el('span', '', o.label));
          item.onclick = function () {
            setter(o.v);
            a.answeredQ[qkey] = true; syncAnswered();
            ol.querySelectorAll('.opt').forEach(function (x) { x.classList.remove('selected'); });
            item.classList.add('selected');
            inp.checked = true;
            q.classList.remove('missing');
          };
          ol.appendChild(item);
        });
        q.appendChild(ol);
        return q;
      }

      var openOpts = [{ v: 1.0, label: '很焦虑，必须做完' }, { v: 0.5, label: '有点惦记' }, { v: 0.1, label: '不太在意' }];
      var socOpts = [{ v: 0.0, label: '自己一个人学' }, { v: 0.5, label: '偶尔和人交流' }, { v: 1.0, label: '必须有人一起学' }];
      var recOpts = [{ v: 0.3, label: '经常熬夜，睡不够' }, { v: 0.65, label: '一般' }, { v: 1.0, label: '规律充足' }];
      var hrsOpts = [{ v: 2, label: '不到 3 小时' }, { v: 5, label: '3–7 小时' }, { v: 10, label: '7–14 小时' }, { v: 18, label: '14 小时以上' }];

      body.appendChild(single('open', '① 有事情没做完悬着，你会？', openOpts, a.openLoop, function (v) { a.openLoop = v; }));
      body.appendChild(single('socialPref', '② 你更喜欢怎么学？', socOpts, a.socialPref, function (v) { a.socialPref = v; }));
      body.appendChild(single('recovery', '③ 你的睡眠休息状况？', recOpts, a.recovery, function (v) { a.recovery = v; }));
      body.appendChild(single('hours', '④ 你每周大约能拿出多少时间学习？', hrsOpts, a.weeklyHours, function (v) { a.weeklyHours = v; }));
    },

    // ===== 屏 5 领域与经验兴趣 =====
    _renderDomains: function (body) {
      body.innerHTML = '';
      body.appendChild(el('h2', 'quiz-screen-title', '你感兴趣的方向'));
      body.appendChild(el('p', 'quiz-hint', '选 1–3 个你想学或正在学的方向（点整行即可勾选），选完再告诉我你的经验和兴趣程度。'));
      var a = state.answers.domains;
      var self = this;

      var grid = el('div', 'opt-list');
      DOMAIN_OPTIONS.forEach(function (d) {
        var checked = a.picks.indexOf(d.key) >= 0;
        var item = el('div', 'opt' + (checked ? ' selected' : ''));
        var inp = el('input'); inp.type = 'checkbox'; inp.checked = checked;
        item.appendChild(inp);
        item.appendChild(el('span', '', d.label));
        item.onclick = function () {
          var idx = a.picks.indexOf(d.key);
          if (idx >= 0) {
            a.picks.splice(idx, 1);
          } else {
            if (a.picks.length >= 3) {
              var warn = $('.domain-warn', body);
              if (!warn) {
                warn = el('div', 'notice warn domain-warn', '最多选 3 个方向，先去掉了再选。');
                body.insertBefore(warn, grid);
              }
              clearTimeout(self._domainWarnT);
              self._domainWarnT = setTimeout(function () { if (warn.parentNode) warn.parentNode.removeChild(warn); }, 1800);
              return;
            }
            a.picks.push(d.key);
            if (!a.matrix[d.key]) { a.matrix[d.key] = { exp: 0.25, int: 0.5 }; }
          }
          a.answered = a.picks.length > 0;
          self._renderDomains(body);
        };
        grid.appendChild(item);
      });
      body.appendChild(grid);

      // 矩阵
      if (a.picks.length > 0) {
        var wrap = el('div', 'card', '');
        wrap.style.marginTop = '14px';
        var tbl = el('table', 'matrix');
        tbl.innerHTML = '<thead><tr><th>方向</th><th>经验</th><th>兴趣（1-5 分）</th></tr></thead>';
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
      var conf = global.LMS.computeConfidence(person);
      person.confidence = conf;
      // 回写到 store（同一用户只有一份画像，覆盖更新；写入时自动备份）
      global.LMS.store.setPerson(person);

      this._renderProfile(body, person);

      // 按钮
      var self = this;
      var acts = el('div', 'row', '');
      acts.style.marginTop = '18px';
      var viewLib = el('button', 'btn', '看看为我推荐的计划');
      viewLib.onclick = function () { if (state.onComplete) state.onComplete(person); };
      acts.appendChild(viewLib);
      var refine = el('button', 'btn secondary', '再答 4 个小问题，让推荐更准');
      refine.onclick = function () { self._renderExtra(body); };
      acts.appendChild(refine);
      body.appendChild(acts);
    },

    // ===== 大白话画像卡（quiz 结果页与 #/result 共用） =====
    _renderProfile: function (body, person) {
      var conf = person.confidence != null ? person.confidence : global.LMS.computeConfidence(person);

      body.appendChild(el('h2', 'quiz-screen-title', '你的学习画像'));
      body.appendChild(el('p', 'quiz-hint', '用大白话总结你的学习特点。之后每次补答和完成反馈，都会让它更准。'));

      var grid = el('div', 'result-grid');

      // 1. 你的吃力程度（5 级标识，替代分数）
      var b = Math.round(person.baseline);
      var lv = global.LMS.levelOf(b);
      var LV_DESC = {
        '很轻松': '同样的内容，你学起来比大多数人轻松，可以大胆加量。',
        '比较轻松': '你学东西挺轻松的，稍微加一点量也没问题。',
        '刚刚好': '难度适中的内容最适合你，太难的任务我们会帮你拆小。',
        '有点吃力': '你比较容易累，我们会把任务切得更小、排得更松。',
        '太吃力': '你很容易累，我们会把任务切得特别小、安排得特别松。'
      };
      var card1 = el('div', 'card');
      card1.appendChild(el('div', '', '你的吃力程度'));
      card1.appendChild(el('div', 'big-number', '<span style="color:' + lv.color + '">' + lv.label + '</span>'));
      card1.appendChild(el('p', 'quiz-hint', LV_DESC[lv.label] || ''));
      grid.appendChild(card1);

      // 2. 画像准确度（5 级标识，替代百分比）
      var conf = person.confidence != null ? person.confidence : 0.3;
      var confTone = conf >= 0.85 ? { t: '很准', c: '#3FB950' }
        : conf >= 0.7 ? { t: '比较准', c: '#39C5BB' }
        : conf >= 0.5 ? { t: '一般', c: '#D29922' }
        : conf >= 0.3 ? { t: '还不太准', c: '#F0883E' }
        : { t: '不太准', c: '#F85149' };
      var card2 = el('div', 'card');
      card2.appendChild(el('div', '', '画像准确度'));
      var ringWrap = el('div', 'confidence-ring');
      ringWrap.appendChild(this._confidenceRingSVG(conf));
      var ringMeta = el('div', '');
      ringMeta.innerHTML = '<div style="font-size:24px;font-weight:800;color:' + confTone.c + ';">' + confTone.t + '</div>';
      ringWrap.appendChild(ringMeta);
      card2.appendChild(ringWrap);
      card2.appendChild(el('p', 'quiz-hint', '答得越完整、反馈给得越多，画像就越准，推荐也越贴心。'));
      grid.appendChild(card2);

      // 3. 最适合你的学习方式
      var topCh = 'hands', topV = -1;
      Object.keys(person.channel || {}).forEach(function (k) {
        if (person.channel[k] > topV) { topV = person.channel[k]; topCh = k; }
      });
      var card3 = el('div', 'card');
      card3.appendChild(el('div', '', '最适合你的学习方式'));
      card3.appendChild(el('div', '', '<b style="font-size:18px;color:var(--primary)">' + (CHANNEL_LABELS[topCh] || topCh) + '</b>'));
      var radarWrap = el('div', 'radar-wrap');
      radarWrap.appendChild(this._channelRadarSVG(person.channel));
      card3.appendChild(radarWrap);
      card3.appendChild(el('p', 'quiz-hint', '雷达图上越靠外的方式，对你越有效。'));
      grid.appendChild(card3);

      // 4. 你的学习节奏
      var blockTxt = person.block <= 20 ? '20 分钟以内' : person.block <= 45 ? '20–45 分钟' : person.block <= 90 ? '45–90 分钟' : '90 分钟以上';
      var hrsTxt = person.weeklyHours <= 2 ? '不到 3 小时' : person.weeklyHours <= 5 ? '3–7 小时' : person.weeklyHours <= 14 ? '7–14 小时' : '14 小时以上';
      var recTxt = person.recovery >= 0.8 ? '规律充足' : person.recovery >= 0.5 ? '一般' : '经常熬夜，需要补觉';
      var card4 = el('div', 'card');
      card4.appendChild(el('div', '', '你的学习节奏'));
      card4.appendChild(el('p', 'quiz-hint',
        '· 一次大约能高效专注 <b>' + blockTxt + '</b><br>' +
        '· 脑子最清醒的时段：<b>' + (TIME_LABELS[person.peakTime] || '早晨') + '</b><br>' +
        '· 每周大约能投入 <b>' + hrsTxt + '</b><br>' +
        '· 睡眠休息：<b>' + recTxt + '</b>'));
      grid.appendChild(card4);

      body.appendChild(grid);

      // 5. 你关注的方向（整宽）
      var dkeys = Object.keys(person.domains || {});
      if (dkeys.length > 0) {
        var card5 = el('div', 'card');
        card5.style.marginTop = '14px';
        card5.appendChild(el('div', '', '你关注的方向'));
        var rows = dkeys.map(function (k) {
          var dom = DOMAIN_OPTIONS.filter(function (d) { return d.key === k; })[0];
          var dd = person.domains[k];
          var expLabel = '看过介绍';
          EXP_OPTIONS.forEach(function (o) { if (Math.abs(dd.experience - o.v) < 0.01) expLabel = o.label; });
          var intScore = Math.round((dd.interest != null ? dd.interest : 0) * 4 + 1);
          return '<div class="plan-item"><div class="pi-name">' + (dom ? dom.label : k) + '</div>' +
            '<span class="tag">兴趣 ' + intScore + '/5</span> <span class="tag">经验：' + expLabel + '</span></div>';
        }).join('');
        card5.appendChild(el('div', '', rows));
        body.appendChild(card5);
      }
    },

    _renderExtra: function (body) {
      body.innerHTML = '';
      body.appendChild(el('h2', 'quiz-screen-title', '让推荐更准（可选）'));
      body.appendChild(el('p', 'quiz-hint', '再回答 4 个小问题，让推荐更贴合你。拖一拖滑块就行。'));
      var a = state.answers.extra;

      function slider(label, getter, setter) {
        var q = el('div', 'quiz-question');
        q.appendChild(el('div', 'q-text', label));
        var r = el('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = getter();
        r.oninput = function () { setter(+r.value); a.answered = true; };
        q.appendChild(r);
        return q;
      }

      body.appendChild(slider('你想学东西的劲头（左=不太想学，右=特别想学）', function () { return a.motivation; }, function (v) { a.motivation = v; }));
      body.appendChild(slider('你周围的环境（左=很安静，右=很吵闹）', function () { return a.distraction; }, function (v) { a.distraction = v; }));
      body.appendChild(slider('学得慢的时候你（左=会着急，右=不着急）', function () { return a.slowTolerance; }, function (v) { a.slowTolerance = v; }));
      body.appendChild(slider('要给别人看学习成果时（左=不在意，右=很紧张）', function () { return a.evalAnxiety; }, function (v) { a.evalAnxiety = v; }));

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
        cfg.weights = global.LMS.normalizeWeights(w2);
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
      // 校准：已有画像的校准与反馈历史保持一致，持续微调；首次则 k=1, b=T-50
      var existing = global.LMS.store.getPerson();
      if (existing && existing.calibration) {
        p.calibration = existing.calibration;
      } else {
        p.calibration = { k: 1, b: p.baseline - 50 };
      }

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
        p.answered.structure = true;
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

      // stateIndex：保留已有画像的今日状态（首次用默认 0.6）
      if (existing && existing.stateIndex != null) {
        p.stateIndex = existing.stateIndex;
      } else {
        p.stateIndex = 0.6;
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
