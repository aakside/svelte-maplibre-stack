import { expect, it, vi } from "vitest";
import geojsonvt from "geojson-vt";
import {
  createTilePreparation,
  encodeTile,
  mergeTile,
  type Contribution,
} from "../src/lib/vector-tiles.js";

it("reuses decoded and clipped source features after moving an overlay", async () => {
  const input = geojsonvt(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Retained" },
          geometry: { type: "Point", coordinates: [10, 10] },
        },
      ],
    },
    {},
  ).getTile(0, 0, 0)!;
  const bytes = encodeTile({ places: input });
  const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes).buffer));
  const preparation = createTilePreparation();
  const contribution: Contribution = {
    id: "overlay",
    tiles: ["https://example.test/{z}/{x}/{y}"],
    minzoom: 0,
    maxzoom: 0,
    region: {
      type: "Polygon",
      coordinates: [
        [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
          [-20, -20],
        ],
      ],
    },
    placement: {
      overlayCenter: { lng: 0, lat: 0 },
      baseMapPosition: { lng: 0, lat: 0 },
      bearing: 0,
    },
  };
  const signal = new AbortController().signal;
  await mergeTile({ z: 0, x: 0, y: 0 }, [contribution], signal, fetcher, preparation);
  const moved = structuredClone(contribution);
  moved.placement!.baseMapPosition.lng = 30;
  await mergeTile({ z: 0, x: 0, y: 0 }, [moved], signal, fetcher, preparation);
  expect(fetcher).toHaveBeenCalledTimes(1);
  preparation.clear();
  await mergeTile({ z: 0, x: 0, y: 0 }, [moved], signal, fetcher, preparation);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("preserves geometry entirely inside a rectangular clip without rebuilding it", async () => {
  const { clipGeometry } = await import("../src/lib/vector-tiles.js");
  const polygon = {
    type: "Polygon" as const,
    coordinates: [
      [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
        [-2, -2],
      ],
    ],
  };
  const rectangle = {
    type: "Polygon" as const,
    coordinates: [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
        [-10, -10],
      ],
    ],
  };
  expect(clipGeometry(polygon, rectangle)).toBe(polygon);
  expect(
    clipGeometry(polygon, {
      type: "Polygon",
      coordinates: [
        [
          [30, 30],
          [40, 30],
          [40, 40],
          [30, 40],
          [30, 30],
        ],
      ],
    }),
  ).toBeNull();
});

it("starts independent overlay requests concurrently", async () => {
  const callbacks: (() => void)[] = [];
  const empty = encodeTile({});
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) =>
        callbacks.push(() => resolve(new Response(new Uint8Array(empty).buffer))),
      ),
  );
  const base = { tiles: ["https://example.test/{z}/{x}/{y}"], minzoom: 0, maxzoom: 0 };
  const result = mergeTile(
    { z: 0, x: 0, y: 0 },
    [
      { ...base, id: "one" },
      { ...base, id: "two" },
    ],
    new AbortController().signal,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  callbacks.forEach((resolve) => resolve());
  await result;
});
