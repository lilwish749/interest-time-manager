/* 存储层 —— 统一 localStorage 读写，挂在 window.LMS.store */
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

  // 群体默认值（用于跳过题）
  function defaultPerson() {
    return {
      version: 1,
      baseline: 50,
      channel: { read: 0.25, audiovisual: 0.25, hands: 0.25, social: 0.25 },
      block: 45,
      stuck: 'search',
      peakTime: 'morning',
      structureNeed: 0.5,
      openLoop: 0.5,
      socialPref: 0.3,
      recovery: 0.65,
      weeklyHours: 5,
      domains: {},
      calibration: { k: 1, b: 0 },
      confidence: 0.3,
      answered: { baseline: false, channel: false, pace: false, structure: false, social: false, domains: false }
    };
  }

  function defaultConfig() {
    return { weights: { IL: 0.30, EL: 0.25, ML: 0.20, TL: 0.15, SL: 0.10 } };
  }

  var store = {
    KEYS: KEYS,

    getPerson: function () { return read(KEYS.PERSON, null); },
    setPerson: function (p) { return write(KEYS.PERSON, p); },
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
    addToPlan: function (activityId, hours) {
      var plan = read(KEYS.PLAN, []);
      var found = false;
      for (var i = 0; i < plan.length; i++) {
        if (plan[i].activityId === activityId) { plan[i].hours = hours; found = true; break; }
      }
      if (!found) { plan.push({ activityId: activityId, hours: hours }); }
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
    }
  };

  global.LMS = global.LMS || {};
  global.LMS.store = store;
})(window);
