// Delta is the editor's document. Only blocks created from our function picker
// may become tool metadata; pasted HTML, labels and unknown embeds never do.
const limit = 300;
function blockKey(insert, registry) {
  if (!insert || typeof insert !== 'object') return '';
  const id = insert.image;
  return typeof id === 'string' && registry[id] ? id : '';
}
function readDocument(delta, registry = {}) {
  let text = '';
  let functionKey = '';
  let blockId = '';
  let index = 0;
  let blockIndex = -1;
  for (const op of delta?.ops || []) {
    if (typeof op.insert === 'string') { text += op.insert; index += op.insert.length; }
    else {
      const id = blockKey(op.insert, registry);
      if (id && !blockId) { blockId = id; functionKey = registry[id].key; blockIndex = index; }
      index += 1;
    }
  }
  return { text: text.replace(/\n$/, ''), functionKey, blockId, blockIndex };
}
function normalizeDocument(delta, registry = {}) {
  const ops = [];
  const removals = [];
  let remaining = limit;
  let keptBlock = false;
  let changed = false;
  let index = 0;
  const source = delta?.ops || [];
  for (let i = 0; i < source.length; i++) {
    const op = source[i];
    if (typeof op.insert === 'string') {
      // Quill's final newline is structural, not one of the user's 300 characters.
      const terminal = i === source.length - 1 && op.insert.endsWith('\n') ? '\n' : '';
      const body = terminal ? op.insert.slice(0, -1) : op.insert;
      const kept = body.slice(0, remaining);
      const text = kept + terminal;
      const styled = Object.keys(op.attributes || {}).length > 0;
      if (kept.length < body.length) removals.push({ index: index + kept.length, length: body.length - kept.length });
      if (text !== op.insert || styled) changed = true;
      if (text) ops.push(text === op.insert && !styled ? op : { insert: text });
      remaining -= kept.length;
      index += op.insert.length;
    } else if (!keptBlock && blockKey(op.insert, registry)) {
      // Keep native metadata/property order intact. Serialization is not equality.
      ops.push(op); keptBlock = true; index += 1;
    } else {
      removals.push({ index, length: 1 }); index += 1; changed = true;
    }
  }
  if (!ops.length || typeof ops.at(-1).insert !== 'string' || !ops.at(-1).insert.endsWith('\n')) {
    ops.push({ insert: '\n' }); changed = true;
  }
  return { delta: changed ? { ops } : delta, changed, removals };
}
function sanitizeDocument(delta, registry = {}) { return normalizeDocument(delta, registry).delta; }
function mapSelection(range, normalized) {
  const end = normalized.delta.ops.reduce((sum, op) => sum + (typeof op.insert === 'string' ? op.insert.length : 1), 0) - 1;
  const map = position => Math.max(0, Math.min(end, position - normalized.removals.reduce((sum, cut) =>
    sum + Math.max(0, Math.min(cut.length, position - cut.index)), 0)));
  const index = map(range.index);
  return { index, length: map(range.index + (range.length || 0)) - index };
}
module.exports = { readDocument, sanitizeDocument, normalizeDocument, mapSelection, blockKey, limit };
