# history-cleanup-scf

用于定时清理 MySQL 中超过保留期限的历史数据。

## 推荐触发方式

- 腾讯云 SCF 定时触发器
- 每天执行 1 次

## 入口

- `index.main_handler`

## 默认保留策略

- `device_history_raw`: 7 天
- `device_history_agg` `5m`: 7 天
- `device_history_agg` `1h`: 30 天
- `device_history_agg` `1d`: 365 天
