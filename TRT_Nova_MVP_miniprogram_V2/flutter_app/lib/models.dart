import 'package:flutter/material.dart';

class SensorMetric {
  const SensorMetric({
    required this.key,
    required this.label,
    required this.unit,
    required this.value,
    required this.history,
    required this.accent,
  });

  final String key;
  final String label;
  final String unit;
  final double value;
  final List<double> history;
  final Color accent;

  SensorMetric copyWith({
    String? key,
    String? label,
    String? unit,
    double? value,
    List<double>? history,
    Color? accent,
  }) {
    return SensorMetric(
      key: key ?? this.key,
      label: label ?? this.label,
      unit: unit ?? this.unit,
      value: value ?? this.value,
      history: history ?? this.history,
      accent: accent ?? this.accent,
    );
  }

  String get displayValue {
    if (value % 1 == 0) {
      return value.toStringAsFixed(0);
    }
    return value.toStringAsFixed(1);
  }
}

class JournalEntry {
  const JournalEntry({
    required this.id,
    required this.deviceId,
    required this.date,
    required this.type,
    required this.title,
    required this.content,
    this.attachmentPaths = const [],
  });

  final String id;
  final String deviceId;
  final DateTime date;
  final String type;
  final String title;
  final String content;
  final List<String> attachmentPaths;
}

class TodoItem {
  const TodoItem({
    required this.id,
    required this.deviceId,
    required this.title,
    required this.description,
    required this.urgent,
    required this.icon,
    required this.iconBackground,
    this.done = false,
  });

  final String id;
  final String deviceId;
  final String title;
  final String description;
  final bool urgent;
  final IconData icon;
  final Color iconBackground;
  final bool done;

  TodoItem copyWith({
    String? id,
    String? deviceId,
    String? title,
    String? description,
    bool? urgent,
    IconData? icon,
    Color? iconBackground,
    bool? done,
  }) {
    return TodoItem(
      id: id ?? this.id,
      deviceId: deviceId ?? this.deviceId,
      title: title ?? this.title,
      description: description ?? this.description,
      urgent: urgent ?? this.urgent,
      icon: icon ?? this.icon,
      iconBackground: iconBackground ?? this.iconBackground,
      done: done ?? this.done,
    );
  }
}

class PlantLibraryItem {
  const PlantLibraryItem({
    required this.id,
    required this.name,
    required this.scientificName,
    required this.category,
    required this.description,
    required this.imageAsset,
    required this.tags,
    required this.difficulty,
    this.isFavorite = false,
  });

  final String id;
  final String name;
  final String scientificName;
  final String category;
  final String description;
  final String imageAsset;
  final List<String> tags;
  final String difficulty;
  final bool isFavorite;

  PlantLibraryItem copyWith({
    String? id,
    String? name,
    String? scientificName,
    String? category,
    String? description,
    String? imageAsset,
    List<String>? tags,
    String? difficulty,
    bool? isFavorite,
  }) {
    return PlantLibraryItem(
      id: id ?? this.id,
      name: name ?? this.name,
      scientificName: scientificName ?? this.scientificName,
      category: category ?? this.category,
      description: description ?? this.description,
      imageAsset: imageAsset ?? this.imageAsset,
      tags: tags ?? this.tags,
      difficulty: difficulty ?? this.difficulty,
      isFavorite: isFavorite ?? this.isFavorite,
    );
  }
}

class PlantDevice {
  const PlantDevice({
    required this.id,
    required this.alias,
    required this.plantType,
    required this.location,
    required this.online,
    required this.imageAsset,
    required this.personality,
    required this.favorability,
    required this.isDead,
    required this.irStatus,
    required this.uid,
    required this.runState,
    required this.dsbTemp,
    required this.updatedAt,
    required this.metrics,
    this.commandPending = false,
  });

  final String id;
  final String alias;
  final String plantType;
  final String location;
  final bool online;
  final String imageAsset;
  final String personality;
  final int favorability;
  final bool isDead;
  final bool? irStatus;
  final String uid;
  final bool? runState;
  final double? dsbTemp;
  final DateTime updatedAt;
  final Map<String, SensorMetric> metrics;
  final bool commandPending;

  String get soulState => irStatus == null ? '--' : (irStatus! ? '没出窍' : '出窍');
  String get lifeStateLabel => isDead ? '死亡状态' : '好感度';
  String get lifeStateValue => isDead ? '已死亡' : '$favorability';

  PlantDevice copyWith({
    String? id,
    String? alias,
    String? plantType,
    String? location,
    bool? online,
    String? imageAsset,
    String? personality,
    int? favorability,
    bool? isDead,
    bool? irStatus,
    String? uid,
    bool? runState,
    double? dsbTemp,
    DateTime? updatedAt,
    Map<String, SensorMetric>? metrics,
    bool? commandPending,
  }) {
    return PlantDevice(
      id: id ?? this.id,
      alias: alias ?? this.alias,
      plantType: plantType ?? this.plantType,
      location: location ?? this.location,
      online: online ?? this.online,
      imageAsset: imageAsset ?? this.imageAsset,
      personality: personality ?? this.personality,
      favorability: favorability ?? this.favorability,
      isDead: isDead ?? this.isDead,
      irStatus: irStatus ?? this.irStatus,
      uid: uid ?? this.uid,
      runState: runState ?? this.runState,
      dsbTemp: dsbTemp ?? this.dsbTemp,
      updatedAt: updatedAt ?? this.updatedAt,
      metrics: metrics ?? this.metrics,
      commandPending: commandPending ?? this.commandPending,
    );
  }
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.text,
    required this.isUser,
    required this.time,
  });

  final String id;
  final String text;
  final bool isUser;
  final DateTime time;
}
