/* =========================================================================
   兴趣池 —— InterestPool
   -------------------------------------------------------------------------
   职责：
     1) 把用户输入的兴趣识别归类后存入可持久化的兴趣池（收藏/清单）；
     2) 提供浏览、取出（用于后续安排）等能力；
     3) 作为对接层，向其他模块暴露简洁的调用接口。

   持久化：localStorage 键 lms.interest.v1（数据结构与契约文件一致）；
           存储不可用时自动退化为内存池，功能不中断。
   注意：本模块只处理数据，不渲染界面。界面层不得呈现任何原始数据内容，
         只呈现经过处理后的用户可见结果（如类别中文名、创建时间）。
   ========================================================================= */
(function (root) {
  'use strict';

  var C = root.InterestClassifier;
  if (!C) { throw new Error('InterestPool 依赖 interest-classifier.js，请先加载'); }

  var VERSION = '1.0';
  var KEYS = {
    POOL: 'lms.interest.v1',        /* 兴趣池 */
    PLANS: 'lms.interest.plans.v1', /* 已生成的计划 */
    ACTIVITY: 'lms.activities.v1'   /* 运行期新增的活动（供负荷系统识别） */
  };

  /* 时段 -> 起始时刻，用于「取出」时推导具体时间 */
  var TIME_BANDS = {
    morning: '06:30', forenoon: '09:00', afternoon: '14:00',
    evening: '19:00', night: '21:30'
  };
  var BAND_LABELS = {
    morning: '清晨', forenoon: '上午', afternoon: '下午',
    evening: '傍晚', night: '夜晚'
  };

  /* ---------- 特殊时段规则 ----------
     有些类别对时段有硬性要求，这些要求优先于「用户精力最好的时段」。

     运动类：睡前做剧烈运动会推迟入睡、第二天更疲劳，也拉低睡眠质量。
     所以哪怕用户自认夜里精力最足，也不把运动排进夜晚，
     改到这个类别允许的时段里、离夜晚最近的那一个（通常是傍晚）。

     规则只在「用户偏好正好撞上禁区」时生效；偏好落在允许范围内时仍然听用户的——
     它的作用是把明显不合适的安排挡住，不是替用户做主。 */
  var BAND_ORDER = ['morning', 'forenoon', 'afternoon', 'evening', 'night'];
  var DOMAIN_BAND_RULES = {
    sport: {
      avoid: ['night'],
      why: '睡前做剧烈运动会推迟入睡、第二天更疲劳'
    }
  };

  /* 在允许的时段里，取离 want 最近的那一个 */
  function nearestBand(list, want) {
    var wi = BAND_ORDER.indexOf(want);
    var best = list[0], bestD = 99;
    for (var i = 0; i < list.length; i++) {
      var bi = BAND_ORDER.indexOf(list[i]);
      if (bi < 0) { continue; }
      var d = Math.abs(bi - wi);
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }

  /* bandForDomain(domain, allowed, peak) -> { band, moved, banned, why }
       allowed：这个兴趣本身适合的时段（兴趣池记录或类别八轴里的 bestTime）
       peak   ：用户精力最好的时段（来自负荷画像）
     优先级：特殊时段规则 > 用户偏好 > 类别默认 */
  function bandForDomain(domain, allowed, peak) {
    var list = (allowed && allowed.length) ? allowed.slice() : ['evening'];
    var rule = DOMAIN_BAND_RULES[domain];
    var banned = (rule && rule.avoid) ? rule.avoid : [];
    var legal = list.filter(function (b) { return banned.indexOf(b) < 0; });
    /* 万一把这个类别的合适时段全禁掉了（数据写矛盾了），
       以「能排出计划」为先：规则让一步，别让计划无解。 */
    if (!legal.length) { legal = list.slice(); }

    /* 1) 硬性规则优先：偏好正好落在禁区里，就不听偏好 */
    if (peak && banned.indexOf(peak) >= 0) {
      return {
        band: nearestBand(legal, peak),
        moved: true,
        banned: peak,
        why: (rule && rule.why) || ('这个兴趣不适合排在' + bandLabel(peak))
      };
    }
    /* 2) 偏好在允许范围内（或这一类没有硬性规则），听用户的 */
    if (peak) { return { band: peak, moved: false, banned: '', why: '' }; }
    /* 3) 没有偏好：用这个类别最合适的第一个时段 */
    return { band: legal[0] || list[0] || 'evening', moved: false, banned: '', why: '' };
  }

  var EVENT_ADDED = 'interest:added';
  var EVENT_UPDATED = 'interest:updated';
  var EVENT_REMOVED = 'interest:removed';
  var EVENT_TAKEN = 'interest:taken';

  /* ---------- 存储层：localStorage 优先，失败退化为内存 ---------- */
  var memory = {};
  var storageAvailable = true;
  var listeners = {};

  function readKey(key, dflt) {
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { storageAvailable = false; }
    if (raw == null) { raw = Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; }
    if (raw == null || raw === '') { return dflt; }
    try { return JSON.parse(raw); } catch (e) { return dflt; }
  }
  function writeKey(key, val) {
    var raw;
    try { raw = JSON.stringify(val); } catch (e) { return false; }
    memory[key] = raw;
    try { localStorage.setItem(key, raw); return true; } catch (e) { storageAvailable = false; return false; }
  }

  function readDoc() {
    var doc = readKey(KEYS.POOL, null);
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) {
      return { version: 1, updatedAt: Date.now(), items: [] };
    }
    if (doc.version == null) { doc.version = 1; }
    return doc;
  }
  function writeDoc(doc) {
    doc.version = 1;
    doc.updatedAt = Date.now();
    var ok = writeKey(KEYS.POOL, doc);
    return ok;
  }

  /* ---------- 小工具 ---------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  }
  function makeId(name) { return 'ip-' + (slugify(name) || 'x') + '-' + uid(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function toMinutes(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function toHHMM(min) {
    var m = ((min % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* 用户可见的时间文案：相对时间，不呈现时间戳本身 */
  function whenText(ts) {
    if (!ts) { return ''; }
    var diff = Date.now() - ts;
    if (diff < 60 * 1000) { return '刚刚'; }
    if (diff < 3600 * 1000) { return Math.floor(diff / 60000) + ' 分钟前'; }
    if (diff < 86400 * 1000) { return Math.floor(diff / 3600000) + ' 小时前'; }
    if (diff < 7 * 86400 * 1000) { return Math.floor(diff / 86400000) + ' 天前'; }
    var d = new Date(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function bandLabel(band) { return BAND_LABELS[band] || '合适时段'; }

  /* ---------- 个人画像（只读，来自负荷管理系统） ---------- */
  function profile() {
    if (root.LMSBridge && root.LMSBridge.getProfile) {
      try { return root.LMSBridge.getProfile(); } catch (e) { /* ignore */ }
    }
    return readKey('lms.person.v1', null);
  }

  /* ---------- 记录构造 ---------- */
  function buildRecord(input, opts) {
    opts = opts || {};
    var name = String(input || '').trim().slice(0, 40);
    var r = C.classify(name, opts.categoryKey);
    if (!r.recognized) { return null; }
    var axes = C.axesOf(r.category) || {};
    var rec = {
      id: makeId(name),
      name: name,
      category: r.category,
      categoryLabel: r.categoryLabel,
      type: r.type,
      createdAt: Date.now(),
      lastUsedAt: null,
      useCount: 0,
      status: 'active',
      source: 'interest-pool',
      matchedKeywords: r.matchedKeywords.slice(),
      matchDegree: r.matchDegree,
      hours: (opts.hours != null ? opts.hours : null),
      activityRef: null,
      D1: axes.D1, D2: axes.D2, focusNeedMin: axes.focusNeedMin,
      D4: axes.D4, D5: axes.D5, D6: axes.D6, D7: axes.D7,
      channel: axes.channel, bestTime: axes.bestTime
    };
    if (r.type === 'custom' && opts.customLabel) { rec.customLabel = String(opts.customLabel); }
    if (opts.tags && opts.tags.length) { rec.tags = opts.tags.slice(); }
    return rec;
  }

  /* 把兴趣记录映射为活动对象（供负荷引擎评分使用） */
  function activityOf(rec) {
    var axes = C.axesOf(rec.category) || {};
    return {
      id: rec.id,
      name: rec.name,
      domain: rec.category,
      D1: rec.D1 != null ? rec.D1 : axes.D1,
      D2: rec.D2 != null ? rec.D2 : axes.D2,
      focusNeedMin: rec.focusNeedMin != null ? rec.focusNeedMin : axes.focusNeedMin,
      D4: rec.D4 != null ? rec.D4 : axes.D4,
      D5: rec.D5 != null ? rec.D5 : axes.D5,
      D6: rec.D6 != null ? rec.D6 : axes.D6,
      D7: rec.D7 != null ? rec.D7 : axes.D7,
      channel: rec.channel || axes.channel,
      bestTime: (rec.bestTime && rec.bestTime.length ? rec.bestTime : axes.bestTime)
    };
  }

  /* 把新增活动登记到运行期活动清单，使负荷管理系统也能识别该兴趣 */
  function registerActivity(rec) {
    var list = readKey(KEYS.ACTIVITY, []);
    if (!Array.isArray(list)) { list = []; }
    var act = activityOf(rec);
    var found = false;
    for (var i = 0; i < list.length; i++) { if (list[i].id === act.id) { list[i] = act; found = true; break; } }
    if (!found) { list.push(act); }
    writeKey(KEYS.ACTIVITY, list);
    /* 写入后立刻并进运行期活动库，否则本会话内「采用计划 → 周计划」会跳过这个活动 */
    if (root.LMS_DATA && typeof root.LMS_DATA.refreshRuntimeActivities === 'function') {
      root.LMS_DATA.refreshRuntimeActivities();
    }
  }

  /* ---------- 事件 ---------- */
  function emit(evt, payload) {
    var hs = listeners[evt];
    if (!hs) { return; }
    hs.slice().forEach(function (fn) { try { fn(payload); } catch (e) { /* 单个订阅者异常不影响主流程 */ } });
  }
  function subscribe(evt, handler) {
    if (typeof handler !== 'function') { return function () {}; }
    if (!listeners[evt]) { listeners[evt] = []; }
    listeners[evt].push(handler);
    return function () {
      listeners[evt] = listeners[evt].filter(function (f) { return f !== handler; });
    };
  }

  /* ---------- 读 ---------- */
  function all(filter) {
    filter = filter || {};
    /* 带上原始位置，保证同一毫秒内加入的多条也有稳定顺序（后加入的排前面） */
    var items = readDoc().items.map(function (r, i) { return { r: r, i: i }; });
    var status = filter.status || 'active';
    if (status !== 'all') { items = items.filter(function (x) { return (x.r.status || 'active') === status; }); }
    if (filter.category) { items = items.filter(function (x) { return x.r.category === filter.category; }); }
    if (filter.keyword) {
      var kw = String(filter.keyword).trim().toLowerCase();
      items = items.filter(function (x) {
        return x.r.name.toLowerCase().indexOf(kw) >= 0 || (x.r.categoryLabel || '').indexOf(kw) >= 0;
      });
    }
    items.sort(function (a, b) {
      var d = (b.r.createdAt || 0) - (a.r.createdAt || 0);
      return d !== 0 ? d : (b.i - a.i);
    });
    return items.map(function (x) { return x.r; });
  }
  function get(id) {
    var items = readDoc().items;
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) { return items[i]; } }
    return null;
  }
  function has(name) {
    var n = String(name || '').trim();
    return readDoc().items.some(function (r) { return r.name === n; });
  }
  function count() { return readDoc().items.length; }
  function isStorageAvailable() { return storageAvailable; }
  function storageHint() {
    return storageAvailable ? '' : '本次记录只在当前页面有效，刷新后不会保留（浏览器未允许本地保存）。';
  }

  /* ---------- 写 ---------- */
  function persist(items) {
    var doc = readDoc();
    doc.items = items;
    return writeDoc(doc);
  }

  /* add(input, opts) -> { ok, item?, reason? }
     opts: { categoryKey, customLabel, hours, tags }
     reason: 'empty' | 'unrecognized' | 'duplicate' */
  function add(input, opts) {
    opts = opts || {};
    var name = String(input || '').trim();
    if (!name) { return { ok: false, reason: 'empty' }; }
    name = name.slice(0, 40);

    var exist = readDoc().items.filter(function (r) { return r.name === name; })[0];
    if (exist) { return { ok: false, reason: 'duplicate', item: exist }; }

    var rec = buildRecord(name, opts);
    if (!rec) { return { ok: false, reason: 'unrecognized' }; }

    var doc = readDoc();
    doc.items.push(rec);
    storageAvailable = writeDoc(doc) || storageAvailable;
    registerActivity(rec);
    emit(EVENT_ADDED, { item: rec });
    return { ok: true, item: rec };
  }

  /* update(id, patch) —— 仅允许改动这些面向用户的字段 */
  function update(id, patch) {
    patch = patch || {};
    var doc = readDoc();
    var rec = null;
    for (var i = 0; i < doc.items.length; i++) { if (doc.items[i].id === id) { rec = doc.items[i]; break; } }
    if (!rec) { return false; }

    if (patch.name != null) { rec.name = String(patch.name).trim().slice(0, 40) || rec.name; }
    if (patch.hours !== undefined) { rec.hours = patch.hours; }
    if (patch.tags) { rec.tags = patch.tags.slice(); }
    if (patch.status) { rec.status = patch.status; }
    if (patch.categoryKey) {
      var axes = C.axesOf(patch.categoryKey);
      if (axes) {
        rec.category = patch.categoryKey;
        rec.categoryLabel = C.labelOf(patch.categoryKey);
        rec.customLabel = patch.customLabel != null ? String(patch.customLabel) : rec.customLabel;
        rec.D1 = axes.D1; rec.D2 = axes.D2; rec.focusNeedMin = axes.focusNeedMin;
        rec.D4 = axes.D4; rec.D5 = axes.D5; rec.D6 = axes.D6; rec.D7 = axes.D7;
        rec.channel = axes.channel; rec.bestTime = axes.bestTime;
        registerActivity(rec);
      }
    }
    rec.updatedAt = Date.now();
    writeDoc(doc);
    emit(EVENT_UPDATED, { item: rec, patch: patch });
    return true;
  }

  function remove(id) {
    var doc = readDoc();
    var before = doc.items.length;
    doc.items = doc.items.filter(function (r) { return r.id !== id; });
    if (doc.items.length === before) { return false; }
    writeDoc(doc);
    emit(EVENT_REMOVED, { id: id });
    return true;
  }
  function archive(id) { return update(id, { status: 'archived' }); }
  function restore(id) { return update(id, { status: 'active' }); }
  function clear() { writeDoc({ version: 1, updatedAt: Date.now(), items: [] }); }

  /* ---------- 取出：用于后续安排 ---------- */
  function preferredBand(rec) {
    var person = profile() || {};
    var bands = (rec.bestTime && rec.bestTime.length) ? rec.bestTime : ((C.axesOf(rec.category) || {}).bestTime || []);
    /* 和计划生成走同一条规则，免得「排进安排表」抄近路，把运动排到夜晚 */
    var res = bandForDomain(rec.category || rec.domain, bands, person.peakTime);
    return res.band;
  }
  function defaultSessionMin(rec) {
    var person = profile() || {};
    var need = rec.focusNeedMin || (C.axesOf(rec.category) || {}).focusNeedMin || 30;
    var block = person.block || need;
    return Math.max(15, Math.round(Math.min(need, block)));
  }
  function slotFor(rec, opts) {
    opts = opts || {};
    if (opts.start && opts.end) { return { start: opts.start, end: opts.end, band: null, sessionMin: toMinutes(opts.end) - toMinutes(opts.start) }; }
    var band = opts.band || preferredBand(rec);
    var sessionMin = opts.sessionMin || defaultSessionMin(rec);
    var start = TIME_BANDS[band] || '19:00';
    return { start: start, end: toHHMM(toMinutes(start) + sessionMin), band: band, sessionMin: sessionMin };
  }

  /* 周负荷预估：把该兴趣计入后，本周负荷百分比与区间文案 */
  function weeklyEstimate(entry, rec) {
    if (!root.LMS || !root.LMS.scoreActivity) { return null; }
    try {
      var person = (root.LMS.store && root.LMS.store.getPerson && root.LMS.store.getPerson()) ||
        (root.LMS.store && root.LMS.store.defaultPerson && root.LMS.store.defaultPerson()) || {};
      var acts = (root.LMS_DATA && root.LMS_DATA.ACTIVITIES) ? root.LMS_DATA.ACTIVITIES : [];
      var scored = {};
      acts.forEach(function (a) { scored[a.id] = root.LMS.scoreActivity(person, a); });
      var runtime = readKey(KEYS.ACTIVITY, []);
      if (Array.isArray(runtime)) {
        runtime.forEach(function (a) { scored[a.id] = root.LMS.scoreActivity(person, a); });
      }
      if (rec) { scored[rec.id] = root.LMS.scoreActivity(person, activityOf(rec)); }
      var base = (root.LMS.store && root.LMS.store.getPlan) ? root.LMS.store.getPlan() : [];
      var plan = base.slice();
      var replaced = false;
      for (var i = 0; i < plan.length; i++) {
        if (plan[i].activityId === entry.activityId) { plan[i] = entry; replaced = true; break; }
      }
      if (!replaced) { plan.push(entry); }
      return root.LMS.weeklyLoadPercent(person, plan, scored);
    } catch (e) { return null; }
  }

  /* take(id, mode, opts)
     mode='schedule'：返回可直接填入「新增事项」的安排信息（时段取自画像与兴趣偏好）
     mode='plan'    ：返回周计划项，并在负荷系统可用时写入本周计划 */
  function take(id, mode, opts) {
    opts = opts || {};
    var rec = get(id);
    if (!rec) { return { ok: false, reason: 'not_found' }; }
    mode = (mode === 'plan') ? 'plan' : 'schedule';

    var result;
    if (mode === 'schedule') {
      var slot = slotFor(rec, opts);
      result = {
        ok: true, mode: 'schedule',
        prefill: {
          project: rec.name,
          description: opts.description || '',
          date: opts.date || todayStr(),
          start: slot.start,
          end: slot.end
        },
        slotLabel: slot.band ? bandLabel(slot.band) : '',
        interestName: rec.name
      };
    } else {
      var hours = (opts.hours != null) ? opts.hours : (rec.hours != null ? rec.hours : Math.round((defaultSessionMin(rec) / 60) * 100) / 100);
      var entry = { activityId: rec.id, hours: hours, weekday: (opts.weekday != null ? opts.weekday : -1) };
      registerActivity(rec);
      var weekly = null;
      if (root.LMS && root.LMS.store && root.LMS.store.addToPlan) {
        try { root.LMS.store.addToPlan(entry.activityId, entry.hours, entry.weekday); } catch (e) { /* ignore */ }
        weekly = weeklyEstimate(entry, rec);
      }
      result = { ok: true, mode: 'plan', entry: entry, weekly: weekly, interestName: rec.name };
    }

    rec.lastUsedAt = Date.now();
    rec.useCount = (rec.useCount || 0) + 1;
    var doc = readDoc();
    doc.items = doc.items.map(function (r) { return r.id === rec.id ? rec : r; });
    writeDoc(doc);
    emit(EVENT_TAKEN, { id: id, mode: mode, result: result });
    return result;
  }

  /* ---------- 备份 / 迁移：仅程序调用，界面不提供入口 ---------- */
  function exportAll() { return readDoc(); }
  function importAll(doc) {
    if (!doc || !Array.isArray(doc.items)) { return { ok: false, added: 0, skipped: 0 }; }
    var cur = readDoc();
    var added = 0, skipped = 0;
    doc.items.forEach(function (r) {
      if (!r || !r.name || !r.category) { skipped++; return; }
      var dup = cur.items.some(function (x) { return x.name === r.name; });
      if (dup) { skipped++; return; }
      cur.items.push(r); added++;
    });
    writeDoc(cur);
    return { ok: true, added: added, skipped: skipped };
  }

  var API = {
    VERSION: VERSION,
    KEYS: KEYS,
    TIME_BANDS: TIME_BANDS,
    EVENTS: { ADDED: EVENT_ADDED, UPDATED: EVENT_UPDATED, REMOVED: EVENT_REMOVED, TAKEN: EVENT_TAKEN },

    classify: function (text, forcedKey) { return C.classify(text, forcedKey); },
    suggest: function (text, limit) { return C.suggest(text, limit); },
    categories: function () { return C.categories(); },
    labelOf: function (key) { return C.labelOf(key); },

    add: add,
    list: all,
    get: get,
    has: has,
    count: count,
    update: update,
    remove: remove,
    archive: archive,
    restore: restore,
    clear: clear,
    take: take,

    activityOf: activityOf,
    registerActivity: registerActivity,
    slotFor: slotFor,
    defaultSessionMin: defaultSessionMin,
    preferredBand: preferredBand,
    /* 特殊时段规则：计划生成与「排进安排表」共用这一个入口 */
    bandForDomain: bandForDomain,
    BAND_ORDER: BAND_ORDER.slice(),
    weeklyEstimate: weeklyEstimate,
    whenText: whenText,
    bandLabel: bandLabel,
    todayStr: todayStr,
    isStorageAvailable: isStorageAvailable,
    storageHint: storageHint,

    subscribe: subscribe,
    exportAll: exportAll,
    importAll: importAll,

    /* 供界面层读写既有本地数据使用：把「读写与转换」收敛在存储层，
       界面层因此不必接触任何原始数据形态。 */
    readLocal: function (key, dflt) { return readKey(key, dflt); },
    writeLocal: function (key, value) { return writeKey(key, value); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.InterestPool = API;
})(typeof window !== 'undefined' ? window : globalThis);
