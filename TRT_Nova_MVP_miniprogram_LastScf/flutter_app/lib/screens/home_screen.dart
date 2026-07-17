import 'package:flutter/material.dart';

import '../app_state.dart';
import '../models.dart';
import '../widgets.dart';
import 'device_detail_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return AnimatedBuilder(
      animation: app,
      builder: (context, _) {
        final device = app.selectedDevice;
        return SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 120),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _HeaderSummary(device: device),
                const SizedBox(height: 18),
                _HeroSection(device: device),
                const SizedBox(height: 18),
                SectionHeader(
                  title: '今日待办',
                  action: IconButton(
                    onPressed: () => _showAddTodoSheet(context),
                    icon: const Icon(Icons.add_circle, color: Color(0xFF14A96A)),
                  ),
                ),
                const SizedBox(height: 12),
                ...app.todosForSelectedDevice.map(
                  (todo) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _TodoCard(todo: todo),
                  ),
                ),
                if (app.todosForSelectedDevice.isEmpty)
                  const _EmptyHint(text: '暂时没有待办，先去植物日历补一条记录吧。'),
                const SizedBox(height: 24),
                SectionHeader(
                  title: '我的设备',
                  action: TextButton(
                    onPressed: () {},
                    child: const Text('刷新状态'),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 156,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: app.devices.length + 1,
                    separatorBuilder: (_, __) => const SizedBox(width: 12),
                    itemBuilder: (context, index) {
                      if (index == app.devices.length) {
                        return _AddDeviceCard(
                          onTap: () => _showDeviceHint(context),
                        );
                      }
                      final item = app.devices[index];
                      return _DeviceCard(
                        device: item,
                        active: item.id == device?.id,
                        onTap: () {
                          app.selectDevice(item.id);
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => DeviceDetailScreen(deviceId: item.id),
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
                const SizedBox(height: 24),
                SectionHeader(title: '实时监测'),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: _sensorTiles(device),
                ),
                const SizedBox(height: 24),
                SectionHeader(title: '设备状态'),
                const SizedBox(height: 12),
                _ExtraGrid(device: device),
                const SizedBox(height: 24),
                SectionHeader(title: '设备控制'),
                const SizedBox(height: 12),
                _FanCard(
                  active: device?.runState ?? false,
                  pending: device?.commandPending ?? false,
                  onTap: () => _showControlToast(context),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  List<Widget> _sensorTiles(PlantDevice? device) {
    if (device == null) {
      return const [];
    }
    final items = ['soil', 'temp', 'humidity', 'light'];
    return items.map((key) {
      final metric = device.metrics[key];
      if (metric == null) return const SizedBox.shrink();
      final highlight = key == 'soil';
      return MetricTile(
        title: metric.label,
        value: metric.displayValue,
        unit: metric.unit,
        highlight: highlight,
      );
    }).toList();
  }

  void _showAddTodoSheet(BuildContext context) {
    final app = AppScope.of(context);
    final controller = TextEditingController();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('新增待办', style: Theme.of(sheetContext).textTheme.titleLarge),
              const SizedBox(height: 14),
              TextField(
                controller: controller,
                decoration: const InputDecoration(
                  hintText: '例如：检查土壤湿度',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final text = controller.text.trim();
                    if (text.isEmpty) return;
                    app.addTodo(
                      title: text,
                      description: '来自首页快速新增',
                      deviceId: app.selectedDevice?.id ?? '',
                    );
                    Navigator.pop(sheetContext);
                  },
                  child: const Text('保存'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _showDeviceHint(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('可以在这里扩展为设备管理页入口')),
    );
  }

  void _showControlToast(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('这里可以接你的硬件控制接口')),
    );
  }
}

class _HeaderSummary extends StatelessWidget {
  const _HeaderSummary({required this.device});

  final PlantDevice? device;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 24,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 76,
            height: 76,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFF2F7F3),
              border: Border.all(color: const Color(0xFFE7EFE8)),
            ),
            child: const Icon(Icons.local_florist, color: Color(0xFF17A76E), size: 34),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  device?.alias ?? '未选择设备',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  '${device?.plantType ?? '--'} · ${device?.location ?? '--'}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (device != null)
                      InfoChip(
                        label: '性格',
                        value: device!.personality,
                        backgroundColor: const Color(0xFFF4F8F1),
                        valueColor: const Color(0xFF4B7D4A),
                      ),
                    if (device != null && !device!.isDead)
                      InfoChip(
                        label: '好感度',
                        value: '${device!.favorability}',
                        backgroundColor: const Color(0xFFEEF6FF),
                        valueColor: const Color(0xFF2B6CB0),
                      ),
                    if (device != null && device!.isDead)
                      InfoChip(
                        label: '生命',
                        value: '已死亡',
                        backgroundColor: const Color(0xFFFFF1F1),
                        valueColor: const Color(0xFFDC2626),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroSection extends StatelessWidget {
  const _HeroSection({required this.device});

  final PlantDevice? device;

  @override
  Widget build(BuildContext context) {
    final warning = device == null
        ? '先选择一台设备开始查看'
        : device!.isDead
            ? '请优先处理当前设备状态'
            : device!.online
                ? '设备在线，状态正常'
                : '主人，设备离线了，请及时留意哦';

    return Container(
      height: 320,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 30,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(28),
              child: Image.asset(
                device?.imageAsset ?? 'assets/images/plant-default.jpg',
                fit: BoxFit.cover,
              ),
            ),
          ),
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(28),
                gradient: LinearGradient(
                  colors: [
                    Colors.white.withOpacity(0.20),
                    Colors.white.withOpacity(0.08),
                    Colors.white.withOpacity(0.24),
                  ],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
            ),
          ),
          Positioned(
            top: 18,
            right: 18,
            child: const StatusPill(
              text: '温度偏低',
              background: Color(0xFFFFF4E7),
              foreground: Color(0xFFB45309),
              icon: Icons.thermostat_outlined,
            ),
          ),
          Positioned(
            left: 18,
            right: 18,
            bottom: 18,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.96),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    warning,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.water_drop_outlined, color: Color(0xFF10B981), size: 18),
                    const SizedBox(width: 6),
                    Text(
                      '土壤 ${device?.metrics['soil']?.displayValue ?? '--'}%',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TodoCard extends StatelessWidget {
  const _TodoCard({required this.todo});

  final TodoItem todo;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return InkWell(
      onTap: () => app.toggleTodo(todo.id),
      onLongPress: () => app.toggleUrgency(todo.id),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border(
            left: BorderSide(color: todo.urgent ? const Color(0xFFF87171) : const Color(0xFF60A5FA), width: 4),
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: todo.iconBackground,
                shape: BoxShape.circle,
              ),
              child: Icon(todo.icon, color: todo.urgent ? const Color(0xFFEF4444) : const Color(0xFF2563EB)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(todo.title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(todo.description, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Icon(todo.done ? Icons.check_circle : Icons.radio_button_unchecked, color: todo.done ? const Color(0xFF10B981) : const Color(0xFFD1D5DB)),
          ],
        ),
      ),
    );
  }
}

class _EmptyHint extends StatelessWidget {
  const _EmptyHint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE5E7EB), style: BorderStyle.solid),
      ),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.active,
    required this.onTap,
  });

  final PlantDevice device;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        width: 168,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: active ? const Color(0xFF11B176) : const Color(0xFFE2E8F0), width: active ? 2 : 1),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.03),
              blurRadius: 12,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.sensors, color: Color(0xFF10B981)),
            const SizedBox(height: 12),
            Text(device.alias, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 2),
            Text(device.plantType, style: Theme.of(context).textTheme.bodySmall),
            const Spacer(),
            Text(device.location, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(
              device.online ? '在线' : '离线',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: device.online ? const Color(0xFF10B981) : const Color(0xFF64748B),
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddDeviceCard extends StatelessWidget {
  const _AddDeviceCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Container(
        width: 168,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: const Color(0xFFD7DFE8), width: 1, style: BorderStyle.solid),
        ),
        child: const Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.add, size: 34, color: Color(0xFF94A3B8)),
              SizedBox(height: 8),
              Text('管理设备', style: TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ExtraGrid extends StatelessWidget {
  const _ExtraGrid({required this.device});

  final PlantDevice? device;

  @override
  Widget build(BuildContext context) {
    if (device == null) {
      return const SizedBox.shrink();
    }
    return GridView.count(
      shrinkWrap: true,
      crossAxisCount: 2,
      childAspectRatio: 1.92,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      children: [
        _InfoBox(label: '生命状态', value: device!.lifeStateValue),
        _InfoBox(label: '灵魂状态', value: device!.soulState),
        _InfoBox(label: '植物类型', value: device!.plantType, fullWidth: true),
        _InfoBox(label: '芯片 UID', value: device!.uid),
        _InfoBox(label: '运行状态', value: device!.runState == null ? '--' : (device!.runState! ? 'ON' : 'OFF')),
        _InfoBox(label: 'DS18B20 温度', value: device!.dsbTemp == null ? '--' : '${device!.dsbTemp!.toStringAsFixed(1)} ℃'),
      ],
    );
  }
}

class _InfoBox extends StatelessWidget {
  const _InfoBox({
    required this.label,
    required this.value,
    this.fullWidth = false,
  });

  final String label;
  final String value;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontSize: fullWidth ? 16 : 15),
          ),
        ],
      ),
    );
  }
}

class _FanCard extends StatelessWidget {
  const _FanCard({
    required this.active,
    required this.pending,
    required this.onTap,
  });

  final bool active;
  final bool pending;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Row(
          children: [
            Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                color: active ? const Color(0xFFE8F9EF) : const Color(0xFFF1F5F9),
                shape: BoxShape.circle,
              ),
              child: Icon(
                active ? Icons.toys_outlined : Icons.mode_fan_off_outlined,
                color: active ? const Color(0xFF10B981) : const Color(0xFF64748B),
                size: 30,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('通风风扇', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    pending ? '指令已发送，等待设备回报' : (active ? '已开启' : '已关闭'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Switch(value: active, onChanged: (_) => onTap()),
          ],
        ),
      ),
    );
  }
}
