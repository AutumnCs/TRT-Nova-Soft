let appPromise;

function loadApp() {
  appPromise ||= import('./lib/app.js');
  return appPromise;
}

exports.main_handler = async function main_handler(event = {}, context = {}) {
  const app = await loadApp();
  return app.main_handler(event, context);
};
