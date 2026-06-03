import 'package:flutter_test/flutter_test.dart';

import 'package:trt_nova_app/app.dart';

void main() {
  testWidgets('renders the app shell', (WidgetTester tester) async {
    await tester.pumpWidget(const TrtNovaApp());

    expect(find.text('首页'), findsWidgets);
    expect(find.text('助手'), findsWidgets);
    expect(find.text('植物库'), findsWidgets);
    expect(find.text('我的'), findsWidgets);
  });
}
