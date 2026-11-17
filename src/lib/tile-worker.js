// @ts-check
import { createTileCache } from "./tile-cache.js";
import { mergeTile, createTilePreparation } from "./vector-tiles.js";

/** @type {Map<number, AbortController>} */
const requests = new Map();
const cache = createTileCache();
/** @type {Map<number, import("./vector-tiles.js").Contribution[]>} */
const configurations = new Map();
/** @type {Map<number, ReturnType<typeof createTilePreparation>>} */
const preparations = new Map();
let latestZoom = 0;
let sourceIdentity = "";
self.onmessage = async ({ data }) => {
  if (data.type === "configure") {
    /** @type {import("./vector-tiles.js").Contribution[]} */
    const contributions = data.contributions;
    const identity = JSON.stringify(
      contributions.map(({ tiles, region, placement, scheme }) => [
        tiles,
        region,
        placement?.overlayCenter,
        scheme,
      ]),
    );
    if (identity !== sourceIdentity) {
      preparations.clear();
      sourceIdentity = identity;
    }
    configurations.set(data.revision, data.contributions);
    return;
  }
  if (data.type === "retain") {
    for (const revision of configurations.keys())
      if (!data.revisions.includes(revision)) configurations.delete(revision);
    return;
  }
  if (data.type === "abort") {
    requests.get(data.id)?.abort();
    return;
  }
  const controller = new AbortController();
  requests.set(data.id, controller);
  try {
    const contributions = configurations.get(data.revision);
    if (!contributions) throw new Error("Tile configuration has expired");
    latestZoom = data.tile.z;
    let preparation = preparations.get(latestZoom);
    if (!preparation) preparations.set(latestZoom, (preparation = createTilePreparation()));
    const bytes = await mergeTile(
      data.tile,
      contributions,
      controller.signal,
      cache.fetch,
      preparation,
    );
    self.postMessage({ id: data.id, bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    requests.delete(data.id);
    if (requests.size === 0) {
      cache.clear();
      // Retain prepared geometry at the current view's zoom, not a growing browsing history.
      for (const z of preparations.keys()) if (z !== latestZoom) preparations.delete(z);
    }
  }
};
