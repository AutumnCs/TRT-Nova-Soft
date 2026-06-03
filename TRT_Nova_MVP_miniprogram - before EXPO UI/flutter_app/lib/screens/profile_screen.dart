import 'package:flutter/material.dart';

import '../app_state.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return AnimatedBuilder(
      animation: app,
      builder: (context, _) {
        final deviceCount = app.devices.length;
        final favoriteCount = app.library.where((item) => item.isFavorite).length;
        return SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              Text('我的', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 34,
                      backgroundColor: Color(0xFFEFF7F1),
                      child: Icon(Icons.person, color: Color(0xFF16A76E)),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('TRT 账号', style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 4),
                          Text('138****1234', style: Theme.of(context).textTheme.bodyMedium),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _StatCard(title: '我的设备', value: '$deviceCount'),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _StatCard(title: '收藏植物', value: '$favoriteCount'),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _MenuCard(
                title: '设备管理',
                icon: Icons.developer_board_outlined,
                onTap: () {},
              ),
              const SizedBox(height: 12),
              _MenuCard(
                title: '收藏植物',
                icon: Icons.bookmark_border,
                onTap: () {},
              ),
              const SizedBox(height: 12),
              _MenuCard(
                title: '关于我们',
                icon: Icons.info_outline,
                onTap: () {},
              ),
              const SizedBox(height: 12),
              _MenuCard(
                title: '资料编辑',
                icon: Icons.edit_outlined,
                onTap: () {},
              ),
              const SizedBox(height: 18),
              OutlinedButton.icon(
                onPressed: app.logout,
                icon: const Icon(Icons.logout),
                label: const Text('退出登录'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(50),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.title, required this.value});

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 6),
          Text(title, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({
    required this.title,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
        ),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF16A76E)),
            const SizedBox(width: 14),
            Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium)),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}
