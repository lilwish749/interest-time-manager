# 兴趣时间管理器

纯静态、零依赖的兴趣学习管理系统。原生 HTML+CSS+JS，无 npm / 无构建 / 无 CDN，完全离线可用。

## 产品概览

本产品包含四大核心功能模块：

| 模块 | 职责 | 状态 |
|------|------|------|
| **兴趣池** | 随时记录兴趣，AI 识别分类，联动负荷评判，支持存取 | 规划中 |
| **负荷管理系统** | 问卷生成画像，7 分量评分，活动匹配度可视化 | ✅ 已实现 |
| **时间计划表** | 本地确定性排程，生成具体到几点做什么的周计划，可换时间 / 勾完成 / 导出 .ics | ✅ 已实现 |
| **社交定制** | 综合数据生成精美海报，一键分享 | 规划中 |

> 本文档聚焦**负荷管理系统**的技术实现。产品整体介绍见 [PROJECT.md](PROJECT.md)。

## 快速开始

双击 `index.html` 即可在浏览器中运行（file:// 协议），无需服务器。
也可用本地服务器：`python -m http.server 8765` 后访问 `http://localhost:8765/`。

跑测试：`node tests/run.js`（35 项断言，覆盖黄金用例 / 字段使用 / 单调性 / 边界 / 校准 / 抗噪 / 排程引擎）。
浏览器版测试：双击 `tests.html`，自动运行同一套断言。

## 目录结构

```
load-manager/
├── index.html              # 入口页面（经典 script 标签加载）
├── tests.html              # 浏览器版测试套件（自包含，深色主题）
├── styles.css              # 深色主题样式（含 @media print 白底黑字）
├── SELF-CHECK.md           # 自检文档（验收表 + 反向验证 + 分批记录 + 自主决策）
├── README.md               # 本文件
├── docs/
│   ├── ANNOTATION.md       # 标注锚点（0.2/0.5/0.8 三档）
│   └── EXECUTION-CARDS.md  # 执行卡标注规范 + 三档行为锚点
├── data/
│   └── activities.js       # 12 个初始活动 + 每个活动的执行卡（挂 window.LMS_DATA）
├── js/
│   ├── engine.js           # 评分引擎 + 推荐计划生成（纯函数，不读写 DOM/localStorage）
│   ├── store.js            # localStorage 存储层 + 数据迁移
│   ├── scheduler.js        # 周计划排程引擎（纯函数，确定性，不联网、无随机数）
│   ├── quiz.js             # 6 屏问卷（全部必填）+ 大白话画像渲染
│   ├── views.js            # 欢迎页/活动库/推荐计划/活动详情/周负荷看板/周计划/设置页
│   └── app.js              # hash 路由 + 启动
└── tests/
    └── run.js              # Node 测试套件（35 项断言）
```

所有 JS 挂在 `window.LMS` 命名空间下，使用经典 `<script>` 标签（非 module）加载。

## 核心模型

### 个人画像 `lms.person.v1`（每个用户唯一一份）

- `baseline` 学习吃力指数（0-100）
- `channel` 学习方式偏好 {read, audiovisual, hands, social}（和为 1）
- `block` 单次高效专注时长（分钟）
- `peakTime` 最清醒时段
- `structureNeed` 结构化需求（0-1）
- `openLoop` 开放循环偏好（0-1）
- `socialPref` 社交偏好（0-1）
- `stuck` 卡住反应（'search' / 'ask' / 'switch'）
- `recovery` 恢复状况（0-1）
- `weeklyHours` 每周可支配学习时间
- `domains` 各领域经验与兴趣
- `calibration` 校准 {k, b}，首次 k=1, b=T-50；重新作答时保留，持续微调

**唯一画像原则**：重新填写问卷会回填已有答案、覆盖更新同一份画像（不新建），校准与反馈记录保留，支持持续精准调整与信息完善。

### 活动 8 轴

D1 认知强度 / D2 知识门槛 / focusNeedMin 专注时长 / D4 结构化需求 / D5 产出压力 / D6 社交需求 / D7 反馈即时性 / channel 通道分布

标注锚点见 [docs/ANNOTATION.md](docs/ANNOTATION.md)。

## 评分公式（engine.js）

### 6 正向分量 + 1 负向分量

```
IL = D1 * (0.7 + 0.3*D2) * max(0.15, 1 - 0.6*E)        # 内在认知负荷
EL = 0.7*mismatch + 0.3*|D6 - socialPref|              # 外在环境负荷
   where mismatch = (1 - dot) / 0.75
   dot = Σ(channel_person[k] * channel_act[k])  for k in {read, audiovisual, hands, social}
ML = (1 - I)^1.5                                         # 动机负荷
TL = min(1, (ratio/2) * (1.5 - 0.5*chrono))             # 时间负荷
   where chrono = 1 if peakTime in bestTime else 0.5
         ratio  = clamp(focusNeedMin / block, 0.5, 2)
SL = 0.50*(1 - structureNeed) + 0.30*(1 - D7) + 0.20*stuckPenalty   # 切换负荷
   where stuckPenalty: ask→(D6<0.3 ? 1.0 : 0.3), switch→0.6, search→0.2
PL = openLoop * (1 - D5)                                # 产出压力负荷
UL = D1 * max(0, E - D2 - 0.15) * 0.8                   # 负向分量（挑战不足，从总分扣减）
```

### 加权与校准

```
权重 W = { IL:0.26, EL:0.20, ML:0.18, TL:0.14, SL:0.12, PL:0.10 }
rawBase = Σ(W[k] * part_k)                              # 6 正向分量加权和
raw     = clamp(100*rawBase - 100*0.45*UL, 0, 100)      # 扣减 UL
score   = clamp(k*raw + b, 0, 100)                      # 个体校准后
matchOf = clamp(100 - |score - 66|*1.8, 0, 100)         # 匹配度（66分为理想点）
```

### 分区（zoneOf）

| 区间 | key | 标签 | 颜色 |
|------|-----|------|------|
| <15 | under | 挑战不足 | #39C5BB |
| <35 | low | 低负荷 | #3FB950 |
| <58 | comfort | 舒适区 | #58A6FF |
| <76 | optimal | 最佳学习区 | #D29922 |
| <90 | high | 高负荷 | #F0883E |
| ≥90 | over | 过载 | #F85149 |

### 校准更新（updateCalibration）

```
predicted = k*raw + b
e = observed - predicted

k 更新（仅 |e|>8 时，抗噪）：
  k = clamp(k + 0.12*e*raw / (raw²+100), 0.5, 1.6)

b 更新（最近 10 次误差中位数）：
  b = clamp(median(recent_10_errors), -35, 35)

lowQuality=true 时不更新（注意检查未过时跳过校准）
```

### 周负荷（weeklyCapacity / weeklyLoadPercent）

```
weeklyCapacity = weeklyHours * 50 * (0.7 + 0.6*recovery)
dailyPenalty:  同天第2个>70分活动 ×1.15，第3个+ ×1.30
weeklyLoadPercent = Σ(score * penalty * hours) / capacity * 100
```

## 周计划是怎么算出来的

把「推荐的活动」变成「周一 20:00–20:55 跟教程第 1 节，产出：一个能跑的 .ipynb」——这一步由 `js/scheduler.js` 的本地确定性算法完成。

### 为什么不用大模型

1. 验收标准要求「控制台零报错、**零网络请求**」，调用 AI 接口会直接破坏这一条；
2. 排程是**约束满足问题**，不是文本生成。活动库的 `focusNeedMin`/`bestTime`/`D1–D7` 和画像的 `block`/`peakTime`/`weeklyHours`/`recovery` 已经足够把解算出来；
3. 模型编的时间很可能违反「同一天不超过一个高负荷活动」「周负荷不超过容量」这些约束，**页面上的时间表会和旁边的周负荷看板打架**；
4. 算法排出来的结果**可复现、可测试**，能写黄金用例；模型输出不能。

**分工原则：让算法算时间，让人写内容。** 时间、顺序、间隔、容量 → `scheduler.js`；每次做什么、交付什么、注意什么 → 活动数据的执行卡（见 [docs/EXECUTION-CARDS.md](docs/EXECUTION-CARDS.md)）。

### 单次时长与次数

```
duration = clamp( round5( min( focusNeedMin * 1.2, clamp(person.block, 45, 90) ) ), 25, 90 )
sessions = clamp( round( hours * 60 / duration ), 1, 6 )
```

`round5` 指按 5 分钟取整。若 `duration < focusNeedMin`，说明这个活动放不进用户的专注块，会在 `warnings` 里记一条，但照样排。

### 七条硬约束（违反就换位置，换不到就进 `unscheduled`）

| # | 约束 |
|---|---|
| H1 | 同一活动同一天最多出现 1 次（该活动本周有 2 块及以上时放宽为 2 次且间隔 ≥ 4 小时） |
| H2 | 同一天 `score > 75` 的块最多 1 个 |
| H3 | 同一天总分钟数 ≤ 240 |
| H4 | 块与块之间至少间隔 10 分钟 |
| H5 | 整个块必须落在**同一个**可用段内，不能跨段 |
| H6 | `restDay` 里列出的星期不排任何块 |
| H7 | 超出可用段总容量的 session 直接进 `unscheduled`，并写清原因 |

排程顺序是确定性的：先按「能否落在 `bestTime` ∩ `peakTime`」分档，再按 `score` 降序、`activityId` 字典序排序；放置时依次尝试「bestTime ∩ peakTime 的槽 → bestTime 的槽 → 任意合法槽」。

### 目标函数 J

排完一遍后，做**最多 2 轮**固定顺序的交换改进（周一 → 周日、每块按开始时间，**不引入随机数**），只有 `J` 严格下降才接受：

```
J = 5 × (无法匹配 bestTime 的块数)
  + 3 × (同一天两个 score>75 的块构成的冲突对数)
  + 2 × (同一活动连续两天出现)
  + Σ (100 - match) / 10
```

### 数字只有一个真相

周负荷由 `computeWeekLoad(person, plan, timetable, scored)` 统一计算：**有时间表**就按时间表里的实际块重算（同天惩罚按 `score > 70` 的块数，第 2 个 ×1.15、第 3 个及以上 ×1.30，与 `engine.js` 的 `dailyPenalty` 口径一致）；**没有时间表**则回退到 `weeklyLoadPercent`，保证老用户数据不变。看板与周计划页都调它，**不许两处各算一遍**。

> 排程结果是启发式解，不保证全局最优，但保证满足全部硬约束。

## 黄金用例

| 画像 | 活动 | IL | EL | ML | TL | SL | PL | UL | raw | score | zone |
|------|------|------|------|------|------|------|------|------|------|-------|------|
| A | python-data-video | 0.3388 | 0.6533 | 0.0000 | 0.4327 | 0.5350 | 0.1500 | 0.0000 | 35.85 | 21 | low |
| B | python-data-video | 0.5236 | 0.7827 | 0.6495 | 1.0000 | 0.3700 | 0.5000 | 0.0000 | 64.40 | 86 | high |
| C | duolingo-japanese | 0.1189 | 0.6823 | 0.5857 | 0.5000 | 0.1200 | 0.3250 | 0.1400 | 32.67 | 8 | under |

> B 用例 zone：规格表标注 over，但 score=86 < 90 按定义应为 high。测试以 `zoneOf(score)` 内部一致性为准。

## 使用流程

1. **欢迎页** → 开始问卷（约 5 分钟）
2. **问卷 6 屏**（全部必填）→ 生成画像
3. **画像结果页**：大白话卡片看懂自己的学习特点
4. **推荐计划**：3 套方案任选，时长可改，一键采用
5. **活动库**：12 个活动卡片，按你的画像评分，可排序筛选
6. **活动详情**：五维拆解条、处方建议、加入本周计划、完成反馈（校准）
7. **周负荷看板**：SVG 进度环、本周清单、容量说明
8. **周计划**（`#/week`）：设好「我的时间」后一键生成，具体到几点做什么，可换时间、勾完成、导出 .ics、打印
9. **设置页**：完善画像（重填覆盖同一份）、导入/导出 person.json、重置、权重滑块（自动归一化）、我的时间

## 已知局限

- 这不是心理测量工具，是启发式工程模型。分量定义来自经验直觉而非因素分析。
- 分数缺少外部真值，本质是"贴合该用户自我报告"的个性化提示，不是客观负荷量。
- 活动画像为人工标定，未经实证校准。D1-D7 的具体数值是合理猜测，不是测量结果。
- 模型只能提示，不能替你改变现实安排。它告诉你"这件事对你负荷偏高"，但做不做仍由你决定。

## 开发规范

- **提交前必测**：每次提交前，开发者必须自行测试所有功能，确认真实可用，不得仅依赖未验证的代码改动。
- **测试命令**：`node tests/run.js`（35 项断言），浏览器版双击 `tests.html`。
- **全流程验证**：问卷填写 → 画像生成 → 活动库浏览 → 推荐计划 → 周负荷看板 → 周计划（生成/换时间/勾完成/导出）→ 设置页，每个环节都要手动跑通。
- **命名空间一致**：引擎层 API 挂在 `window.LMS` 根命名空间，UI 层调用时需保持一致，避免页面空白。
