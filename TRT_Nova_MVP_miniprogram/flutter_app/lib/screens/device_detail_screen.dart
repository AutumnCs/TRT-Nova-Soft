import 'package:flutter/material.dart';

import '../app_state.dart';
import '../widgets.dart';
import 'device_settings_screen.dart';
import 'plant_journal_screen.dart';

class DeviceDetailScreen extends StatefulWidget {
  const DeviceDetailScreen({super.key, required this.deviceId});

  final String deviceId;

  @override
  State<DeviceDetailScreen> createState() => _DeviceDetailScreenState();
}

class _DeviceDetailScreenState extends State<DeviceDetailScreen> {
  String _metricKey = 'soil';

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final device = app.devices.firstWhere((item) => item.id == widget.deviceId, orElse: () => app.selectedDevice!);
    final metric = device.metrics[_metricKey] ?? device.metrics.values.first;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(Icons.arrow_back),
                  ),
                  Expanded(
                    child: Text(device.alias, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
                children: [
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(18),
                          child: Image.asset(device.imageAsset, width: 92, height: 92, fit: BoxFit.cover),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(device.alias, style: Theme.of(context).textTheme.headlineMedium),
                                  ),
                                  const SizedBox(width: 8),
                                  TextButton(
                                    onPressed: () {
                                      Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) => PlantJournalScreen(deviceId: device.id),
                                        ),
                                      );
                                    },
                                    child: const Text('成长日历'),
                                  ),
                                  TextButton(
                                    onPressed: () {
                                      Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) => DeviceSettingsScreen(deviceId: device.id),
                                        ),
                                      );
                                    },
                                    child: const Text('设置'),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text('${device.location} · ${device.plantType}', style: Theme.of(context).textTheme.bodyMedium),
                              const SizedBox(height: 4),
                              Text(
                                device.online ? '在线运行中' : '离线',
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: device.online ? const Color(0xFF16A76E) : const Color(0xFF64748B),
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                              const SizedBox(height: 10),
                              if (device.personality.isNotEmpty)
                                InfoChip(
                                  label: '性格',
                                  value: device.personality,
                                  backgroundColor: const Color(0xFFF4F8F1),
                                  valueColor: const Color(0xFF4B7D4A),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 128,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: device.metrics.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 12),
                      itemBuilder: (context, index) {
                        final item = device.metrics.values.elementAt(index);
                        final active = item.key == _metricKey;
                        return MetricTile(
                          title: item.label,
                          value: item.displayValue,
                          unit: item.unit,
                          highlight: active,
                          onTap: () => setState(() => _metricKey = item.key),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('植物状态', style: Theme.of(context).textTheme.titleLarge),
                        const SizedBox(height: 14),
                        GridView.count(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          crossAxisCount: 2,
                          childAspectRatio: 2.1,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          children: [
                            _InfoTile(label: device.lifeStateLabel, value: device.lifeStateValue),
                            _InfoTile(label: '灵魂状态', value: device.soulState),
                            _InfoTile(label: '植物类型', value: device.plantType),
                            _InfoTile(label: '芯片 UID', value: device.uid),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${metric.label} 趋势', style: Theme.of(context).textTheme.titleLarge),
                                  const SizedBox(height: 4),
                                  Text('点击上方不同传感器切换趋势图', style: Theme.of(context).textTheme.bodySmall),
                                ],
                              ),
                            ),
                            const Icon(Icons.show_chart, color: Color(0xFF16A76E)),
                          ],
                        ),
                        const SizedBox(height: 14),
                        TrendChart(values: metric.history, color: metric.accent),
                        const SizedBox(height: 12),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _StatColumn(label: '最低', value: _min(metric.history, metric.unit)),
                            _StatColumn(label: '平均', value: _avg(metric.history, metric.unit)),
                            _StatColumn(label: '最高', value: _max(metric.history, metric.unit)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _min(List<double> values, String unit) {
    if (values.isEmpty) return '--';
    final v = values.reduce((a, b) => a < b ? a : b);
    return _format(v, unit);
  }

  String _max(List<double> values, String unit) {
    if (values.isEmpty) return '--';
    final v = values.reduce((a, b) => a > b ? a : b);
    return _format(v, unit);
  }

  String _avg(List<double> values, String unit) {
    if (values.isEmpty) return '--';
    final v = values.reduce((a, b) => a + b) / values.length;
    return _format(v, unit);
  }

  String _format(double value, String unit) {
    final body = value % 1 == 0 ? value.toStringAsFixed(0) : value.toStringAsFixed(1);
    return '$body$unit';
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 6),
          Text(value, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }
}

class _StatColumn extends StatelessWidget {
  const _StatColumn({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}
