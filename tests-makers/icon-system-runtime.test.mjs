import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

function node(tagName = "span") {
  const value = {
    tagName,
    children: [],
    events: {},
    className: "",
    classList: {
      values: new Set(),
      add(...names) {
        names.forEach((name) => this.values.add(name));
      },
      remove(...names) {
        names.forEach((name) => this.values.delete(name));
      },
      contains(name) {
        return this.values.has(name);
      },
    },
    style: { setProperty() {} },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
      children.forEach((child) => {
        child.parentNode = this;
      });
    },
    addEventListener(name, callback) {
      this.events[name] = callback;
    },
    replaceWith(replacement) {
      const index = this.parentNode.children.indexOf(this);
      replacement.parentNode = this.parentNode;
      this.parentNode.children.splice(index, 1, replacement);
    },
    remove() {
      const index = this.parentNode.children.indexOf(this);
      this.parentNode.children.splice(index, 1);
    },
    setAttribute() {},
    isConnected: true,
  };
  return value;
}

test("a failed historic image switches to its deterministic library fallback", async () => {
  const source = await readFile("frontend/icon-system.js", "utf8");
  const elementMap = {
    "黄钻": {
      icon: {
        base: "qq-era:yellow-diamond",
        palette: "product",
        source: "curated",
      },
      fallback_icon: {
        base: "💎",
        badge: "⭐",
        palette: "product",
        source: "fallback",
      },
    },
  };
  const manifest = {
    "qq-era:yellow-diamond": "/icons/yellow-diamond.png",
    "💎": "/icons/diamond.png",
    "⭐": "/icons/star.png",
  };
  const window = {
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url.includes("element-icon-map") ? elementMap : manifest,
    }),
  };
  vm.runInNewContext(source, { window, Promise });
  await window.ICON_SYSTEM.ready;

  const document = {
    createElement: node,
    createTextNode(text) {
      return { textContent: text };
    },
  };
  const target = node("button");
  window.ICON_SYSTEM.renderElement(document, target, {
    name: "黄钻",
    emoji: "💛",
    icon: {
      base: "💛",
      badge: "🚇",
      palette: "product",
      source: "generated",
    },
  });
  const sticker = target.children[0];
  const historicImage = sticker.children[0];
  assert.equal(historicImage.src, "/icons/yellow-diamond.png");

  historicImage.events.error();

  assert.deepEqual(
    sticker.children.map((child) => child.src),
    ["/icons/diamond.png", "/icons/star.png"],
  );
});

test("a missing named manifest entry immediately uses the library fallback", async () => {
  const source = await readFile("frontend/icon-system.js", "utf8");
  const elementMap = {
    "黄钻": {
      icon: {
        base: "qq-era:yellow-diamond",
        palette: "product",
        source: "curated",
      },
      fallback_icon: {
        base: "💎",
        badge: "⭐",
        palette: "product",
        source: "fallback",
      },
    },
  };
  const manifest = {
    "💎": "/icons/diamond.png",
    "⭐": "/icons/star.png",
  };
  const window = {
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url.includes("element-icon-map") ? elementMap : manifest,
    }),
  };
  vm.runInNewContext(source, { window, Promise });
  await window.ICON_SYSTEM.ready;

  const document = {
    createElement: node,
    createTextNode(text) {
      return { textContent: text };
    },
  };
  const target = node("button");
  window.ICON_SYSTEM.renderElement(document, target, {
    name: "黄钻",
    emoji: "💛",
  });

  assert.deepEqual(
    target.children[0].children.map((child) => child.src),
    ["/icons/diamond.png", "/icons/star.png"],
  );
});
