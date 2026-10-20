/* 存储层 —— 统一 localStorage 读写，挂在 window.LMS.store */
/* 单用户唯一画像：覆盖更新，不保留历史多画像 */
(function (global) {
  'use strict';

  var KEYS = {
    PERSON: 'lms.person.v1',
    LOGS: 'lms.logs.v1',
    PLAN: 'lms.plan.v1',
    CONFIG: 'lms.config.v1'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) { return fallback; }
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  // 群体默认画像（用于跳过题 / 未填问卷时的通用估算）
  function defaultPerson() {
    return {
      version: 1,
      baseline: 58,
      channel: { read: 0.25, audiovisual: 0.25, hands: 0.25, social: 0.25 },
      block: 60,
      stuck: 'search',
      peakTime: 'night',
      structureNeed: 0.3,
      openLoop: 0.5,
      socialPref: 0.1,
      recovery: 0.7,
      weeklyHours: 8,
      stateIndex: 0.6,
      domains: {},
      calibration: { k: 1.0, b: 8 },
      confidence: 0.82,
      answered: { baseline: true, channel: true, pace: true, structure: true, social: true, domains: true }
    };
  }

  // 默认配置：6 分量权重 + 反馈开关 + 每周提醒
  function defaultConfig() {
    return {
      weights: { IL: 0.26, EL: 0.20, ML: 0.18, TL: 0.14, SL: 0.12, PL: 0.10 },
      feedbackEnabled: false,
      weeklyReminder: 3
    };
  }

  var store = {
    KEYS: KEYS,

    getPerson: function () { return read(KEYS.PERSON, null); },
    setPerson: function (p) {
      var ok = write(KEYS.PERSON, p);
      if (ok) { this.autoBackup(p); } // 写入画像时自动备份
      return ok;
    },
    hasPerson: function () { return read(KEYS.PERSON, null) != null; },

    getLogs: function () { return read(KEYS.LOGS, []); },
    addLog: function (log) {
      var logs = read(KEYS.LOGS, []);
      logs.push(log);
      write(KEYS.LOGS, logs);
      return logs;
    },
    clearLogs: function () { write(KEYS.LOGS, []); },

    getPlan: function () { return read(KEYS.PLAN, []); },
    setPlan: function (plan) { return write(KEYS.PLAN, plan); },
    // 加入计划：activityId + hours + weekday（-1 = 不限日期）
    addToPlan: function (activityId, hours, weekday) {
      var plan = read(KEYS.PLAN, []);
      var found = false;
      for (var i = 0; i < plan.length; i++) {
        if (plan[i].activityId === activityId) {
          plan[i].hours = hours;
          plan[i].weekday = (weekday != null ? weekday : -1);
          found = true; break;
        }
      }
      if (!found) { plan.push({ activityId: activityId, hours: hours, weekday: (weekday != null ? weekday : -1) }); }
      write(KEYS.PLAN, plan);
      return plan;
    },
    removeFromPlan: function (activityId) {
      var plan = read(KEYS.PLAN, []).filter(function (p) { return p.activityId !== activityId; });
      write(KEYS.PLAN, plan);
      return plan;
    },
    clearPlan: function () { write(KEYS.PLAN, []); },

    getConfig: function () { return read(KEYS.CONFIG, defaultConfig()); },
    setConfig: function (c) { return write(KEYS.CONFIG, c); },

    defaultPerson: defaultPerson,
    defaultConfig: defaultConfig,

    resetAll: function () {
      Object.keys(KEYS).forEach(function (k) { localStorage.removeItem(KEYS[k]); });
    },

    exportAll: function () {
      return {
        person: read(KEYS.PERSON, null),
        logs: read(KEYS.LOGS, []),
        plan: read(KEYS.PLAN, []),
        config: read(KEYS.CONFIG, defaultConfig())
      };
    },

    importAll: function (data) {
      if (!data) { return false; }
      if (data.person) { write(KEYS.PERSON, data.person); }
      if (data.logs) { write(KEYS.LOGS, data.logs); }
      if (data.plan) { write(KEYS.PLAN, data.plan); }
      if (data.config) { write(KEYS.CONFIG, data.config); }
      return true;
    },

    // 自动备份：保存画像时下载 person-backup-YYYYMMDD.json
    // 仅当距上次备份超过 6 小时才下载，避免频繁弹下载框
    autoBackup: function (person) {
      try {
        var last = read('lms.lastBackup', 0);
        var now = Date.now();
        if (now - last < 6 * 3600 * 1000) return; // 6 小时内已备份过
        write('lms.lastBackup', now);
        var d = new Date();
        var stamp = d.getFullYear() +
          String(d.getMonth() + 1).padStart(2, '0') +
          String(d.getDate()).padStart(2, '0');
        var blob = new Blob([JSON.stringify(person, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'person-backup-' + stamp + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } catch (e) { /* 备份失败不影响主流程 */ }
    }
  };

  global.LMS = global.LMS || {};
  global.LMS.store = store;
})(window);
