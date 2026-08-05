export class FakeKV {
  constructor(initial = {}, { cursorMode = "key" } = {}) {
    this.values = new Map(Object.entries(initial));
    this.getCalls = 0;
    this.listCalls = 0;
    this.putCalls = 0;
    this.deleteCalls = 0;
    this.cursorMode = cursorMode;
  }

  async put(key, value) {
    this.putCalls += 1;
    this.#assertKey(key);
    if (typeof value === "string") {
      this.values.set(key, value);
      return;
    }
    if (value instanceof ArrayBuffer) {
      this.values.set(key, new TextDecoder().decode(value));
      return;
    }
    if (ArrayBuffer.isView(value)) {
      this.values.set(
        key,
        new TextDecoder().decode(
          value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
        ),
      );
      return;
    }
    throw new TypeError("FakeKV only accepts serializable test values");
  }

  async get(key, options) {
    this.getCalls += 1;
    this.#assertKey(key);
    const value = this.values.get(key);
    if (value == null) return null;
    const type = typeof options === "string" ? options : options?.type || "text";
    if (type === "json") return JSON.parse(value);
    if (type === "arrayBuffer") return new TextEncoder().encode(value).buffer;
    if (type === "stream") {
      return new Blob([value]).stream();
    }
    return value;
  }

  async delete(key) {
    this.deleteCalls += 1;
    this.#assertKey(key);
    this.values.delete(key);
  }

  async list({ prefix = "", limit = 256, cursor = "" } = {}) {
    this.listCalls += 1;
    const allKeys = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const safeLimit = Math.min(256, Math.max(1, limit));
    const offset = this.cursorMode === "offset"
      ? Math.max(0, Number.parseInt(cursor || "0", 10) || 0)
      : 0;
    const keys = this.cursorMode === "offset"
      ? allKeys
      : allKeys.filter((key) => !cursor || key >= cursor);
    const page = keys.slice(offset, offset + safeLimit);
    const complete = offset + page.length >= keys.length;
    return {
      complete,
      cursor: complete
        ? null
        : this.cursorMode === "offset"
          ? String(offset + page.length)
          : keys[page.length],
      keys: page.map((key) => ({ key })),
    };
  }

  #assertKey(key) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_]+$/.test(key)) {
      throw new Error(`invalid Makers KV key: ${key}`);
    }
    if (new TextEncoder().encode(key).byteLength > 512) {
      throw new Error("Makers KV key is too long");
    }
  }
}
