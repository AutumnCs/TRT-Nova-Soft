import 'package:flutter/material.dart';

import 'app_state.dart';
import 'screens/login_screen.dart';
import 'screens/root_shell.dart';
import 'theme/app_theme.dart';

class TrtNovaApp extends StatelessWidget {
  const TrtNovaApp({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = AppController();
    return AppScope(
      controller: controller,
      child: AnimatedBuilder(
        animation: controller,
        builder: (context, _) {
          return MaterialApp(
            debugShowCheckedModeBanner: false,
            title: 'TRT Nova',
            theme: buildAppTheme(),
            home: controller.loggedIn ? const RootShell() : const LoginScreen(),
          );
        },
      ),
    );
  }
}
