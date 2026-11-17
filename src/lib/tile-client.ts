import type { Contribution, TileID } from "./vector-tiles.js";

/** One worker per map keeps clipping and PBF encoding off the gesture thread. */
export function createTileClient() {
  const worker = new Worker(new URL("./tile-worker.js", import.meta.url), { type: "module" });
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void; cleanup: () => void }
  >();
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    request.cleanup();
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.bytes);
  };
  const fail = (error: Error) => {
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    pending.clear();
  };
  worker.onerror = (event) => fail(new Error(event.message));
  return {
    retain(revisions: number[]) {
      worker.postMessage({ type: "retain", revisions });
    },
    configure(revision: number, contributions: Contribution[]) {
      worker.postMessage({ type: "configure", revision, contributions });
    },
    request(tile: TileID, revision: number, signal: AbortSignal): Promise<Uint8Array> {
      signal.throwIfAborted();
      const id = sequence++;
      return new Promise((resolve, reject) => {
        const abort = () => {
          worker.postMessage({ type: "abort", id });
          pending.delete(id);
          reject(new DOMException("Tile request aborted", "AbortError"));
        };
        pending.set(id, {
          resolve,
          reject,
          cleanup: () => signal.removeEventListener("abort", abort),
        });
        signal.addEventListener("abort", abort, { once: true });
        worker.postMessage({ id, tile, revision });
      });
    },
    dispose() {
      fail(new DOMException("Map removed", "AbortError"));
      worker.terminate();
    },
  };
}
