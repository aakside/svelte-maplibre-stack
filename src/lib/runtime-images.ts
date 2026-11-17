import type { Map, MapStyleImageMissingEvent } from "maplibre-gl";

/** Keep existing runtime image generators usable with namespaced sprite assets. */
export function installRuntimeImageBridge(map: Map, namespaces: () => string[]) {
  const originalAdd = map.addImage;
  const originalGet = map.getImage;
  const pending = new globalThis.Map<string, Set<string>>();
  let scope: string | undefined;
  map.getImage = function (id) {
    return originalGet.call(this, scope && this.hasImage(`${scope}:${id}`) ? `${scope}:${id}` : id);
  };
  map.addImage = function (id, ...args) {
    if (scope) return originalAdd.call(this, `${scope}:${id}`, ...args);
    const result = originalAdd.call(this, id, ...args);
    for (const qualified of pending.get(id) ?? []) {
      if (!this.hasImage(qualified)) originalAdd.call(this, qualified, ...args);
    }
    pending.delete(id);
    return result;
  };
  const missing = (event: MapStyleImageMissingEvent) => {
    const namespace = namespaces().find((name) => event.id.startsWith(`${name}:`));
    if (!namespace) return;
    const id = event.id.slice(namespace.length + 1);
    if (!id) return;
    const waiting = pending.get(id) ?? new Set<string>();
    waiting.add(event.id);
    pending.set(id, waiting);
    const previous = scope;
    scope = namespace;
    try {
      map.fire("styleimagemissing", { id });
    } finally {
      scope = previous;
    }
    if (map.hasImage(event.id)) {
      waiting.delete(event.id);
      if (!waiting.size) pending.delete(id);
    }
  };
  map.on("styleimagemissing", missing);
  return () => {
    map.off("styleimagemissing", missing);
    map.addImage = originalAdd;
    map.getImage = originalGet;
    pending.clear();
  };
}
