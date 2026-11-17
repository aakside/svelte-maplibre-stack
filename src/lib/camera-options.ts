import type { JumpToOptions } from "maplibre-gl";
/** MapLibre treats some explicitly undefined camera properties as supplied values. */
export function cameraOptions(options: JumpToOptions): JumpToOptions {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}
