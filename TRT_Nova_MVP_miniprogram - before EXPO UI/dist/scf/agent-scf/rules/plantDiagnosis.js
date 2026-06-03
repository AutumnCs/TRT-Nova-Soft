function extractSensorValue(params, keys) {
  for (const key of keys) {
    const node = params?.[key];
    if (node && typeof node === 'object' && node.value !== undefined && node.value !== null && node.value !== '') {
      const num = Number(node.value);
      if (Number.isFinite(num)) return num;
    }
    if (typeof node === 'number' && Number.isFinite(node)) {
      return node;
    }
  }
  return null;
}

function computeRiskFacts(snapshot) {
  const params = snapshot?.params || {};
  const soil = extractSensorValue(params, ['soil_percent', 'soil', 'soil_moisture']);
  const temp = extractSensorValue(params, ['dht_temp', 'temp', 'temperature', 'air_temp']);
  const humidity = extractSensorValue(params, ['dht_humi', 'humidity', 'air_humidity']);
  const light = extractSensorValue(params, ['light_val', 'light', 'illuminance', 'lux']);

  const facts = [];
  const suggestions = [];
  const alerts = [];

  if (soil !== null) {
    facts.push(`土壤湿度 ${soil}%`);
    if (soil < 20) {
      alerts.push('土壤缺水');
      suggestions.push('建议尽快补水一次');
    } else if (soil > 80) {
      alerts.push('土壤过湿');
      suggestions.push('建议暂停浇水并观察排水情况');
    }
  }

  if (temp !== null) {
    facts.push(`环境温度 ${temp}℃`);
    if (temp < 15) {
      alerts.push('温度偏低');
      suggestions.push('建议注意保温，避免长时间低温');
    } else if (temp > 35) {
      alerts.push('温度偏高');
      suggestions.push('建议适度通风，避免闷热环境');
    }
  }

  if (humidity !== null) {
    facts.push(`环境湿度 ${humidity}%`);
    if (humidity < 30) {
      alerts.push('湿度偏低');
      suggestions.push('可以考虑提升环境湿度');
    } else if (humidity > 85) {
      alerts.push('湿度偏高');
      suggestions.push('建议增强通风，避免环境过湿');
    }
  }

  if (light !== null) {
    facts.push(`光照 ${light}lx`);
    if (light < 500) {
      alerts.push('光照不足');
      suggestions.push('可尝试移到更明亮的散射光位置');
    } else if (light > 80000) {
      alerts.push('光照过强');
      suggestions.push('建议避免长时间强光直晒');
    }
  }

  if (!snapshot?.hasLatest) {
    alerts.push('设备暂无最新上报');
    suggestions.push('请先检查设备联网与上报状态');
  }

  const riskLevel = alerts.length >= 2 ? 'high' : alerts.length === 1 ? 'medium' : 'low';
  return {
    soil,
    temp,
    humidity,
    light,
    facts,
    alerts,
    suggestions,
    riskLevel
  };
}

function buildTrendSentence(metricName, summary) {
  if (!summary || summary.pointCount <= 0) {
    return '';
  }

  const trendTextMap = {
    up: '整体呈上升趋势',
    down: '整体呈下降趋势',
    stable: '整体较稳定',
    unknown: '趋势暂不明确'
  };

  const trendText = trendTextMap[summary.trend] || trendTextMap.unknown;
  return `${metricName}${trendText}`;
}

module.exports = {
  buildTrendSentence,
  computeRiskFacts,
  extractSensorValue
};
