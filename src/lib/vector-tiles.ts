import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import vtpbf from "vt-pbf";
import geojsonvt from "geojson-vt";
import polygonClipping from "polygon-clipping";
import type { Feature, Geometry, Polygon, MultiPolygon, Position } from "geojson";

export type Region = Polygon | MultiPolygon;
export type Point = [number, number];
export interface Placement {
  overlayCenter: { lng: number; lat: number };
  baseMapPosition: { lng: number; lat: number };
  /** Clockwise map bearing relative to the base camera. */
  bearing: number;
}
export interface Contribution {
  id: string;
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  scheme?: "xyz" | "tms";
  region?: Region;
  placement?: Placement;
}
export interface TileID {
  z: number;
  x: number;
  y: number;
}

// Web Mercator's finite domain, defined by atan(sinh(pi)).
const MAX_LATITUDE = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;
export function project([lng, lat]: Position): Point {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > MAX_LATITUDE) {
    throw new Error("Overlay coordinates must be within the Web Mercator domain");
  }
  return [(lng + 180) / 360, (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2];
}
export function unproject([x, y]: Position): Point {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}
export function createTransform(placement: Placement) {
  const source = project([placement.overlayCenter.lng, placement.overlayCenter.lat]);
  const destination = project([placement.baseMapPosition.lng, placement.baseMapPosition.lat]);
  const scale =
    Math.cos((placement.overlayCenter.lat * Math.PI) / 180) /
    Math.cos((placement.baseMapPosition.lat * Math.PI) / 180);
  const angle = (-placement.bearing * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const forwardWorld = ([x, y]: Position): Point => {
    const dx = x - source[0],
      dy = y - source[1];
    return [
      destination[0] + scale * (cos * dx - sin * dy),
      destination[1] + scale * (sin * dx + cos * dy),
    ];
  };
  const inverseWorld = ([x, y]: Position): Point => {
    const dx = (x - destination[0]) / scale,
      dy = (y - destination[1]) / scale;
    return [source[0] + cos * dx + sin * dy, source[1] - sin * dx + cos * dy];
  };
  return {
    scale,
    forwardWorld,
    inverseWorld,
    sourceWorld: (p: Position): Point => {
      const point = project(p);
      point[0] += Math.round(source[0] - point[0]);
      return point;
    },
    destination,
    forward: (p: Position) => {
      const point = project(p);
      point[0] += Math.round(source[0] - point[0]);
      return unproject(forwardWorld(point));
    },
    inverse: (p: Position) => {
      const point = project(p);
      point[0] += Math.round(destination[0] - point[0]);
      return unproject(inverseWorld(point));
    },
  };
}
export function mapGeometry(geometry: Geometry, transform: (p: Position) => Position): Geometry {
  if (geometry.type === "GeometryCollection")
    return { ...geometry, geometries: geometry.geometries.map((g) => mapGeometry(g, transform)) };
  const walk = (coordinates: unknown): unknown =>
    typeof (coordinates as unknown[])[0] === "number"
      ? transform(coordinates as Position)
      : (coordinates as unknown[]).map(walk);
  return { ...geometry, coordinates: walk(geometry.coordinates) } as Geometry;
}
function polygons(region: Region) {
  return region.type === "Polygon" ? [region.coordinates] : region.coordinates;
}
function inRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [px, py] = ring[j];
    if (y > point[1] !== py > point[1] && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x)
      inside = !inside;
  }
  return inside;
}
export function contains(point: Position, region: Region) {
  return polygons(region).some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h)),
  );
}
function clipLine(line: Position[], region: Region): Position[][] {
  const output: Position[][] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const cuts = [0, 1];
    for (const polygon of polygons(region))
      for (const ring of polygon)
        for (let j = 1; j < ring.length; j++) {
          const c = ring[j - 1],
            d = ring[j],
            ex = d[0] - c[0],
            ey = d[1] - c[1];
          const denominator = dx * ey - dy * ex;
          if (denominator === 0) continue;
          const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator;
          const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
        }
    cuts.sort((a, b) => a - b);
    const at = (t: number): Position => [a[0] + t * dx, a[1] + t * dy];
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] === cuts[j - 1] || !contains(at((cuts[j] + cuts[j - 1]) / 2), region)) continue;
      const start = at(cuts[j - 1]),
        end = at(cuts[j]);
      const previous = output.at(-1);
      if (previous && previous.at(-1)![0] === start[0] && previous.at(-1)![1] === start[1])
        previous.push(end);
      else output.push([start, end]);
    }
  }
  return output;
}
const regionBounds = new WeakMap<Region, { box: ReturnType<typeof bounds>; rectangle: boolean }>();
export function clipGeometry(geometry: Geometry, region: Region): Geometry | null {
  let cached = regionBounds.get(region);
  if (!cached) {
    const box = bounds(region);
    const rings = polygons(region);
    const ring = rings[0]?.[0];
    const rectangle =
      rings.length === 1 &&
      rings[0].length === 1 &&
      ring.length === 5 &&
      ring.every(
        (p, i) =>
          (p[0] === box[0] || p[0] === box[2]) &&
          (p[1] === box[1] || p[1] === box[3]) &&
          (i === 0 || p[0] === ring[i - 1][0] || p[1] === ring[i - 1][1]),
      );
    cached = { box, rectangle };
    regionBounds.set(region, cached);
  }
  const a = bounds(geometry),
    b = cached.box;
  if (a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]) return null;
  if (cached.rectangle && a[0] > b[0] && a[1] > b[1] && a[2] < b[2] && a[3] < b[3]) return geometry;

  switch (geometry.type) {
    case "Point":
      return contains(geometry.coordinates, region) ? geometry : null;
    case "MultiPoint": {
      const coordinates = geometry.coordinates.filter((p) => contains(p, region));
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case "LineString":
    case "MultiLineString": {
      const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
      const coordinates = lines.flatMap((line) => clipLine(line, region));
      return coordinates.length ? { type: "MultiLineString", coordinates } : null;
    }
    case "Polygon":
    case "MultiPolygon": {
      const coordinates = polygonClipping.intersection(
        polygons(geometry) as polygonClipping.MultiPolygon,
        polygons(region) as polygonClipping.MultiPolygon,
      );
      return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
    }
    case "GeometryCollection": {
      const geometries = geometry.geometries
        .map((g) => clipGeometry(g, region))
        .filter((g) => g !== null);
      return geometries.length ? { type: "GeometryCollection", geometries } : null;
    }
  }
}
function bounds(geometry: Geometry): [number, number, number, number] {
  const result: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coordinates: unknown): void => {
    const values = coordinates as unknown[];
    if (typeof values[0] === "number") {
      const p = coordinates as Position;
      result[0] = Math.min(result[0], p[0]);
      result[1] = Math.min(result[1], p[1]);
      result[2] = Math.max(result[2], p[0]);
      result[3] = Math.max(result[3], p[1]);
    } else for (const child of values) visit(child);
  };
  const walk = (g: Geometry): void => {
    if (g.type === "GeometryCollection") g.geometries.forEach(walk);
    else visit(g.coordinates);
  };
  walk(geometry);
  return result;
}
/** Prepared source geometry is independent of destination placement and style namespace. */
export function createTilePreparation() {
  const keys = new WeakMap<Contribution, string>();
  const regions = new Map<
    string,
    { geometry: Region; bbox: ReturnType<typeof bounds>; id: number }
  >();
  const tiles = new Map<string, Record<string, Feature[]>>();
  return {
    keys,
    regions,
    tiles,
    clear() {
      regions.clear();
      tiles.clear();
    },
  };
}

export async function mergeTile(
  tile: TileID,
  contributions: Contribution[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  preparation = createTilePreparation(),
): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (contributions.length > 1) {
    const parts = await Promise.all(
      contributions.map((contribution) =>
        mergeTile(tile, [contribution], signal, fetcher, preparation),
      ),
    );
    return joinTiles(parts);
  }
  const layers: Record<string, geojsonvt.Tile> = {};
  const passthrough: Uint8Array[] = [];
  const count = 2 ** tile.z;
  // Match geojson-vt's documented buffer/extent so labels and strokes cross tile edges.
  const buffer = 64 / 4096;
  for (const contribution of contributions) {
    if (
      !contribution.region &&
      !contribution.placement &&
      tile.z >= contribution.minzoom &&
      tile.z <= contribution.maxzoom
    ) {
      const url = contribution.tiles[0]
        .replaceAll("{z}", String(tile.z))
        .replaceAll("{x}", String(tile.x))
        .replaceAll(
          "{y}",
          String(contribution.scheme === "tms" ? 2 ** tile.z - 1 - tile.y : tile.y),
        );
      const response = await fetcher(url, { signal });
      if (!response.ok) throw new Error(`Vector tile ${url}: HTTP ${response.status}`);
      const decoded = new VectorTile(new Pbf(await response.arrayBuffer()));
      const renamed = Object.fromEntries(
        Object.entries(decoded.layers).map(([name, layer]) => {
          layer.name = `${contribution.id}/${name}`;
          return [layer.name, layer];
        }),
      );
      passthrough.push(
        vtpbf.fromVectorTileJs({ layers: renamed } as unknown as Parameters<
          typeof vtpbf.fromVectorTileJs
        >[0]),
      );
      continue;
    }

    const transform = contribution.placement ? createTransform(contribution.placement) : undefined;
    const inverse = transform?.inverseWorld ?? ((p: Position) => p);
    const worldOffset = transform
      ? Math.round(transform.destination[0] - (tile.x + 0.5) / count)
      : 0;
    const corners = [
      [tile.x - buffer, tile.y - buffer],
      [tile.x + 1 + buffer, tile.y - buffer],
      [tile.x + 1 + buffer, tile.y + 1 + buffer],
      [tile.x - buffer, tile.y + 1 + buffer],
    ].map((p) => inverse([p[0] / count + worldOffset, p[1] / count]));
    const bbox = [
      Math.min(...corners.map((p) => p[0])),
      Math.min(...corners.map((p) => p[1])),
      Math.max(...corners.map((p) => p[0])),
      Math.max(...corners.map((p) => p[1])),
    ];
    let regionKey = preparation.keys.get(contribution);
    if (!regionKey) {
      regionKey = JSON.stringify([contribution.region, contribution.placement?.overlayCenter]);
      preparation.keys.set(contribution, regionKey);
    }
    let preparedRegion = preparation.regions.get(regionKey);
    if (!preparedRegion && contribution.region) {
      const geometry = mapGeometry(
        contribution.region,
        transform?.sourceWorld ?? project,
      ) as Region;
      preparedRegion = { geometry, bbox: bounds(geometry), id: preparation.regions.size };
      preparation.regions.set(regionKey, preparedRegion);
    }
    const worldRegion = preparedRegion?.geometry;
    if (preparedRegion) {
      const b = preparedRegion.bbox;
      bbox[0] = Math.max(bbox[0], b[0]);
      bbox[1] = Math.max(bbox[1], b[1]);
      bbox[2] = Math.min(bbox[2], b[2]);
      bbox[3] = Math.min(bbox[3], b[3]);
    }
    if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) continue;
    const z = Math.max(
      contribution.minzoom,
      Math.min(contribution.maxzoom, Math.round(tile.z + Math.log2(transform?.scale ?? 1))),
    );
    const n = 2 ** z;
    const features: Record<string, Feature[]> = {};
    const jobs: Promise<void>[] = [];
    for (let x = Math.floor(bbox[0] * n); x <= Math.floor(bbox[2] * n); x++)
      for (
        let y = Math.max(0, Math.floor(bbox[1] * n));
        y <= Math.min(n - 1, Math.floor(bbox[3] * n));
        y++
      ) {
        jobs.push(
          (async () => {
            signal.throwIfAborted();
            const ownership: Polygon = {
              type: "Polygon",
              coordinates: [
                [
                  [x / n, y / n],
                  [(x + 1) / n, y / n],
                  [(x + 1) / n, (y + 1) / n],
                  [x / n, (y + 1) / n],
                  [x / n, y / n],
                ],
              ],
            };
            const tileRegion = worldRegion
              ? (clipGeometry(worldRegion, ownership) as Region | null)
              : ownership;
            if (!tileRegion) return;
            const wrappedX = ((x % n) + n) % n;
            const url = contribution.tiles[0]
              .replaceAll("{z}", String(z))
              .replaceAll("{x}", String(wrappedX))
              .replaceAll("{y}", String(contribution.scheme === "tms" ? n - 1 - y : y));
            const cacheKey = JSON.stringify([preparedRegion?.id, url, x, y]);
            let prepared = preparation.tiles.get(cacheKey);
            if (!prepared) {
              const response = await fetcher(url, { signal });
              if (!response.ok) throw new Error(`Vector tile ${url}: HTTP ${response.status}`);
              const bytes = await response.arrayBuffer();
              signal.throwIfAborted();
              // A sibling destination tile may have prepared this source during the fetch.
              prepared = preparation.tiles.get(cacheKey);
              if (!prepared) {
                prepared = {};
                const decoded = new VectorTile(new Pbf(bytes));
                for (const [name, layer] of Object.entries(decoded.layers)) {
                  const items: Feature[] = [];
                  for (let i = 0; i < layer.length; i++) {
                    const feature = layer.feature(i).toGeoJSON(x, y, z);
                    const world = mapGeometry(feature.geometry, (point) =>
                      project([
                        point[0],
                        Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point[1])),
                      ]),
                    );
                    const geometry = clipGeometry(world, tileRegion);
                    if (geometry) items.push({ ...feature, geometry });
                  }
                  prepared[name] = items;
                }
                preparation.tiles.set(cacheKey, prepared);
              }
            }
            for (const [name, items] of Object.entries(prepared)) {
              const key = `${contribution.id}/${name}`;
              features[key] ??= [];
              for (const feature of items) {
                const geometry = mapGeometry(feature.geometry, (p) =>
                  unproject(transform ? transform.forwardWorld(p) : p),
                );
                features[key].push({ ...feature, geometry });
              }
            }
          })(),
        );
      }
    await Promise.all(jobs);
    for (const [key, items] of Object.entries(features)) {
      if (!items.length) continue;
      const generated = geojsonvt(
        { type: "FeatureCollection", features: items },
        { maxZoom: tile.z, indexMaxZoom: 0, tolerance: 0 },
      ).getTile(tile.z, tile.x, tile.y);
      if (generated) layers[key] = generated;
    }
  }
  signal.throwIfAborted();
  return joinTiles([...passthrough, encodeTile(layers)]);
}
function joinTiles(pieces: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(pieces.reduce((size, piece) => size + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    result.set(piece, offset);
    offset += piece.length;
  }
  return result;
}

/** vt-pbf's upstream declaration incorrectly accepts indexes rather than tiles. */
export function encodeTile(layers: Record<string, geojsonvt.Tile>): Uint8Array {
  return vtpbf.fromGeojsonVt(layers as unknown as Parameters<typeof vtpbf.fromGeojsonVt>[0]);
}
