(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const LINK_COLOR = "#78A9D6";
  const STRENGTH_STOPS = Object.freeze([
    Object.freeze({ hits: 1, width: 0.7, opacity: 0.34, glow: 0, duration: 900 }),
    Object.freeze({ hits: 3, width: 0.95, opacity: 0.43, glow: 1, duration: 820 }),
    Object.freeze({ hits: 8, width: 1.25, opacity: 0.54, glow: 3, duration: 720 }),
    Object.freeze({ hits: 20, width: 1.75, opacity: 0.68, glow: 6, duration: 620 }),
    Object.freeze({ hits: 40, width: 2.4, opacity: 0.82, glow: 10, duration: 500 }),
  ]);

  function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizedHits(value) {
    return Math.min(40, Math.max(1, Math.trunc(finiteNumber(value, 1))));
  }

  function rounded(value) {
    return Math.round(value * 1000) / 1000;
  }

  function strengthFor(value) {
    const hits = normalizedHits(value);
    let upperIndex = STRENGTH_STOPS.findIndex((stop) => hits <= stop.hits);
    if (upperIndex <= 0) {
      return { ...STRENGTH_STOPS[0], hits };
    }
    if (upperIndex < 0) upperIndex = STRENGTH_STOPS.length - 1;
    const lower = STRENGTH_STOPS[upperIndex - 1];
    const upper = STRENGTH_STOPS[upperIndex];
    const ratio = (hits - lower.hits) / (upper.hits - lower.hits);
    const interpolate = (field) =>
      rounded(lower[field] + (upper[field] - lower[field]) * ratio);
    return {
      hits,
      width: interpolate("width"),
      opacity: interpolate("opacity"),
      glow: interpolate("glow"),
      duration: interpolate("duration"),
    };
  }

  function normalizedElements(elements) {
    const normalized = new Map();
    for (const item of Array.isArray(elements) ? elements : []) {
      const id = String(item?.id ?? "");
      const name = String(item?.name ?? "");
      const x = finiteNumber(item?.x, NaN);
      const y = finiteNumber(item?.y, NaN);
      if (!id || !name || !Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      normalized.set(id, { id, name, x, y });
    }
    return normalized;
  }

  function normalizedRecipes(recipes) {
    const normalized = [];
    for (const item of Array.isArray(recipes) ? recipes : []) {
      const a = String(item?.a ?? "");
      const b = String(item?.b ?? "");
      if (!a || !b) continue;
      normalized.push({
        key: String(item?.key || [a, b].sort().join(" + ")),
        a,
        b,
        hitCount: normalizedHits(item?.hit_count),
        depth: Math.max(1, Math.trunc(finiteNumber(item?.depth, 1))),
      });
    }
    return normalized;
  }

  function groupedByName(elements) {
    const grouped = new Map();
    for (const item of elements.values()) {
      if (!grouped.has(item.name)) grouped.set(item.name, []);
      grouped.get(item.name).push(item);
    }
    return grouped;
  }

  function stablePairKey(recipeKey, leftId, rightId) {
    const ids = [String(leftId), String(rightId)].sort();
    return `${recipeKey}\u0000${ids[0]}\u0000${ids[1]}`;
  }

  function curveSign(key) {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = ((hash * 31) + key.charCodeAt(index)) | 0;
    }
    return (hash & 1) === 0 ? 1 : -1;
  }

  function curvePath(left, right, sign) {
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const bend = Math.min(48, Math.max(12, distance * 0.12)) * sign;
    const normalX = -dy / distance;
    const normalY = dx / distance;
    const controlX = (left.x + right.x) / 2 + normalX * bend;
    const controlY = (left.y + right.y) / 2 + normalY * bend;
    return [
      "M", rounded(left.x), rounded(left.y),
      "Q", rounded(controlX), rounded(controlY),
      rounded(right.x), rounded(right.y),
    ].join(" ");
  }

  function setVisualProfile(edge, recipe) {
    const strength = strengthFor(recipe.hitCount);
    edge.group.dataset.recipeKey = recipe.key;
    edge.group.dataset.hitCount = String(strength.hits);
    edge.group.style.setProperty("--recipe-link-color", LINK_COLOR);
    edge.group.style.setProperty(
      "--recipe-link-width",
      String(strength.width),
    );
    edge.group.style.setProperty(
      "--recipe-link-opacity",
      String(strength.opacity),
    );
    edge.group.style.setProperty(
      "--recipe-link-glow",
      String(strength.glow),
    );
    edge.group.style.setProperty(
      "--recipe-link-duration",
      String(strength.duration),
    );
  }

  function createSvg(documentRef) {
    const svg = documentRef.createElementNS(SVG_NS, "svg");
    svg.classList.add("recipe-links");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const layer = documentRef.createElementNS(SVG_NS, "g");
    layer.classList.add("recipe-link-paths");
    svg.appendChild(layer);
    return { svg, layer };
  }

  function createEdge(documentRef, key, recipe, left, right) {
    const group = documentRef.createElementNS(SVG_NS, "g");
    group.classList.add("recipe-link");
    group.dataset.linkId = key;
    const base = documentRef.createElementNS(SVG_NS, "path");
    base.classList.add("recipe-link-base");
    const emphasis = documentRef.createElementNS(SVG_NS, "path");
    emphasis.classList.add("recipe-link-emphasis");
    const draw = documentRef.createElementNS(SVG_NS, "path");
    draw.classList.add("recipe-link-draw");
    group.append(base, emphasis, draw);
    const edge = {
      key,
      group,
      base,
      emphasis,
      draw,
      paths: [base, emphasis, draw],
      leftId: left.id,
      rightId: right.id,
      sign: curveSign(key),
      animation: null,
    };
    setVisualProfile(edge, recipe);
    return edge;
  }

  function create(workspace) {
    if (!workspace?.ownerDocument) {
      throw new TypeError("Recipe links require a workspace element");
    }
    const documentRef = workspace.ownerDocument;
    const { svg, layer } = createSvg(documentRef);
    workspace.prepend(svg);

    const edges = new Map();
    let elements = new Map();
    let frameId = null;
    let destroyed = false;
    const requestFrame =
      global.requestAnimationFrame?.bind(global) ||
      ((callback) => global.setTimeout(callback, 16));
    const cancelFrame =
      global.cancelAnimationFrame?.bind(global) ||
      global.clearTimeout?.bind(global);

    function updateGeometry() {
      if (destroyed) return;
      frameId = null;
      const rect = workspace.getBoundingClientRect();
      const width = Math.max(1, workspace.clientWidth || rect.width || 1);
      const height = Math.max(1, workspace.clientHeight || rect.height || 1);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      for (const edge of edges.values()) {
        const left = elements.get(edge.leftId);
        const right = elements.get(edge.rightId);
        if (!left || !right) continue;
        const path = curvePath(left, right, edge.sign);
        edge.paths.forEach((node) => node.setAttribute("d", path));
      }
    }

    function schedule() {
      if (destroyed || frameId !== null) return;
      frameId = requestFrame(updateGeometry);
    }

    function scheduleGeometryUpdate(nextElements) {
      if (destroyed) return;
      elements = normalizedElements(nextElements);
      schedule();
    }

    function sync(payload = {}) {
      if (destroyed) return;
      elements = normalizedElements(payload.elements);
      const grouped = groupedByName(elements);
      const desired = new Map();

      for (const recipe of normalizedRecipes(payload.recipes)) {
        const leftItems = grouped.get(recipe.a) || [];
        const rightItems = grouped.get(recipe.b) || [];
        if (recipe.a === recipe.b) {
          for (let leftIndex = 0; leftIndex < leftItems.length; leftIndex += 1) {
            for (
              let rightIndex = leftIndex + 1;
              rightIndex < leftItems.length;
              rightIndex += 1
            ) {
              const left = leftItems[leftIndex];
              const right = leftItems[rightIndex];
              desired.set(
                stablePairKey(recipe.key, left.id, right.id),
                { recipe, left, right },
              );
            }
          }
        } else {
          for (const left of leftItems) {
            for (const right of rightItems) {
              desired.set(
                stablePairKey(recipe.key, left.id, right.id),
                { recipe, left, right },
              );
            }
          }
        }
      }

      for (const [key, edge] of edges) {
        if (desired.has(key)) continue;
        edge.group.remove();
        edges.delete(key);
      }

      for (const [key, item] of desired) {
        let edge = edges.get(key);
        if (!edge) {
          edge = createEdge(
            documentRef,
            key,
            item.recipe,
            item.left,
            item.right,
          );
          edges.set(key, edge);
          layer.appendChild(edge.group);
        } else {
          edge.leftId = item.left.id;
          edge.rightId = item.right.id;
          setVisualProfile(edge, item.recipe);
        }
      }
      schedule();
    }

    function clear() {
      if (destroyed) return;
      edges.forEach((edge) => edge.group.remove());
      edges.clear();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId !== null && cancelFrame) cancelFrame(frameId);
      frameId = null;
      resizeObserver?.disconnect();
      if (!resizeObserver) global.removeEventListener?.("resize", schedule);
      edges.clear();
      svg.remove();
    }

    const resizeObserver = global.ResizeObserver
      ? new global.ResizeObserver(schedule)
      : null;
    if (resizeObserver) {
      resizeObserver.observe(workspace);
    } else {
      global.addEventListener?.("resize", schedule);
    }
    schedule();

    return Object.freeze({
      sync,
      scheduleGeometryUpdate,
      clear,
      destroy,
    });
  }

  global.RECIPE_LINKS = Object.freeze({ create });
})(window);
