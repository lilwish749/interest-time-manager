/* 排程引擎 —— 纯函数，UMD 风格（浏览器 window.LMS.scheduler，Node 里 require）
 * 输入输出都是普通对象，不读写 DOM 和 localStorage，不使用 Math.random / Date.now
 * 时间、顺序、间隔、容量由本文件算；「做什么/交付什么/注意什么」来自活动数据的执行卡
 */
(function (root) {
  'use strict';

  var WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* 一天里的时段划分，用于把钟点归到一个「时段标签」，跟 bestTime / peakTime 对齐 */
  function periodOf(min) {
    if (min < 5 * 60) return 'night';       // 凌晨算深夜
    if (min < 8 * 60) return 'morning';     // 早晨
    if (min < 12 * 60) return 'forenoon';   // 上午
    if (min < 17 * 60) return 'afternoon';  // 下午
    if (min < 20 * 60) return 'evening';    // 傍晚
    return 'night';                          // 深夜
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function round5(x) { return Math.round(x / 5) * 5; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 取引擎（浏览器里 engine.js 先加载；Node 里按需 require 同目录的 engine.js） */
  function engineApi() {
    if (root.LMS && root.LMS.scoreActivity) return root.LMS;
    if (typeof require === 'function') {
      try {
        var e = require('./engine.js');
        root.LMS = Object.assign(root.LMS || {}, e);
      } catch (err) { /* 没有引擎时退化为零分，不抛错 */ }
    }
    return root.LMS || {};
  }

  function toMin(hhmm) {
    var p = String(hhmm == null ? '' : hhmm).split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    if (h < 0 || h > 24 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }
  function toHHMM(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return pad2(h) + ':' + pad2(m);
  }

  /* ───────── 日期工具（全部走 UTC，避免时区/夏令时影响确定性） ───────── */
  function parseDateStr(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  function formatDateStr(utcMs) {
    var d = new Date(utcMs);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function normalizeWeekStart(weekStart) {
    var ms;
    if (weekStart instanceof Date) {
      ms = Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    } else {
      ms = parseDateStr(weekStart);
    }
    if (ms == null) return null;
    var dow = new Date(ms).getUTCDay();            // 0=周日
    var back = (dow + 6) % 7;                      // 距离上一个周一的天数
    return ms - back * 86400000;
  }
  function addDays(ms, n) { return ms + n * 86400000; }

  /* ───────── 可用时段 ───────── */
  function normalizeAvailability(availability) {
    var av = availability || {};
    return {
      workday: Array.isArray(av.workday) ? av.workday : [],
      weekend: Array.isArray(av.weekend) ? av.weekend : [],
      restDay: Array.isArray(av.restDay) ? av.restDay : []
    };
  }

  /* 某一天可用的时段列表；非法段（end <= start）直接跳过并返回坏段清单 */
  function segmentsForDate(av, dayIndex, weekdayName) {
    if (av.restDay.indexOf(weekdayName) >= 0) { return { segs: [], invalid: [] }; }
    var raw = (dayIndex === 6 || dayIndex === 0) ? av.weekend : av.workday;
    var segs = [], invalid = [];
    raw.forEach(function (s) {
      var a = toMin(s && s.start), b = toMin(s && s.end);
      if (a == null || b == null || b <= a) { invalid.push({ start: s && s.start, end: s && s.end }); return; }
      segs.push({ start: a, end: b });
    });
    segs.sort(function (x, y) { return x.start - y.start; });
    return { segs: segs, invalid: invalid };
  }

  /* ───────── 单次时长 / 次数 ───────── */
  function sessionPlan(person, act, hours) {
    var block = clamp(person && person.block != null ? person.block : 45, 45, 90);
    var focus = act.focusNeedMin != null ? act.focusNeedMin : 30;
    var duration = clamp(round5(Math.min(focus * 1.2, block)), 25, 90);
    var h = hours != null ? hours : 1;
    var sessions = clamp(Math.round(h * 60 / duration), 1, 6);
    return { duration: duration, sessions: sessions, focus: focus, blockCap: block, short: duration < focus };
  }

  /* ───────── 执行卡轮转 ─────────
   * 按该活动已完成的步数决定这次用第几张卡；全部做完回到第 1 张并标注「复习」 */
  function pickCard(act, doneCount) {
    var cards = (act && act.cards) || [];
    var total = cards.length;
    if (total === 0) {
      return { step: 1, stepTotal: 1, action: '按你自己的节奏做这一项', deliverable: '', tip: '', review: false };
    }
    var done = doneCount || 0;
    if (done >= total) {
      var c0 = cards[0];
      return { step: c0.step != null ? c0.step : 1, stepTotal: total,
        action: c0.action, deliverable: c0.deliverable, tip: c0.tip, review: true };
    }
    var card = cards[done];
    return { step: card.step != null ? card.step : done + 1, stepTotal: total,
      action: card.action, deliverable: card.deliverable, tip: card.tip, review: false };
  }

  /* ───────── 当天加成：第 2 个高负荷 ×1.15，第 3 个及以上 ×1.30 ─────────
   * 阈值与 engine.js 的 dailyPenalty 保持一致（score > 70），保证两处口径相同 */
  function dayPenalty(dayBlocks, idx) {
    if (idx === 0) return 1;
    var priorHigh = 0;
    for (var i = 0; i < idx && i < dayBlocks.length; i++) {
      if (dayBlocks[i].score > 70) priorHigh++;
    }
    return priorHigh === 0 ? 1 : priorHigh === 1 ? 1.15 : 1.30;
  }

  /* ───────── 周负荷：唯一真相 ─────────
   * 有时间表 → 按时间表里的实际块重算；没有时间表 → 回退到 engine 的算法 */
  var LOAD_ZONES = [
    { max: 70, key: 'low', label: '有余量可加量', color: '#3FB950' },
    { max: 101, key: 'comfort', label: '正常', color: '#58A6FF' },
    { max: 111, key: 'optimal', label: '提示降载', color: '#D29922' },
    { max: Infinity, key: 'over', label: '强提示恢复', color: '#F85149' }
  ];
  function loadZoneOf(pct) {
    for (var i = 0; i < LOAD_ZONES.length; i++) { if (pct < LOAD_ZONES[i].max) return LOAD_ZONES[i]; }
    return LOAD_ZONES[LOAD_ZONES.length - 1];
  }

  function computeWeekLoad(person, plan, timetable, scoredByActivity) {
    var scored = scoredByActivity || {};
    var eng = engineApi();
    var cap = eng.weeklyCapacity
      ? eng.weeklyCapacity(person)
      : ((person && person.weeklyHours) || 8) * 50 * (0.7 + 0.6 * ((person && person.recovery) != null ? person.recovery : 0.7));
    if (cap <= 0) return { percent: 0, capacity: 0, zone: loadZoneOf(0) };

    if (timetable && Array.isArray(timetable.days) && timetable.days.length > 0) {
      var hasBlocks = false;
      var sum = 0;
      timetable.days.forEach(function (day) {
        var blocks = (day.blocks || []).slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
        if (blocks.length) hasBlocks = true;
        blocks.forEach(function (b, i) {
          var sc = scored[b.activityId];
          var score = sc ? sc.score : (b.score != null ? b.score : 0);
          var hours = (b.minutes || 0) / 60;
          sum += score * dayPenalty(blocks, i) * hours;
        });
      });
      if (hasBlocks) {
        var pct = sum / cap * 100;
        return { percent: Math.round(pct * 10) / 10, capacity: Math.round(cap), zone: loadZoneOf(pct) };
      }
    }
    /* 回退：没有时间表时沿用 engine 的算法，老用户数据不变 */
    if (eng.weeklyLoadPercent) {
      return eng.weeklyLoadPercent(person, plan, scored);
    }
    return { percent: 0, capacity: Math.round(cap), zone: loadZoneOf(0) };
  }

  /* ───────── 放置约束（H1–H7） ───────── */
  function canPlace(day, sess, startMin, activityId, sessionCount) {
    var duration = sess.duration;
    var endMin = startMin + duration;
    var blocks = day.blocks;

    /* H3 同一天总分钟数 ≤ 240 */
    if (day.totalMinutes + duration > 240) return false;

    /* H1 同一活动同一天最多 1 次；该活动本周有多块时放宽为最多 2 次且间隔 ≥ 4 小时 */
    var same = blocks.filter(function (b) { return b.activityId === activityId; });
    var limit = sessionCount >= 2 ? 2 : 1;
    if (same.length >= limit) return false;
    if (limit === 2 && same.length === 1) {
      var o = same[0];
      var gap = Math.max(startMin - o.endMin, o.startMin - endMin);
      if (gap < 240) return false;
    }

    /* H2 同一天 score > 75 的块最多 1 个 */
    if (sess.score > 75 && blocks.some(function (b) { return b.score > 75; })) return false;

    /* H4 块与块之间至少间隔 10 分钟（含不重叠） */
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var ok = (endMin + 10 <= b.startMin) || (b.endMin + 10 <= startMin);
      if (!ok) return false;
    }
    return true;
  }

  /* 按天生成候选起点：天内按时段顺序、以 15 分钟为步长（H5：整块必须落在同一段内） */
  function candidatesForDay(day) {
    var out = [];
    day.segs.forEach(function (seg) {
      for (var t = seg.start; t + 15 <= seg.end; t += 15) { out.push(t); }
    });
    return out;
  }

  /* ───────── 目标函数 J ───────── */
  function computeJ(days, activitiesById) {
    var unmatchedBest = 0, conflicts = 0, consecutive = 0, matchTerm = 0;
    days.forEach(function (day, di) {
      var n75 = 0;
      day.blocks.forEach(function (b) {
        var act = activitiesById[b.activityId];
        var best = (act && act.bestTime && act.bestTime.length) ? act.bestTime : null;
        if (best && best.indexOf(periodOf(b.startMin)) < 0) unmatchedBest++;
        if (b.score > 75) n75++;
        matchTerm += (100 - (b.match != null ? b.match : 0)) / 10;
      });
      if (n75 > 1) conflicts += n75 * (n75 - 1) / 2;
    });
    /* 同一活动连续两天出现 */
    var byAct = {};
    days.forEach(function (day, di) {
      day.blocks.forEach(function (b) {
        if (!byAct[b.activityId]) byAct[b.activityId] = [];
        byAct[b.activityId].push(di);
      });
    });
    Object.keys(byAct).forEach(function (id) {
      var idx = byAct[id].slice().sort(function (a, b) { return a - b; });
      for (var i = 1; i < idx.length; i++) { if (idx[i] - idx[i - 1] === 1) consecutive++; }
    });
    return 5 * unmatchedBest + 3 * conflicts + 2 * consecutive + matchTerm;
  }

  /* ───────── 收尾：算 loadFactor / weekLoad / 校验 ───────── */
  function finalize(input, days, unscheduled, warnings) {
    days.forEach(function (day) {
      var blocks = day.blocks.slice().sort(function (a, b) { return a.startMin - b.startMin; });
      blocks.forEach(function (b, i) { b.loadFactor = dayPenalty(blocks, i); });
      day.blocks = blocks;
      day.totalMinutes = blocks.reduce(function (s, b) { return s + b.minutes; }, 0);
    });
    var tt = {
      weekStart: formatDateStr(input.weekStartMs),
      weekLoad: 0,
      days: days.map(function (d) {
        return {
          date: d.date,
          weekday: d.weekday,
          totalMinutes: d.totalMinutes,
          blocks: d.blocks.map(function (b) { return toOutBlock(b, d); })
        };
      }),
      unscheduled: unscheduled,
      warnings: warnings
    };
    var wl = computeWeekLoad(input.person, input.plan, tt, input.scored);
    tt.weekLoad = Math.round(wl.percent);
    tt.weekLoadZone = wl.zone;
    tt.capacity = wl.capacity;
    tt.errors = validateTimetable(tt);
    return tt;
  }

  function toOutBlock(b, day) {
    var act = b.act || {};
    return {
      activityId: b.activityId,
      title: b.title,
      start: toHHMM(b.startMin),
      end: toHHMM(b.endMin),
      minutes: b.minutes,
      step: b.step,
      stepTotal: b.stepTotal,
      review: !!b.review,
      action: b.action,
      deliverable: b.deliverable,
      tip: b.tip,
      score: b.score,
      match: b.match,
      zone: b.zone,
      loadFactor: b.loadFactor
    };
  }

  /* ───────── 主函数 ───────── */
  function buildTimetable(input) {
    input = input || {};
    var person = input.person || {};
    var activities = Array.isArray(input.activities) ? input.activities : [];
    var plan = Array.isArray(input.plan) ? input.plan : [];
    var done = Array.isArray(input.done) ? input.done : [];
    var avail = normalizeAvailability(input.availability);
    var warnings = [];
    var unscheduled = [];

    var weekStartMs = normalizeWeekStart(input.weekStart);
    if (weekStartMs == null) {
      return { weekStart: '', weekLoad: 0, days: [], unscheduled: [], warnings: ['本周的起始日期不合法，无法排程'], errors: ['weekStart 不合法'] };
    }

    var activitiesById = {};
    activities.forEach(function (a) { if (a && a.id) activitiesById[a.id] = a; });

    /* 评分表 */
    var scored = input.scored;
    if (!scored) {
      scored = {};
      var engine = engineApi();
      activities.forEach(function (a) {
        if (!a || !a.id) return;
        scored[a.id] = engine.scoreActivity ? engine.scoreActivity(person, a) : { score: 0, match: 0, zone: { key: 'low' } };
      });
    }

    /* 建 7 天骨架 */
    var days = [];
    for (var i = 0; i < 7; i++) {
      var ms = addDays(weekStartMs, i);
      var dow = new Date(ms).getUTCDay();
      var name = WEEKDAY_NAMES[dow];
      var sres = segmentsForDate(avail, dow, name);
      sres.invalid.forEach(function (bad) {
        warnings.push(name + '的可用时段 ' + (bad.start || '?') + '–' + (bad.end || '?') + ' 不合法（结束时间不晚于开始时间），已跳过');
      });
      days.push({
        index: i, date: formatDateStr(ms), weekday: name, dow: dow,
        segs: sres.segs, blocks: [], totalMinutes: 0
      });
    }
    /* 留白日直接不生成任何候选（H6） */
    days.forEach(function (d) { if (d.segs.length === 0 && avail.restDay.indexOf(d.weekday) >= 0) { d.rest = true; } });

    /* 展开成候选 session */
    var sessions = [];
    var doneCountByAct = {};
    plan.forEach(function (item) {
      if (!item || item.hours == null || !(item.hours > 0)) return;      // hours 为 0 或负数 → 忽略
      var act = activitiesById[item.activityId];
      if (!act) {                                                        // 计划里引用了不存在的活动 → 跳过并记 warning
        warnings.push('计划里的活动「' + item.activityId + '」在活动库中找不到，已跳过');
        return;
      }
      var sp2 = sessionPlan(person, act, item.hours);
      if (sp2.short) {
        warnings.push('「' + act.name + '」单次需要 ' + sp2.focus + ' 分钟，超过你的专注块（' + sp2.blockCap + ' 分钟），建议拆分');
      }
      if (!doneCountByAct[act.id]) { doneCountByAct[act.id] = done.filter(function (x) { return x && x.activityId === act.id; }).length; }
      var card = pickCard(act, doneCountByAct[act.id]);
      var sc = scored[act.id] || { score: 0, match: 0, zone: { key: 'low' } };
      for (var k = 0; k < sp2.sessions; k++) {
        sessions.push({
          activityId: act.id,
          title: act.name,
          act: act,
          duration: sp2.duration,
          sessions: sp2.sessions,
          score: sc.score,
          match: sc.match,
          zone: sc.zone.key,
          step: card.step, stepTotal: card.stepTotal,
          action: card.action, deliverable: card.deliverable, tip: card.tip, review: card.review
        });
      }
    });

    /* 排序：能否落在 bestTime ∩ peakTime（能=0） → score 降序 → activityId 字典序 */
    function canMatchIntersection(s) {
      var best = (s.act && s.act.bestTime && s.act.bestTime.length) ? s.act.bestTime : null;
      if (!best) return 1;
      var peak = person.peakTime;
      if (!peak) return 1;
      return best.indexOf(peak) >= 0 ? 0 : 1;
    }
    sessions.sort(function (a, b) {
      var ka = canMatchIntersection(a), kb = canMatchIntersection(b);
      if (ka !== kb) return ka - kb;
      if (a.score !== b.score) return b.score - a.score;
      return a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0;
    });

    /* 放置：每个 session 分三档找位置
     *   1) 落在 bestTime ∩ peakTime 的槽
     *   2) 落在 bestTime 的槽
     *   3) 任意合法槽
     * 这样「时段匹配」真的在起作用，而不是随便找空位填 */
    var unplaced = {};
    sessions.forEach(function (s) {
      var best = (s.act && s.act.bestTime && s.act.bestTime.length) ? s.act.bestTime : null;
      var peak = person.peakTime;
      var passes = [];
      if (best && peak && best.indexOf(peak) >= 0) passes.push(function (min) { return best.indexOf(periodOf(min)) >= 0 && periodOf(min) === peak; });
      if (best) passes.push(function (min) { return best.indexOf(periodOf(min)) >= 0; });
      passes.push(function () { return true; });

      for (var p = 0; p < passes.length; p++) {
        var placed = false;
        for (var di = 0; di < days.length && !placed; di++) {
          var day = days[di];
          if (day.segs.length === 0) continue;
          var cands = candidatesForDay(day);
          for (var ci = 0; ci < cands.length; ci++) {
            var start = cands[ci];
            if (!passes[p](start)) continue;
            if (!canPlace(day, s, start, s.activityId, s.sessions)) continue;
            day.blocks.push({
              activityId: s.activityId, title: s.title, act: s.act,
              startMin: start, endMin: start + s.duration, minutes: s.duration,
              step: s.step, stepTotal: s.stepTotal, review: s.review,
              action: s.action, deliverable: s.deliverable, tip: s.tip,
              score: s.score, match: s.match, zone: s.zone, loadFactor: 1
            });
            day.totalMinutes += s.duration;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) { unplaced[s.activityId] = true; }
    });

    Object.keys(unplaced).forEach(function (id) {
      unscheduled.push({ activityId: id, reason: '本周可用时段不够，排不下' });
    });

    /* 局部改进：最多 2 轮，固定顺序，不引入随机数 */
    for (var round = 0; round < 2; round++) {
      var improved = false;
      for (var di2 = 0; di2 < days.length; di2++) {
        var day2 = days[di2];
        var ordered = day2.blocks.slice().sort(function (a, b) { return a.startMin - b.startMin; });
        for (var bi = 0; bi < ordered.length; bi++) {
          var block = ordered[bi];
          var j0 = computeJ(days, activitiesById);
          /* 临时移除 */
          var pos = day2.blocks.indexOf(block);
          if (pos < 0) continue;
          day2.blocks.splice(pos, 1);
          day2.totalMinutes -= block.minutes;
          var bestJ = j0, bestDay = null, bestStart = null;
          for (var dj = 0; dj < days.length; dj++) {
            var day3 = days[dj];
            if (day3.segs.length === 0) continue;
            var cands3 = candidatesForDay(day3);
            for (var cj = 0; cj < cands3.length; cj++) {
              var st = cands3[cj];
              var sess = { duration: block.minutes, score: block.score };
              if (!canPlace(day3, sess, st, block.activityId, 1)) continue;
              day3.blocks.push({ activityId: block.activityId, title: block.title, act: block.act,
                startMin: st, endMin: st + block.minutes, minutes: block.minutes,
                step: block.step, stepTotal: block.stepTotal, review: block.review,
                action: block.action, deliverable: block.deliverable, tip: block.tip,
                score: block.score, match: block.match, zone: block.zone, loadFactor: 1 });
              day3.totalMinutes += block.minutes;
              var j1 = computeJ(days, activitiesById);
              day3.blocks.pop();
              day3.totalMinutes -= block.minutes;
              if (j1 < bestJ - 1e-9) { bestJ = j1; bestDay = day3; bestStart = st; }
            }
          }
          if (bestDay) {
            bestDay.blocks.push({ activityId: block.activityId, title: block.title, act: block.act,
              startMin: bestStart, endMin: bestStart + block.minutes, minutes: block.minutes,
              step: block.step, stepTotal: block.stepTotal, review: block.review,
              action: block.action, deliverable: block.deliverable, tip: block.tip,
              score: block.score, match: block.match, zone: block.zone, loadFactor: 1 });
            bestDay.totalMinutes += block.minutes;
            improved = true;
          } else {
            day2.blocks.push(block);
            day2.totalMinutes += block.minutes;
          }
        }
      }
      if (!improved) break;
    }

    return finalize({ person: person, plan: plan, scored: scored, weekStartMs: weekStartMs }, days, unscheduled, warnings);
  }

  /* ───────── 输出校验（前端渲染前必须调用） ───────── */
  function validateTimetable(tt) {
    var errs = [];
    if (!tt || !Array.isArray(tt.days)) return ['timetable.days 不是数组'];
    var byActDay = {};
    var weekCount = {};
    tt.days.forEach(function (day) {
      (day.blocks || []).forEach(function (b) {
        weekCount[b.activityId] = (weekCount[b.activityId] || 0) + 1;
      });
    });
    tt.days.forEach(function (day) {
      var seen75 = 0;
      var blocks = (day.blocks || []).slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
      var total = 0;
      blocks.forEach(function (b, i) {
        var s = toMin(b.start), e = toMin(b.end);
        if (!/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end)) {
          errs.push(day.weekday + '「' + b.title + '」时间格式不是 HH:MM');
        }
        if (s == null || e == null || !(e > s)) { errs.push(day.weekday + '「' + b.title + '」结束时间没有晚于开始时间'); }
        else if (b.minutes !== e - s) { errs.push(day.weekday + '「' + b.title + '」minutes 与时间段长度不一致'); }
        if (!(b.step >= 1 && b.step <= b.stepTotal)) { errs.push(day.weekday + '「' + b.title + '」step 不在 1..stepTotal 范围内'); }
        /* H1：同一活动同一天最多 1 次；该活动本周有多块时放宽为 2 次且间隔 ≥ 4 小时 */
        var key = b.activityId + '@' + day.date;
        if (!byActDay[key]) byActDay[key] = [];
        var sameList = byActDay[key];
        var limit = (weekCount[b.activityId] || 1) >= 2 ? 2 : 1;
        if (sameList.length >= limit) {
          errs.push(day.weekday + '同一活动「' + b.title + '」出现了不止 ' + limit + ' 次');
        } else if (sameList.length === 1) {
          var prev = sameList[0];
          var gap = Math.max(s - prev.e, prev.s - e);
          if (gap < 240) { errs.push(day.weekday + '同一活动「' + b.title + '」两次间隔不足 4 小时'); }
        }
        sameList.push({ s: s, e: e });
        /* H2 */
        if (b.score > 75) seen75++;
        /* H4 */
        if (i > 0) {
          var prevEnd = toMin(blocks[i - 1].end);
          if (s - prevEnd < 10) { errs.push(day.weekday + '「' + b.title + '」与上一块间隔不足 10 分钟'); }
        }
        total += b.minutes;
      });
      if (seen75 > 1) { errs.push(day.weekday + '有 ' + seen75 + ' 个高负荷块（score > 75），超过 1 个'); }
      /* H3 */
      if (total > 240) { errs.push(day.weekday + '总时长 ' + total + ' 分钟，超过 240 分钟'); }
    });
    return errs;
  }

  /* ───────── 换时间：给出当天所有合法空槽 ───────── */
  function legalStartsFor(input, date, blockIndex) {
    var tt = input.timetable;
    if (!tt || !Array.isArray(tt.days)) return [];
    var avail = normalizeAvailability(input.availability);
    var person = input.person || {};
    var scored = input.scored || {};
    var day = tt.days.filter(function (d) { return d.date === date; })[0];
    if (!day) return [];
    var block = (day.blocks || [])[blockIndex];
    if (!block) return [];

    var ms = parseDateStr(date);
    var dow = ms == null ? 1 : new Date(ms).getUTCDay();
    var name = WEEKDAY_NAMES[dow];
    /* dow 0=周日、6=周六，其余按工作日处理；segmentsForDate 用 0/6 判定周末 */
    var segIndex = (dow === 0 || dow === 6) ? 6 : 1;
    var r2 = segmentsForDate(avail, segIndex, name);
    if (r2.segs.length === 0) return [];

    var others = (day.blocks || []).filter(function (b, i) { return i !== blockIndex; })
      .map(function (b) { return { startMin: toMin(b.start), endMin: toMin(b.end), score: b.score, activityId: b.activityId }; });
    var sc = scored[block.activityId];
    var sess = { duration: block.minutes, score: sc ? sc.score : block.score };
    var out = [];
    var fakeDay = { blocks: others, totalMinutes: others.reduce(function (s, b) { return s + (b.endMin - b.startMin); }, 0), segs: r2.segs };
    r2.segs.forEach(function (seg) {
      for (var t = seg.start; t + block.minutes <= seg.end; t += 15) {
        if (canPlace(fakeDay, sess, t, block.activityId, 1)) { out.push(toHHMM(t)); }
      }
    });
    return out;
  }

  /* ───────── 移动到新时间：返回新的 timetable ───────── */
  function applyMove(input, date, blockIndex, newStart) {
    var tt = input.timetable;
    if (!tt || !Array.isArray(tt.days)) return tt;
    var day = tt.days.filter(function (d) { return d.date === date; })[0];
    if (!day || !day.blocks[blockIndex]) return tt;
    var block = day.blocks[blockIndex];
    var sm = toMin(newStart);
    if (sm == null) return tt;
    block.start = toHHMM(sm);
    block.end = toHHMM(sm + block.minutes);

    /* 重新算每天都加成 + 周负荷 + 校验 */
    var days = tt.days.map(function (d) {
      var blocks = (d.blocks || []).slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
      blocks.forEach(function (b, i) { b.loadFactor = dayPenalty(blocks, i); });
      return {
        date: d.date, weekday: d.weekday,
        totalMinutes: blocks.reduce(function (s, b) { return s + b.minutes; }, 0),
        blocks: blocks
      };
    });
    tt.days = days;
    var wl = computeWeekLoad(input.person, input.plan, tt, input.scored);
    tt.weekLoad = Math.round(wl.percent);
    tt.weekLoadZone = wl.zone;
    tt.capacity = wl.capacity;
    tt.errors = validateTimetable(tt);
    return tt;
  }

  var API = {
    buildTimetable: buildTimetable,
    validateTimetable: validateTimetable,
    computeWeekLoad: computeWeekLoad,
    legalStartsFor: legalStartsFor,
    applyMove: applyMove,
    periodOf: periodOf,
    WEEKDAY_NAMES: WEEKDAY_NAMES
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  root.LMS = root.LMS || {};
  root.LMS.scheduler = API;
})(typeof window !== 'undefined' ? window : globalThis);
