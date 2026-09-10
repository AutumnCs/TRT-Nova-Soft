function normalizePagePath(value = '') {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function getCurrentPagePath(pages = []) {
  const current = Array.isArray(pages) ? pages[pages.length - 1] : null;
  return normalizePagePath(current?.route || '');
}

function resolveTabSelection(list = [], pagePath = '') {
  const normalizedPath = normalizePagePath(pagePath);
  const selected = (Array.isArray(list) ? list : []).findIndex(
    (item) => normalizePagePath(item?.pagePath) === normalizedPath
  );
  return selected >= 0 ? selected : 0;
}

function canStartTabSwitch({ switching = false, currentPath = '', targetPath = '' } = {}) {
  const normalizedTarget = normalizePagePath(targetPath);
  if (!normalizedTarget || switching) return false;
  return normalizePagePath(currentPath) !== normalizedTarget;
}

module.exports = {
  normalizePagePath,
  getCurrentPagePath,
  resolveTabSelection,
  canStartTabSwitch
};
