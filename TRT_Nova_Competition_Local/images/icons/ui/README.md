# 图标来源

这些图标来自 Lucide 官方仓库的 icons 目录（2026-09-07，main）。
https://github.com/lucide-icons/lucide

沿用项目已有的 Lucide 图标系列与 ISC / Feather MIT 许可，许可全文见上游 LICENSE。
只固定描边颜色以适配小程序 image；路径形状未修改。

相邻 function-tokens/*.png 由 scripts/render-function-tokens.cjs 将已有 Lucide plug.svg 与中文功能名作构建期文本排版生成。它们是 editor 的原子行内 UI，不是用户附件；只有功能白名单键传给后端。修改名称后重新生成，原生 insertImage 的 width/height 不可丢失。
