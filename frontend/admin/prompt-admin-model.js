(() => {
  "use strict";

  const TEMPERATURE_ERROR = "Temperature 必须是 0 到 2 之间的数字";

  function temperatureError(value) {
    if (String(value).trim() === "") {
      return TEMPERATURE_ERROR;
    }
    const temperature = Number(value);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      return TEMPERATURE_ERROR;
    }
    return "";
  }

  function mergeVersionPage(existing, payload, reset = false) {
    const merged = reset ? [] : existing.slice();
    const ids = new Set(merged.map((version) => version.id));
    for (const version of payload.versions) {
      if (!ids.has(version.id)) {
        merged.push(version);
        ids.add(version.id);
      }
    }
    return {
      versions: merged,
      hasMore: payload.version_page.has_more === true,
      nextOffset: payload.version_page.next_offset,
    };
  }

  function reconcileDeletedVersion(pendingVersionId, deletedVersionId) {
    const pendingWasDeleted = pendingVersionId === deletedVersionId;
    return {
      pendingVersionId: pendingWasDeleted ? null : pendingVersionId,
      clearPreview: pendingWasDeleted,
    };
  }

  globalThis.PromptAdminModel = Object.freeze({
    mergeVersionPage,
    reconcileDeletedVersion,
    temperatureError,
  });
})();
