/**
 * 本地植物兜底数据（离线 / API 失败时使用）
 * 数据权威来源：服务端 plant_library 表
 * 收藏状态权威来源：服务端 user_plant_favorites 表
 */
const PLANTS = [
  {
    id: 1,
    name: '龟背竹',
    aliases: ['蓬莱蕉', '裂叶喜林芋'],
    family: '天南星科・龟背竹属',
    scientificName: 'Monstera deliciosa',
    feature: 'partial-shade',
    featureText: '半阴',
    category: 'foliage',
    image: 'https://images.unsplash.com/photo-1509423355108-74d6920d986b?q=80&w=600&auto=format&fit=crop',
    tags: ['常绿植物', '净化空气', '新手友好'],
    description: '原生生于热带雨林，具有独特的孔洞叶片，极具观赏性。',
    difficulty: 'easy',
    care: {
      light: '半阴或明亮散光，避免长期暴晒',
      water: '表层土微干到半干时浇透，避积水',
      temperature: '18~30℃，低于12℃要注意保温',
      humidity: '偏好中高湿，空气过干时叶缘可能发焦',
      soil: '疏松透气、富含有机质的基质',
      fertilizer: '春夏每月薄肥一次，冬季减少施肥',
      ventilation: '喜欢通风但避免冷风直吹'
    },
    commonIssues: [
      {
        issue: '黄叶',
        possibleCauses: ['浇水过多', '强光暴晒', '换盆应激'],
        actions: ['先检查盆土是否长期潮湿', '移到散射光更稳定的位置', '观察新叶是否恢复正常']
      },
      {
        issue: '叶片无开裂',
        possibleCauses: ['植株偏幼', '长期缺光', '养分不足'],
        actions: ['补充稳定散射光', '在生长期适度补肥', '不要期待短期内马上开背']
      }
    ],
    faq: [
      {
        question: '龟背竹多久浇一次？',
        answer: '不建议按固定天数浇水，更适合观察盆土状态，表层微干再浇更稳。'
      },
      {
        question: '龟背竹怕晒吗？',
        answer: '怕夏季强烈直射光，长时间暴晒容易灼伤叶片，但也不能长期放在太暗的位置。'
      }
    ],
    recommendQuestions: ['龟背竹适合什么光照？', '我的龟背竹现在要不要浇水？'],
    deviceInterpretation: {
      soil_percent: { dry: 20, ok: [20, 45], wet: 70 },
      light_val: { low: 800, ok: [800, 12000], high: 28000 },
      dht_temp: { low: 15, ok: [18, 30], high: 33 }
    },
    agentNotes: '适合把重点放在散射光、湿度和积水风险上。',
    isFavorite: false
  },
  {
    id: 2,
    name: '多肉・玉露',
    aliases: ['玉露', 'Haworthia cooperi'],
    family: '独尾草科・瓦苇属',
    scientificName: 'Haworthia cooperi',
    feature: 'avoid-sun',
    featureText: '忌暴晒',
    category: 'succulent',
    image: 'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?q=80&w=600&auto=format&fit=crop',
    tags: ['多肉植物', '耐旱', '小型盆栽'],
    description: '叶片晶莹剔透，形如露珠，是多肉植物中的珍品。',
    difficulty: 'medium',
    care: {
      light: '明亮散射光为主，夏季避免中午直晒',
      water: '干透再浇，宁干勿涝，冬季明显控水',
      temperature: '15~28℃较舒适，夏季闷热和冬季严寒都要注意',
      humidity: '不需要过高湿度，闷湿环境反而容易出问题',
      soil: '颗粒占比高、排水透气的多肉基质',
      fertilizer: '生长期少量薄肥即可，不宜频繁施肥',
      ventilation: '非常看重通风，长期闷养容易化水烂根'
    },
    commonIssues: [
      {
        issue: '叶片发软',
        possibleCauses: ['缺水', '烂根', '高温闷湿'],
        actions: ['先看盆土是否长期潮湿', '确认是否有烂根异味', '加强通风并减少暴晒']
      },
      {
        issue: '徒长',
        possibleCauses: ['长期缺光'],
        actions: ['逐步增加光照', '避免频繁浇水', '保持通风防止株形松散']
      }
    ],
    faq: [
      {
        question: '多肉是不是一定要少浇水？',
        answer: '核心不是“少”，而是“干透再浇、避免长期潮湿”，不同季节和通风条件差别很大。'
      },
      {
        question: '玉露适合暴晒吗？',
        answer: '不适合长时间强光直晒，尤其是夏季中午，很容易出现晒伤或失水发皱。'
      }
    ],
    recommendQuestions: ['多肉现在要不要浇水？', '玉露适合什么光照？'],
    deviceInterpretation: {
      soil_percent: { dry: 15, ok: [15, 28], wet: 45 },
      light_val: { low: 1200, ok: [1200, 15000], high: 32000 },
      dht_temp: { low: 10, ok: [15, 28], high: 32 }
    },
    agentNotes: '回答多肉问题时应强调排水、通风和宁干勿涝。',
    isFavorite: false
  },
  {
    id: 3,
    name: '天堂鸟',
    aliases: ['鹤望兰', 'Strelitzia'],
    family: '旅人蕉科・鹤望兰属',
    scientificName: 'Strelitzia reginae',
    feature: 'sun-loving',
    featureText: '喜阳光',
    category: 'foliage',
    image: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?q=80&w=600&auto=format&fit=crop',
    tags: ['观花植物', '大型盆栽', '喜温暖'],
    description: '花朵形如仙鹤，姿态优美，是室内外装饰的佳品。',
    difficulty: 'medium',
    care: {
      light: '充足阳光，每天至少 4 小时，室内需尽量靠近明亮窗边',
      water: '生长期保持微湿，避免长期干透，也避免积水',
      temperature: '18~32℃较适宜，冬季注意防寒',
      humidity: '中等湿度即可，空气过干时可适度增加湿度',
      soil: '肥沃、疏松、排水良好的基质',
      fertilizer: '生长期定期薄肥，促进叶片和花芽发育',
      ventilation: '喜通风，闷热环境下状态会明显下降'
    },
    commonIssues: [
      {
        issue: '叶片卷曲',
        possibleCauses: ['缺水', '强风', '空气过干'],
        actions: ['检查土壤湿度', '避免空调热风直吹', '适当提高环境湿度']
      }
    ],
    faq: [
      {
        question: '天堂鸟为什么一直不开花？',
        answer: '常见原因是光照不足、植株未成熟或养分不够，室内环境下更常见的是缺光。'
      }
    ],
    recommendQuestions: ['天堂鸟现在缺光吗？', '天堂鸟要不要增加通风？'],
    deviceInterpretation: {
      soil_percent: { dry: 22, ok: [22, 48], wet: 70 },
      light_val: { low: 1800, ok: [1800, 25000], high: 45000 },
      dht_temp: { low: 14, ok: [18, 32], high: 36 }
    },
    agentNotes: '回答时可强调高光需求和生长期供水节奏。',
    isFavorite: false
  },
  {
    id: 4,
    name: '银斑葛',
    aliases: ['银斑藤芋', 'Scindapsus pictus'],
    family: '天南星科・麒麟叶属',
    scientificName: 'Scindapsus pictus',
    feature: 'shade-tolerant',
    featureText: '耐阴',
    category: 'foliage',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=600&auto=format&fit=crop',
    tags: ['藤蔓植物', '净化空气', '耐阴'],
    description: '叶片带有银色斑点，富有质感，适合悬挂栽培。',
    difficulty: 'easy',
    care: {
      light: '低光到中等光照都能适应，但明亮散射光下状态更好',
      water: '保持土壤微湿，避免长期过干或过湿',
      temperature: '18~30℃较适宜',
      humidity: '偏好中高湿，空气太干时边缘易干焦',
      soil: '排水良好的通用观叶基质',
      fertilizer: '春夏薄肥少量补充即可',
      ventilation: '保持柔和通风，避免闷养'
    },
    commonIssues: [
      {
        issue: '叶片失去银斑光泽',
        possibleCauses: ['光照不足', '养分偏弱'],
        actions: ['移到更明亮的散射光位置', '生长期少量补肥']
      }
    ],
    faq: [
      {
        question: '银斑葛能放很暗的地方吗？',
        answer: '短期可以耐阴，但长期过暗会影响斑纹表现和整体长势。'
      }
    ],
    recommendQuestions: ['银斑葛适合什么湿度？', '我的银斑葛现在状态怎么样？'],
    deviceInterpretation: {
      soil_percent: { dry: 20, ok: [20, 42], wet: 68 },
      light_val: { low: 500, ok: [500, 9000], high: 22000 },
      dht_temp: { low: 14, ok: [18, 30], high: 34 }
    },
    agentNotes: '重点关注耐阴但不等于喜暗，以及湿度与斑纹状态的关系。',
    isFavorite: false
  }
];

module.exports = { PLANTS };
