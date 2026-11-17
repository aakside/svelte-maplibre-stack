import type { MultiPolygon, Polygon } from "geojson";
import { mapGeometry, createTransform } from "./vector-tiles.js";
import maplibregl, { type MapOptions } from "maplibre-gl";

export const DEFAULT_STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

export type LatLng = { lat: number; lng: number };

type RegionGeometry = Polygon | MultiPolygon;

function getPolygonRings(geometry: RegionGeometry): Polygon["coordinates"] {
  return geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : geometry.coordinates;
}

function ringToPathData(map: maplibregl.Map, ring: Polygon["coordinates"][number]): string {
  if (ring.length === 0) {
    return "";
  }

  const [start, ...rest] = ring;
  const startPoint = map.project(start as maplibregl.LngLatLike);
  const segments = rest
    .map(([lng, lat]) => {
      const point = map.project([lng, lat]);
      return `L ${point.x} ${point.y}`;
    })
    .join(" ");
  return `M ${startPoint.x} ${startPoint.y} ${segments} Z`;
}

function geometryToPath(map?: maplibregl.Map, geometry?: RegionGeometry): string | undefined {
  if (map && geometry) {
    const pathData = getPolygonRings(geometry)
      .map((ring) => ringToPathData(map, ring))
      .filter(Boolean)
      .join(" ");
    return pathData.length > 0 ? pathData : undefined;
  }
}

export interface FirstLayer {
  bearing: number;
  center: LatLng;
  pathBorderColor?: string;
  pathBorderWidth?: number;
  geojson?: RegionGeometry;
  opacity?: number;
  pitch?: MapOptions["pitch"];
  style?: MapOptions["style"];
  visible: boolean;
  zoom?: number;
}

export interface OverlayLayer extends Omit<FirstLayer, "center" | "geojson"> {
  /**
   * The position on the base map that the overlay layer should be anchored to.
   */
  baseMapPosition: LatLng;
  /**
   * The center of the overlay map initially used to guide the calculation of the overlay map's center.
   */
  center?: LatLng;
  geojson: RegionGeometry;
  /**
   * The point on the overlay that should be aligned with the base map position (`baseMapPosition`). This is needed to compute the center of the overlay map based on the base map's center and the layer's base map position.
   */
  overlayCenter: LatLng;
}

export type LayerConfigs = [FirstLayer, ...OverlayLayer[]];

interface ToLayerConfigsOptions {
  includeGeojson?: boolean;
}

export class MapState {
  layers: MapLayer[];
  layerBeingMoved = $state<{ index: number | undefined; center?: LatLng }>({ index: undefined });
  center: LatLng;
  maxPitch?: MapOptions["maxPitch"];
  minPitch?: MapOptions["minPitch"];
  pitch: MapOptions["pitch"];
  roll: MapOptions["roll"] = $state(undefined);
  elevation: MapOptions["elevation"] = $state(undefined);
  zoom: number;
  containerDimensions = $state({ x: 0, y: 0 });
  isBaseMapLoaded = $state(false);
  error = $state<Error | undefined>();
  additionalAttributions: string[] = $state([]);
  attributionControl = $state<maplibregl.AttributionControl>();

  constructor(
    configs: LayerConfigs,
    minPitch?: MapOptions["minPitch"],
    maxPitch?: MapOptions["maxPitch"],
  ) {
    if (!configs.length) throw new Error("A base layer is required");
    this.minPitch = $state(minPitch);
    this.maxPitch = $state(maxPitch);
    this.center = $state(configs[0].center);
    this.pitch = $state(configs[0].pitch);
    this.zoom = $state(configs[0].zoom ?? 4);
    this.layers = $state(configs.map((config, index) => new MapLayer(this, index, config)));
  }
  addLayer(config: OverlayLayer) {
    const layer = new MapLayer(this, this.layers.length, config);
    this.layers.push(layer);
    return layer.id;
  }
  flyToLayer(index: number) {
    if (index > 0 && index < this.layers.length)
      this.layers[0].map?.flyTo({ center: this.layers[index].baseMapPosition });
  }
  removeLayer(index: number) {
    if (!Number.isInteger(index) || index <= 0 || index >= this.layers.length)
      throw new Error("Invalid layer index");
    return this.layers.splice(index, 1)[0].id;
  }
  setBearing(index: number, bearing: number) {
    const delta = bearing - this.layers[index].bearing;
    this.layers.forEach((layer, i) => {
      if (i === index) layer.bearing = bearing;
      else if (index === 0 && !layer.isBearingLocked) layer.bearing += delta;
    });
  }
  toLayerConfigs(options: ToLayerConfigsOptions = {}): LayerConfigs {
    return this.layers.map((layer, index) => ({
      bearing: layer.bearing,
      center: index === 0 ? this.center : layer.center,
      geojson: options.includeGeojson ? layer.geojson : undefined,
      opacity: layer.opacity,
      style: layer.style,
      visible: layer.visible,
      pathBorderColor: layer.pathBorderColor,
      pathBorderWidth: layer.pathBorderWidth,
      ...(index === 0
        ? { pitch: this.pitch, zoom: this.zoom }
        : { baseMapPosition: layer.baseMapPosition, overlayCenter: layer.overlayCenter }),
    })) as LayerConfigs;
  }
  update(configs: LayerConfigs) {
    if (!configs.length) throw new Error("A base layer is required");
    this.center = configs[0].center;
    this.pitch = configs[0].pitch;
    this.zoom = configs[0].zoom ?? this.zoom;
    configs.forEach((config, index) => {
      if (this.layers[index]) this.layers[index].update(config);
      else this.addLayer(config as OverlayLayer);
    });
    this.layers.splice(configs.length);
  }
}

export class MapLayer {
  id: string;
  baseMapPosition: LatLng;
  overlayCenter: LatLng;
  bearing = $state(0);
  center: LatLng;
  pathBorderColor?: string;
  pathBorderWidth?: number;
  path?: string;
  clipPath?: string;
  geojson?: RegionGeometry;
  isBearingLocked = $state(false);
  map = $state<maplibregl.Map>();
  projectionRevision = $state(0);
  styleUpdateIteration = $state(0);
  opacity: number;
  style?: MapOptions["style"];
  visible = $state(true);
  attributions: string[] = $state([]);

  constructor(
    private mapState: MapState,
    private index: number,
    config: FirstLayer | OverlayLayer,
    id?: string,
  ) {
    this.id = id ?? `layer-${crypto.randomUUID()}`;
    this.baseMapPosition = $state(
      index === 0 ? config.center! : (config as OverlayLayer).baseMapPosition,
    );
    this.overlayCenter = $state((config as OverlayLayer).overlayCenter ?? config.center!);
    this.bearing = config.bearing;
    this.geojson = $state(config.geojson);
    this.opacity = $state(config.opacity ?? 1);
    this.visible = config.visible;
    this.pathBorderColor = $state(config.pathBorderColor);
    this.pathBorderWidth = $state(config.pathBorderWidth);
    this.style = $state(config.style ?? (index === 0 ? DEFAULT_STYLE_URL : undefined));
    this.center = $derived(index === 0 ? mapState.center : this.overlayCenter);
    this.path = $derived.by(() => {
      const _ = this.projectionRevision;
      const geometry =
        this.geojson && index > 0
          ? (mapGeometry(
              this.geojson,
              createTransform({
                overlayCenter: this.overlayCenter,
                baseMapPosition: this.baseMapPosition,
                bearing: this.bearing - mapState.layers[0].bearing,
              }).forward,
            ) as RegionGeometry)
          : this.geojson;
      return geometryToPath(this.map, geometry);
    });
    this.clipPath = $derived(this.path ? `path("${this.path}")` : undefined);
  }
  get attributionControl(): maplibregl.AttributionControl | undefined {
    return this.mapState.attributionControl;
  }
  markProjectionStaleFromMap() {
    this.projectionRevision++;
  }
  toggleVisibility() {
    this.visible = !this.visible;
  }
  update(config: FirstLayer | OverlayLayer) {
    this.baseMapPosition = (config as OverlayLayer).baseMapPosition ?? config.center!;
    this.overlayCenter = (config as OverlayLayer).overlayCenter ?? config.center!;
    this.bearing = config.bearing;
    this.geojson = config.geojson;
    this.opacity = config.opacity ?? 1;
    this.pathBorderColor = config.pathBorderColor;
    this.pathBorderWidth = config.pathBorderWidth;
    this.style = config.style ?? (this.index === 0 ? DEFAULT_STYLE_URL : undefined);
    this.visible = config.visible;
  }
}
