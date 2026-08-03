(function (root) {
  "use strict";

  var PALETTES = ["nature", "product", "office", "studio", "people", "place"];
  var SOURCES = ["curated", "entity", "generated", "fallback", "preset"];
  var SIZES = ["sidebar", "canvas", "detail"];
  var ACTIONS = {
    back: "arrow-left",
    next: "arrow-right",
    recipes: "book-open",
    close: "x",
    confirm: "check",
    download: "download-simple",
    combine: "equals",
    search: "magnifying-glass",
    wall: "monitor-play",
    add: "plus",
    help: "question",
    share: "share-network",
    sparkle: "sparkle",
    dislike: "thumbs-down",
    like: "thumbs-up",
    reset: "trash",
    score: "trophy",
    user: "user-circle",
    warning: "warning"
  };
  var ACTION_TONES = ["default", "positive", "negative", "neutral"];
  var ACTION_SIZES = ["default", "compact", "large"];
  var STATE_CLASSES = {
    starter: "state-starter",
    "global-new": "state-global-new",
    global_new: "state-global-new",
    "personal-new": "state-personal-new",
    personal_new: "state-personal-new",
    global_known: "state-personal-new",
    dragging: "state-dragging",
    "combine-target": "state-combine-target",
    combine_target: "state-combine-target"
  };
  var STATE_LABELS = {
    "state-starter": "基础元素",
    "state-global-new": "全球首发",
    "state-personal-new": "我的新发现",
    "state-dragging": "拖拽中",
    "state-combine-target": "合成目标"
  };
  var elementMap = {};
  var emojiManifest = {};
  var manifestsLoaded = false;

  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function allowed(value, values, fallback) {
    return values.indexOf(value) >= 0 ? value : fallback;
  }

  function loadJson(url) {
    if (typeof root.fetch !== "function") return Promise.resolve({});
    return root.fetch(url)
      .then(function (response) {
        if (!response || !response.ok) throw new Error("Unable to load " + url);
        return response.json();
      })
      .then(function (value) { return object(value) ? value : {}; })
      .catch(function () { return {}; });
  }

  var ready = Promise.all([
    loadJson("/assets/icons/generated/element-icon-map.json"),
    loadJson("/assets/icons/generated/emoji-icon-manifest.json")
  ]).then(function (loaded) {
    elementMap = loaded[0];
    emojiManifest = loaded[1];
    manifestsLoaded = true;
  });

  function validRecipe(icon) {
    if (!object(icon) || typeof icon.base !== "string" || !icon.base) return null;
    if (!PALETTES.includes(icon.palette) || !SOURCES.includes(icon.source)) return null;
    var recipe = {
      base: icon.base,
      palette: icon.palette,
      source: icon.source
    };
    if (typeof icon.badge === "string" && icon.badge) recipe.badge = icon.badge;
    return recipe;
  }

  function fallbackRecipe(payload) {
    var emoji = typeof payload.emoji === "string" && payload.emoji ? payload.emoji : "❓";
    return { base: emoji, palette: "place", source: "fallback" };
  }

  function resolveElementRecipe(payload) {
    payload = object(payload) ? payload : {};
    var persisted = validRecipe(payload.icon);
    if (persisted) return persisted;

    var preset = payload.name && elementMap[payload.name];
    var mapped = preset && validRecipe(preset.icon);
    if (mapped) return mapped;

    if (typeof payload.emoji === "string" && payload.emoji) {
      return { base: payload.emoji, palette: "place", source: "emoji" };
    }
    return fallbackRecipe(payload);
  }

  function stableTilt(name) {
    var hash = 0;
    var text = String(name || "");
    for (var index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return (Math.abs(hash) % 5) - 2;
  }

  function nativeEmojiNode(doc, emoji) {
    var nativeEmoji = doc.createElement("span");
    nativeEmoji.className = "element-icon-native";
    nativeEmoji.textContent = emoji;
    return nativeEmoji;
  }

  function appendNativeFallback(doc, image, emoji) {
    var nativeEmoji = nativeEmojiNode(doc, emoji);
    image.replaceWith(nativeEmoji);
  }

  function appendImage(doc, sticker, emoji, className, isBadge) {
    var url = emojiManifest[emoji];
    if (!url) {
      if (!isBadge) sticker.appendChild(nativeEmojiNode(doc, emoji));
      return null;
    }
    var image = doc.createElement("img");
    image.className = className;
    image.src = url;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", function () {
      if (isBadge) image.remove();
      else appendNativeFallback(doc, image, emoji);
    }, { once: true });
    sticker.appendChild(image);
    return image;
  }

  function elementState(target, payload) {
    var explicit = STATE_CLASSES[payload.state] || "";
    if (payload.combineTarget || explicit === "state-combine-target") return "state-combine-target";
    if (
      payload.dragging ||
      explicit === "state-dragging" ||
      target.classList.contains("dragging")
    ) return "state-dragging";
    if (
      payload.isFirst ||
      payload.isGlobalNew ||
      payload.tier === "global_new" ||
      explicit === "state-global-new"
    ) return "state-global-new";
    if (
      payload.isPersonalNew ||
      payload.tier === "global_known" ||
      explicit === "state-personal-new"
    ) return "state-personal-new";
    if (payload.isStarter || explicit === "state-starter") return "state-starter";
    return "";
  }

  function setElementClasses(target, recipe, payload) {
    PALETTES.forEach(function (palette) { target.classList.remove("palette-" + palette); });
    ["state-starter", "state-global-new", "state-personal-new", "state-dragging", "state-combine-target"].forEach(function (state) {
      target.classList.remove(state);
    });
    target.classList.add("palette-" + allowed(recipe.palette, PALETTES, "place"));
    var state = elementState(target, payload);
    if (state) target.classList.add(state);
    return state;
  }

  function elementTooltip(payload, recipe, state) {
    if (typeof payload.tooltip === "string") return payload.tooltip;
    if (typeof payload.title === "string") return payload.title;
    var parts = [];
    var name = typeof payload.name === "string" ? payload.name : "";
    var category = typeof payload.category === "string" ? payload.category : "";
    if (name) parts.push(name);
    if (category) parts.push("类别：" + category);
    if (recipe.source) parts.push("来源：" + recipe.source);
    if (state && STATE_LABELS[state]) parts.push("状态：" + STATE_LABELS[state]);
    return parts.length ? parts.join(" · ") : recipe.base;
  }

  function renderElement(doc, target, payload) {
    payload = object(payload) ? payload : {};
    var recipe = resolveElementRecipe(payload);
    var name = typeof payload.name === "string" ? payload.name : "";
    var size = allowed(payload.size, SIZES, "sidebar");
    var sticker = doc.createElement("span");
    sticker.className = "emoji element-icon palette-" + allowed(recipe.palette, PALETTES, "place");
    sticker.classList.add("element-icon-" + size);
    sticker.style.setProperty("--element-icon-tilt", stableTilt(name) + "deg");
    appendImage(doc, sticker, recipe.base, "element-icon-base", false);
    if (recipe.badge) appendImage(doc, sticker, recipe.badge, "element-icon-badge", true);

    var nameNode = doc.createElement("span");
    nameNode.className = "name";
    nameNode.textContent = name;
    target.replaceChildren(sticker, nameNode);
    var state = setElementClasses(target, recipe, payload);
    target.title = elementTooltip(payload, recipe, state);
    if (!manifestsLoaded) {
      ready.then(function () {
        if (target.isConnected) renderElement(doc, target, payload);
      });
    }
    return recipe;
  }

  function renderedLineCount(nameNode) {
    if (!nameNode || !nameNode.textContent) return 0;
    var range = nameNode.ownerDocument.createRange();
    range.selectNodeContents(nameNode);
    var tops = [];
    Array.from(range.getClientRects()).forEach(function (rect) {
      if (!rect.width && !rect.height) return;
      var top = Math.round(rect.top * 2) / 2;
      if (!tops.some(function (seen) { return Math.abs(seen - top) < 0.5; })) {
        tops.push(top);
      }
    });
    return tops.length;
  }

  function fitSidebarChip(target) {
    if (!target || !target.classList) return 0;
    target.classList.remove("sidebar-span-2", "sidebar-span-3");
    var nameNode = target.querySelector(".name");
    var lines = renderedLineCount(nameNode);
    if (lines > 2) {
      target.classList.add("sidebar-span-2");
      lines = renderedLineCount(nameNode);
    }
    if (lines > 2) {
      target.classList.remove("sidebar-span-2");
      target.classList.add("sidebar-span-3");
      lines = renderedLineCount(nameNode);
    }
    return lines;
  }

  function renderAction(doc, target, payload) {
    payload = object(payload) ? payload : {};
    var action = ACTIONS[payload.name];
    var label = typeof payload.label === "string" ? payload.label : "";
    var tone = allowed(payload.tone, ACTION_TONES, "default");
    var size = allowed(payload.size, ACTION_SIZES, "default");
    var actionNode = doc.createElement("span");
    actionNode.className = "action-icon tone-" + tone + " size-" + size;
    if (action) {
      var image = doc.createElement("img");
      image.src = "/assets/icons/actions/" + action + ".svg";
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      actionNode.appendChild(image);
    }
    if (label) actionNode.appendChild(doc.createTextNode(label));
    else actionNode.setAttribute("aria-label", action ? payload.name : "操作");
    target.replaceChildren(actionNode);
    return actionNode;
  }

  function hydrateActions(doc) {
    (doc || root.document).querySelectorAll("[data-icon-action]").forEach(function (target) {
      renderAction(doc || root.document, target, {
        name: target.dataset.iconAction,
        label: target.dataset.iconLabel || "",
        tone: target.dataset.iconTone,
        size: target.dataset.iconSize
      });
    });
  }

  root.ICON_SYSTEM = {
    ready: ready,
    resolveElementRecipe: resolveElementRecipe,
    renderElement: renderElement,
    fitSidebarChip: fitSidebarChip,
    renderAction: renderAction,
    hydrateActions: hydrateActions
  };
})(typeof window !== "undefined" ? window : this);
