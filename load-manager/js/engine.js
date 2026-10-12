/* 评分引擎 —— 纯函数，不读写 DOM / localStorage。挂在 window.LMS.engine */
(function (global) {
  'use strict';

  var DEFAULT_WEIGHTS = { IL: 0.30, EL: 0.25, ML: 0.20, TL: 0.15, SL: 0.10 };
  var DEFAULT_CONFIG = { weights: DEFAULT_WEIGHTS };

  var ZONES = [
    { max: 30, key: 'low', label: '低负荷', color: '#3FB950' },
    { max: 55, key: 'comfort', label: '舒适区', color: '#58A6FF' },
    { max: 75, key: 'optimal', label: '最佳学习区', color: '#D29922' },
    { max: 90, key: 'high', label: '高负荷', color: '#F0883E' },
    { max: 101, key: 'over', label: '过载', color: '#F85149' }
  ];

  function zoneOf(score) {
    score = Math.max(0, Math.min(100, score));
    for (var i = 0; i < ZONES.length; i++) {
      if (score < ZONES[i].max) { return ZONES[i]; }
    }
    return ZONES[ZONES.length - 1];
  }

  // 个体置信度计算：权重来自 config（维度名对齐 answered）
  var DIM_WEIGHTS = { baseline: 0.20, channel: 0.20, pace: 0.15, structure: 0.10, social: 0.20, domains: 0.15 };

  function computeConfidence(person) {
    if (!person) { return 0.3; }
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

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function scoreActivity(person, activity, config) {
    config = config || DEFAULT_CONFIG;
    var weights = config.weights || DEFAULT_WEIGHTS;

    var dom = (person && person.domains && person.domains[activity.domain]) || {};
    var E = dom.experience != null ? dom.experience : 0.3;
    var I = dom.interest != null ? dom.interest : 0.3;

    // 内在负荷 IL
    var IL = activity.D1 * Math.max(0.15, 1 - 0.6 * E);

    // 通道匹配
    var ch = person && person.channel || { read: 0.25, audiovisual: 0.25, hands: 0.25, social: 0.25 };
    var ach = activity.channel || {};
    var dot = 0;
    ['read', 'audiovisual', 'hands', 'social'].forEach(function (k) {
      dot += (ch[k] || 0) * (ach[k] || 0);
    });
    var mismatch = (1 - dot) / 0.75; // 归一化到 0~1

    // 外在负荷 EL
    var EL = 0.45 * mismatch
           + 0.30 * (activity.D4 * (1 - (person && person.structureNeed != null ? person.structureNeed : 0.5)))
           + 0.25 * Math.abs(activity.D6 - (person && person.socialPref != null ? person.socialPref : 0.3));

    // 动机负荷 ML
    var ML = Math.pow(1 - I, 1.5);

    // 时间负荷 TL
    var peakTime = person && person.peakTime || 'morning';
    var chrono = (activity.bestTime && activity.bestTime.indexOf(peakTime) >= 0) ? 1 : 0.5;
    var block = person && person.block || 45;
    var ratio = clamp(activity.focusNeedMin / block, 0.5, 2);
    var TL = Math.min(1, (ratio / 2) * (1.5 - 0.5 * chrono));

    // 切换负荷 SL
    var structureNeed = person && person.structureNeed != null ? person.structureNeed : 0.5;
    var SL = 0.6 * (1 - structureNeed) + 0.4 * (1 - activity.D7);

    // 加权原始分
    var Raw = 100 * (weights.IL * IL + weights.EL * EL + weights.ML * ML + weights.TL * TL + weights.SL * SL);
    Raw = clamp(Raw, 0, 100);

    // 校准
    var cal = (person && person.calibration) || { k: 1, b: 0 };
    var score = clamp(cal.k * Raw + cal.b, 0, 100);

    return {
      score: Math.round(score * 10) / 10,
      raw: Math.round(Raw * 10) / 10,
      parts: {
        IL: Math.round(IL * 1000) / 1000,
        EL: Math.round(EL * 1000) / 1000,
        ML: Math.round(ML * 1000) / 1000,
        TL: Math.round(TL * 1000) / 1000,
        SL: Math.round(SL * 1000) / 1000
      },
      mismatch: Math.round(mismatch * 1000) / 1000,
      confidence: 0.8,
      zone: zoneOf(score)
    };
  }

  // 主要负荷来源：返回 parts 中权重后贡献最大的标签
  var PART_LABELS = { IL: '内在认知', EL: '外在环境', ML: '动机兴趣', TL: '时间块', SL: '切换成本' };

  function topContributor(parts, weights) {
    weights = weights || DEFAULT_WEIGHTS;
    var best = 'IL', bestV = -1;
    Object.keys(parts).forEach(function (k) {
      var w = weights[k] || 0;
      var v = parts[k] * w;
      if (v > bestV) { bestV = v; best = k; }
    });
    // 中文化标签
    var label = PART_LABELS[best];
    if (best === 'EL') label = '通道/环境不匹配';
    else if (best === 'IL') label = '认知门槛较高';
    else if (best === 'ML') label = '兴趣偏低';
    else if (best === 'TL') label = '时间块不匹配';
    else if (best === 'SL') label = '切换成本';
    return label;
  }

  // 处方规则（按序匹配，可多条）
  function prescriptions(person, activity, scored, config) {
    config = config || DEFAULT_CONFIG;
    var weights = config.weights || DEFAULT_WEIGHTS;
    var I = (person && person.domains && person.domains[activity.domain] && person.domains[activity.domain].interest != null)
      ? person.domains[activity.domain].interest : 0.3;
    var score = scored.score;
    var mismatch = scored.mismatch;
    var TL = scored.parts.TL;
    var ch = person && person.channel || {};
    var topChannel = 'hands';
    var topV = -1;
    Object.keys(ch).forEach(function (k) { if (ch[k] > topV) { topV = ch[k]; topChannel = k; } });
    var channelName = { read: '读图文', audiovisual: '看视频听讲解', hands: '自己上手试错', social: '和人讨论请教' }[topChannel] || '自己上手试错';

    var out = [];
    if (score > 75 && I > 0.7) {
      out.push({ title: '心流陷阱', text: '这件事你很感兴趣但负荷偏高，建议拆成≤45分钟小块分两天做。' });
    }
    if (score > 75 && mismatch > 0.5) {
      out.push({ title: '通道不匹配', text: '换成你更偏好的形式，例如「' + channelName + '」。' });
    }
    if (score > 75 && TL > 0.6) {
      out.push({ title: '时间不匹配', text: '挪到该活动的最佳时段，或延长单次时间块以降低切换成本。' });
    }
    if (I < 0.4) {
      out.push({ title: '兴趣偏低', text: '缩短到 15 分钟、让反馈更即时，或与喜欢的活动绑定（做完它才做喜欢的）。' });
    }
    if (score < 30) {
      out.push({ title: '负荷很轻', text: '可与其他活动叠加或适当加量。' });
    }
    if (score >= 55 && score < 75) {
      out.push({ title: '处在最佳学习区', text: '保持当前安排，这是高效学习的甜区。' });
    }
    if (out.length === 0) {
      out.push({ title: '常规', text: '当前负荷可接受，按需调整即可。' });
    }
    return out;
  }

  // 容量与周负荷
  function weeklyCapacity(person) {
    var p = person || {};
    var weeklyHours = p.weeklyHours || 8;
    var recovery = p.recovery != null ? p.recovery : 0.7;
    return weeklyHours * 50 * (0.7 + 0.6 * recovery);
  }

  function weeklyLoadPercent(person, plan, scoredByActivity, config) {
    var cap = weeklyCapacity(person);
    if (cap <= 0) { return { percent: 0, capacity: 0, zone: zoneOf(0) }; }
    var sum = 0;
    (plan || []).forEach(function (item) {
      var sc = scoredByActivity[item.activityId];
      if (sc) { sum += sc.score * (item.hours || 0); }
    });
    var pct = sum / cap * 100;
    var z;
    if (pct < 70) { z = { key: 'low', label: '有余量可加量', color: '#3FB950' }; }
    else if (pct <= 100) { z = { key: 'comfort', label: '正常', color: '#58A6FF' }; }
    else if (pct <= 110) { z = { key: 'optimal', label: '提示降载', color: '#D29922' }; }
    else { z = { key: 'over', label: '强提示恢复', color: '#F85149' }; }
    return { percent: Math.round(pct * 10) / 10, capacity: Math.round(cap), zone: z };
  }

  // LMS 校准更新（纯函数，返回新 calibration）
  function updateCalibration(calibration, raw, observed, alpha) {
    alpha = alpha == null ? 0.15 : alpha;
    var k = calibration.k != null ? calibration.k : 1;
    var b = calibration.b != null ? calibration.b : 0;
    var P = k * raw + b;
    var e = observed - P;
    k += alpha * e * raw / (raw * raw + 100);
    b += alpha * e * 100 / (raw * raw + 100);
    k = clamp(k, 0.5, 1.6);
    b = clamp(b, -40, 40);
    return { k: Math.round(k * 10000) / 10000, b: Math.round(b * 10000) / 10000 };
  }

  // 权重归一化
  function normalizeWeights(weights) {
    var sum = 0;
    Object.keys(weights).forEach(function (k) { sum += weights[k]; });
    if (sum <= 0) { return DEFAULT_WEIGHTS; }
    var out = {};
    Object.keys(weights).forEach(function (k) { out[k] = Math.round((weights[k] / sum) * 1000) / 1000; });
    return out;
  }

  global.LMS = global.LMS || {};
  global.LMS.engine = {
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    ZONES: ZONES,
    zoneOf: zoneOf,
    computeConfidence: computeConfidence,
    scoreActivity: scoreActivity,
    topContributor: topContributor,
    prescriptions: prescriptions,
    weeklyCapacity: weeklyCapacity,
    weeklyLoadPercent: weeklyLoadPercent,
    updateCalibration: updateCalibration,
    normalizeWeights: normalizeWeights,
    DIM_WEIGHTS: DIM_WEIGHTS
  };
})(window);
