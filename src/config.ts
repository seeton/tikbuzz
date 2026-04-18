export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;
export const RUNS_DIR = 'runs';
export const PUBLIC_RUNS_DIR = 'public/runs';
export const REMOTION_COMPOSITION_ID = 'TikTokAutoVideo';

export const DEFAULT_VOICE_SETTINGS = {
  speedScale: 1.08,
  intonationScale: 1.22,
  pitchScale: 0,
  volumeScale: 1.2,
  prePhonemeLength: 0.08,
  postPhonemeLength: 0.12,
};

export const DISCOVERY_SOURCES = [
  {
    name: 'Google Trends JP',
    sourceType: 'trends',
    url: 'https://trends.google.com/trending/rss?geo=JP',
  },
  {
    name: 'NHK News',
    sourceType: 'news',
    url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',
  },
  {
    name: 'ITmedia News',
    sourceType: 'news',
    url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml',
  },
  {
    name: 'Hatena Hotentry IT',
    sourceType: 'community',
    url: 'https://b.hatena.ne.jp/hotentry/it.rss',
  },
] as const;

export const BLOCKED_TOPIC_KEYWORDS = [
  '選挙',
  '政治',
  '政党',
  '首相',
  '大統領',
  '戦争',
  '紛争',
  '殺人',
  '事故',
  '逮捕',
  '陰謀',
  'デマ',
  '医療',
  'ワクチン',
  '投資',
  '株価',
  '為替',
  '仮想通貨',
  'ギャンブル',
  '事件',
  '病院',
  '医療関連',
  '法務省',
  '公取委',
  '独禁法',
  '権利侵害',
  '損害賠償',
  'ガイドライン',
  '検討会',
  '報告書',
  '自衛隊',
  '護衛艦',
  '台湾海峡',
];

export const POSITIVE_TOPIC_KEYWORDS = [
  '科学',
  '宇宙',
  '歴史',
  '地理',
  'AI',
  'ロボット',
  '海',
  '動物',
  '生き物',
  '技術',
  '仕組み',
  '世界',
  '日本',
  '食',
  '文化',
];

export const WEAK_TOPIC_KEYWORDS = [
  '導入',
  'コンタクトセンター',
  '顧客体験',
  '問い合わせ対応',
  '発表した',
  '料金',
  'スタート',
  '協議',
  '会談',
  '処分',
  '支援表明',
  '議長声明',
];

export const PROCESS_TOPIC_KEYWORDS = [
  '決定',
  '発表',
  '合意',
  '命名',
  '呼称',
  '採用',
  '調査',
  '報告書',
  '検討',
  '会合',
  'アンケート',
  '有識者',
];

export const ENTERPRISE_TOPIC_KEYWORDS = [
  'CLI',
  'API',
  'SDK',
  'MCP',
  'OS',
  'クラウド',
  'プラットフォーム',
  'テクニカルプレビュー',
  '開発者',
  '顧客体験',
  '問い合わせ対応',
  'コマンドライン',
  '独占販売',
  'コンタクトセンター',
  'リモートMCP',
  '市場調査',
];

export const SHORTS_FRIENDLY_KEYWORDS = [
  '猛暑',
  '酷暑',
  '気温',
  '天気',
  '気象',
  '地球',
  '宇宙',
  '星',
  '惑星',
  '月',
  '太陽',
  '海',
  '深海',
  '地震',
  '火山',
  '空港',
  '航空',
  '人体',
  '脳',
  '睡眠',
  '色',
  '音',
  '光',
  '数学',
  '物理',
  '化学',
  '歴史',
  '文化',
  '動物',
  '生き物',
  '不思議',
  'なぜ',
  '実は',
  '仕組み',
];

export const VISUAL_SHORTS_KEYWORDS = [
  '光る',
  '追える',
  '可視化',
  '見える',
  'アニメ',
  '復活',
  '30周年',
  '周年',
  '画期的',
  'デザイン',
  'シミュレータ',
  '再来',
  '軌跡',
];

export const DISCOVER_TARGET_COUNT = 18;
