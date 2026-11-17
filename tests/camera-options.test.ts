import { expect, it } from "vitest";
import { cameraOptions } from "../src/lib/camera-options.js";
it("omits unset camera fields instead of overwriting MapLibre defaults", () => {
  expect(
    cameraOptions({
      center: { lng: 1, lat: 2 },
      zoom: 4,
      bearing: 0,
      pitch: undefined,
      roll: undefined,
      elevation: undefined,
    }),
  ).toEqual({ center: { lng: 1, lat: 2 }, zoom: 4, bearing: 0 });
  expect(cameraOptions({ pitch: 0, elevation: 0 })).toEqual({ pitch: 0, elevation: 0 });
});
