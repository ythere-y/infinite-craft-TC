const CHENGYU = [
  "热情洋溢",
  "一本正经",
  "无所畏惧",
  "精神饱满",
  "坚定不移",
  "全力以赴",
  "心有灵犀",
  "目不转睛",
];

const STATES = ["代码", "周报", "咖啡", "火锅"];

export const MEME_POOL = [
  "OKR", "KPI", "周报", "月报", "季报", "述职PPT", "TAPD",
  "P0", "P1", "活水", "瑞雪", "南极圈", "打工鹅", "赛马", "中台",
  "组织架构", "绩效3.5", "绩效3.75", "年终奖",
  "腾讯会议", "腾讯文档", "iWiki", "RTX",
  "秃头", "黑眼圈", "班味", "摸鱼", "带薪摸鱼", "带薪拉屎",
  "007", "996", "画饼", "空头支票", "删库跑路",
  "发疯", "发癫", "破防", "显眼包", "松弛感",
  "已读不回", "已读乱回", "猝死",
  "闭环", "抓手", "颗粒度", "对齐", "赋能", "链路", "心智", "穿透",
  "工位", "工牌", "打卡", "夜宵券", "咖啡", "美式", "奶茶",
  "外卖", "加班", "调休", "转岗", "离职", "述职",
  "酱板鸭", "雪山狐狸", "人类丰容", "画饼可以直说", "老贝榨",
  "爱你老己", "我要验牌", "太湖三霸", "不做人", "SBTI",
  "吗喽", "颠颠上班", "过期酸奶", "松人", "紧人",
];

function pick(items, random) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function generateNickname({ random = Math.random } = {}) {
  const adjective = pick(CHENGYU, random);
  const state = random() < 0.4
    ? pick(MEME_POOL, random)
    : pick(STATES, random);
  return `${adjective}的${state}鹅`;
}

export function randomSuffix(length = 3, random = Math.random) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length }, () => pick(alphabet, random)).join("");
}

export function nicknameStats() {
  return {
    chengyu: CHENGYU.length,
    thuocl_states: STATES.length,
    meme_pool: MEME_POOL.length,
    meme_weight: 0.4,
    effective_combo_space: CHENGYU.length * (MEME_POOL.length + STATES.length),
  };
}
