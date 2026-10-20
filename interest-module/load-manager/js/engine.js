/* 评分引擎 —— UMD 风格，纯函数，浏览器和 Node 均可使用 */
/* 6 正向分量(IL/EL/ML/TL/SL/PL) + 1 负向分量(UL) */
(function (root) {
  'use strict';

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* ───────── 分区 ───────── */
  var ZONES = [
    { max: 15,  key: 'under',   label: '挑战不足',   color: '#39C5BB' },
    { max: 35,  key: 'low',     label: '低负荷',     color: '#3FB950' },
    { max: 58,  key: 'comfort', label: '舒适区',     color: '#58A6FF' },
    { max: 76,  key: 'optimal', label: '最佳学习区', color: '#D29922' },
    { max: 90,  key: 'high',    label: '高负荷',     color: '#F0883E' },
    { max: 101, key: 'over',    label: '过载',       color: '#F85149' }
  ];

  function zoneOf(score) {
    score = clamp(score, 0, 100);
    for (var i = 0; i < ZONES.length; i++) {
      if (score < ZONES[i].max) return ZONES[i];
    }
    return ZONES[ZONES.length - 1];
  }

  /* 匹配度：66 分为理想点 */
  function matchOf(score) {
    return clamp(100 - Math.abs(score - 66) * 1.8, 0, 100);
  }

  /* ───────── 5 级通俗标识（仅用于界面展示，不参与评分逻辑） ───────── */
  /* 负荷分（0-100）→ 5 级 */
  var LEVELS = [
    { max: 35,  label: '很轻松',   color: '#3FB950' },
    { max: 58,  label: '比较轻松', color: '#58A6FF' },
    { max: 76,  label: '刚刚好',   color: '#D29922' },
    { max: 90,  label: '有点吃力', color: '#F0883E' },
    { max: 101, label: '太吃力',   color: '#F85149' }
  ];
  function levelOf(score) {
    score = clamp(score, 0, 100);
    for (var i = 0; i < LEVELS.length; i++) {
      if (score < LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }
  /* 周负荷 / 日负荷百分比 → 5 级 */
  function levelOfPercent(pct) {
    if (pct < 40)  return { label: '很轻松',   color: '#3FB950' };
    if (pct < 70)  return { label: '比较轻松', color: '#58A6FF' };
    if (pct < 100) return { label: '刚刚好',   color: '#D29922' };
    if (pct < 120) return { label: '有点吃力', color: '#F0883E' };
    return { label: '太吃力', color: '#F85149' };
  }

  /* ───────── 核心评分 ───────── */
  var W = { IL: 0.26, EL: 0.20, ML: 0.18, TL: 0.14, SL: 0.12, PL: 0.10 };

  function scoreActivity(person, activity) {
    person = person || {};
    activity = activity || {};
    var dom = (person.domains && person.domains[activity.domain]) || {};
    var E = dom.experience != null ? dom.experience : 0.3;
    var I = dom.interest != null ? dom.interest : 0.3;

    var D1 = activity.D1 != null ? activity.D1 : 0.5;
    var D2 = activity.D2 != null ? activity.D2 : 0.5;
    var D4 = activity.D4 != null ? activity.D4 : 0.5;
    var D5 = activity.D5 != null ? activity.D5 : 0.5;
    var D6 = activity.D6 != null ? activity.D6 : 0.1;
    var D7 = activity.D7 != null ? activity.D7 : 0.5;

    /* IL —— 内在认知负荷 */
    var IL = D1 * (0.7 + 0.3 * D2) * Math.max(0.15, 1 - 0.6 * E);

    /* EL —— 外在环境负荷（通道不匹配 + 社交偏好差） */
    var ch = person.channel || { read: 0.25, audiovisual: 0.25, hands: 0.25, social: 0.25 };
    var ach = activity.channel || { read: 0.25, audiovisual: 0.25, hands: 0.25, social: 0.25 };
    var dot = 0;
    ['read', 'audiovisual', 'hands', 'social'].forEach(function (k) {
      dot += (ch[k] || 0) * (ach[k] || 0);
    });
    var mismatch = (1 - dot) / 0.75;
    var socialPref = person.socialPref != null ? person.socialPref : 0.1;
    var EL = 0.7 * mismatch + 0.3 * Math.abs(D6 - socialPref);

    /* ML —— 动机负荷 */
    var ML = Math.pow(1 - I, 1.5);

    /* TL —— 时间负荷 */
    var peakTime = person.peakTime || 'morning';
    var chrono = (activity.bestTime && activity.bestTime.indexOf(peakTime) >= 0) ? 1 : 0.5;
    var block = person.block || 45;
    var focusNeedMin = activity.focusNeedMin || 30;
    var ratio = clamp(focusNeedMin / block, 0.5, 2);
    var TL = Math.min(1, (ratio / 2) * (1.5 - 0.5 * chrono));

    /* SL —— 切换负荷（structureNeed 仅在此出现一次） */
    var structureNeed = person.structureNeed != null ? person.structureNeed : 0.5;
    var stuck = person.stuck || 'search';
    var stuckPenalty;
    if (stuck === 'ask') {
      stuckPenalty = D6 < 0.3 ? 1.0 : 0.3;
    } else if (stuck === 'switch') {
      stuckPenalty = 0.6;
    } else {
      stuckPenalty = 0.2; /* search */
    }
    var SL = 0.50 * (1 - structureNeed) + 0.30 * (1 - D7) + 0.20 * stuckPenalty;

    /* PL —— 产出压力负荷 */
    var openLoop = person.openLoop != null ? person.openLoop : 0.5;
    var PL = openLoop * (1 - D5);

    /* UL —— 负向分量：挑战不足（从总分中扣减） */
    var UL = D1 * Math.max(0, E - D2 - 0.15) * 0.8;

    /* 加权原始分 */
    var rawBase = W.IL * IL + W.EL * EL + W.ML * ML + W.TL * TL + W.SL * SL + W.PL * PL;
    var raw = clamp(100 * rawBase - 100 * 0.45 * UL, 0, 100);

    /* 校准 */
    var cal = person.calibration || { k: 1, b: 0 };
    var score = clamp(cal.k * raw + cal.b, 0, 100);

    /* 状态修正：今天的实际负荷 */
    var stateIndex = person.stateIndex != null ? person.stateIndex : 0.6;
    var stateAdj = clamp(score * (1 + (0.5 - stateIndex) * 0.3), 0, 100);

    return {
      score: Math.round(score),
      raw: Math.round(raw * 100) / 100,
      stateAdj: Math.round(stateAdj),
      parts: {
        IL: Math.round(IL * 10000) / 10000,
        EL: Math.round(EL * 10000) / 10000,
        ML: Math.round(ML * 10000) / 10000,
        TL: Math.round(TL * 10000) / 10000,
        SL: Math.round(SL * 10000) / 10000,
        PL: Math.round(PL * 10000) / 10000,
        UL: Math.round(UL * 10000) / 10000
      },
      mismatch: Math.round(mismatch * 10000) / 10000,
      confidence: computeConfidence(person),
      zone: zoneOf(score),
      match: Math.round(matchOf(score)),
      recovery: person.recovery != null ? person.recovery : 0.7,
      weeklyHours: person.weeklyHours || 8
    };
  }

  /* ───────── 置信度 ───────── */
  var DIM_WEIGHTS = { baseline: 0.20, channel: 0.20, pace: 0.15, structure: 0.10, social: 0.20, domains: 0.15 };

  function computeConfidence(person) {
    if (!person) return 0.3;
    var answered = person.answered || {};
    var sum = 0, wsum = 0;
    Object.keys(DIM_WEIGHTS).forEach(function (k) {
      var w = DIM_WEIGHTS[k];
      var c = (k in answered) ? (answered[k] ? 1 : 0.5) : 0.3;
      sum += w * c; wsum += w;
    });
    var conf = wsum > 0 ? sum / wsum : 0.3;
    return Math.round(conf * 100) / 100;
  }

  /* ───────── 主要负荷来源（通俗表述） ───────── */
  var PART_LABELS = {
    IL: '动脑强度',
    EL: '学习方式不合拍',
    ML: '兴趣不够浓',
    TL: '时间对不上',
    SL: '来回切换',
    PL: '要有成果的压力'
  };

  function topContributor(parts) {
    var best = 'IL', bestV = -1;
    Object.keys(PART_LABELS).forEach(function (k) {
      var v = (parts[k] || 0) * W[k];
      if (v > bestV) { bestV = v; best = k; }
    });
    return PART_LABELS[best];
  }

  /* ───────── 处方规则（按序匹配，可多条） ───────── */
  function prescriptions(person, activity, scored) {
    var dom = (person && person.domains && person.domains[activity.domain]) || {};
    var I = dom.interest != null ? dom.interest : 0.3;
    var score = scored.score;
    var mismatch = scored.mismatch;
    var TL = scored.parts.TL;
    var UL = scored.parts.UL || 0;
    var zone = scored.zone.key;

    /* 通道第一名 */
    var ch = person && person.channel || {};
    var topCh = 'hands', topV = -1;
    Object.keys(ch).forEach(function (k) { if (ch[k] > topV) { topV = ch[k]; topCh = k; } });
    var chName = { read: '读图文教程', audiovisual: '看视频听讲解', hands: '自己上手试错', social: '和人讨论请教' }[topCh] || '自己上手试错';

    var out = [];
    if (score > 76 && I > 0.7) {
      out.push({ title: '又爱又累', text: '这件事你很感兴趣但比较费劲，建议拆成每次 45 分钟以内的小块，分两天做。' });
    }
    if (score > 76 && mismatch > 0.5) {
      out.push({ title: '学习方式不合拍', text: '换个更适合你的学法，比如「' + chName + '」。' });
    }
    if (score > 76 && TL > 0.6) {
      out.push({ title: '时间对不上', text: '挪到你脑子最清醒的时段去做，或者一次学久一点、少来回切换。' });
    }
    if (UL > 0.1 || zone === 'under') {
      out.push({ title: '太简单没劲', text: '这个活动对你来说太简单了，建议加点难度、缩短时间，或者换个更进阶的版本 —— 太无聊比太累更容易让人放弃。' });
    }
    if (I < 0.4) {
      out.push({ title: '兴趣不够浓', text: '每次只学 15 分钟，或者把它和你喜欢的事绑在一起（做完它才做喜欢的那件）。' });
    }
    if (score < 35) {
      out.push({ title: '很轻松', text: '这件很省力，可以和其他事排在同一天，或者适当加量。' });
    }
    if (zone === 'optimal') {
      out.push({ title: '难度刚刚好', text: '保持现在的安排就好，这正是你学得又快又好的状态。' });
    }
    if (out.length === 0) {
      out.push({ title: '正常安排', text: '目前的强度可以接受，按自己的节奏来就行。' });
    }
    return out;
  }

  /* ───────── 周负荷 ───────── */
  function weeklyCapacity(person) {
    var p = person || {};
    var weeklyHours = p.weeklyHours || 8;
    var recovery = p.recovery != null ? p.recovery : 0.7;
    return weeklyHours * 50 * (0.7 + 0.6 * recovery);
  }

  /* 同一天内高负荷惩罚：第2个>70 ×1.15，第3个+ ×1.30 */
  function dailyPenalty(list, idx) {
    if (idx === 0) return 1;
    var priorHigh = 0;
    for (var i = 0; i < idx && i < list.length; i++) {
      if (list[i].score > 70) priorHigh++;
    }
    return priorHigh === 0 ? 1 : priorHigh === 1 ? 1.15 : 1.30;
  }

  function weeklyLoadPercent(person, plan, scoredByActivity) {
    var cap = weeklyCapacity(person);
    if (cap <= 0) return { percent: 0, capacity: 0, zone: zoneOf(0) };
    /* 按星期分组 */
    var byDay = {};
    var sum = 0;
    (plan || []).forEach(function (item) {
      var sc = scoredByActivity[item.activityId];
      if (!sc) return;
      var wd = item.weekday != null ? item.weekday : -1; /* -1 = 不限日期 */
      if (wd >= 0) {
        if (!byDay[wd]) byDay[wd] = [];
        byDay[wd].push({ score: sc.score, hours: item.hours || 0 });
      } else {
        sum += sc.score * (item.hours || 0); /* 不限日期不加惩罚 */
      }
    });
    /* 同天惩罚 */
    Object.keys(byDay).forEach(function (day) {
      var list = byDay[day];
      list.forEach(function (item, i) {
        var pen = dailyPenalty(list, i);
        sum += item.score * pen * item.hours;
      });
    });
    var pct = sum / cap * 100;
    var z;
    if (pct < 70) z = { key: 'low', label: '有余量可加量', color: '#3FB950' };
    else if (pct <= 100) z = { key: 'comfort', label: '正常', color: '#58A6FF' };
    else if (pct <= 110) z = { key: 'optimal', label: '提示降载', color: '#D29922' };
    else z = { key: 'over', label: '强提示恢复', color: '#F85149' };
    return { percent: Math.round(pct * 10) / 10, capacity: Math.round(cap), zone: z };
  }

  /* ───────── 校准 ───────── */
  function median(arr) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function updateCalibration(calibration, raw, observed, logs, lowQuality) {
    if (lowQuality) return { k: calibration.k, b: calibration.b };
    var k = calibration.k != null ? calibration.k : 1;
    var b = calibration.b != null ? calibration.b : 0;
    var predicted = k * raw + b;
    var e = observed - predicted;

    /* k: 仅大误差时更新（抗噪） */
    if (Math.abs(e) > 8) {
      k = clamp(k + 0.12 * e * raw / (raw * raw + 100), 0.5, 1.6);
    }
    /* b: 最近 10 次误差中位数 */
    var recent = (logs || []).slice(-10).map(function (x) { return x.e; });
    b = clamp(median(recent), -35, 35);

    return { k: Math.round(k * 10000) / 10000, b: Math.round(b * 10000) / 10000 };
  }

  /* stateIndex EMA 更新（α=0.3） */
  function updateStateIndex(oldVal, input) {
    var alpha = 0.3;
    var newVal = alpha * input + (1 - alpha) * (oldVal != null ? oldVal : 0.6);
    return Math.round(newVal * 100) / 100;
  }

  /* ───────── 权重归一化 ───────── */
  function normalizeWeights(weights) {
    var sum = 0;
    Object.keys(weights).forEach(function (k) { sum += weights[k]; });
    if (sum <= 0) return Object.assign({}, W);
    var out = {};
    Object.keys(weights).forEach(function (k) {
      out[k] = Math.round((weights[k] / sum) * 1000) / 1000;
    });
    return out;
  }

  /* ───────── 导出 ───────── */
  var API = {
    scoreActivity: scoreActivity,
    zoneOf: zoneOf,
    matchOf: matchOf,
    levelOf: levelOf,
    levelOfPercent: levelOfPercent,
    computeConfidence: computeConfidence,
    topContributor: topContributor,
    prescriptions: prescriptions,
    weeklyCapacity: weeklyCapacity,
    weeklyLoadPercent: weeklyLoadPercent,
    dailyPenalty: dailyPenalty,
    updateCalibration: updateCalibration,
    updateStateIndex: updateStateIndex,
    normalizeWeights: normalizeWeights,
    ZONES: ZONES,
    WEIGHTS: W
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LMS = Object.assign(root.LMS || {}, API);
})(typeof window !== 'undefined' ? window : globalThis);
