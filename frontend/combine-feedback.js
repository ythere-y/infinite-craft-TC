(function (root) {
  "use strict";
  var DEFAULT_COMMENT = "这波组合很有想法，建议先小范围灰度。";

  function classify(isGlobalFirst, knownBefore) {
    if (isGlobalFirst) return "global_new";
    return knownBefore ? "seen" : "global_known";
  }

  function appendTextNode(doc, parent, className, text) {
    var node = doc.createElement("div");
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
  }

  function renderToast(doc, target, payload) {
    while (target.firstChild) target.removeChild(target.firstChild);
    var labels = {
      global_new: "🌍 全球首发",
      global_known: "✨ 我的新发现",
      seen: "↻ 再次合成"
    };
    appendTextNode(doc, target, "first-toast-title", labels[payload.tier]);
    appendTextNode(doc, target, "first-toast-result",
      String(payload.emoji || "❓") + " " + String(payload.name || ""));
    appendTextNode(doc, target, "first-toast-comment",
      "“" + String(payload.comment || DEFAULT_COMMENT) + "”");
  }

  root.COMBINE_FEEDBACK = {
    DEFAULT_COMMENT: DEFAULT_COMMENT,
    classify: classify,
    renderToast: renderToast
  };
})(typeof window !== "undefined" ? window : this);
