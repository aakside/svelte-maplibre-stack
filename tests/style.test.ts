import { expect, it } from "vitest";
import { composeStyle } from "../src/lib/compose-style.js";
import type { StyleSpecification } from "maplibre-gl";
const style: StyleSpecification = {
  version: 8,
  glyphs: "https://example.test/fonts/{fontstack}/{range}.pbf",
  sprite: "https://example.test/sprite",
  sources: { world: { type: "vector", tiles: ["https://example.test/{z}/{x}/{y}.pbf"] } },
  layers: [
    {
      id: "land",
      type: "fill",
      source: "world",
      "source-layer": "land",
      paint: { "fill-opacity": 0.5 },
    },
    {
      id: "labels",
      type: "symbol",
      source: "world",
      "source-layer": "places",
      layout: { "text-field": ["get", "name"], "text-font": ["Test Font"], "icon-image": "marker" },
    },
  ],
};
it("isolates source layers and assets and multiplies opacity", async () => {
  const result = await composeStyle(
    [
      { id: "base", style, visible: true, opacity: 1 },
      { id: "overlay", style, visible: true, opacity: 0.5 },
    ],
    "stacktest",
    new AbortController().signal,
  );
  expect(result.style.layers.map((l) => l.id)).toEqual([
    "base/land",
    "base/labels",
    "overlay/land",
    "overlay/labels",
  ]);
  expect(result.style.layers[2]).toMatchObject({
    source: "merged",
    "source-layer": "overlay/world/land",
    paint: { "fill-opacity": 0.25 },
  });
  expect(result.style.layers[3]).toMatchObject({
    layout: { "icon-image": "base:marker", "text-font": ["overlay::Test Font"] },
  });
  expect(result.contributions).toHaveLength(1);
  expect(result.style.sprite).toEqual([{ id: "base", url: "https://example.test/sprite" }]);
});
it("rejects raster overlays explicitly", async () => {
  const raster: StyleSpecification = {
    version: 8,
    sources: { r: { type: "raster", tiles: ["https://example.test/{z}/{x}/{y}.png"] } },
    layers: [{ id: "r", type: "raster", source: "r" }],
  };
  await expect(
    composeStyle(
      [
        { id: "base", style, visible: true, opacity: 1 },
        { id: "over", style: raster, visible: true, opacity: 1 },
      ],
      "test",
      new AbortController().signal,
    ),
  ).rejects.toThrow("vector");
});
it("preserves legacy zoom stop opacity functions", async () => {
  const legacy = structuredClone(style);
  legacy.layers[0] = {
    id: "land",
    type: "fill",
    source: "world",
    "source-layer": "land",
    paint: {
      "fill-opacity": {
        stops: [
          [0, 0],
          [10, 1],
        ],
      },
    },
  } as unknown as StyleSpecification["layers"][number];
  const result = await composeStyle(
    [{ id: "base", style: legacy, visible: true, opacity: 0.5 }],
    "test",
    new AbortController().signal,
  );
  expect(result.style.layers[0]).toMatchObject({
    paint: {
      "fill-opacity": {
        stops: [
          [0, 0],
          [10, 0.5],
        ],
      },
    },
  });
});
it("namespaces font outputs without modifying match conditions", async () => {
  const expression = structuredClone(style);
  expression.layers[1] = {
    id: "label",
    type: "symbol",
    source: "world",
    "source-layer": "places",
    layout: {
      "text-font": [
        "match",
        ["get", "class"],
        "city",
        ["literal", ["Bold"]],
        ["literal", ["Regular"]],
      ],
    },
  };
  const result = await composeStyle(
    [{ id: "base", style: expression, visible: true, opacity: 1 }],
    "test",
    new AbortController().signal,
  );
  expect(result.style.layers[1]).toMatchObject({
    layout: {
      "text-font": [
        "match",
        ["get", "class"],
        "city",
        ["literal", ["base::Bold"]],
        ["literal", ["base::Regular"]],
      ],
    },
  });
});
it("preserves resolved-image coalesce expressions", async () => {
  const images = structuredClone(style);
  images.layers[1] = {
    id: "label",
    type: "symbol",
    source: "world",
    "source-layer": "places",
    layout: { "icon-image": ["coalesce", ["image", "marker"], ["image", "fallback"]] },
  };
  const result = await composeStyle(
    [{ id: "base", style: images, visible: true, opacity: 1 }],
    "test",
    new AbortController().signal,
  );
  expect(result.style.layers[1]).toMatchObject({
    layout: { "icon-image": ["coalesce", ["image", "base:marker"], ["image", "base:fallback"]] },
  });
});
it("scales zoom-dependent opacity at its outputs", async () => {
  const zoom = structuredClone(style);
  zoom.layers[0] = {
    id: "land",
    type: "fill",
    source: "world",
    "source-layer": "land",
    paint: { "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 1] },
  };
  const result = await composeStyle(
    [{ id: "base", style: zoom, visible: true, opacity: 0.5 }],
    "test",
    new AbortController().signal,
  );
  expect(result.style.layers[0]).toMatchObject({
    paint: { "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 0.5] },
  });
});
