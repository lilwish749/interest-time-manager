/* =========================================================================
   兴趣识别层 —— InterestClassifier
   -------------------------------------------------------------------------
   职责：把用户输入的兴趣/活动名称识别为 14 个预设类别之一；识别不出时
         给出候选类别，交用户确认。纯逻辑、零依赖，浏览器与 Node 均可使用。

   暴露：window.InterestClassifier = { VERSION, categories, byKey, axesOf,
          classify, suggest }
   说明：本层不涉及任何存储与界面。界面层只呈现「类别中文名」等处理后的
         结果，不呈现类别键或任何原始数据结构。
   ========================================================================= */
(function (root) {
  'use strict';

  var VERSION = '1.0';

  /* 分类体系：key 唯一键 / label 中文类别名 / keywords 命中关键词
     axes 为该领域的 8 轴默认模板（供负荷引擎评分使用） */
  var CATEGORIES = [
    { key: 'music', label: '乐器类',
      keywords: ['钢琴', '吉他', '小提琴', '古筝', '架子鼓', '尤克里里', '口琴', '萨克斯', '二胡', '乐器', '声乐', '唱歌', '练琴', '视唱', '听音', '乐理', '编曲', '混音', '葫芦丝', '手风琴', '贝斯', '电吉他', '鼓', '合唱'],
      axes: { D1: 0.50, D2: 0.35, focusNeedMin: 30, D4: 0.60, D5: 0.55, D6: 0.05, D7: 0.50, channel: { read: 0.05, audiovisual: 0.20, hands: 0.75, social: 0.00 }, bestTime: ['evening'] } },
    { key: 'coding', label: '编程开发类',
      keywords: ['编程', '代码', 'python', 'javascript', 'js', 'java', '前端', '后端', '算法', 'c++', 'go', 'rust', 'html', 'css', '写代码', '开发', '项目', '网站', '小程序', '爬虫', '机器学习', '深度学习', '神经网络', '开源', 'git', '数据库', 'sql', '脚本', '自动化', 'api', '服务端', '客户端', '游戏开发'],
      axes: { D1: 0.70, D2: 0.60, focusNeedMin: 45, D4: 0.55, D5: 0.60, D6: 0.10, D7: 0.60, channel: { read: 0.15, audiovisual: 0.30, hands: 0.55, social: 0.00 }, bestTime: ['morning', 'forenoon', 'afternoon'] } },
    { key: 'reading', label: '阅读类',
      keywords: ['读书', '阅读', '看书', '小说', '纸质书', '电子书', '名著', '散文', '杂文', '杂志', '报刊', '诗', '漫画书', '绘本', '文献', '论文阅读', '啃书'],
      axes: { D1: 0.55, D2: 0.40, focusNeedMin: 40, D4: 0.30, D5: 0.15, D6: 0.05, D7: 0.25, channel: { read: 0.85, audiovisual: 0.05, hands: 0.05, social: 0.05 }, bestTime: ['morning', 'night'] } },
    { key: 'language', label: '语言学习类',
      keywords: ['日语', '英语', '韩语', '法语', '德语', '西班牙语', '俄语', '意大利语', '泰语', '阿拉伯语', '学语言', '口语', '单词', '外语', '翻译', '雅思', '托福', 'n1', 'n2', '四六级', '语法', '听力', '发音'],
      axes: { D1: 0.35, D2: 0.30, focusNeedMin: 20, D4: 0.80, D5: 0.35, D6: 0.10, D7: 0.90, channel: { read: 0.25, audiovisual: 0.35, hands: 0.30, social: 0.10 }, bestTime: ['morning', 'forenoon', 'afternoon', 'evening', 'night'] } },
    { key: 'design', label: '设计绘画类',
      keywords: ['设计', '插画', '绘画', '素描', '水彩', '临摹', 'ps', 'photoshop', 'illustrator', 'ui', 'ux', 'logo', '排版', '建模', 'blender', '3d', '海报', '原画', '动漫', '漫画', '板绘', 'procreate', '字体', '视觉', 'cad', '手绘'],
      axes: { D1: 0.65, D2: 0.50, focusNeedMin: 50, D4: 0.65, D5: 0.60, D6: 0.05, D7: 0.55, channel: { read: 0.10, audiovisual: 0.40, hands: 0.50, social: 0.00 }, bestTime: ['afternoon', 'night'] } },
    { key: 'writing', label: '写作类',
      keywords: ['写作', '博客', '文章', '小说创作', '日记', '笔记', '文案', '公众号', '知乎', '头条', '写书', '论文', '报告', '总结', '复盘', '随笔', '诗歌', '剧本', '脚本', '通讯稿', '投稿'],
      axes: { D1: 0.70, D2: 0.50, focusNeedMin: 50, D4: 0.35, D5: 0.80, D6: 0.15, D7: 0.30, channel: { read: 0.30, audiovisual: 0.10, hands: 0.35, social: 0.25 }, bestTime: ['night'] } },
    { key: 'history', label: '历史人文类',
      keywords: ['历史', '人文', '考古', '哲学', '政治', '经济', '社会学', '心理学', '传记', '史料', '典籍', '思想史', '文化', '宗教', '人类学', '法律', '研究'],
      axes: { D1: 0.60, D2: 0.45, focusNeedMin: 45, D4: 0.30, D5: 0.30, D6: 0.10, D7: 0.20, channel: { read: 0.75, audiovisual: 0.15, hands: 0.10, social: 0.00 }, bestTime: ['morning'] } },
    { key: 'photography', label: '摄影类',
      keywords: ['摄影', '拍照', '相机', '单反', '调色', '后期', '修图', '胶片', '人像', '风光', '构图', '光线', 'lr', 'lightroom', '棚拍', '街拍', '旅拍', 'vlog', '视频拍摄'],
      axes: { D1: 0.55, D2: 0.45, focusNeedMin: 40, D4: 0.55, D5: 0.50, D6: 0.10, D7: 0.75, channel: { read: 0.15, audiovisual: 0.45, hands: 0.40, social: 0.00 }, bestTime: ['afternoon', 'night'] } },
    { key: 'sport', label: '运动健身类',
      keywords: ['跑步', '健身', '瑜伽', '游泳', '篮球', '足球', '羽毛球', '骑行', '登山', '跳绳', '马拉松', '举铁', '太极', '舞蹈', '滑板', '徒步', '普拉提', '搏击', '网球', '乒乓球', '飞盘'],
      axes: { D1: 0.30, D2: 0.20, focusNeedMin: 40, D4: 0.25, D5: 0.30, D6: 0.20, D7: 0.85, channel: { read: 0.05, audiovisual: 0.10, hands: 0.60, social: 0.25 }, bestTime: ['morning', 'afternoon', 'evening'] } },
    { key: 'cooking', label: '烹饪美食类',
      keywords: ['做饭', '烹饪', '烘焙', '蛋糕', '面包', '咖啡', '茶艺', '料理', '美食', '菜谱', '炒菜', '甜点', '饮品', '调酒', '下厨', '腌渍', '发酵', '摆盘'],
      axes: { D1: 0.35, D2: 0.30, focusNeedMin: 30, D4: 0.45, D5: 0.40, D6: 0.10, D7: 0.80, channel: { read: 0.10, audiovisual: 0.25, hands: 0.65, social: 0.00 }, bestTime: ['afternoon', 'evening'] } },
    { key: 'craft', label: '手工手作类',
      keywords: ['手工', '折纸', '编织', '乐高', '模型', '木工', '陶艺', '刺绣', '针织', '拼图', '滴胶', '串珠', '羊毛毡', '雕刻', '皮具', '手帐', '粘土', '积木'],
      axes: { D1: 0.45, D2: 0.35, focusNeedMin: 45, D4: 0.55, D5: 0.45, D6: 0.05, D7: 0.70, channel: { read: 0.10, audiovisual: 0.15, hands: 0.75, social: 0.00 }, bestTime: ['afternoon', 'night'] } },
    { key: 'gaming', label: '游戏娱乐类',
      keywords: ['游戏', '主机', 'steam', 'switch', 'ps5', '手游', '桌游', '棋牌', '剧本杀', '解谜', 'rpg', '通关', '电竞', '联机', 'mc', '模拟经营'],
      axes: { D1: 0.40, D2: 0.35, focusNeedMin: 60, D4: 0.40, D5: 0.30, D6: 0.45, D7: 0.90, channel: { read: 0.10, audiovisual: 0.45, hands: 0.35, social: 0.10 }, bestTime: ['evening', 'night'] } },
    { key: 'science', label: '科学探索类',
      keywords: ['物理', '化学', '生物', '天文', '数学', '量子', '科普', '科学', '天文观测', '实验', '数论', '电路', '自然', '地理', '气象', '机器人'],
      axes: { D1: 0.75, D2: 0.65, focusNeedMin: 50, D4: 0.60, D5: 0.55, D6: 0.05, D7: 0.55, channel: { read: 0.25, audiovisual: 0.40, hands: 0.35, social: 0.00 }, bestTime: ['morning', 'forenoon'] } },
    { key: 'life', label: '生活技能类',
      keywords: ['理财', '投资', '记账', '收纳', '整理', '园艺', '养花', '钓鱼', '宠物', '时间管理', '护肤', '穿搭', '副业', '沟通', '表达', '思维导图', '效率', '手帐规划'],
      axes: { D1: 0.45, D2: 0.35, focusNeedMin: 30, D4: 0.50, D5: 0.35, D6: 0.20, D7: 0.65, channel: { read: 0.30, audiovisual: 0.30, hands: 0.25, social: 0.15 }, bestTime: ['morning', 'afternoon'] } }
  ];

  /* 别名 / 同义词：补充关键词难以覆盖的写法（英文、流派、口语说法、长尾表达等），
     用于弥补精确关键词匹配的盲区（见 classify 的「别名命中」阶段） */
  var ALIASES = {
    music: ['弹琴', '玩乐器', '学乐器', '练鼓', '打架子鼓', '电钢琴', '电子琴', '双排键', '口风琴', '长笛', '黑管', '单簧管', '竖琴', '扬琴', '琵琶', '唢呐', '笙', '阮', '中提琴', '大提琴', '电提琴', '电贝斯', '木吉他', '古典吉他', '民谣吉他', '拇指琴', '卡林巴', '空灵鼓', '半音阶口琴', '蓝调口琴', '做beat', '写歌', '写曲', '作曲', '扒谱', '视奏', '即兴', '和声', '复调', '配器', '母带', '录音', '修音', '鼓机', '采样', '合成器', '软音源', 'midi', '编曲软件', '钢琴伴奏', '弹唱', '自弹自唱', '吉他弹唱', '钢琴弹唱', '阿卡贝拉', '清唱', '美声', '戏腔', 'rap', '说唱', 'beatbox', '电子音乐', 'edm', '摇滚', '流行', '爵士', '蓝调', 'blues', '民谣', 'folk', '古典', '轻音乐', 'new age', '古风', '国风', 'vocaloid', '翻唱', 'cover'],
    coding: ['敲代码', '写代码', '码代码', '码农', '程序员', '搞开发', '做网站', '做app', '做应用', '写app', '小程序开发', '前端开发', '后端开发', '全栈', '刷算法', '算法题', 'leetcode', '力扣', '写脚本', '自动化脚本', '网络爬虫', '数据分析', '数据科学', '自然语言处理', 'nlp', '计算机视觉', '人工智能', '大模型', 'llm', '微调', 'prompt', '开源项目', 'github', 'docker', '云计算', '服务器', '前端框架', 'react', 'vue', 'angular', 'node', 'nodejs', 'py', 'c语言', 'go语言', 'mysql', '接口开发', 'unity', 'unreal', 'godot', 'shader', '做游戏', '独立游戏', '黑客', 'ctf', '网络安全', '逆向', '嵌入式', '单片机', 'arduino', '树莓派', 'iot', '物联网', '浏览器插件', '微信小程序', '桌面应用', 'electron', 'flutter', '技术博客', '写技术文章'],
    reading: ['看书', '啃书', 'kindle', '微信读书', '听书', '有声书', '网文', '网络小说', '玄幻', '言情', '悬疑', '推理', '科幻', '奇幻', '武侠', '自传', '诗词', '古诗', '现代诗', '漫画', '期刊', '文献', '研报', '技术文档', 'wiki', '维基', '专栏', '博客', 'blog', '掘金', '速读', '精读', '泛读', '拆书', '读书笔记', '做读书笔记', '摘抄', '工具书'],
    language: ['学外语', '二外', '第二外语', 'english', 'ielts', 'toefl', '专四', '专八', 'gre', 'gmat', 'japanese', 'n3', '韩国语', 'korean', 'français', 'deutsch', 'german', '西语', 'russian', '越南语', '葡萄牙语', '学方言', '粤语', '闽南语', '上海话', '四川话', '方言', '练口语', '音标', '自然拼读', 'phonics', '背单词', '词汇', 'anki', '间隔重复', '影子跟读', '跟读', '配音', '影视配音', '字幕组', '笔译', '口译', '本地化', 'localization', '语言交换', '语伴', 'tandem', 'hellotalk', '多邻国', 'duolingo', '沉浸式', '拉丁语'],
    design: ['画画', '学画', 'illustration', '游戏原画', '角色设计', '场景设计', '概念设计', 'ui设计', 'ux设计', '交互设计', '产品设计', '视觉设计', '平面设计', '品牌设计', 'logo设计', 'vi设计', '字体设计', '版式', '海报设计', '封面设计', '包装设计', '3d建模', 'maya', 'c4d', 'zbrush', '像素画', 'pixel art', 'figma', 'sketch', 'autocad', '室内设计', '家装设计', '服装设计', '纹身', '刺青', '纹样', '剪纸', '纸艺', 'ip设计', '表情包', '动效', 'motion', '渲染', '材质', '贴图', '配色', '速写', '人体结构', '透视', '构成', '艺术', '当代艺术', '装置艺术', '版画', '摄影后期', '人像精修', '影调'],
    writing: ['写东西', '码字', '写文', '创作', '写小说', '网文写作', '码字软件', '写作软件', '写诗', '古体诗', '编剧', '广告文案', '软文', '头条号', '知乎回答', '技术博客', '手帐', 'vlog脚本', '视频脚本', '短视频脚本', '毕业论文', '开题', '综述', '周报', '月报', '读书笔记', '书评', '影评', '乐评', '剧评', '推文', '小红书', '知识卡片', '卡片笔记', 'flomo', 'obsidian', 'notion', '幕布', '脑图', '大纲', '写作课', '写作训练', '练笔', '日更', '约稿', '写作社区', '简书', '豆瓣日记', '公众号排版', '秀米'],
    history: ['读史', '史学', '古代史', '近代史', '世界史', '中国史', '通史', '文物', '博物馆', '逛博物馆', '拓片', '西方哲学', '东方哲学', '政治学', '经济学', '人类学', '民俗', '民俗学', '佛学', '道教', '心理', '精神分析', '认知心理学', '回忆录', '思想', '文化研究', '经典', '诸子', '红楼', '三国', '西游', '水浒', '史记', '资治通鉴', '人文地理', '法学', '社会', '社会调查', '口述史', '家谱', '族谱', '方志', '地方志', '非遗', '传统文化', '神话', '神话学', '语言学', '训诂', '文字学', '金石', '甲骨文', '简牍', '敦煌', '敦煌学', '建筑史', '艺术史', '音乐史', '书法史', '园林', '园林史', '饮食文化', '茶文化', '酒文化', '服饰史', '汉服', '传统服饰', '文博', '策展', '展览'],
    photography: ['照相', '微单', '胶片机', '拍立得', '拍照片', '人像摄影', '风光摄影', '街拍', '人文摄影', '纪实', '纪实摄影', '婚礼摄影', '产品摄影', '美食摄影', '宠物摄影', '儿童摄影', '旅拍', '旅行摄影', '视频', '短视频', '拍视频', '视频拍摄', '运镜', '光影', '用光', '布光', '打光', '捕捉', '抓拍', '扫街', '胶卷', '暗房', '航拍', '无人机', '延时', '延时摄影', '星空', '星野', '银河', '夜景', '微距', '生态', '打鸟', '活动摄影', '会议摄影', '毕业照', '证件照', '汉服摄影', '古风摄影', '写真', '婚纱', '相机评测', '镜头', '定焦', '变焦', '广角', '长焦', '三脚架', '稳定器', '云台', '滤镜', '闪光灯', 'raw', '全画幅', '哈苏', '徕卡', '索尼', '佳能', '尼康', '富士'],
    sport: ['运动', '锻炼', '去健身房', '撸铁', '力量训练', '自重训练', '徒手', 'crossfit', '功能性训练', '体能', '体能训练', '有氧', 'hiit', '夜跑', '半马', '全马', '越野跑', '骑车', '公路车', '山地车', '自由泳', '蛙泳', '蝶泳', '仰泳', '拉伸', '柔韧性', '体态', '体态矫正', '康复', '康复训练', '排球', '壁球', '高尔夫', '棒球', '橄榄球', '冰球', '滑雪', '单板', '双板', '滑冰', '轮滑', '跑酷', '攀岩', '抱石', '爬山', '露营', '户外', '桨板', '皮划艇', '冲浪', '潜水', '自由潜水', '浮潜', '帆船', '骑马', '马术', '击剑', '射箭', '拳击', '泰拳', '搏击', 'mma', '综合格斗', '摔跤', '柔道', '跆拳道', '空手道', '八段锦', '五禽戏', '气功', '健步走', '竞走', '毽球', '毽子', '广场舞', '街舞', '爵士舞', '拉丁舞', '芭蕾', '民族舞', '尊巴', 'zumba', '健身操', '广播体操', '塑形', '减脂', '增肌', '身材管理', '体测', '体脂', '健康', '养生', '睡眠', '饮食', '健身餐', '增肌餐', '减脂餐', '蛋白粉', '护具', '跑鞋', '运动鞋', '运动手环', '运动手表', '佳明', 'garmin', 'keep'],
    cooking: ['做菜', '做晚饭', '做午饭', '在家做饭', '学做菜', '家常菜', '红烧', '清蒸', '爆炒', '凉拌', '腌制', '腌菜', '泡菜', '卤味', '煲汤', '炖', '焖', '煎', '炸', '烤', '饼干', '甜品', '点心', '糕点', '月饼', '粽子', '汤圆', '饺子', '包子', '馒头', '面条', '拉面', '意面', '披萨', '汉堡', '寿司', '刺身', '韩餐', '日料', '西餐', '法餐', '泰餐', '咖喱', '火锅', '串串', '烧烤', '撸串', '麻辣烫', '螺蛳粉', '奶茶', '饮品', '手冲', 'espresso', '拿铁', '卡布奇诺', '美式', '冷萃', '泡茶', '功夫茶', '葡萄酒', '红酒', '精酿', '啤酒', '鸡尾酒', '果酒', '米酒', '酿酒', '自酿', '酸奶', '种菜', '阳台种菜', '养花', '香草', '食谱', '下厨房', '探店', '吃货', '美食摄影', '摆盘', '刀工', '备菜', 'meal prep', '便当', '轻食', '沙拉', '果昔', '果汁', '榨汁', '破壁机', '空气炸锅', '电饭煲', '烤箱', '面包机', '厨师机'],
    craft: ['做手工', '手作', 'diy', '手工艺', '编织', '棒针', '钩针', '毛线', '毛衣', '围巾', '玩偶', '棉花娃娃', '黏土', '软陶', '超轻黏土', '滴胶', '树脂', '环氧树脂', '硅胶', '翻模', '模具', '串珠', '珍珠', '水晶', '绕线', '金工', '银饰', '银饰制作', '掐丝', '珐琅', '十字绣', '苏绣', '戳戳绣', '拼布', '布艺', '拼豆', '高达', '兵人', '手办', '涂装', '旧化', '木雕', '石雕', '玉雕', '核雕', '皮革', '皮雕', '裁皮', '纸艺', '纸模', '衍纸', '立体书', '竹编', '草编', '藤编', '绳编', '中国结', 'macrame', '不织布', '热缩片', '火漆', '押花', '微景观', '沙画', '流体画', 'tufting', '簇绒', '刮画', '橡皮章', '刻章', '篆刻', '活字', '活字印刷', '拓印', '标本', '昆虫标本', '矿物', '石头画', '贝壳画', '纽扣画', '旧物改造', '变废为宝', 'upcycle', '手工皂', '冷制皂', '香薰', '蜡烛', '大豆蜡', '扩香', '香牌', '合香', '制香', '线香', '手串', '手链', '项链', '耳环', '戒指', '发簪', '绒花', '缠花', '通草花', '纸花', '永生花', '微缩', '娃娃屋', 'dollhouse'],
    gaming: ['打游戏', '玩游戏', 'ps4', 'xbox', '密室', '我的世界', '二次元', '乙女', 'galgame', '视觉小说', '音游', '节奏游戏', '格斗游戏', '射击', 'fps', '自走棋', '卡牌', '万智牌', '游戏王', '三国杀', '狼人杀', '斗地主', '麻将', '象棋', '围棋', '五子棋', '拼图'],
    science: ['量子力学', '相对论', '黑洞', '星系', '星座', '陨石', '化石', '恐龙', '昆虫', '植物', '观鸟', '天文望远镜', '望远镜', '显微镜', '化学实验', '物理实验', '生物实验', '酶', '基因', 'dna', '电子', '电路图', '焊接', '电子制作', '科学实验', '小实验', '家庭实验', 'stem', 'steam', '动手做', '创客', 'maker', '航模', '海模', '车模', '模型制作', '火箭', '水火箭', '纸飞机', '晶体', '结晶', '苔藓', '矿石收藏', '化石收藏', '集邮', '钱币', '钱币收藏', '邮票', '科学纪录片', '科普视频', '原理', '揭秘', '十万个为什么', '占星'],
    life: ['理财', '投资', '记账', '基金', '股票', '定投', '储蓄', '保险', '攒钱', '存钱', '资产', '负债', '财报', '副业', '搞钱', '赚钱', '收纳', '整理', '断舍离', '极简', '极简主义', '家务', '打扫', '清洁', '园艺', '种菜', '养宠物', '宠物', '猫', '狗', '仓鼠', '多肉', '阳台', '阳台花园', '时间管理', '效率', 'gtd', '番茄钟', '番茄工作法', 'todo', '待办', '习惯', '习惯养成', '早起', '冥想', '正念', '护肤', '化妆', '穿搭', '衣品', '衣橱', '整理衣橱', '沟通', '表达', '演讲', 'ppt', '公众表达', '效率工具', '规划', '人生规划', '职业规划', '聊天', '社交', '人际关系', '情商', '情绪', '心理疏导', '心理咨询', '自我提升', '成长', '学习', '学习方法', '费曼', '记忆', '知识管理', '个人管理']
  };

  /* 长尾 / 小众表达补强（第二层别名，便于持续扩展，不改动上方主表） */
  ALIASES.music = ALIASES.music.concat(['尺八', '洞箫', '南箫', '箫', '筚篥', '巴乌', '埙', '陶埙', '芦笙', '吉它', '结他', '六弦琴', 'synth', 'synthwave', 'daw', 'ableton', 'flstudio', 'logic', 'protools', 'cubase', 'reaper', 'trap', 'hiphop', 'lofi', 'lo-fi', 'producer', '蒸汽波', 'vaporwave']);
  ALIASES.design = ALIASES.design.concat(['毛笔字', '软笔', '硬笔', '练字', '字帖', '临帖', '钢笔字', '书法', 'calligraphy', '瘦金体', '行书', '楷书', '隶书']);
  ALIASES.cooking = ALIASES.cooking.concat(['提拉米苏', '慕斯', '布丁', '芝士', '芝士蛋糕', '千层', '可丽露', '马卡龙', '泡芙', '舒芙蕾', '班戟', '千层蛋糕', '铜锣烧', '和果子', '大福', '麻薯', '雪媚娘', '蛋挞', '可颂', '牛角包', '贝果', '司康', '玛芬', '费南雪', '歌剧院蛋糕', '黑森林', '巴斯克', '奶盖', '生椰', '杨枝甘露', '双皮奶', '龟苓膏', '绿豆糕', '桂花糕', '冰粉', '凉糕', '糖画', '糖人']);
  ALIASES.life = ALIASES.life.concat(['蜜袋鼯', '刺猬', '兔子', '龟', '蜥蜴', '蛇', '鸟', '鹦鹉', '龙猫', '荷兰猪', '豚鼠', '观赏鱼', '绿植', '蝈蝈', '蚕', '蚂蚁工坊', '守宫', '豹纹守宫', '爬宠', '水族', '多肉拼盘', '雨林缸', '生态缸', '观赏虾', '蟹']);

  /* —— 模糊匹配工具：字符级二元组(bigram) Dice 相似度，作为长尾输入的兜底 —— */
  function norm(s) { return String(s || '').trim().toLowerCase(); }
  function strip(s) { return norm(s).replace(/[\s!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]+/g, ''); }
  function bigrams(s) { s = strip(s); if (s.length <= 1) return [s]; var o = []; for (var i = 0; i < s.length - 1; i++) o.push(s.substr(i, 2)); return o; }
  function dice(a, b) { if (!a.length || !b.length) return 0; var sb = {}; b.forEach(function (x) { sb[x] = 1; }); var n = 0; a.forEach(function (x) { if (sb[x]) n++; }); return (2 * n) / (a.length + b.length); }
  function bestScore(ibg, cat) {
    var terms = cat.keywords.concat(ALIASES[cat.key] || []).map(norm);
    var best = 0;
    for (var i = 0; i < terms.length; i++) { var s = dice(ibg, bigrams(terms[i])); if (s > best) best = s; }
    return best;
  }

  /* —— 口语化虚词 ——
     普通用户不会只写「钢琴」，而是写「今晚想练会儿琴」。
     这些字词只表达语气、意愿、时间，不携带「做什么」的信息，
     直接拿整句去比对关键词往往落空。
     注意：仅在首轮比对失败后用于「回退重试」，绝不修改用户的原始输入。
     长词排在前面，避免「一会儿」被拆成「会」后留下残字。 */
  var FILLERS = [
    '一会儿', '一阵子', '一下子', '打算', '准备', '开始', '尝试', '想要', '最近', '平时',
    '每天', '今晚', '今早', '今天', '明天', '早上', '上午', '中午', '下午', '晚上', '夜里',
    '周末', '平时', '会儿', '一点', '一下', '一直', '有点', '稍微',
    '想', '要', '的', '了', '着', '过', '吧', '呢', '啊', '呀', '嘛', '哦', '恩',
    '我', '来', '去', '把', '给'
  ];
  function loosen(s) {
    var out = String(s || '');
    for (var i = 0; i < FILLERS.length; i++) {
      if (out.indexOf(FILLERS[i]) >= 0) { out = out.split(FILLERS[i]).join(''); }
    }
    return out;
  }

  /* 核心比对：先关键词，再别名。命中返回 {cat, hits, kind}，否则 null */
  function matchCore(t) {
    var byKw = CATEGORIES.map(function (c) {
      return { cat: c, hits: c.keywords.filter(function (kw) { return t.indexOf(norm(kw)) >= 0; }) };
    }).sort(function (a, b) { return b.hits.length - a.hits.length; });
    if (byKw[0].hits.length) { return { cat: byKw[0].cat, hits: byKw[0].hits, kind: 'keyword', rival: (byKw[1] || { hits: [] }).hits.length }; }

    var byAlias = CATEGORIES.map(function (c) {
      var al = (ALIASES[c.key] || []).map(norm);
      return { cat: c, hits: al.filter(function (a) { return t.indexOf(a) >= 0 || a.indexOf(t) >= 0; }) };
    }).sort(function (a, b) { return b.hits.length - a.hits.length; });
    if (byAlias[0].hits.length) { return { cat: byAlias[0].cat, hits: byAlias[0].hits, kind: 'alias', rival: (byAlias[1] || { hits: [] }).hits.length }; }

    return null;
  }

  function byKey(key) {
    for (var i = 0; i < CATEGORIES.length; i++) { if (CATEGORIES[i].key === key) return CATEGORIES[i]; }
    return null;
  }
  function axesOf(key) {
    var c = byKey(key);
    if (!c) return null;
    return {
      D1: c.axes.D1, D2: c.axes.D2, focusNeedMin: c.axes.focusNeedMin,
      D4: c.axes.D4, D5: c.axes.D5, D6: c.axes.D6, D7: c.axes.D7,
      channel: { read: c.axes.channel.read, audiovisual: c.axes.channel.audiovisual, hands: c.axes.channel.hands, social: c.axes.channel.social },
      bestTime: c.axes.bestTime.slice()
    };
  }
  function labelOf(key) { var c = byKey(key); return c ? c.label : ''; }

  /* classify(text, forcedKey)
     forcedKey：用户在候选中手动指定的类别（可选）
     返回：{ input, recognized, category, categoryLabel, type, matchedKeywords,
             matchDegree, matchType, suggestions }
     说明：category 为内部键，仅用于程序内部流转，界面层只呈现 categoryLabel。 */
  function classify(text, forcedKey) {
    var name = String(text || '').trim();

    if (forcedKey) {
      var f = byKey(forcedKey);
      if (f) {
        return { input: name, recognized: true, category: f.key, categoryLabel: f.label, type: 'custom',
          matchedKeywords: [], matchDegree: 1, matchType: 'manual', suggestions: [] };
      }
    }
    if (!name) {
      return { input: '', recognized: false, category: null, categoryLabel: null, type: 'custom',
        matchedKeywords: [], matchDegree: 0, matchType: 'empty', suggestions: [] };
    }

    var t = norm(name);

    /* ① 关键词命中（最可靠） / ② 别名、同义词命中（覆盖长尾表达） */
    var hit = matchCore(t);
    if (hit) {
      var base = hit.kind === 'keyword' ? 0.55 : 0.42;
      var step = hit.kind === 'keyword' ? 0.12 : 0.08;
      var cap = hit.kind === 'keyword' ? 0.97 : 0.88;
      var floor = hit.kind === 'keyword' ? 0.50 : 0.40;
      var deg = base + step * hit.hits.length - (hit.rival > 0 ? Math.min(0.20, 0.04 + 0.16 * (hit.rival / hit.hits.length)) : 0);
      return { input: name, recognized: true, category: hit.cat.key, categoryLabel: hit.cat.label,
        type: 'category', matchedKeywords: hit.hits,
        matchDegree: Math.max(floor, Math.min(cap, Math.round(deg * 100) / 100)),
        matchType: hit.kind, suggestions: [] };
    }

    /* ③ 口语化回退：把「今晚想练会儿琴」还原成「练琴」再试一次 */
    var lt = loosen(strip(name));
    if (lt && lt !== strip(name)) {
      var hit2 = matchCore(lt);
      if (hit2) {
        return { input: name, recognized: true, category: hit2.cat.key, categoryLabel: hit2.cat.label,
          type: 'category', matchedKeywords: hit2.hits,
          matchDegree: hit2.kind === 'keyword' ? 0.62 : 0.45,
          matchType: hit2.kind + '-plain', suggestions: [] };
      }
    }

    /* ④ 模糊相似度：不自动归类，给出最接近的候选交用户确认 */
    var ibg = bigrams(t);
    var suggestions = CATEGORIES.map(function (c) {
      return { key: c.key, label: c.label, score: bestScore(ibg, c) };
    }).sort(function (a, b) { return b.score - a.score; })
      .filter(function (s) { return s.score > 0; })
      .slice(0, 3)
      .map(function (s) { return { key: s.key, label: s.label }; });

    return { input: name, recognized: false, category: null, categoryLabel: null, type: 'custom',
      matchedKeywords: [], matchDegree: 0, matchType: 'fuzzy', suggestions: suggestions };
  }

  /* 实时联想：据输入的不完整关键词返回候选补全项
     排序：前缀匹配 > 子串匹配 > 模糊字符相似度 */
  var _index = null;
  function buildIndex() {
    if (_index) return _index;
    var idx = [], seen = {};
    CATEGORIES.forEach(function (cat) {
      cat.keywords.concat(ALIASES[cat.key] || []).forEach(function (term) {
        var t = String(term);
        if (seen[t]) return;
        seen[t] = 1;
        idx.push({ term: t, label: cat.label });
      });
    });
    _index = idx;
    return idx;
  }
  function suggest(query, limit) {
    limit = limit || 8;
    var q = norm(query);
    if (!q) return [];
    /* 除了原样比对，也拿「去掉口语虚词」的版本比对一次，
       这样输入「今晚想练会儿琴」也能联想出「练琴 / 钢琴」 */
    var attempts = [q];
    var lq = loosen(strip(q));
    if (lq && lq !== strip(q)) { attempts.push(lq); }

    var prefix = [], sub = [], fuzzy = [];
    buildIndex().forEach(function (it) {
      var t = norm(it.term);
      var rank = 0, sc = 0;
      attempts.forEach(function (a) {
        if (!a) { return; }
        if (t.indexOf(a) === 0) { if (rank < 2) { rank = 2; sc = 1; } }
        else if (t.indexOf(a) >= 0) { if (rank < 1) { rank = 1; sc = 0.8; } }
        else if (a.length >= 2) {
          var s = dice(bigrams(a), bigrams(t));
          if (s >= 0.34 && rank === 0 && s > sc) { sc = s; }
        }
      });
      if (rank === 2) { prefix.push({ it: it, score: sc }); }
      else if (rank === 1) { sub.push({ it: it, score: sc }); }
      else if (sc > 0) { fuzzy.push({ it: it, score: sc }); }
    });
    prefix.sort(function (a, b) { return a.it.term.length - b.it.term.length; });
    sub.sort(function (a, b) { return a.it.term.length - b.it.term.length; });
    fuzzy.sort(function (a, b) { return b.score - a.score; });
    return prefix.concat(sub, fuzzy).slice(0, limit).map(function (m) {
      return { term: m.it.term, label: m.it.label };
    });
  }

  var API = {
    VERSION: VERSION,
    categories: function () { return CATEGORIES.map(function (c) { return { key: c.key, label: c.label }; }); },
    byKey: byKey,
    labelOf: labelOf,
    axesOf: axesOf,
    classify: classify,
    suggest: suggest
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.InterestClassifier = API;
})(typeof window !== 'undefined' ? window : globalThis);
