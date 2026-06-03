import 'package:flutter/material.dart';

import 'models.dart';

List<PlantLibraryItem> demoPlants() {
  return [
    const PlantLibraryItem(
      id: 'monstera',
      name: '龟背竹',
      scientificName: 'Monstera deliciosa',
      category: '天南星科',
      description: '喜欢稳定散射光和较高空气湿度，适合放在通风良好的室内空间。',
      imageAsset: 'assets/images/plant-default.jpg',
      tags: ['观叶', '好养', '新手友好'],
      difficulty: 'easy',
      isFavorite: true,
    ),
    const PlantLibraryItem(
      id: 'haworthia',
      name: '玉露',
      scientificName: 'Haworthia cooperi',
      category: '独尾草科',
      description: '耐旱但怕闷湿，适合排水透气的颗粒土，光照要柔和。',
      imageAsset: 'assets/images/plant-default.jpg',
      tags: ['多肉', '耐旱', '通风'],
      difficulty: 'medium',
    ),
    const PlantLibraryItem(
      id: 'snake',
      name: '虎尾兰',
      scientificName: 'Dracaena trifasciata',
      category: '天门冬科',
      description: '对环境适应性很强，但长期缺光也会影响叶片状态。',
      imageAsset: 'assets/images/plant-default.jpg',
      tags: ['耐阴', '省心', '净化'],
      difficulty: 'easy',
      isFavorite: true,
    ),
  ];
}

List<TodoItem> demoTodos() {
  return [
    TodoItem(
      id: 'todo-1',
      deviceId: 'device-1',
      title: '检查土壤湿度',
      description: '今天中午前确认一次龟背竹的湿度状态。',
      urgent: false,
      icon: Icons.water_drop_outlined,
      iconBackground: const Color(0xFFEAF4FF),
    ),
    TodoItem(
      id: 'todo-2',
      deviceId: 'device-1',
      title: '补一条成长记录',
      description: '把昨天的浇水记录补进植物日历。',
      urgent: true,
      icon: Icons.edit_outlined,
      iconBackground: const Color(0xFFFFF4E5),
    ),
    TodoItem(
      id: 'todo-3',
      deviceId: '',
      title: '查看收藏植物',
      description: '去植物库看看最近收藏的品种。',
      urgent: false,
      icon: Icons.bookmark_border,
      iconBackground: const Color(0xFFE8F9EF),
    ),
  ];
}

List<ChatMessage> demoMessages() {
  return [
    ChatMessage(
      id: 'm-1',
      text: '你好，我是你的植物养护助手。你可以直接问我植物状态、浇水建议、历史趋势或设备数据。',
      isUser: false,
      time: DateTime(2026, 5, 22, 9, 20),
    ),
    ChatMessage(
      id: 'm-2',
      text: '我的植物现在状态怎么样？',
      isUser: true,
      time: DateTime(2026, 5, 22, 9, 21),
    ),
    ChatMessage(
      id: 'm-3',
      text: '我会优先结合你当前设备的数据来回答。',
      isUser: false,
      time: DateTime(2026, 5, 22, 9, 21, 8),
    ),
  ];
}

List<PlantDevice> demoDevices() {
  return [
    PlantDevice(
      id: 'device-1',
      alias: 'J',
      plantType: '龟背竹',
      location: '客厅',
      online: false,
      imageAsset: 'assets/images/plant-default.jpg',
      personality: '温和型',
      favorability: 78,
      isDead: false,
      irStatus: true,
      uid: 'A1B2C3D4',
      runState: true,
      dsbTemp: 23.6,
      updatedAt: DateTime(2026, 5, 25, 9, 6, 12),
      metrics: {
        'soil': SensorMetric(
          key: 'soil',
          label: '土壤湿度',
          unit: '%',
          value: 42,
          history: [48, 45, 44, 42, 39, 36, 41],
          accent: const Color(0xFF6BAEFC),
        ),
        'temp': SensorMetric(
          key: 'temp',
          label: '环境温度',
          unit: '°C',
          value: 24.3,
          history: [23.6, 23.8, 24.1, 24.3, 24.8, 25.1, 24.9],
          accent: const Color(0xFFF59E0B),
        ),
        'humidity': SensorMetric(
          key: 'humidity',
          label: '环境湿度',
          unit: '%',
          value: 58,
          history: [61, 60, 59, 58, 56, 55, 57],
          accent: const Color(0xFF38BDF8),
        ),
        'light': SensorMetric(
          key: 'light',
          label: '光照强度',
          unit: 'lx',
          value: 1260,
          history: [900, 1000, 1100, 1260, 1400, 1510, 1490],
          accent: const Color(0xFF10B981),
        ),
      },
    ),
    PlantDevice(
      id: 'device-2',
      alias: 'O',
      plantType: '玉露',
      location: '书桌',
      online: true,
      imageAsset: 'assets/images/plant-default.jpg',
      personality: '敏感型',
      favorability: 64,
      isDead: false,
      irStatus: false,
      uid: 'E5F6G7H8',
      runState: true,
      dsbTemp: 26.1,
      updatedAt: DateTime(2026, 5, 25, 8, 54, 2),
      metrics: {
        'soil': SensorMetric(
          key: 'soil',
          label: '土壤湿度',
          unit: '%',
          value: 28,
          history: [34, 32, 31, 29, 28, 27, 26],
          accent: const Color(0xFF6BAEFC),
        ),
        'temp': SensorMetric(
          key: 'temp',
          label: '环境温度',
          unit: '°C',
          value: 27.2,
          history: [26.5, 26.7, 27.0, 27.2, 27.6, 27.8, 28.0],
          accent: const Color(0xFFF59E0B),
        ),
        'humidity': SensorMetric(
          key: 'humidity',
          label: '环境湿度',
          unit: '%',
          value: 44,
          history: [49, 48, 47, 46, 44, 42, 45],
          accent: const Color(0xFF38BDF8),
        ),
        'light': SensorMetric(
          key: 'light',
          label: '光照强度',
          unit: 'lx',
          value: 2520,
          history: [2000, 2200, 2300, 2520, 2600, 2800, 2750],
          accent: const Color(0xFF10B981),
        ),
      },
    ),
  ];
}
