export function renderUsersPage(container, users = []) {
  container.innerHTML = `<h2>用户</h2><p>当前用户 ${users.length} 位。</p>`;
}
