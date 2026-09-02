export function renderDevicesPage(container, devices = []) {
  container.innerHTML = `<h2>设备</h2><p>当前设备 ${devices.length} 台。</p>`;
}
