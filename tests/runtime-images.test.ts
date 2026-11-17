import { expect, it } from "vitest";
import { installRuntimeImageBridge } from "../src/lib/runtime-images.js";
import type { Map } from "maplibre-gl";
it("routes legacy generated icons through the requesting sprite namespace", () => {
  const images = new Set(["overlay:marker"]);
  const listeners: ((event: { id: string }) => void)[] = [];
  const map = {
    on: (_: string, fn: (event: { id: string }) => void) => listeners.push(fn),
    off: (_: string, fn: (event: { id: string }) => void) =>
      listeners.splice(listeners.indexOf(fn), 1),
    fire: (_: string, event: { id: string }) => listeners.forEach((fn) => fn(event)),
    hasImage: (id: string) => images.has(id),
    getImage: (id: string) => (images.has(id) ? { id } : undefined),
    addImage: (id: string) => {
      images.add(id);
      return map;
    },
  };
  const dispose = installRuntimeImageBridge(map as unknown as Map, () => ["overlay"]);
  map.on("styleimagemissing", ({ id }) => {
    if (id === "generated") {
      expect(map.getImage("marker")).toEqual({ id: "overlay:marker" });
      map.addImage(id);
    }
  });
  map.fire("styleimagemissing", { id: "overlay:generated" });
  expect(map.hasImage("overlay:generated")).toBe(true);
  // Asynchronous renderers add their result after the missing-image callback returns.
  map.fire("styleimagemissing", { id: "overlay:async" });
  map.addImage("async");
  expect(map.hasImage("overlay:async")).toBe(true);
  dispose();
});
