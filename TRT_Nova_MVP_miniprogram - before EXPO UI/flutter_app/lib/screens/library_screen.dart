import 'package:flutter/material.dart';

import '../app_state.dart';
import '../models.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return AnimatedBuilder(
      animation: app,
      builder: (context, _) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('植物库', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 4),
                Text('搜索、收藏和查看植物详情', style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 14),
                TextField(
                  onChanged: app.setLibraryQuery,
                  decoration: InputDecoration(
                    hintText: '搜索植物名称、学名或标签',
                    prefixIcon: const Icon(Icons.search),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 42,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: app.libraryCategories.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (context, index) {
                      final category = app.libraryCategories[index];
                      final selected = category == app.libraryCategory;
                      return ChoiceChip(
                        label: Text(category),
                        selected: selected,
                        onSelected: (_) => app.setLibraryCategory(category),
                        selectedColor: const Color(0xFFDDF5E8),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 14),
                Expanded(
                  child: GridView.builder(
                    itemCount: app.filteredLibrary.length,
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 0.74,
                    ),
                    itemBuilder: (context, index) {
                      final item = app.filteredLibrary[index];
                      return _PlantCard(
                        item: item,
                        onTap: () => _showPlantDetail(context, item),
                        onFavoriteTap: () => app.toggleFavorite(item.id),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showPlantDetail(BuildContext context, PlantLibraryItem item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Image.asset(item.imageAsset, height: 180, width: double.infinity, fit: BoxFit.cover),
              ),
              const SizedBox(height: 16),
              Text(item.name, style: Theme.of(sheetContext).textTheme.headlineMedium),
              const SizedBox(height: 4),
              Text('${item.scientificName} · ${item.category}', style: Theme.of(sheetContext).textTheme.bodySmall),
              const SizedBox(height: 12),
              Text(item.description, style: Theme.of(sheetContext).textTheme.bodyMedium),
            ],
          ),
        );
      },
    );
  }
}

class _PlantCard extends StatelessWidget {
  const _PlantCard({
    required this.item,
    required this.onTap,
    required this.onFavoriteTap,
  });

  final PlantLibraryItem item;
  final VoidCallback onTap;
  final VoidCallback onFavoriteTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 18,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
                  child: Image.asset(item.imageAsset, height: 150, width: double.infinity, fit: BoxFit.cover),
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child: GestureDetector(
                    onTap: onFavoriteTap,
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 8, offset: const Offset(0, 4)),
                        ],
                      ),
                      child: Icon(
                        item.isFavorite ? Icons.favorite : Icons.favorite_border,
                        size: 18,
                        color: item.isFavorite ? const Color(0xFFEF4444) : const Color(0xFF94A3B8),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(item.category, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: item.tags
                        .take(2)
                        .map(
                          (tag) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF2F8F3),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(tag, style: const TextStyle(fontSize: 11, color: Color(0xFF2F6F4E))),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
