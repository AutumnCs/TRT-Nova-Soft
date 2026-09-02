import 'package:flutter/material.dart';

ThemeData buildAppTheme() {
  const seed = Color(0xFF13A86A);
  final scheme = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: Brightness.light,
    surface: const Color(0xFFF8FAF8),
  );

  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: const Color(0xFFF3F5F7),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      centerTitle: true,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: const Color(0xFFDDF5E8),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        return IconThemeData(
          color: states.contains(WidgetState.selected) ? seed : const Color(0xFF9AA4B2),
        );
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        return TextStyle(
          color: states.contains(WidgetState.selected) ? seed : const Color(0xFF9AA4B2),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        );
      }),
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: Color(0xFF16202A)),
      headlineMedium: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF16202A)),
      titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF16202A)),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF16202A)),
      bodyLarge: TextStyle(fontSize: 14, height: 1.45, color: Color(0xFF334155)),
      bodyMedium: TextStyle(fontSize: 13, height: 1.45, color: Color(0xFF516170)),
      bodySmall: TextStyle(fontSize: 12, height: 1.4, color: Color(0xFF718096)),
    ),
  );
}
