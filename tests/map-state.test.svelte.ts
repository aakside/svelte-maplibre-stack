import { expect, it } from "vitest";
import { MapState, type LayerConfigs } from "../src/lib/map-state.svelte.js";
import type { Map } from "maplibre-gl";
const configs: LayerConfigs = [
  { bearing: 0, center: { lng: 0, lat: 0 }, visible: true, zoom: 4 },
  {
    bearing: 30,
    baseMapPosition: { lng: 10, lat: 10 },
    overlayCenter: { lng: 0, lat: 0 },
    visible: true,
    pathBorderWidth: 2,
    pathBorderColor: "red",
    geojson: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
  },
];
it("removes overlays without destroying the shared map and replaces surplus configurations", () => {
  const state = new MapState(configs);
  const map = {} as Map;
  state.layers.forEach((layer) => {
    layer.map = map;
  });
  const id = state.layers[1].id;
  expect(state.removeLayer(1)).toBe(id);
  expect(state.layers[0].map).toBe(map);
  state.addLayer(configs[1]);
  state.update([configs[0]]);
  expect(state.layers).toHaveLength(1);
  expect(() => state.removeLayer(-1)).toThrow("Invalid layer index");
});
it("round trips borders and geometry and preserves unlocked relative bearings", () => {
  const state = new MapState(configs);
  state.setBearing(0, 45);
  expect(state.layers[1].bearing).toBe(75);
  state.layers[1].isBearingLocked = true;
  state.setBearing(0, 90);
  expect(state.layers[1].bearing).toBe(75);
  const restored = new MapState(state.toLayerConfigs({ includeGeojson: true }));
  expect(restored.layers[1].pathBorderWidth).toBe(2);
  expect(restored.layers[1].pathBorderColor).toBe("red");
  expect(restored.layers[1].geojson).toEqual(configs[1].geojson);
});
