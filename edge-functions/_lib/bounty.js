const TABS = [{ key: "tencent", label: "鹅厂生态", emoji: "🐧" }];

const HALL_OF_FAME = [
  { real: "马化腾", alias: "Pony", emoji: "🐎", title: "创始人 · 董事会主席兼 CEO" },
  { real: "张志东", alias: "Tony", emoji: "💻", title: "创始人 · 首任 CTO" },
  { real: "许晨晔", alias: "Daniel", emoji: "📡", title: "创始人 · 首席信息官 (CIO)" },
  { real: "陈一丹", alias: "Charles", emoji: "📜", title: "创始人 · 首席行政官 (CAO)" },
  { real: "曾李青", alias: "Jason", emoji: "🚀", title: "创始人 · 首席运营官 (COO)" },
];

const GROUPS = [
  {
    category: "tencent",
    label: "鹅厂文化",
    emoji: "🐧",
    tab: "tencent",
    whitelist: [
      "企鹅", "鹅厂", "工牌", "电梯", "打卡", "掌纹", "iWiki", "RTX", "乐享",
      "鹅卡", "食堂", "鹅餐", "班车", "健身房", "按摩椅", "小马哥", "南极圈",
      "活水", "瑞雪", "赛马", "中台", "TAPD", "腾讯会议", "腾讯文档", "微信",
      "QQ", "朋友圈", "视频号", "组织架构调整", "烤企鹅", "打工鹅", "续命鹅",
      "鹅咖", "鹅式小憩", "爆料", "水帖", "道别贴", "深夜食堂", "工位食堂",
      "免费午餐", "带薪养生", "带薪健身", "午间撸铁", "早会", "晨会", "周会",
      "周会纪要", "虚拟背景", "静音挂机", "黑屏挂机", "背景音", "多人编辑打架",
      "文档不同步", "@所有人", "全员信", "排队堵梯", "尴尬同框", "最后一班",
      "晚班", "通勤睡眠", "程序员床位", "灯火通明", "IEG", "WXG", "CSIG",
      "PCG", "TEG", "CDG",
    ],
  },
  {
    category: "product",
    label: "腾讯产品线",
    emoji: "📦",
    tab: "tencent",
    whitelist: [
      "QQ", "QQ邮箱", "QQ音乐", "QQ浏览器", "QQ空间", "TIM", "微信", "企业微信",
      "微云", "公众号", "小程序", "微信支付", "微视", "红包", "腾讯视频", "腾讯新闻",
      "腾讯体育", "腾讯动漫", "阅文集团", "TME", "全民K歌", "腾讯音乐娱乐", "腾讯云",
      "腾讯会议", "腾讯文档", "应用宝", "电脑管家", "CODING", "腾讯地图", "腾讯翻译君",
      "混元大模型", "元宝", "CodeBuddy", "WorkBuddy", "AnyDev", "Wedata",
      "ima.copilot", "腾讯企点", "CDC", "王者荣耀", "和平精英", "英雄联盟",
      "英雄联盟手游", "金铲铲", "穿越火线", "DNF", "火影忍者手游", "元梦之星",
      "PUBG", "Valorant", "欢乐斗地主", "欢乐麻将",
    ],
  },
  {
    category: "studio",
    label: "游戏工作室",
    emoji: "🎮",
    tab: "tencent",
    whitelist: [
      "天美", "光子", "魔方", "北极光", "量子", "极光", "波士顿",
      "拳头", "Riot", "Supercell", "Epic",
    ],
  },
  {
    category: "building",
    label: "办公楼/园区",
    emoji: "🏢",
    tab: "tencent",
    whitelist: [
      "腾讯大厦", "滨海大厦", "鹅厂双子塔", "T1塔楼", "琶洲新总部", "科兴科学园",
      "TIT创意园", "微信总部", "北京总部", "上海总部", "成都办公楼", "金地威新",
    ],
  },
  {
    category: "level",
    label: "职级体系",
    emoji: "🎖️",
    tab: "tencent",
    whitelist: [
      "T族", "P族", "M族", "S族", "应届生", "实习生", "正式员工", "外包",
      "专家", "总监", "VP",
    ],
  },
  {
    category: "invest",
    label: "被投公司",
    emoji: "💼",
    tab: "tencent",
    whitelist: [
      "拼多多", "美团", "快手", "B站", "京东", "知乎", "蔚来", "小红书",
      "Riot", "99公益日",
    ],
  },
];

function addFirstMetadata(item, first) {
  if (!first) return item;
  return {
    ...item,
    discoverer: first.discoverer,
    ts: Number(first.ts) || null,
    ...(first.seq == null ? {} : { seq: first.seq }),
  };
}

function buildHall(firstByName) {
  const items = HALL_OF_FAME.map((person) => {
    const hitAs = [person.real, person.alias].find((name) => firstByName.has(name));
    const item = {
      name: `${person.real} · ${person.alias}`,
      real: person.real,
      alias: person.alias,
      title: person.title,
      emoji: person.emoji,
      category: "boss",
      is_starter: false,
      discovered: Boolean(hitAs),
      ...(hitAs ? { hit_as: hitAs } : {}),
    };
    return addFirstMetadata(item, hitAs ? firstByName.get(hitAs) : null);
  });
  return {
    category: "boss",
    label: "角色",
    emoji: "🏛️",
    tab: "tencent",
    total: items.length,
    found: items.filter((item) => item.discovered).length,
    items,
  };
}

function buildGroup(definition, elements, starters, firstByName) {
  const starterNames = new Set(
    starters
      .filter((item) => item.category === definition.category)
      .map((item) => item.name),
  );
  const items = definition.whitelist.map((name) => {
    const first = firstByName.get(name);
    const item = {
      name,
      emoji: elements[name]?.emoji || "❓",
      category: definition.category,
      is_starter: starterNames.has(name),
      discovered: starterNames.has(name) || Boolean(first),
    };
    return addFirstMetadata(item, first);
  });
  return {
    category: definition.category,
    label: definition.label,
    emoji: definition.emoji,
    tab: definition.tab,
    total: items.length,
    found: items.filter((item) => item.discovered).length,
    items,
  };
}

export function buildBounty({ elements, starters, firsts }) {
  const firstByName = new Map(
    (firsts || []).map((item) => [item.result, item]),
  );
  const groups = [
    buildHall(firstByName),
    ...GROUPS.map((definition) =>
      buildGroup(definition, elements, starters, firstByName),
    ),
  ];
  const tabs = TABS.map((tab) => {
    const owned = groups.filter((group) => group.tab === tab.key);
    return {
      ...tab,
      total: owned.reduce((sum, group) => sum + group.total, 0),
      found: owned.reduce((sum, group) => sum + group.found, 0),
    };
  });
  return {
    tabs,
    groups,
    total: groups.reduce((sum, group) => sum + group.total, 0),
    found: groups.reduce((sum, group) => sum + group.found, 0),
  };
}

export function buildCategory({ category, elements, starters, firsts }) {
  const starterNames = new Set(
    starters
      .filter((item) => item.category === category)
      .map((item) => item.name),
  );
  const firstByName = new Map(
    (firsts || []).map((item) => [item.result, item]),
  );
  const items = Object.entries(elements)
    .filter(([, info]) => info?.category === category)
    .map(([name, info]) =>
      addFirstMetadata(
        {
          name,
          emoji: info?.emoji || "❓",
          category,
          is_starter: starterNames.has(name),
          discovered: starterNames.has(name) || firstByName.has(name),
        },
        firstByName.get(name),
      ),
    )
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return {
    category,
    total: items.length,
    found: items.filter((item) => item.discovered).length,
    items,
  };
}
