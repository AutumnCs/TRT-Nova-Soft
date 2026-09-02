import 'package:flutter/material.dart';

import 'mock_data.dart';
import 'models.dart';

class AppController extends ChangeNotifier {
  AppController()
      : _library = demoPlants(),
        _devices = demoDevices(),
        _todos = demoTodos(),
        _messages = demoMessages() {
    _selectedDeviceId = _devices.first.id;
    _journalByDeviceId = {
      for (final device in _devices) device.id: <JournalEntry>[
        JournalEntry(
          id: '${device.id}-journal-1',
          deviceId: device.id,
          date: DateTime(2026, 5, 21, 18, 20),
          type: 'watering',
          title: '浇水记录',
          content: '晚间根据土壤状态进行了补水。',
        ),
        JournalEntry(
          id: '${device.id}-journal-2',
          deviceId: device.id,
          date: DateTime(2026, 5, 22, 8, 40),
          type: 'note',
          title: '状态备注',
          content: '今天叶片状态看起来更稳一些。',
        ),
      ],
    };
  }

  bool loggedIn = true;
  int currentTab = 0;
  String _selectedDeviceId = '';
  String _libraryCategory = '全部';
  String _libraryQuery = '';

  late final List<PlantDevice> _devices;
  late final List<PlantLibraryItem> _library;
  late final List<TodoItem> _todos;
  late final List<ChatMessage> _messages;
  late final Map<String, List<JournalEntry>> _journalByDeviceId;

  List<PlantDevice> get devices => List.unmodifiable(_devices);
  List<PlantLibraryItem> get library => List.unmodifiable(_library);
  List<TodoItem> get todos => List.unmodifiable(_todos);
  List<ChatMessage> get messages => List.unmodifiable(_messages);
  String get libraryCategory => _libraryCategory;
  String get libraryQuery => _libraryQuery;

  PlantDevice? get selectedDevice {
    try {
      return _devices.firstWhere((item) => item.id == _selectedDeviceId);
    } catch (_) {
      return _devices.isEmpty ? null : _devices.first;
    }
  }

  List<PlantLibraryItem> get filteredLibrary {
    final query = _libraryQuery.trim().toLowerCase();
    return _library.where((item) {
      final categoryHit = _libraryCategory == '全部' || item.category == _libraryCategory;
      final queryHit = query.isEmpty ||
          item.name.toLowerCase().contains(query) ||
          item.scientificName.toLowerCase().contains(query) ||
          item.tags.any((tag) => tag.toLowerCase().contains(query));
      return categoryHit && queryHit;
    }).toList(growable: false);
  }

  List<String> get libraryCategories {
    final categories = <String>{'全部'};
    for (final item in _library) {
      categories.add(item.category);
    }
    return categories.toList(growable: false);
  }

  List<TodoItem> get todosForSelectedDevice {
    final deviceId = _selectedDeviceId;
    return _todos.where((todo) {
      if (todo.deviceId.isEmpty) return true;
      return todo.deviceId == deviceId;
    }).toList(growable: false);
  }

  List<JournalEntry> journalEntriesForDevice(String deviceId) {
    final list = _journalByDeviceId[deviceId] ?? const <JournalEntry>[];
    final cloned = List<JournalEntry>.from(list);
    cloned.sort((a, b) => b.date.compareTo(a.date));
    return cloned;
  }

  List<JournalEntry> journalEntriesForDay(String deviceId, DateTime day) {
    final entries = journalEntriesForDevice(deviceId);
    return entries.where((entry) => _sameDay(entry.date, day)).toList(growable: false);
  }

  List<JournalEntry> journalEntriesForMonth(String deviceId, DateTime month) {
    final entries = journalEntriesForDevice(deviceId);
    return entries
        .where((entry) => entry.date.year == month.year && entry.date.month == month.month)
        .toList(growable: false);
  }

  void loginDemo() {
    loggedIn = true;
    notifyListeners();
  }

  void logout() {
    loggedIn = false;
    notifyListeners();
  }

  void setTab(int index) {
    currentTab = index;
    notifyListeners();
  }

  void selectDevice(String deviceId) {
    if (_selectedDeviceId == deviceId) return;
    _selectedDeviceId = deviceId;
    notifyListeners();
  }

  void updateSelectedDevice({
    String? alias,
    String? plantType,
    String? location,
  }) {
    final device = selectedDevice;
    if (device == null) return;
    final index = _devices.indexWhere((item) => item.id == device.id);
    if (index < 0) return;
    _devices[index] = device.copyWith(
      alias: alias,
      plantType: plantType,
      location: location,
      updatedAt: DateTime.now(),
    );
    notifyListeners();
  }

  void toggleFavorite(String plantId) {
    final index = _library.indexWhere((item) => item.id == plantId);
    if (index < 0) return;
    _library[index] = _library[index].copyWith(isFavorite: !_library[index].isFavorite);
    notifyListeners();
  }

  void setLibraryQuery(String query) {
    _libraryQuery = query;
    notifyListeners();
  }

  void setLibraryCategory(String category) {
    _libraryCategory = category;
    notifyListeners();
  }

  void toggleTodo(String todoId) {
    final index = _todos.indexWhere((item) => item.id == todoId);
    if (index < 0) return;
    _todos[index] = _todos[index].copyWith(done: !_todos[index].done);
    if (_todos[index].done && _todos[index].deviceId.isNotEmpty) {
      addJournalEntry(
        deviceId: _todos[index].deviceId,
        type: 'todoDone',
        title: '完成待办',
        content: _todos[index].title,
        date: DateTime.now(),
      );
    }
    notifyListeners();
  }

  void toggleUrgency(String todoId) {
    final index = _todos.indexWhere((item) => item.id == todoId);
    if (index < 0) return;
    _todos[index] = _todos[index].copyWith(urgent: !_todos[index].urgent);
    notifyListeners();
  }

  void addTodo({
    required String title,
    required String description,
    required String deviceId,
    bool urgent = false,
  }) {
    _todos.insert(
      0,
      TodoItem(
        id: 'todo-${DateTime.now().millisecondsSinceEpoch}',
        deviceId: deviceId,
        title: title,
        description: description,
        urgent: urgent,
        icon: Icons.task_alt_outlined,
        iconBackground: const Color(0xFFE8F9EF),
      ),
    );
    notifyListeners();
  }

  void addJournalEntry({
    required String deviceId,
    required String type,
    required String title,
    required String content,
    required DateTime date,
  }) {
    final list = _journalByDeviceId.putIfAbsent(deviceId, () => <JournalEntry>[]);
    list.insert(
      0,
      JournalEntry(
        id: 'journal-${DateTime.now().millisecondsSinceEpoch}',
        deviceId: deviceId,
        date: date,
        type: type,
        title: title,
        content: content,
      ),
    );
    notifyListeners();
  }

  void addAssistantMessage(String text) {
    _messages.add(
      ChatMessage(
        id: 'msg-${DateTime.now().millisecondsSinceEpoch}',
        text: text,
        isUser: true,
        time: DateTime.now(),
      ),
    );
    _messages.add(
      ChatMessage(
        id: 'msg-${DateTime.now().microsecondsSinceEpoch}',
        text: _assistantReplyFor(text),
        isUser: false,
        time: DateTime.now(),
      ),
    );
    notifyListeners();
  }

  String _assistantReplyFor(String text) {
    final lower = text.trim().toLowerCase();
    if (lower.contains('浇水')) {
      return '如果你现在看的是当前设备，我会先结合土壤湿度和最近趋势再给你建议。';
    }
    if (lower.contains('状态') || lower.contains('怎么样')) {
      return '我会优先结合实时数据、设备状态和历史趋势来回答。';
    }
    if (lower.contains('光照')) {
      return '光照这件事要看植物类型，不同植物的舒适区间差别很大。';
    }
    return '收到，我会按当前设备上下文继续帮你看。';
  }

  static bool _sameDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }
}

class AppScope extends InheritedNotifier<AppController> {
  const AppScope({
    super.key,
    required AppController controller,
    required Widget child,
  }) : super(notifier: controller, child: child);

  static AppController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope not found in context');
    return scope!.notifier!;
  }
}
