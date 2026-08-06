(() => {
  "use strict";

  const tabs = Array.from(document.querySelectorAll("[data-admin-tab]"));

  function selectTab(name) {
    for (const tab of tabs) {
      const selected = tab.dataset.adminTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll("[data-admin-panel]")) {
      panel.hidden = panel.dataset.adminPanel !== name;
    }
    document.dispatchEvent(new CustomEvent("admin:tab-selected", {
      detail: {name},
    }));
  }

  function moveFocus(event, currentIndex) {
    let nextIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const next = tabs[nextIndex];
    selectTab(next.dataset.adminTab);
    next.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.adminTab));
    tab.addEventListener("keydown", (event) => moveFocus(event, index));
  });
})();
