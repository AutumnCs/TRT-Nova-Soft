const CloudAdapter = require('./core/CloudAdapter');

// Keep a singleton adapter. Connection is established lazily inside CloudAdapter.
const adapter = new CloudAdapter();

module.exports = adapter;
