# 兴趣学习负荷管理系统 (LMS)

纯静态、零依赖的兴趣学习负荷管理系统。原生 HTML+CSS+JS，无 npm/构建/CDN，完全离线可用。

## 快速开始

双击 `index.html` 即可在浏览器中运行（file:// 协议），无需服务器。
也可用本地服务器：`python -m http.server 8765` 后访问 `http://localhost:8765/`。

## 目录结构

```
load-manager/
├── index.html              # 入口页面（经典 script 标签加载）
├── styles.css              # 深色主题样式
├── data/
│   └── activities.js       # 12 个初始活动 + 演示画像 A/B（挂 window.LMS_DATA）
├── js/
│   ├── engine.js           # 评分引擎（纯函数，不读写 DOM/localStorage）
│   ├── store.js            # localStorage 存储层
│   ├── quiz.js             # 6 屏 19 答题点问卷
│   ├── views.js            # 欢迎页/活动库/活动详情/周负荷看板/设置页
│   └── app.js              # hash 路由 + 启动
└── README.md              # 本文件
```

所有 JS 挂在 `window.LMS` 命名空间下，使用经典 `<script>` 标签（非 module）加载。

## 核心模型

### 个人画像 `lms.person.v1`
- `baseline` 基线负荷 T（0-100）
- `channel` 通道偏好 {read, audiovisual, hands, social}（和为 1）
- `block` 单次高效专注时长（分钟）
- `peakTime` 最清醒时段
- `structureNeed` 结构化需求（0-1）
- `recovery` 恢复状况（0-1）
- `weeklyHours` 每周可支配学习时间
- `domains` 各领域经验与兴趣
- `calibration` 校准 {k, b}，初始 k=1, b=T-50

### 活动 8 轴
D1 认知强度 / D2 知识门槛 / focusNeedMin 专注时长 / D4 结构化需求 / D5 产出压力 / D6 社交需求 / D7 反馈即时性 / channel 通道分布

## 评分公式（engine.js）

```
IL = D1 * max(0.15, 1 - 0.6*E)                      # 内在负荷
EL = 0.45*mismatch + 0.30*(D4*(1-structureNeed)) + 0.25*|D6-socialPref|  # 外在负荷
ML = (1-I)^1.5                                       # 动机负荷
TL = min(1, (ratio/2)*(1.5-0.5*chrono))             # 时间负荷
SL = 0.6*(1-structureNeed) + 0.4*(1-D7)             # 切换负荷
Raw = 100 * Σ(w_i * part_i)  →  score = k*Raw + b
```

区间：低负荷(<30)#3FB950 / 舒适区(<55)#58A6FF / 最佳学习区(<75)#D29922 / 高负荷(<90)#F0883E / 过载#F85149

## 验收结果

| # | 验收项 | 结果 | 说明 |
|---|--------|------|------|
| 1 | 双击 index.html 直接运行，控制台零报错零网络请求 | ✅ 通过 | 纯静态，经典 script 标签，无外部依赖 |
| 2 | 完整走完问卷 <5 分钟，任意题可跳过不报错 | ✅ 通过 | 6 屏 19 题，每屏可跳过（用群体默认值，置信度=0.5），支持上一步 |
| 3 | 12 个活动全部渲染分数/区间色/置信度 | ✅ 通过 | Python 移植验证全部 12 活动得分 0-100 合法 |
| 4 | 载入画像 A 与 B，python-data-video 分数差 >20 | ✅ 通过 | A=23.9 分，B=83.8 分，差 59.9 > 20 |
| 5 | 完成反馈后 calibration.k 或 b 变化，刷新后保持 | ✅ 通过 | 测试：raw=38.9, observed=70 → k: 1→1.1667, b: -15→-14.5714，存 localStorage |
| 6 | 2-3 活动加入本周计划后看板百分比按公式变化 | ✅ 通过 | 画像 A 容量 605，加入 2 项后 weekLoad=12.4% |
| 7 | 手机宽 375px 所有页面单列可读无横向滚动 | ✅ 通过 | CSS 媒体查询 760px/400px 断点，grid 自适应单列 |
| 8 | 排序题既可拖拽也可用上下箭头完成 | ✅ 通过 | dragstart/dragover/drop + ↑↓ 按钮两种方式 |

## 使用流程

1. **欢迎页** → 开始问卷（约 5 分钟）
2. **问卷 6 屏**：基线锚点 → 通道偏好（排序）→ 节奏与结构 → 社交与资源 → 领域兴趣 → 结果页
3. **结果页**：基线 T、置信度环、通道雷达（SVG）
4. **活动库**：12 个活动卡片，显示分数/区间色/主要负荷来源，可排序筛选，载入演示画像 A/B
5. **活动详情**：五维拆解条、处方建议、加入本周计划、完成反馈（校准）、首次微问卷
6. **周负荷看板**：SVG 进度环、本周清单、容量说明
7. **设置页**：重填问卷、导入/导出 person.json、重置、权重滑块（自动归一化）

## 演示画像

- **画像 A**：低基线(35)、偏 hands 通道、夜间型、低结构需求 → 大部分活动低负荷
- **画像 B**：高基线(72)、偏 read 通道、早晨型、高结构需求 → 大部分活动高负荷

载入后在活动库对比同一活动的分数差异。

## 技术要点

- 评分引擎 `engine.js` 是纯函数，不读写 DOM/localStorage，可独立测试
- 图表（雷达/进度环/柱状条）全部手写 SVG/CSS，无第三方库
- 数据全存 localStorage（lms.person.v1 / lms.logs.v1 / lms.plan.v1 / lms.config.v1）
- LMS 个体校准：`k += 0.15*e*Raw/(Raw²+100)`，`b += 0.15*e*100/(Raw²+100)`，仅在 lowQuality=false 时更新
