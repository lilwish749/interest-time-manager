/* 主应用 —— hash 路由 + 启动，挂在 window.LMS.app */
(function (global) {
  'use strict';
  var LMS = global.LMS;

  function highlightNav(hash) {
    var links = document.querySelectorAll('.nav a');
    var target = hash.replace(/^#\/?/, '').split('/')[0];
    links.forEach(function (a) {
      var href = a.getAttribute('href').replace(/^#\/?/, '');
      a.classList.toggle('active', href === target);
    });
  }

  function route() {
    var hash = location.hash || '#/welcome';
    var path = hash.replace(/^#\/?/, '');
    var parts = path.split('/');
    highlightNav(hash);

    switch (parts[0]) {
      case '':
      case 'welcome':
        LMS.views.welcome(); break;
      case 'quiz':
        LMS.views.quiz(); break;
      case 'result':
        LMS.views.result(); break;
      case 'library':
        LMS.views.library(); break;
      case 'activity':
        LMS.views.activity(parts[1] || ''); break;
      case 'dashboard':
        LMS.views.dashboard(); break;
      case 'week':
        LMS.views.week(); break;
      case 'settings':
        LMS.views.settings(); break;
      default:
        LMS.views.welcome();
    }
    window.scrollTo(0, 0);
  }

  var app = {
    init: function () {
      // 先跑数据迁移：旧数据缺字段自动补默认值，不影响老用户
      if (LMS.store && LMS.store.migrate) { LMS.store.migrate(); }
      window.addEventListener('hashchange', route);
      if (!location.hash) { location.hash = '#/welcome'; }
      else { route(); }
    }
  };

  global.LMS = global.LMS || {};
  global.LMS.app = app;

  document.addEventListener('DOMContentLoaded', function () {
    if (global.LMS && global.LMS.app) { global.LMS.app.init(); }
  });
})(window);
