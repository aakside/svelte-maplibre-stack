import type { Polygon } from "geojson";
import maplibregl, { type MapOptions } from "maplibre-gl";

export type LatLng = { lat: number; lng: number };

export interface FirstLayer {
  bearing: number;
  center: LatLng;
  geojson?: Polygon;
  opacity?: number;
  style?: string | maplibregl.StyleSpecification;
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
  geojson: Polygon;
  /**
   * The point on the overlay that should be aligned with the base map position (`baseMapPosition`). This is needed to compute the center of the overlay map based on the base map's center and the layer's base map position.
   */
  overlayCenter: LatLng;
}

export type Layers = [FirstLayer, ...OverlayLayer[]];

export class MapState {
  layers: MapLayer[];
  layerBeingMoved = $state<{
    index: number | undefined;
    center?: LatLng;
  }>({ index: undefined, center: undefined });
  previousBasemapBearing: number = $state(0);
  center: LatLng;
  maxPitch?: MapOptions["maxPitch"];
  minPitch?: MapOptions["minPitch"];
  pitch?: MapOptions["pitch"] = $state(undefined);
  roll?: MapOptions["roll"] = $state(undefined);
  elevation?: MapOptions["elevation"] = $state(undefined);
  style: MapOptions["style"] = $state(
    "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  );
  zoom: Required<MapOptions>["zoom"];
  containerDimensions = $state({ x: 0, y: 0 });
  isBaseMapLoaded = $state(false);

  constructor(
    layers: Layers,
    minPitch?: MapOptions["minPitch"],
    maxPitch?: MapOptions["maxPitch"],
  ) {
    this.minPitch = $state(minPitch);
    this.maxPitch = $state(maxPitch);
    this.zoom = $state(layers[0].zoom ?? 4);
    const centerLngLat = maplibregl.LngLat.convert(layers[0].center ?? { lat: 0, lng: 0 });
    this.center = $state({ lat: centerLngLat.lat, lng: centerLngLat.lng });
    this.layers = $state(layers.map((layer, index) => new MapLayer(this, index, layer)));
    $effect.pre(() => {
      this.previousBasemapBearing = this.layers[0].bearing;
    });
  }
}

class MapLayer {
  baseMapPosition: LatLng;
  bearing: number = $state(0);
  center: LatLng;
  clipPath?: string;
  map?: maplibregl.Map = $state(undefined);
  projectionRevision: number = $state(0);
  opacity: number = $state(1);
  overlayCenter: LatLng;
  style?: MapOptions["style"];
  visible: boolean = $state(true);
  protected index: number;
  private lastProjectionCameraSignature = "";

  constructor(
    private mapState: MapState,
    index: number,
    layerConfig: FirstLayer | OverlayLayer,
  ) {
    this.index = index;
    this.baseMapPosition = $state(
      index === 0 ? layerConfig.center! : (layerConfig as OverlayLayer).baseMapPosition,
    );
    this.bearing = layerConfig.bearing;
    this.overlayCenter = (layerConfig as OverlayLayer).overlayCenter ?? layerConfig.center!;
    this.style = $state(layerConfig.style);
    this.center = $derived.by(() => {
      if (index === 0) {
        return mapState.center;
      }
      const _ = [mapState.center, mapState.layerBeingMoved.index, mapState.zoom];
      if (this.map) {
        const baseMapPositionPoint = mapState.layers[0].map!.project(this.baseMapPosition);
        const overlayCenterPoint = this.map.project(this.overlayCenter);
        return this.map.unproject(
          new maplibregl.Point(mapState.containerDimensions.x, mapState.containerDimensions.y)
            .div(2)
            .add(overlayCenterPoint)
            .sub(baseMapPositionPoint),
        );
      }
      return layerConfig.center ?? this.overlayCenter;
    });
    this.clipPath = $derived.by<string | undefined>(() => {
      const _ = [
        mapState.layers[0].bearing,
        this.baseMapPosition.lat,
        this.baseMapPosition.lng,
        this.bearing,
        this.center,
        this.projectionRevision,
        mapState.layerBeingMoved.center,
        mapState.pitch,
        mapState.zoom,
      ];
      if (!this.map || !layerConfig.geojson) {
        return undefined;
      }
      const pathData = layerConfig.geojson.coordinates
        .map((ring) => {
          if (ring.length === 0) {
            return "";
          }
          const [start, ...rest] = ring;
          const startPoint = this.map!.project(start as maplibregl.LngLatLike);
          const segments = rest
            .map(([lng, lat]) => {
              const point = this.map!.project([lng, lat]);
              return `L ${point.x} ${point.y}`;
            })
            .join(" ");
          return `M ${startPoint.x} ${startPoint.y} ${segments} Z`;
        })
        .filter(Boolean)
        .join(" ");
      return pathData.length > 0 ? `path("${pathData}")` : undefined;
    });
  }

  markProjectionStaleFromMap() {
    if (this.map) {
      const center = this.map.getCenter();
      const signature = [
        center.lat,
        center.lng,
        this.map.getZoom(),
        this.map.getBearing(),
        this.map.getPitch(),
      ].join("|");

      if (signature !== this.lastProjectionCameraSignature) {
        this.lastProjectionCameraSignature = signature;
        this.projectionRevision += 1;
      }
    }
  }
}
