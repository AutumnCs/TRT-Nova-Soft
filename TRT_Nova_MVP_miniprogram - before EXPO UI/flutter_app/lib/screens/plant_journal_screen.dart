import 'package:flutter/material.dart';

import '../app_state.dart';
import '../models.dart';
import '../widgets.dart';

class PlantJournalScreen extends StatefulWidget {
  const PlantJournalScreen({super.key, required this.deviceId});

  final String deviceId;

  @override
  State<PlantJournalScreen> createState() => _PlantJournalScreenState();
}

class _PlantJournalScreenState extends State<PlantJournalScreen> {
  late DateTime _focusedMonth;
  late DateTime _selectedDay;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _focusedMonth = DateTime(now.year, now.month);
    _selectedDay = DateTime(now.year, now.month, now.day);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return AnimatedBuilder(
      animation: app,
      builder: (context, _) {
        final device = app.devices.firstWhere((item) => item.id == widget.deviceId, orElse: () => app.selectedDevice!);
        final monthEntries = app.journalEntriesForMonth(widget.deviceId, _focusedMonth);
        final selectedEntries = app.journalEntriesForDay(widget.deviceId, _selectedDay);
        return Scaffold(
          appBar: AppBar(title: const Text('植物成长日历')),
          floatingActionButton: FloatingActionButton(
            onPressed: () => _showAddEntrySheet(context, device.id),
            child: const Icon(Icons.add),
          ),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(22)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(device.alias, style: Theme.of(context).textTheme.headlineMedium),
                    const SizedBox(height: 4),
                    Text('${device.plantType} · ${device.location}', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        IconButton(
                          onPressed: () => setState(() => _focusedMonth = DateTime(_focusedMonth.year, _focusedMonth.month - 1)),
                          icon: const Icon(Icons.chevron_left),
                        ),
                        Text('${_focusedMonth.year}年${_focusedMonth.month}月', style: Theme.of(context).textTheme.titleMedium),
                        IconButton(
                          onPressed: () => setState(() => _focusedMonth = DateTime(_focusedMonth.year, _focusedMonth.month + 1)),
                          icon: const Icon(Icons.chevron_right),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    _CalendarGrid(
                      month: _focusedMonth,
                      selectedDay: _selectedDay,
                      entries: monthEntries,
                      onSelected: (day) => setState(() => _selectedDay = day),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SectionHeader(
                title: '当天记录',
                subtitle: formatDate(_selectedDay),
                action: TextButton(
                  onPressed: () {},
                  child: const Text('查看设备趋势'),
                ),
              ),
              const SizedBox(height: 12),
              if (selectedEntries.isEmpty)
                const _EmptyState(text: '这一天还没有记录，点右下角 + 记一条吧。')
              else
                ...selectedEntries.map((entry) => _JournalCard(entry: entry)),
            ],
          ),
        );
      },
    );
  }

  void _showAddEntrySheet(BuildContext context, String deviceId) {
    final app = AppScope.of(context);
    final titleController = TextEditingController();
    final contentController = TextEditingController();
    String type = 'note';
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
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
                  Text('新增记录', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    value: type,
                    items: const [
                      DropdownMenuItem(value: 'watering', child: Text('浇水')),
                      DropdownMenuItem(value: 'fertilizing', child: Text('施肥')),
                      DropdownMenuItem(value: 'pruning', child: Text('修剪')),
                      DropdownMenuItem(value: 'relocation', child: Text('调整位置')),
                      DropdownMenuItem(value: 'note', child: Text('备注')),
                      DropdownMenuItem(value: 'photo', child: Text('照片')),
                      DropdownMenuItem(value: 'todo_done', child: Text('完成待办')),
                    ],
                    onChanged: (value) => setSheetState(() => type = value ?? 'note'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: titleController,
                    decoration: const InputDecoration(labelText: '标题', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: contentController,
                    maxLines: 3,
                    decoration: const InputDecoration(labelText: '内容', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        final title = titleController.text.trim().isEmpty ? '成长记录' : titleController.text.trim();
                        app.addJournalEntry(
                          deviceId: deviceId,
                          type: type,
                          title: title,
                          content: contentController.text.trim(),
                          date: _selectedDay,
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
      },
    );
  }
}

class _CalendarGrid extends StatelessWidget {
  const _CalendarGrid({
    required this.month,
    required this.selectedDay,
    required this.entries,
    required this.onSelected,
  });

  final DateTime month;
  final DateTime selectedDay;
  final List<JournalEntry> entries;
  final ValueChanged<DateTime> onSelected;

  @override
  Widget build(BuildContext context) {
    final firstDay = DateTime(month.year, month.month, 1);
    final startOffset = (firstDay.weekday + 6) % 7;
    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
    final totalCells = ((startOffset + daysInMonth) / 7).ceil() * 7;
    final entriesDays = entries.map((entry) => DateTime(entry.date.year, entry.date.month, entry.date.day)).toSet();

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: totalCells,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 7,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 1,
      ),
      itemBuilder: (context, index) {
        final dayIndex = index - startOffset + 1;
        if (dayIndex < 1 || dayIndex > daysInMonth) {
          return const SizedBox.shrink();
        }
        final currentDay = DateTime(month.year, month.month, dayIndex);
        final selected = _sameDay(currentDay, selectedDay);
        final hasEntry = entriesDays.contains(currentDay);
        return GestureDetector(
          onTap: () => onSelected(currentDay),
          child: Container(
            decoration: BoxDecoration(
              color: selected ? const Color(0xFFDDF5E8) : const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: hasEntry ? const Color(0xFF16A76E) : Colors.transparent),
            ),
            child: Stack(
              children: [
                Center(child: Text('$dayIndex', style: const TextStyle(fontWeight: FontWeight.w700))),
                if (hasEntry)
                  const Positioned(
                    bottom: 6,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: Icon(Icons.circle, size: 8, color: Color(0xFF16A76E)),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;
}

class _JournalCard extends StatelessWidget {
  const _JournalCard({required this.entry});

  final JournalEntry entry;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _IconBox(type: entry.type),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(entry.title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 2),
                    Text(formatClock(entry.date), style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          if (entry.content.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(entry.content, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ],
      ),
    );
  }
}

class _IconBox extends StatelessWidget {
  const _IconBox({required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (type) {
      'watering' => (Icons.water_drop_outlined, const Color(0xFFEAF4FF)),
      'fertilizing' => (Icons.eco_outlined, const Color(0xFFF0F9F5)),
      'pruning' => (Icons.content_cut_outlined, const Color(0xFFFFF4E5)),
      'relocation' => (Icons.place_outlined, const Color(0xFFF2F0FF)),
      'photo' => (Icons.photo_camera_outlined, const Color(0xFFF1F5F9)),
      'todo_done' => (Icons.task_alt_outlined, const Color(0xFFDDF5E8)),
      _ => (Icons.edit_outlined, const Color(0xFFF1F5F9)),
    };
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: Icon(icon, color: const Color(0xFF2563EB), size: 20),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}
