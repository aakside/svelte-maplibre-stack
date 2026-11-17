/** A request-burst cache: emptied when the worker has no active tile consumers. */
export function createTileCache(fetcher: typeof fetch = fetch) {
  type Payload = { body: ArrayBuffer; status: number; headers: Headers };
  const entries = new Map<
    string,
    { controller: AbortController; consumers: number; settled: boolean; promise: Promise<Payload> }
  >();
  return {
    fetch: (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const signal = init?.signal;
      signal?.throwIfAborted();
      let entry = entries.get(url);
      if (!entry) {
        const controller = new AbortController();
        const created = {
          controller,
          consumers: 0,
          settled: false,
          promise: undefined as unknown as Promise<Payload>,
        };
        created.promise = fetcher(input, { ...init, signal: controller.signal })
          .then(async (response) => ({
            body: await response.arrayBuffer(),
            status: response.status,
            headers: new Headers(response.headers),
          }))
          .finally(() => {
            created.settled = true;
          });
        entry = created;
        entries.set(url, entry);
      }
      const shared = entry;
      shared.consumers++;
      return new Promise<Response>((resolve, reject) => {
        let done = false;
        const cleanup = () => {
          if (done) return false;
          done = true;
          signal?.removeEventListener("abort", abort);
          shared.consumers--;
          if (!shared.settled && shared.consumers === 0) {
            shared.controller.abort();
            entries.delete(url);
          }
          return true;
        };
        const abort = () => {
          if (cleanup()) reject(new DOMException("Tile request aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        shared.promise.then(
          (payload) => {
            if (cleanup())
              resolve(
                new Response(payload.body.slice(0), {
                  status: payload.status,
                  headers: payload.headers,
                }),
              );
          },
          (error) => {
            entries.delete(url);
            if (cleanup()) reject(error);
          },
        );
      });
    }) as typeof fetch,
    clear() {
      for (const entry of entries.values()) if (!entry.settled) entry.controller.abort();
      entries.clear();
    },
  };
}
