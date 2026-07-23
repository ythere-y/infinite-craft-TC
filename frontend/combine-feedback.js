(function (root) {
  "use strict";
  var DEFAULT_COMMENT = "这波组合很有想法，建议先小范围灰度。";

  function classify(isGlobalFirst, knownBefore) {
    if (isGlobalFirst) return "global_new";
    return knownBefore ? "seen" : "global_known";
  }

  function appendTextNode(doc, parent, tagName, className, text) {
    var node = doc.createElement(tagName);
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  function clearChildren(target) {
    while (target.firstChild) target.removeChild(target.firstChild);
  }

  function renderElement(doc, target, payload) {
    clearChildren(target);
    if (payload.isStarter) {
      var badge = appendTextNode(
        doc, target, "span", "starter-badge", "🌱"
      );
      badge.setAttribute("aria-hidden", "true");
    }
    appendTextNode(
      doc, target, "span", "emoji", String(payload.emoji || "❓")
    );
    appendTextNode(
      doc, target, "span", "name", String(payload.name || "")
    );
  }

  function renderToast(doc, target, payload) {
    clearChildren(target);
    var labels = {
      global_new: "🌍 全球首发",
      global_known: "✨ 我的新发现",
      seen: "↻ 再次合成"
    };
    appendTextNode(
      doc, target, "div", "first-toast-title", labels[payload.tier]
    );
    appendTextNode(doc, target, "div", "first-toast-result",
      String(payload.emoji || "❓") + " " + String(payload.name || ""));
    appendTextNode(doc, target, "div", "first-toast-comment",
      "“" + String(payload.comment || DEFAULT_COMMENT) + "”");
  }

  root.COMBINE_FEEDBACK = {
    DEFAULT_COMMENT: DEFAULT_COMMENT,
    classify: classify,
    renderElement: renderElement,
    renderToast: renderToast
  };
})(typeof window !== "undefined" ? window : this);
