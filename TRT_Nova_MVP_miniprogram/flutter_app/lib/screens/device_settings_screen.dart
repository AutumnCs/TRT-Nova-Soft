import 'package:flutter/material.dart';

import '../app_state.dart';

class DeviceSettingsScreen extends StatefulWidget {
  const DeviceSettingsScreen({super.key, required this.deviceId});

  final String deviceId;

  @override
  State<DeviceSettingsScreen> createState() => _DeviceSettingsScreenState();
}

class _DeviceSettingsScreenState extends State<DeviceSettingsScreen> {
  final TextEditingController _aliasController = TextEditingController();
  final TextEditingController _plantTypeController = TextEditingController();
  final TextEditingController _locationController = TextEditingController();
  bool _initialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    final app = AppScope.of(context);
    final device = app.devices.firstWhere((item) => item.id == widget.deviceId, orElse: () => app.selectedDevice!);
    _aliasController.text = device.alias;
    _plantTypeController.text = device.plantType;
    _locationController.text = device.location;
    _initialized = true;
  }

  @override
  void dispose() {
    _aliasController.dispose();
    _plantTypeController.dispose();
    _locationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('设备设置')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _aliasController,
            decoration: const InputDecoration(
              labelText: '设备别名',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _plantTypeController,
            decoration: const InputDecoration(
              labelText: '植物种类',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _locationController,
            decoration: const InputDecoration(
              labelText: '种植地点',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 50,
            child: FilledButton(
              onPressed: () {
                app.updateSelectedDevice(
                  alias: _aliasController.text.trim(),
                  plantType: _plantTypeController.text.trim(),
                  location: _locationController.text.trim(),
                );
                Navigator.pop(context);
              },
              child: const Text('保存'),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('这里可以继续接解绑接口')),
              );
            },
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
            child: const Text('解绑设备'),
          ),
        ],
      ),
    );
  }
}
