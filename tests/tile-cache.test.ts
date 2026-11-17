import { expect, it, vi } from "vitest";
import { createTileCache } from "../src/lib/tile-cache.js";
it("shares upstream requests without letting one cancelled consumer cancel another", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const cache = createTileCache(fetcher);
  const first = new AbortController(),
    second = new AbortController();
  const a = cache.fetch("https://tiles.test/tile", { signal: first.signal });
  const b = cache.fetch("https://tiles.test/tile", { signal: second.signal });
  first.abort();
  await expect(a).rejects.toMatchObject({ name: "AbortError" });
  finish(new Response("tile"));
  expect(await (await b).text()).toBe("tile");
  expect(fetcher).toHaveBeenCalledTimes(1);
  cache.clear();
});
