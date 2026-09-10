const startedAt = performance.now();
const core = await import('@earendil-works/pi-agent-core');
const coreLoadedAt = performance.now();
const ai = await import('@earendil-works/pi-ai/compat');
const allLoadedAt = performance.now();

console.log(JSON.stringify({
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  coreImportMs: Number((coreLoadedAt - startedAt).toFixed(3)),
  compatImportMs: Number((allLoadedAt - coreLoadedAt).toFixed(3)),
  totalImportMs: Number((allLoadedAt - startedAt).toFixed(3)),
  exportsPresent: {
    Agent: typeof core.Agent === 'function',
    streamSimple: typeof ai.streamSimple === 'function',
    registerFauxProvider: typeof ai.registerFauxProvider === 'function'
  }
}, null, 2));
