export function collectUnseenPrefix(incoming, seen) {
  const items = [];
  for (const item of incoming || []) {
    if (!item?.result) continue;
    if (seen.has(item.result)) {
      return { items, boundaryFound: true };
    }
    items.push(item);
  }
  return { items, boundaryFound: false };
}

export function mergeFirstItems(existing, fresh) {
  const byResult = new Map();
  for (const item of [...(fresh || []), ...(existing || [])]) {
    if (item?.result && !byResult.has(item.result)) {
      byResult.set(item.result, item);
    }
  }
  return [...byResult.values()].sort((left, right) => {
    const leftOrder = Number(left.seq ?? left.ts ?? 0);
    const rightOrder = Number(right.seq ?? right.ts ?? 0);
    return rightOrder - leftOrder;
  });
}
