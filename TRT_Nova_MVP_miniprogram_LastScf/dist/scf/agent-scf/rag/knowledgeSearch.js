const { searchPlantProfiles } = require('../tools/plant');

const PROTOCOL_SNIPPETS = [
  {
    id: 'soil_percent',
    title: '土壤湿度 soil_percent',
    keywords: ['soil_percent', '土壤湿度', '湿度多少', '缺水', '浇水'],
    content: 'soil_percent 表示土壤湿度百分比，单位是 %。它通常用于判断是否缺水、给出浇水建议，以及绘制湿度趋势。'
  },
  {
    id: 'dht_temp',
    title: '环境温度 dht_temp',
    keywords: ['dht_temp', '温度', '环境温度', '热不热', '通风'],
    content: 'dht_temp 表示环境温度，单位是 ℃。它常用于判断环境温度是否异常，以及是否需要建议通风。'
  },
  {
    id: 'dht_humi',
    title: '环境湿度 dht_humi',
    keywords: ['dht_humi', '空气湿度', '环境湿度', '太干', '太湿'],
    content: 'dht_humi 表示环境湿度，单位是 %。它用于判断环境是否过干或过湿。'
  },
  {
    id: 'light_val',
    title: '光照 light_val',
    keywords: ['light_val', '光照', '照度', 'lux', '晒太阳'],
    content: 'light_val 表示光照强度，单位是 lx。它通常用于判断植物是否缺光，或者是否有强光直晒风险。'
  },
  {
    id: 'run_state',
    title: '设备运行状态 run_state',
    keywords: ['run_state', '运行状态', '设备状态', '在运行吗'],
    content: 'run_state 表示设备运行状态。一般 true 代表运行中，false 代表已停止，用于展示设备当前状态。'
  },
  {
    id: 'fan_switch',
    title: '风扇状态 fan_switch',
    keywords: ['fan_switch', 'test', '风扇', '开风扇', '关风扇', '通风'],
    content: 'fan_switch 是风扇开关状态的正式字段。当前系统也兼容历史过渡字段 test：true 表示风扇开启，false 表示风扇关闭。'
  },
  {
    id: 'business_rule_latest',
    title: '业务规则：真实状态来源',
    keywords: ['真实状态', '为什么没执行', '命令发出', '为什么没开', '最新状态'],
    content: '当前项目以 device_latest 作为设备真实状态来源。命令发送成功不等于设备已经执行成功，仍需要等待设备重新上报确认。'
  }
];

function scoreSnippet(query, snippet) {
  const text = String(query || '').trim();
  if (!text) return 0;

  let score = 0;
  snippet.keywords.forEach((keyword) => {
    if (keyword && text.toLowerCase().includes(String(keyword).toLowerCase())) {
      score += keyword.length > 4 ? 5 : 3;
    }
  });
  return score;
}

function searchProtocolKnowledge(query, limit = 3) {
  return PROTOCOL_SNIPPETS
    .map((snippet) => ({ snippet, score: scoreSnippet(query, snippet) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      type: 'protocol',
      title: item.snippet.title,
      content: item.snippet.content,
      source: `device-field:${item.snippet.id}`
    }));
}

function buildPlantKnowledgeEntry(plant) {
  const parts = [
    plant.name ? `植物：${plant.name}` : '',
    plant.scientificName ? `学名：${plant.scientificName}` : '',
    plant.feature || plant.featureText ? `特点：${plant.featureText || plant.feature}` : '',
    plant.description ? `简介：${plant.description}` : '',
    plant.care?.light ? `光照建议：${plant.care.light}` : '',
    plant.care?.water ? `浇水建议：${plant.care.water}` : ''
  ].filter(Boolean);

  return {
    type: 'plant_library',
    title: plant.name || '植物资料',
    content: parts.join('；'),
    source: `plant_library:${plant.id}`,
    plantId: plant.id
  };
}

async function searchKnowledgeBundle(db, options = {}) {
  const query = String(options.query || '').trim();
  const plantType = String(options.plantType || '').trim();
  const plantLibraryId = Number(options.plantLibraryId) || 0;

  const [plantProfiles, protocolHits] = await Promise.all([
    searchPlantProfiles(db, {
      plantLibraryId,
      plantType,
      query,
      limit: 2
    }),
    Promise.resolve(searchProtocolKnowledge(query, 2))
  ]);

  const plantHits = plantProfiles.map(buildPlantKnowledgeEntry);
  const hits = plantHits.concat(protocolHits);

  return {
    hits,
    contextText: hits.length
      ? [
          '以下是本轮可用知识依据，请优先基于这些内容回答，避免超出依据自由发挥：',
          ...hits.map((item, index) => `${index + 1}. [${item.title}] ${item.content}`)
        ].join('\n')
      : ''
  };
}

module.exports = {
  searchKnowledgeBundle
};
