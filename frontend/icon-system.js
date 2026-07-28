(function (root) {
  "use strict";

  var PALETTES = ["nature", "product", "office", "studio", "people", "place"];
  var SOURCES = ["entity", "generated", "fallback", "preset"];
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
    return (Math.abs(hash) % 7) - 3;
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

  function setElementClasses(target, recipe, payload) {
    PALETTES.forEach(function (palette) { target.classList.remove("palette-" + palette); });
    ["state-starter", "state-global-new", "state-personal-new", "state-dragging", "state-combine-target"].forEach(function (state) {
      target.classList.remove(state);
    });
    target.classList.add("palette-" + allowed(recipe.palette, PALETTES, "place"));
    if (payload.isStarter) target.classList.add("state-starter");
    if (payload.isFirst || payload.isGlobalNew || payload.tier === "global_new") target.classList.add("state-global-new");
    if (payload.isPersonalNew || payload.tier === "global_known") target.classList.add("state-personal-new");
    if (payload.dragging || target.classList.contains("dragging")) target.classList.add("state-dragging");
    if (payload.combineTarget) target.classList.add("state-combine-target");
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
    setElementClasses(target, recipe, payload);
    if (!target.title) target.title = name ? name + " · " + recipe.base : recipe.base;
    if (!manifestsLoaded) {
      ready.then(function () {
        if (target.isConnected) renderElement(doc, target, payload);
      });
    }
    return recipe;
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
    renderAction: renderAction,
    hydrateActions: hydrateActions
  };
})(typeof window !== "undefined" ? window : this);
