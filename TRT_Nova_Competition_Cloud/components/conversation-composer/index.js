const { readDocument, normalizeDocument, mapSelection } = require('./document');
const call = (context, name, options = {}) => new Promise((resolve, reject) => context[name]({ ...options, success: resolve, fail: reject }));
Component({
  properties: { value: { type: String, value: '' }, functionItem: { type: Object, value: null }, disabled: Boolean, scopeKey: String },
  data: { blocks: [], changing: false },
  observers: {
    'value, functionItem, scopeKey'() { this.scheduleSync(); }
  },
  lifetimes: {
    attached() { this._registry = {}; this._lastText = ''; this._lastKey = ''; this._cursor = 0; this._scope = this.properties.scopeKey; },
    detached() { this._detached = true; this._editor = null; }
  },
  methods: {
    onEditorReady() {
      this.createSelectorQuery().select('#document-editor').context(result => {
        if (this._detached) return;
        this._editor = result.context;
        this.scheduleSync();
      }).exec();
    },
    scheduleSync() {
      if (!this._editor || this._detached) return;
      if (!this._syncPromise && this._scope === this.properties.scopeKey && this.properties.value === this._lastText
        && (this.properties.functionItem?.key || '') === this._lastKey) return;
      this._revision = (this._revision || 0) + 1;
      if (this._syncPromise) return;
      this._syncPromise = Promise.resolve().then(async () => {
        this.setData({ changing: true }); this.triggerEvent('busy', { value: true });
        let seen;
        do {
          seen = this._revision;
          await this.syncDocument();
        } while (!this._detached && seen !== this._revision);
      }).catch(error => {
        if (!this._detached) { this.triggerEvent('editorerror', { message: error.errMsg || error.message || '输入框暂未就绪，请重试' }); }
      }).finally(() => {
        this._syncPromise = null;
        if (!this._detached) { this.setData({ changing: false }); this.triggerEvent('busy', { value: false }); }
      });
    },
    async syncDocument() {
      const editor = this._editor;
      if (!editor) return;
      const text = String(this.properties.value || '').slice(0, 300);
      const option = this.properties.functionItem;
      const key = option?.key || '';
      const scopeChanged = this._scope !== this.properties.scopeKey;
      if (!scopeChanged && text === this._lastText && key === this._lastKey) return;
      let content = await call(editor, 'getContents');
      let state = readDocument(content.delta, this._registry);
      // Never replay a block or old undo history into a different conversation/account.
      if (scopeChanged || text !== this._lastText) {
        await call(editor, 'setContents', { delta: { ops: [{ insert: text + '\n' }] } });
        state = { blockId: '', blockIndex: -1 };
        this._cursor = text.length;
        this._scope = this.properties.scopeKey;
        this._registry = {};
        this.setData({ blocks: [] });
      }
      if (state.blockId && (state.functionKey !== key || !key)) {
        await call(editor, 'deleteText', { index: state.blockIndex, length: 1 });
        this._cursor = Math.max(0, this._cursor - (state.blockIndex < this._cursor ? 1 : 0));
        state.blockId = '';
      }
      if (key && !state.blockId) {
        if (typeof editor.setSelection !== 'function') throw new Error('请更新微信后使用内联功能；普通文字仍可发送');
        await call(editor, 'setSelection', { index: Math.min(text.length, this._cursor), length: 0 });
        const base64 = wx.getFileSystemManager().readFileSync('/images/icons/function-tokens/' + key + '.png', 'base64');
        const src = 'data:image/png;base64,' + base64;
        this._registry[src] = { key, label: option.label };
        const scale = wx.getWindowInfo().windowWidth / 750;
        await call(editor, 'insertImage', { src, nowrap: true, width: Math.round(180 * scale) + 'px', height: Math.round(38 * scale) + 'px', alt: option.label });
        if (this._detached) return;
        this.setData({ blocks: [{ key, label: option.label }] });
        this._cursor += 1;
      }
      this._lastText = text; this._lastKey = key;
    },
    async rememberSelection() {
      if (!this._editor || this.data.changing) return;
      try { const result = await call(this._editor, 'getSelection'); if (result.range) this._cursor = result.range.index; } catch {}
    },
    async onEditorInput(event) {
      if (this.data.changing || this._detached) return;
      try { await this.consumeDocument(event.detail.delta); this.rememberSelection(); }
      catch (error) { if (!this._detached) this.triggerEvent('editorerror', { message: '输入整理失败，请检查草稿后重试' }); }
    },
    async consumeDocument(delta) {
      if (this._detached) return;
      const revision = this._inputRevision = (this._inputRevision || 0) + 1;
      const normalized = normalizeDocument(delta, this._registry);
      // Typing/backspace belong to the native editor: project state only. A full
      // write for harmless Delta serialization differences resets its caret.
      if (normalized.changed) {
        const editor = this._editor;
        const scope = this.properties.scopeKey;
        const selection = await call(editor, 'getSelection');
        if (this._detached || revision !== this._inputRevision || scope !== this.properties.scopeKey) return;
        await call(editor, 'setContents', { delta: normalized.delta });
        if (this._detached || scope !== this.properties.scopeKey) return;
        if (selection.range) await call(editor, 'setSelection', mapSelection(selection.range, normalized));
      }
      if (this._detached) return;
      const state = readDocument(normalized.delta, this._registry);
      this._lastText = state.text; this._lastKey = state.functionKey;
      this.triggerEvent('change', { value: state.text, functionKey: state.functionKey });
    },
    async flush() {
      if (this._syncPromise) await this._syncPromise;
      if (!this._editor) throw new Error('输入框正在准备，请稍后再发');
      const content = await call(this._editor, 'getContents');
      await this.consumeDocument(content.delta);
    }
  }
});
