import { expect, it, vi } from "vitest";
import { createDragPreview } from "../src/lib/drag-preview.js";
import type { Map as MapLibreMap } from "maplibre-gl";
it("captures before hiding layers and restores opacity on cancellation", () => {
  const callbacks: (() => void)[] = [];
  const layers = [
    { id: "base", type: "fill" },
    { id: "1/overlay/land", type: "fill" },
  ];
  const setPaintProperty = vi.fn();
  const map = {
    getStyle: () => ({ layers }),
    getLayer: () => true,
    getCanvas: () => ({ width: 100, height: 100 }),
    setPaintProperty,
    once: (_: string, callback: () => void) => callbacks.push(callback),
    off: vi.fn(),
    triggerRepaint: vi.fn(),
  } as unknown as MapLibreMap;
  const remove = vi.fn();
  const container = {
    ownerDocument: {
      createElement: () => ({
        width: 0,
        height: 0,
        style: {},
        getContext: () => ({ drawImage: vi.fn() }),
        remove,
      }),
    },
    append: vi.fn(),
  } as unknown as HTMLElement;
  const preview = createDragPreview(map, container, "overlay");
  expect(setPaintProperty).not.toHaveBeenCalled();
  callbacks.shift()!();
  expect(setPaintProperty).toHaveBeenCalledWith("base", "fill-opacity", 0);
  preview.dispose();
  expect(setPaintProperty).toHaveBeenCalledWith("base", "fill-opacity", undefined);
  expect(remove).toHaveBeenCalled();
});
