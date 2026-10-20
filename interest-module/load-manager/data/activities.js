/* 活动库与演示画像 —— UMD 风格，浏览器和 Node 均可使用 */
(function (root) {
  'use strict';

  var ACTIVITIES = [
    { id: 'python-data-video', name: '跟视频教程学 Python 数据处理', domain: 'coding',
      D1: 0.70, D2: 0.60, focusNeedMin: 45, D4: 0.75, D5: 0.50, D6: 0.10, D7: 0.60,
      channel: { read: 0.10, audiovisual: 0.60, hands: 0.30, social: 0.00 },
      bestTime: ['forenoon', 'afternoon'] },
    { id: 'read-cogsci-book', name: '读一本认知科学入门书', domain: 'reading',
      D1: 0.65, D2: 0.45, focusNeedMin: 40, D4: 0.30, D5: 0.15, D6: 0.05, D7: 0.20,
      channel: { read: 0.85, audiovisual: 0.05, hands: 0.05, social: 0.05 },
      bestTime: ['morning', 'night'] },
    { id: 'duolingo-japanese', name: '用 App 学日语', domain: 'language',
      D1: 0.35, D2: 0.30, focusNeedMin: 15, D4: 0.85, D5: 0.35, D6: 0.05, D7: 0.90,
      channel: { read: 0.25, audiovisual: 0.35, hands: 0.35, social: 0.05 },
      bestTime: ['morning', 'forenoon', 'afternoon', 'evening', 'night'] },
    { id: 'blender-basics', name: '跟教程学 Blender 建模', domain: 'design',
      D1: 0.70, D2: 0.55, focusNeedMin: 60, D4: 0.70, D5: 0.60, D6: 0.05, D7: 0.55,
      channel: { read: 0.10, audiovisual: 0.55, hands: 0.35, social: 0.00 },
      bestTime: ['afternoon', 'night'] },
    { id: 'piano-piece', name: '练一首钢琴曲', domain: 'music',
      D1: 0.50, D2: 0.35, focusNeedMin: 30, D4: 0.60, D5: 0.55, D6: 0.05, D7: 0.50,
      channel: { read: 0.05, audiovisual: 0.20, hands: 0.75, social: 0.00 },
      bestTime: ['evening'] },
    { id: 'tech-blog', name: '写一篇技术博客', domain: 'writing',
      D1: 0.75, D2: 0.55, focusNeedMin: 60, D4: 0.35, D5: 0.85, D6: 0.10, D7: 0.25,
      channel: { read: 0.30, audiovisual: 0.10, hands: 0.20, social: 0.40 },
      bestTime: ['night'] },
    { id: 'history-notes', name: '研究一段历史并做笔记', domain: 'history',
      D1: 0.60, D2: 0.40, focusNeedMin: 45, D4: 0.25, D5: 0.30, D6: 0.05, D7: 0.15,
      channel: { read: 0.75, audiovisual: 0.15, hands: 0.10, social: 0.00 },
      bestTime: ['morning'] },
    { id: 'lr-color-grading', name: '学摄影后期调色', domain: 'photography',
      D1: 0.55, D2: 0.45, focusNeedMin: 40, D4: 0.55, D5: 0.50, D6: 0.05, D7: 0.75,
      channel: { read: 0.15, audiovisual: 0.45, hands: 0.40, social: 0.00 },
      bestTime: ['afternoon', 'night'] },
    { id: 'arduino-project', name: '动手做 Arduino 小项目', domain: 'coding',
      D1: 0.75, D2: 0.65, focusNeedMin: 75, D4: 0.40, D5: 0.80, D6: 0.10, D7: 0.65,
      channel: { read: 0.20, audiovisual: 0.15, hands: 0.65, social: 0.00 },
      bestTime: ['afternoon'] },
    { id: 'online-book-club', name: '参加线上读书会讨论', domain: 'history',
      D1: 0.45, D2: 0.30, focusNeedMin: 60, D4: 0.35, D5: 0.25, D6: 0.90, D7: 0.40,
      channel: { read: 0.20, audiovisual: 0.15, hands: 0.05, social: 0.60 },
      bestTime: ['evening', 'night'] },
    { id: 'prompt-engineering', name: '整理 AI 提示词模板库', domain: 'coding',
      D1: 0.60, D2: 0.40, focusNeedMin: 35, D4: 0.45, D5: 0.60, D6: 0.10, D7: 0.70,
      channel: { read: 0.40, audiovisual: 0.30, hands: 0.30, social: 0.00 },
      bestTime: ['morning', 'forenoon', 'afternoon', 'evening', 'night'] },
    { id: 'sketch-copy', name: '临摹一张插画', domain: 'design',
      D1: 0.45, D2: 0.30, focusNeedMin: 40, D4: 0.35, D5: 0.55, D6: 0.00, D7: 0.60,
      channel: { read: 0.10, audiovisual: 0.25, hands: 0.65, social: 0.00 },
      bestTime: ['night'] }
  ];

  /* 三个演示画像 —— 规格第七节提供，禁止修改 */
  var DEMO_PROFILES = {
    A: {
      baseline: 35, channel: { read: 0.15, audiovisual: 0.15, hands: 0.65, social: 0.05 }, block: 65,
      stuck: 'search', peakTime: 'night', structureNeed: 0.25, openLoop: 0.3, socialPref: 0.1,
      recovery: 0.85, weeklyHours: 10,
      domains: { coding: { experience: 0.75, interest: 1.0 }, design: { experience: 0.5, interest: 0.75 } },
      calibration: { k: 1, b: -15 }
    },
    B: {
      baseline: 72, channel: { read: 0.5, audiovisual: 0.35, hands: 0.1, social: 0.05 }, block: 15,
      stuck: 'ask', peakTime: 'morning', structureNeed: 0.9, openLoop: 1.0, socialPref: 0.5,
      recovery: 0.3, weeklyHours: 4,
      domains: { coding: { experience: 0.25, interest: 0.25 }, design: { experience: 0.1, interest: 0.2 } },
      calibration: { k: 1, b: 22 }
    },
    C: {
      baseline: 30, channel: { read: 0.5, audiovisual: 0.3, hands: 0.15, social: 0.05 }, block: 15,
      stuck: 'search', peakTime: 'night', structureNeed: 0.9, openLoop: 0.5, socialPref: 0.0,
      recovery: 0.8, weeklyHours: 8,
      domains: { language: { experience: 0.95, interest: 0.3 } },
      calibration: { k: 1, b: -25 }
    }
  };

  /* 运行期扩展：把兴趣池新增的活动并入活动清单，使负荷系统也能识别这些兴趣。
     仅在浏览器且存在本地记录时生效；Node（测试）环境自动跳过，结果不受影响。 */
  function mergeRuntimeActivities() {
    try {
      if (typeof localStorage === 'undefined') { return; }
      var raw = localStorage.getItem('lms.activities.v1');
      if (!raw) { return; }
      var extra = JSON.parse(raw);
      if (!Array.isArray(extra)) { return; }
      extra.forEach(function (act) {
        if (!act || !act.id || !act.name || !act.domain) { return; }
        for (var i = 0; i < ACTIVITIES.length; i++) {
          if (ACTIVITIES[i].id === act.id) { return; }
        }
        ACTIVITIES.push(act);
      });
    } catch (e) { /* 本地记录不可读时保持内置清单不变 */ }
  }
  mergeRuntimeActivities();

  var LMS_DATA = { ACTIVITIES: ACTIVITIES, DEMO_PROFILES: DEMO_PROFILES };

  if (typeof module !== 'undefined' && module.exports) module.exports = LMS_DATA;
  else root.LMS_DATA = LMS_DATA;
})(typeof window !== 'undefined' ? window : globalThis);
