import { describe, expect, it } from "vitest";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { encodeTile } from "../src/lib/vector-tiles.js";
import geojsonvt from "geojson-vt";
import { clipGeometry, createTransform, mergeTile } from "../src/lib/vector-tiles.js";
import type { Polygon } from "geojson";

const region: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-20, -20],
      [20, -20],
      [20, 20],
      [-20, 20],
      [-20, -20],
    ],
    [
      [-2, -2],
      [-2, 2],
      [2, 2],
      [2, -2],
      [-2, -2],
    ],
  ],
};
const placement = {
  overlayCenter: { lng: 0, lat: 0 },
  baseMapPosition: { lng: 90, lat: 60 },
  bearing: 30,
};

describe("overlay geometry", () => {
  it("maps the source anchor exactly and inverts rotation and latitude scale", () => {
    const transform = createTransform(placement);
    expect(transform.forward([0, 0])[0]).toBeCloseTo(90);
    expect(transform.forward([0, 0])[1]).toBeCloseTo(60);
    expect(transform.inverse(transform.forward([10, 10]))[0]).toBeCloseTo(10);
    expect(transform.inverse(transform.forward([10, 10]))[1]).toBeCloseTo(10);
    expect(transform.scale).toBeCloseTo(2);
  });
  it("clips points and lines against holes, preserving separate line pieces", () => {
    expect(clipGeometry({ type: "Point", coordinates: [0, 0] }, region)).toBeNull();
    expect(clipGeometry({ type: "Point", coordinates: [10, 0] }, region)).not.toBeNull();
    expect(
      clipGeometry(
        {
          type: "LineString",
          coordinates: [
            [-30, 0],
            [30, 0],
          ],
        },
        region,
      ),
    ).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [-20, 0],
          [-2, 0],
        ],
        [
          [2, 0],
          [20, 0],
        ],
      ],
    });
  });
  it("retains polygon holes", () => {
    const clipped = clipGeometry(
      {
        type: "Polygon",
        coordinates: [
          [
            [-30, -30],
            [30, -30],
            [30, 30],
            [-30, 30],
            [-30, -30],
          ],
        ],
      },
      region,
    );
    expect(clipped?.type).toBe("MultiPolygon");
    if (clipped?.type === "MultiPolygon") expect(clipped.coordinates[0]).toHaveLength(2);
  });
});

describe("merged vector tile requests", () => {
  const input = geojsonvt(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 7,
          properties: { name: "Edge label" },
          geometry: { type: "Point", coordinates: [10, 0] },
        },
      ],
    },
    {},
  ).getTile(0, 0, 0)!;
  const bytes = encodeTile({ places: input });
  const contribution = {
    id: "overlay/source",
    tiles: ["https://example.test/{z}/{x}/{y}.pbf"],
    minzoom: 0,
    maxzoom: 0,
    region,
    placement,
  };
  it("merges namespaces without losing IDs or label properties", async () => {
    const data = await mergeTile(
      { z: 0, x: 0, y: 0 },
      [contribution, { ...contribution, id: "other/source" }],
      new AbortController().signal,
      async () => new Response(new Uint8Array(bytes).buffer),
    );
    const tile = new VectorTile(new Pbf(data));
    expect(Object.keys(tile.layers)).toEqual(["overlay/source/places", "other/source/places"]);
    const feature = tile.layers["overlay/source/places"].feature(0);
    expect(feature.id).toBe(7);
    expect(feature.properties.name).toBe("Edge label");
    const transformed = createTransform(placement).forward([10, 0]);
    const point = feature.toGeoJSON(0, 0, 0).geometry;
    if (point.type === "Point") expect(point.coordinates[0]).toBeCloseTo(transformed[0], 0);
  });
  it("propagates fetch failures instead of silently returning an empty tile", async () => {
    await expect(
      mergeTile(
        { z: 0, x: 0, y: 0 },
        [contribution],
        new AbortController().signal,
        async () => new Response("", { status: 503 }),
      ),
    ).rejects.toThrow("503");
  });
  it("honors cancellation before fetching", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      mergeTile({ z: 0, x: 0, y: 0 }, [contribution], controller.signal, async () => {
        throw new Error("should not fetch");
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
it("keeps the untransformed basemap tile intact and namespaces its layers", async () => {
  const original = geojsonvt(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: 42,
          properties: { name: "Base label" },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      ],
    },
    {},
  ).getTile(0, 0, 0)!;
  const bytes = encodeTile({ places: original });
  const data = await mergeTile(
    { z: 0, x: 0, y: 0 },
    [{ id: "base/source", tiles: ["https://example.test/{z}/{x}/{y}"], minzoom: 0, maxzoom: 0 }],
    new AbortController().signal,
    async () => new Response(new Uint8Array(bytes).buffer),
  );
  const tile = new VectorTile(new Pbf(data));
  expect(tile.layers["base/source/places"].feature(0).id).toBe(42);
});
it("does not fetch source tiles for a destination outside the overlay", async () => {
  const data = await mergeTile(
    { z: 4, x: 0, y: 0 },
    [
      {
        id: "overlay",
        tiles: ["https://example.test/{z}/{x}/{y}"],
        minzoom: 0,
        maxzoom: 14,
        region,
        placement,
      },
    ],
    new AbortController().signal,
    async () => {
      throw new Error("Unexpected fetch");
    },
  );
  expect(new VectorTile(new Pbf(data)).layers).toEqual({});
});
it("keeps nearby coordinates together across the antimeridian", () => {
  const transform = createTransform({
    overlayCenter: { lng: 179, lat: 0 },
    baseMapPosition: { lng: 0, lat: 0 },
    bearing: 0,
  });
  expect(transform.forward([-179, 0])[0]).toBeCloseTo(2);
});
