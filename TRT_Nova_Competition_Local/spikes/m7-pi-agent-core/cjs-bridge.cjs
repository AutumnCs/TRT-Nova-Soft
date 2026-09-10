'use strict';

// agent-scf remains CommonJS. Cache one ESM module promise at process scope so a
// warm SCF instance does not repeat module loading for every request.
const piAgentCoreModule = import('@earendil-works/pi-agent-core');

async function loadPiAgentCore() {
  return piAgentCoreModule;
}

module.exports = { loadPiAgentCore };
