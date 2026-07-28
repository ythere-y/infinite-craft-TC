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
    target.replaceChildren();
  }

  function renderElement(doc, target, payload) {
    return root.ICON_SYSTEM.renderElement(doc, target, payload);
  }

  function renderToast(doc, target, payload) {
    target.classList.remove("has-actions");
    clearChildren(target);
    var labels = {
      global_new: "🌍 全球首发",
      global_known: "✨ 我的新发现",
      seen: "↻ 再次合成"
    };
    appendTextNode(
      doc, target, "div", "first-toast-title", labels[payload.tier]
    );
    var result = appendTextNode(doc, target, "div", "first-toast-result", "");
    var iconTarget = doc.createElement("span");
    iconTarget.className = "first-toast-icon";
    result.appendChild(iconTarget);
    root.ICON_SYSTEM.renderElement(doc, iconTarget, {
      name: String(payload.name || ""),
      emoji: String(payload.emoji || "❓"),
      icon: payload.icon,
      category: payload.category,
      tier: payload.tier,
      size: "detail"
    });
    appendTextNode(doc, target, "div", "first-toast-comment",
      "“" + String(payload.comment || DEFAULT_COMMENT) + "”");
  }

  function renderPublishAction(doc, target, payload) {
    var actions = appendTextNode(
      doc, target, "div", "first-toast-actions", ""
    );
    var button = appendTextNode(
      doc, actions, "button", "first-toast-publish", "公开这个公式"
    );
    button.type = "button";
    target.classList.add("has-actions");

    button.addEventListener("click", function () {
      button.disabled = true;

      function finish(outcome) {
        if (!actions.isConnected) return;
        if (outcome && outcome.ok) {
          clearChildren(actions);
          appendTextNode(
            doc, actions, "span", "first-toast-published",
            "✅ 已公开"
          );
          return;
        }

        button.disabled = false;
        button.textContent =
          outcome && outcome.detail
            ? String(outcome.detail)
            : "公开失败，请重试";
      }

      var request;
      try {
        request = payload.publish();
      } catch (_error) {
        finish({ ok: false });
        return;
      }
      Promise.resolve(request)
        .then(finish, function () { finish({ ok: false }); });
    });

    return actions;
  }

  root.COMBINE_FEEDBACK = {
    DEFAULT_COMMENT: DEFAULT_COMMENT,
    classify: classify,
    renderElement: renderElement,
    renderToast: renderToast,
    renderPublishAction: renderPublishAction
  };
})(typeof window !== "undefined" ? window : this);
