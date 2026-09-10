const DEFAULT_PLANT_IMAGE = '/images/plant-default-v2.jpg';

function buildCareStatus(pet = {}, taskFacts = {}) {
  if (pet.status === 'archived') {
    return {
      key: 'archived',
      label: '已归档',
      reason: '档案仍保留，可查看或永久删除。'
    };
  }

  const overdueCount = Number(taskFacts.overdueCount) || 0;
  const dueTodayCount = Number(taskFacts.dueTodayCount) || 0;
  if (overdueCount > 0) {
    return {
      key: 'overdue',
      label: '有待补养护',
      reason: `${overdueCount} 项计划已逾期；这是任务事实，不代表确定性的植物健康结论。`
    };
  }
  if (dueTodayCount > 0) {
    return {
      key: 'due',
      label: '今日待养护',
      reason: `今天有 ${dueTodayCount} 项计划待完成。`
    };
  }

  const missing = [];
  if (pet.isUnknownSpecies || !pet.speciesName || pet.speciesName === '未知品种') missing.push('品种');
  if (!pet.enteredAt) missing.push('入室日期');
  if (!pet.location) missing.push('位置');

  if (missing.length) {
    return {
      key: 'incomplete',
      label: '档案待完善',
      reason: `还可以补充${missing.join('、')}。当前不推断健康状况。`
    };
  }

  return {
    key: 'recorded',
    label: '档案已建立',
    reason: '当前没有到期未完成任务；这里只陈述任务事实，不推断植物健康。'
  };
}

function mapPlantPetCard(pet = {}, taskFacts = {}) {
  return {
    id: Number(pet.id) || 0,
    ownerOpenid: pet.ownerOpenid || '',
    nickname: pet.nickname || '未命名植宠',
    speciesName: pet.speciesName || '未知品种',
    coverUrl: pet.coverUrl || DEFAULT_PLANT_IMAGE,
    enteredAt: pet.enteredAt || '',
    enteredAtLabel: pet.enteredAt || '未记录',
    location: pet.location || '未记录位置',
    careNotes: pet.careNotes || '',
    status: pet.status || 'active',
    careStatus: buildCareStatus(pet, taskFacts)
  };
}

function buildTaskFactsByPlant(tasks = []) {
  return (Array.isArray(tasks) ? tasks : []).reduce((result, task) => {
    const plantPetId = Number(task.plantPetId) || 0;
    if (!plantPetId) return result;
    const facts = result[plantPetId] || { dueTodayCount: 0, overdueCount: 0 };
    if (task.overdue) facts.overdueCount += 1;
    else facts.dueTodayCount += 1;
    result[plantPetId] = facts;
    return result;
  }, {});
}

function splitPlantPetCards(pets = [], taskFactsByPlant = {}) {
  const cards = (Array.isArray(pets) ? pets : []).map((pet) => mapPlantPetCard(pet, taskFactsByPlant[pet.id]));
  return {
    active: cards.filter((pet) => pet.status === 'active'),
    archived: cards.filter((pet) => pet.status === 'archived')
  };
}

module.exports = {
  DEFAULT_PLANT_IMAGE,
  buildCareStatus,
  buildTaskFactsByPlant,
  mapPlantPetCard,
  splitPlantPetCards
};
