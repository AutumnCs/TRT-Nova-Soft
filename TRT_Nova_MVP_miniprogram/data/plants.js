/**
 * 本地植物兜底数据（离线 / API 失败时使用）
 * 数据权威来源：服务端 plant_library 表
 * 收藏状态权威来源：服务端 user_plant_favorites 表
 */
const PLANTS = [
  {
    id: 1,
    name: '龟背竹',
    family: '天南星科・龟背竹属',
    scientificName: 'Monstera deliciosa',
    feature: 'partial-shade',
    featureText: '半阴',
    category: 'foliage',
    image: 'https://images.unsplash.com/photo-1509423355108-74d6920d986b?q=80&w=600&auto=format&fit=crop',
    tags: ['常绿植物', '净化空气', '新手友好'],
    description: '原生生于热带雨林，具有独特的孔洞叶片，极具观赏性。',
    care: { light: '半阴或明亮散光', water: '干透浇透，避积水' },
    isFavorite: false
  },
  {
    id: 2,
    name: '多肉・玉露',
    family: '独尾草科・瓦苇属',
    scientificName: 'Haworthia cooperi',
    feature: 'avoid-sun',
    featureText: '忌暴晒',
    category: 'succulent',
    image: 'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?q=80&w=600&auto=format&fit=crop',
    tags: ['多肉植物', '耐旱', '小型盆栽'],
    description: '叶片晶莹剔透，形如露珠，是多肉植物中的珍品。',
    care: { light: '散射光，忌强光直射', water: '干透浇透，冬季少水' },
    isFavorite: false
  },
  {
    id: 3,
    name: '天堂鸟',
    family: '旅人蕉科・鹤望兰属',
    scientificName: 'Strelitzia reginae',
    feature: 'sun-loving',
    featureText: '喜阳光',
    category: 'foliage',
    image: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?q=80&w=600&auto=format&fit=crop',
    tags: ['观花植物', '大型盆栽', '喜温暖'],
    description: '花朵形如仙鹤，姿态优美，是室内外装饰的佳品。',
    care: { light: '充足阳光，每天至少4小时', water: '保持土壤湿润，避免积水' },
    isFavorite: false
  },
  {
    id: 4,
    name: '银斑葛',
    family: '天南星科・麒麟叶属',
    scientificName: 'Scindapsus pictus',
    feature: 'shade-tolerant',
    featureText: '耐阴',
    category: 'foliage',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=600&auto=format&fit=crop',
    tags: ['藤蔓植物', '净化空气', '耐阴'],
    description: '叶片带有银色斑点，富有质感，适合悬挂栽培。',
    care: { light: '低光到中等光照，忌强光', water: '保持土壤微湿，避免干燥' },
    isFavorite: false
  }
];

module.exports = { PLANTS };
