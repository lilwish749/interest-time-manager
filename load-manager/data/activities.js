/* 活动库与演示画像 —— UMD 风格，浏览器和 Node 均可使用 */
(function (root) {
  'use strict';

  var ACTIVITIES = [
    { id: 'python-data-video', name: '跟视频教程学 Python 数据处理', domain: 'coding',
      D1: 0.70, D2: 0.60, focusNeedMin: 45, D4: 0.75, D5: 0.50, D6: 0.10, D7: 0.60,
      channel: { read: 0.10, audiovisual: 0.60, hands: 0.30, social: 0.00 },
      bestTime: ['forenoon', 'afternoon'],
      cards: [
        { step: 1, action: '跟完教程第 1 节，用 pandas 把示例 CSV 读进来并打印前 5 行',
          deliverable: '一个能跑通的 .ipynb 文件', tip: '先别改代码，先跑通再说' },
        { step: 2, action: '在上面的代码上改 3 处（列名、筛选条件、排序字段），每改一处记一行结果',
          deliverable: '3 条「改了什么 → 结果怎么变」的记录', tip: '改错了就撤回，重点看报错信息' },
        { step: 3, action: '拿一张你自己的真实数据（哪怕是一张记账表），独立完成 读入 → 筛选 → 排序 → 导出 四步',
          deliverable: '一份导出的 CSV', tip: '卡住超过 10 分钟就先跳过这一处，别在原地耗' }
      ] },
    { id: 'read-cogsci-book', name: '读一本认知科学入门书', domain: 'reading',
      D1: 0.65, D2: 0.45, focusNeedMin: 40, D4: 0.30, D5: 0.15, D6: 0.05, D7: 0.20,
      channel: { read: 0.85, audiovisual: 0.05, hands: 0.05, social: 0.05 },
      bestTime: ['morning', 'night'],
      cards: [
        { step: 1, action: '读完第 1 章，用荧光笔标出 5 句你认为最关键的原文句子',
          deliverable: '5 条标好的原文句子（拍照留底）', tip: '读不懂的段落先跳过，别停在一页上' },
        { step: 2, action: '用自己的话给这 5 句各写一句解释，每句不超过 40 字',
          deliverable: '5 条自己写的解释', tip: '写成自己的话，别照抄原句' },
        { step: 3, action: '合上书，用 200 字复述这一章讲了什么，再翻书对照补漏 3 处',
          deliverable: '一份 200 字复述稿 + 3 处补漏标记', tip: '先写完再翻书，边看边写等于没复述' }
      ] },
    { id: 'duolingo-japanese', name: '用 App 学日语', domain: 'language',
      D1: 0.35, D2: 0.30, focusNeedMin: 15, D4: 0.85, D5: 0.35, D6: 0.05, D7: 0.90,
      channel: { read: 0.25, audiovisual: 0.35, hands: 0.35, social: 0.05 },
      bestTime: ['morning', 'forenoon', 'afternoon', 'evening', 'night'],
      cards: [
        { step: 1, action: '完成 App 里 1 组入门单元（约 4 个小关卡），每句都跟着读一遍',
          deliverable: '一张单元完成截图', tip: '别追求全对，先把当天的连续打卡保住' },
        { step: 2, action: '把这一单元出现的 15 个新词抄进生词表，每个词自己造 1 句短句',
          deliverable: '一张 15 词的生词表（含例句）', tip: '例句用自己生活里的事，比抄课本好记' },
        { step: 3, action: '连做 3 天复习关卡，把反复答错的词挑出来单独再抄一遍',
          deliverable: '一份至少 5 个词的错词清单', tip: '只抄错词，别把整单元重抄一遍' }
      ] },
    { id: 'blender-basics', name: '跟教程学 Blender 建模', domain: 'design',
      D1: 0.70, D2: 0.55, focusNeedMin: 60, D4: 0.70, D5: 0.60, D6: 0.05, D7: 0.55,
      channel: { read: 0.10, audiovisual: 0.55, hands: 0.35, social: 0.00 },
      bestTime: ['afternoon', 'night'],
      cards: [
        { step: 1, action: '跟教程摆出方块 → 圆柱 → 球的基础场景，渲染 1 张 800×600 的图',
          deliverable: '一张渲染截图', tip: '镜头别乱调，先把模型摆出来再管好看' },
        { step: 2, action: '给模型加 1 个材质（金属或木纹），改 2 个参数各渲染一次做对比',
          deliverable: '2 张材质对比图 + 改了哪 2 个参数的记录', tip: '一次只改一个参数，不然不知道是哪个起效' },
        { step: 3, action: '不看教程，独立复刻一个桌上的杯子，导出 .blend 工程文件',
          deliverable: '一个 .blend 文件 + 1 张渲染图', tip: '卡住就回看对应的那一小段教程，别整节重看' }
      ] },
    { id: 'piano-piece', name: '练一首钢琴曲', domain: 'music',
      D1: 0.50, D2: 0.35, focusNeedMin: 30, D4: 0.60, D5: 0.55, D6: 0.05, D7: 0.50,
      channel: { read: 0.05, audiovisual: 0.20, hands: 0.75, social: 0.00 },
      bestTime: ['evening'],
      cards: [
        { step: 1, action: '单手把前 4 小节慢速弹顺，节拍器调到 60，录一段 30 秒',
          deliverable: '一段 30 秒录音', tip: '错音别停下重来，先弹完整一遍' },
        { step: 2, action: '双手合，只练两个衔接处，每处各练 3 遍',
          deliverable: '衔接处能连上（录 1 段）', tip: '卡的地方单独拆出来，慢过一遍就顺了' },
        { step: 3, action: '完整弹一遍这首曲子的这一段并录音',
          deliverable: '一条完整录音', tip: '录下来自己听，比练十遍都有用' }
      ] },
    { id: 'tech-blog', name: '写一篇技术博客', domain: 'writing',
      D1: 0.75, D2: 0.55, focusNeedMin: 60, D4: 0.35, D5: 0.85, D6: 0.10, D7: 0.25,
      channel: { read: 0.30, audiovisual: 0.10, hands: 0.20, social: 0.40 },
      bestTime: ['night'],
      cards: [
        { step: 1, action: '定下标题，列出 5 条提纲，每条用一句话写清要讲什么',
          deliverable: '一份 5 条提纲的文档', tip: '提纲先写，别对着空白页硬憋开头' },
        { step: 2, action: '按提纲写完正文，不少于 800 字，插入 2 段代码块',
          deliverable: '一篇 800 字以上的草稿（含 2 段代码）', tip: '先写完再改，别边写边删' },
        { step: 3, action: '通读一遍删掉 10 句话，把开头压缩到 3 句话以内说完',
          deliverable: '一版删改后的定稿', tip: '删的时候手要狠，能删就删' }
      ] },
    { id: 'history-notes', name: '研究一段历史并做笔记', domain: 'history',
      D1: 0.60, D2: 0.40, focusNeedMin: 45, D4: 0.25, D5: 0.30, D6: 0.05, D7: 0.15,
      channel: { read: 0.75, audiovisual: 0.15, hands: 0.10, social: 0.00 },
      bestTime: ['morning'],
      cards: [
        { step: 1, action: '选定 1 个历史事件，从 2 个来源各整理 5 条时间线要点',
          deliverable: '一份 10 条时间线笔记', tip: '两个来源都要看，别只信一个说法' },
        { step: 2, action: '把两个来源说法不一致的地方标出来，至少找出 3 处',
          deliverable: '3 处分歧对照记录', tip: '日期和数字最容易打架，重点核对' },
        { step: 3, action: '用 300 字写一段自己的判断，注明依据的是哪几条材料',
          deliverable: '一段 300 字判断（含材料编号）', tip: '结论后面要跟材料编号，不然站不住' }
      ] },
    { id: 'lr-color-grading', name: '学摄影后期调色', domain: 'photography',
      D1: 0.55, D2: 0.45, focusNeedMin: 40, D4: 0.55, D5: 0.50, D6: 0.05, D7: 0.75,
      channel: { read: 0.15, audiovisual: 0.45, hands: 0.40, social: 0.00 },
      bestTime: ['afternoon', 'night'],
      cards: [
        { step: 1, action: '用同一张原片，调出 2 种风格（高对比、低饱和），各导出 1 张',
          deliverable: '2 张风格对比图', tip: '先看直方图再动滑块，别凭感觉拉到爆' },
        { step: 2, action: '把其中一张的参数抄下 5 项（曝光/对比/色温等），照参数复现一次',
          deliverable: '一份 5 项参数记录 + 复现图', tip: '照着记参数，比凭手感调有用得多' },
        { step: 3, action: '用自己拍的一张照片独立完成调色，写出 3 步主要操作',
          deliverable: '1 张成片 + 3 步操作说明', tip: '写完操作再对比原片，看差别在哪' }
      ] },
    { id: 'arduino-project', name: '动手做 Arduino 小项目', domain: 'coding',
      D1: 0.75, D2: 0.65, focusNeedMin: 75, D4: 0.40, D5: 0.80, D6: 0.10, D7: 0.65,
      channel: { read: 0.20, audiovisual: 0.15, hands: 0.65, social: 0.00 },
      bestTime: ['afternoon'],
      cards: [
        { step: 1, action: '让板子上的 LED 按 1 秒间隔闪烁，程序上传成功',
          deliverable: '一段 15 秒闪烁视频', tip: '烧不进去先查端口和驱动' },
        { step: 2, action: '接 1 个按钮，实现按下亮、松开灭',
          deliverable: '一段演示视频 + 一张接线照片', tip: '接线先断电，别带电插拔' },
        { step: 3, action: '用按钮 + LED 做一个「按 3 次才亮」的小逻辑',
          deliverable: '一段演示视频 + 代码截图', tip: '先在纸上数一遍计数逻辑再写代码' }
      ] },
    { id: 'online-book-club', name: '参加线上读书会讨论', domain: 'history',
      D1: 0.45, D2: 0.30, focusNeedMin: 60, D4: 0.35, D5: 0.25, D6: 0.90, D7: 0.40,
      channel: { read: 0.20, audiovisual: 0.15, hands: 0.05, social: 0.60 },
      bestTime: ['evening', 'night'],
      cards: [
        { step: 1, action: '在读书会里发言 1 次，讲清书里的 1 个观点',
          deliverable: '一段发言截图或录音', tip: '提前写好 1 句开场，别等别人点名' },
        { step: 2, action: '记下 3 个别人提到、你没注意到的点，各写一句自己的看法',
          deliverable: '3 条记录', tip: '当场就记，散会后基本想不起来' },
        { step: 3, action: '主动回答别人提的 1 个问题，再把讨论整理成 200 字笔记',
          deliverable: '一份 200 字讨论笔记', tip: '回答前先确认自己真的理解问题' }
      ] },
    { id: 'prompt-engineering', name: '整理 AI 提示词模板库', domain: 'coding',
      D1: 0.60, D2: 0.40, focusNeedMin: 35, D4: 0.45, D5: 0.60, D6: 0.10, D7: 0.70,
      channel: { read: 0.40, audiovisual: 0.30, hands: 0.30, social: 0.00 },
      bestTime: ['morning', 'forenoon', 'afternoon', 'evening', 'night'],
      cards: [
        { step: 1, action: '收集 10 条你用得上的提示词，按用途分成 3 类',
          deliverable: '一份 10 条 3 类的模板表', tip: '分类按「你什么时候会用它」来分最实用' },
        { step: 2, action: '挑 1 条改写成带「角色 + 输出格式 + 示例」的模板，实际跑 2 次对比结果',
          deliverable: '改后的模板 + 2 次结果对比', tip: '模板里写清输出格式，结果才稳定' },
        { step: 3, action: '用这套模板解决 1 个真实问题，写下 3 条使用心得',
          deliverable: '1 份解决记录 + 3 条心得', tip: '记下失败的那次，比成功的更值钱' }
      ] },
    { id: 'sketch-copy', name: '临摹一张插画', domain: 'design',
      D1: 0.45, D2: 0.30, focusNeedMin: 40, D4: 0.35, D5: 0.55, D6: 0.00, D7: 0.60,
      channel: { read: 0.10, audiovisual: 0.25, hands: 0.65, social: 0.00 },
      bestTime: ['night'],
      cards: [
        { step: 1, action: '选一张想临摹的图，用 30 秒画出 3 个缩略构图方案（火柴人级）',
          deliverable: '3 张草稿', tip: '30 秒就得停手，慢下来就不叫缩略了' },
        { step: 2, action: '只画大块明暗不画细节，限时 20 分钟',
          deliverable: '一张 5 阶灰度稿', tip: '先定大形再铺色' },
        { step: 3, action: '对照原图修正一次比例关系',
          deliverable: '修正前后的对比图', tip: '用铅笔量一量，别用眼睛估' }
      ] }
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

  var LMS_DATA = { ACTIVITIES: ACTIVITIES, DEMO_PROFILES: DEMO_PROFILES };

  if (typeof module !== 'undefined' && module.exports) module.exports = LMS_DATA;
  else root.LMS_DATA = LMS_DATA;
})(typeof window !== 'undefined' ? window : globalThis);
