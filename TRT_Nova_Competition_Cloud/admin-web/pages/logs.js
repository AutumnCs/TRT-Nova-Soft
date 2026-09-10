export function renderLogsPage(container, logs = []) {
  container.innerHTML = `<h2>日志</h2><p>当前日志 ${logs.length} 条。</p>`;
}
