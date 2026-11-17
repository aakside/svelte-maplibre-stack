import { expect, it } from "vitest";
import { stageStyle } from "../src/lib/style-transition.js";
import type { StyleSpecification } from "maplibre-gl";
it("retains the displayed overlay while replacement sources load", () => {
  const make = (id: string): StyleSpecification => ({
    version: 8,
    sources: { [id]: { type: "vector", tiles: [`stack://tiles/{z}/{x}/{y}?revision=${id}`] } },
    layers: [
      { id, type: "fill", source: id, "source-layer": "land", paint: { "fill-opacity": 0.7 } },
    ],
  });
  const old = make("1/merged"),
    next = make("2/merged");
  const staged = stageStyle(old, next);
  expect(staged.sources).toHaveProperty("1/merged");
  expect(staged.sources).toHaveProperty("2/merged");
  expect(staged.layers[0]).toEqual(old.layers[0]);
  expect(staged.layers[1].paint).toMatchObject({ "fill-opacity": 0 });
  expect(next.layers[0].paint).toMatchObject({ "fill-opacity": 0.7 });
});

it("does not retain superseded sources with no displayed layers", () => {
  const previous: StyleSpecification = {
    version: 8,
    sources: { "obsolete/merged": { type: "vector", tiles: ["stack://old"] } },
    layers: [],
  };
  const next: StyleSpecification = { version: 8, sources: {}, layers: [] };
  expect(stageStyle(previous, next).sources).toEqual({});
});
