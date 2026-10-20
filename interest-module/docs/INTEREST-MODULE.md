# 兴趣池模块 · 接入说明（给合作者）

这份文档回答一个问题：**要把「兴趣池 + 计划生成」搬进另一个总程序，需要哪些文件、按什么顺序接、哪些地方会踩坑。**

模块的能力边界：用户写下一个兴趣 → 识别归类 → 存进兴趣池 → 生成一套可执行计划 → 改计划 → 采用并（可选）编进安排表。
它不负责登录、不负责渲染安排表、不负责负荷评分——这三件事都用总程序已有的能力。

---

## 一、必须上传的文件（缺一个就跑不起来）

| 文件 | 体积 | 用途 | 在接入中的作用 |
|---|---|---|---|
| `js/interest-classifier.js` | 30 KB | 14 类关键词 + 别名表 + bigram 模糊匹配 | **零依赖的底座**。把「学钢琴」认成「乐器类」。可单独在 Node 里用 |
| `js/interest-pool.js` | 22 KB | 兴趣池的读写、取出、时段推导、特殊时段规则 | 唯一的存储入口。`lms.interest.v1` 的读写都收敛在这里，界面层不碰原始数据 |
| `js/planner.js` | 39 KB | 计划生成（目标 / 六步 / 时间 / 资源 / 指标 / 风险） | 把一条兴趣变成一份可执行计划。复用宿主页的负荷评分，缺失时降级 |
| `js/plan-editor.js` | 55 KB | 计划的修改权：字段校验、版本记录、并发合并 | 已保存计划的唯一合法写入通道（`commit()`）。派生字段一律重算 |
| `js/interest-view.js` | 40 KB | 兴趣池界面（录入 / 列表 / 计划面板 / 采用） | 只要页面上有对应的容器 id，它就能自己渲染 |
| `js/plan-edit-view.js` | 51 KB | 计划编辑界面（改内容 / 换顺序 / 调时间 / 实时预览） | 与 plan-editor 配对，一个管数据一个管界面 |
| `css/interest-pool.css` | 11 KB | 模块的全部样式，`.ip-*` / `.ep-*` 前缀 | 自带命名空间，不污染宿主页既有样式 |
| `index.html`（改） | 50 KB | 总程序 | 宿主页里改动了五处：样式引用、导航按钮、页面容器、脚本加载、`LMSBridge` 接口 |
| `load-manager/data/activities.js`（改） | 6 KB | 活动库 | 追加了 `mergeRuntimeActivities()`：页面载入时把兴趣池登记的新活动并进活动库，负荷系统才认得它 |

> 前 7 个是模块本体。`index.html` 与 `activities.js` 是**对宿主程序的改动**，不是新文件——接入时按第五节的步骤逐处照做即可。

## 二、建议一并提供（不影响功能，影响体验与验收）

| 文件 | 用途 | 说明 |
|---|---|---|
| `load-manager/js/engine.js` | 负荷评分纯函数 | `planner` 用它算「这件事对你的负荷」。**不提供不会报错**，只是计划里不再出现负荷结论 |
| `load-manager/js/store.js` | 画像与周计划的读写 | 同上，`planner` 经 `LMS.store` 取画像 |
| `load-manager/data/activities.js` | 12 条标定过的活动 | 给了才能按「同领域近似活动」复用 8 轴参数 |

## 三、可选（演示与验收，不进生产链路）

| 文件 | 用途 |
|---|---|
| `interest-pool-preview.html` | 独立预览页：不开总程序也能看模块长什么样，用来对照「同一份数据两种外壳」 |
| `interest-entry.html` | 脚本生成的单文件成品页（278 KB，零外部引用，双击即用）。**不要手改**，改模块后重新生成 |
| `tools/build-prototype.js` | 生成上面那个单文件页 |
| `tools/verify.js` | 界面端到端自检（595 条） |
| `tools/verify-plan-editor.js` | 计划编辑模块自检（150 条） |
| `tools/verify-modules.js` | 模块级自检（130 条） |
| `tools/verify-deploy.js` | 发布后线上与本地逐文件比对 |
| `tools/publish.js` | 走 GitHub API 的发布脚本（`github.com:443` 连不通时的备份通道） |
| `load-manager/`（其余） | 负荷管理子应用本体，模块只是读取它的画像与评分 |

## 四、不要上传

- `node_modules/`（已在 `.gitignore`；`linkedom` 只是测试期 DOM 替身，不是运行时依赖）
- 任何令牌、`.env`、个人绝对路径（如 `C:\Users\<你>\Desktop\...`）
- 手改过的 `interest-entry.html`（会与模块脱钩）

## 五、目录结构

```
interest-time-manager/
├── index.html                    ← 总程序（改 4 处）
├── interest-pool-preview.html    ← 可选：独立预览
├── interest-entry.html           ← 可选：单文件成品页（生成物）
├── css/
│   └── interest-pool.css
├── js/
│   ├── interest-classifier.js
│   ├── interest-pool.js
│   ├── planner.js
│   ├── plan-editor.js
│   ├── interest-view.js
│   └── plan-edit-view.js
├── load-manager/
│   ├── data/activities.js        ← 追加 mergeRuntimeActivities()
│   ├── js/{engine,store,quiz,views,app}.js
│   └── ...
└── tools/                        ← 开发脚本，不参与站点运行
```

**路径全是相对的**（`js/...`、`css/...`），所以整个目录可以直接放在任意子路径下，不需要改配置。

## 六、接入步骤（最小改动）

1. **引样式**（放 `<head>` 里，在宿主自己的样式之后）：
   ```html
   <link rel="stylesheet" href="css/interest-pool.css">
   ```
2. **加入口**：在导航里加一个页签，值是 `interest`（`switchTab` 按 `data-tab` 找页面）：
   ```html
   <button data-tab="interest">兴趣池</button>
   ```
3. **加容器**：一个 `id="page-interest"` 的 `section.page`，里面放这 16 个**静态** id：
   `ipInput` / `ipClearInput` / `ipClassify` / `ipExample` / `ipSuggest` / `ipResults` /
   `ipSearch` / `ipFilter` / `ipList` / `ipCount` / `ipNotice` / `ipStorageHint` /
   `ipPlan` / `ipSavedPlans` / `ipSavedCount` / `ipEditor`。
   **照抄 `interest-pool-preview.html` 的 section 即可**，它就是精简版。
   「采用这个计划」「去修改」这类按钮不在 HTML 里，由模块渲染进 `ipPlan` / `ipSavedPlans`，不用手写。
4. **按序引脚本**：必须排在宿主内联脚本**之后**（见第七节第 1 条）：
   ```html
   <script src="load-manager/data/activities.js"></script>
   <script src="load-manager/js/engine.js"></script>
   <script src="load-manager/js/store.js"></script>
   <script src="js/interest-classifier.js"></script>
   <script src="js/interest-pool.js"></script>
   <script src="js/planner.js"></script>
   <script src="js/plan-editor.js"></script>
   <script src="js/interest-view.js"></script>
   <script src="js/plan-edit-view.js"></script>
   ```
5. **（可选）接安排表**：模块**不直接写**宿主的日程数据，只调用宿主实现的桥：
   ```js
   window.LMSBridge = {
     scheduleItems(),          // 返回当前用户已有的安排项
     applySchedule(items, rms),// 按 id 增改 + 删除，返回 {ok, added, updated, removed, focus}
     focusSchedule(date),      // 跳到安排表并定位到某天
     getProfile()              // 返回负荷画像（含 peakTime）
   };
   ```
   宿主没实现这三个方法时，「编入安排表」按钮整条不出现——**降级是安全的，不会报错**。

## 七、依赖关系与三个硬约束

**加载顺序（不可调换）**

```
interest-classifier  （零依赖）
      ↓
interest-pool        （需要 InterestClassifier）
      ↓
   planner           （需要 Classifier + Pool）
      ↓
plan-editor          （需要 Pool）
      ↓
interest-view        （需要 Pool + Planner + document）
plan-edit-view       （需要 PlanEditor + document）
```

`interest-pool.js`、`planner.js`、`plan-editor.js` 开头都有 `throw new Error('X 依赖 Y，请先加载')` 的守卫——顺序错了会立刻在控制台报出来，不会静默错乱。

**硬约束 1：必须排在宿主内联脚本之后。**
宿主 `index.html` 用 `const` 在内联脚本里声明了 `Store` / `$` / `uid`，它们处在全局词法环境而不是 `window` 属性上。新脚本先于它加载会直接 TDZ 报错。

**硬约束 2：只通过 `LMSBridge` 写宿主数据。**
模块自己不碰 `tm_items`。日程的增删改一律交给宿主的 `applySchedule`，这样宿主的渲染、日负荷徽标、15 分钟提醒全部继续生效，不会出现「模块自己画一套日程」的分裂。

**硬约束 3：界面不出现原始数据形态。**
字段名、花括号、`键: 值`、`<pre>` 一律不得出现在界面文本里。所有读写与转换收敛在存储层，界面只调 `InterestPool.readLocal / writeLocal` 拿处理好的对象。

**存储键（两个命名空间不混用）**

| 键 | 归属 | 内容 |
|---|---|---|
| `lms.interest.v1` | 本模块 | 兴趣池：`{version, updatedAt, items[]}` |
| `lms.interest.plans.v1` | 本模块 | 已采用计划 + 版本记录 |
| `lms.activities.v1` | 本模块 | 运行期新增活动（由 `activities.js` 并入活动库） |
| `lms.person.v1` | 宿主的负荷系统 | 画像（本模块**只读**，读 `peakTime` 定时段） |
| `tm_items` | 宿主总程序 | 日程事项（本模块**只经 LMSBridge 写**） |

## 八、自检

```bash
node tools/verify-modules.js        # 模块级 130 条
node tools/verify-plan-editor.js    # 编辑模块 150 条
npm i -D linkedom                   # verify.js 需要它（仅测试期）
node tools/build-prototype.js       # 先生成单文件页
node tools/verify.js                # 界面端到端 595 条
node load-manager/tests/run.js      # 项目既有 14 条
```

> `verify.js` 测的是**构建产物**（默认 `<仓库根>/interest-entry.html`），所以改完 `js/*.js` 要**先打包再跑**。

## 九、故障对照

| 现象 | 原因 |
|---|---|
| 控制台报 `X 依赖 Y，请先加载` | 脚本顺序错了，或漏了前置模块 |
| 报 `Cannot access 'Store' before initialization` | 新脚本排到了宿主内联脚本前面 |
| 页面一片空白、页签点不动 | `section` 少了 `class="page"` 或 id 不是 `page-interest` |
| 计划里没有负荷结论 | 宿主没提供 `LMS`/`LMS_DATA`，属正常降级 |
| 计划里没有「编入安排表」 | 宿主没实现 `LMSBridge.applySchedule`，属正常降级 |
| 运动类被排到夜晚 | 丢了 `interest-pool.js` 里的 `DOMAIN_BAND_RULES`，或改走别的时段推导 |
