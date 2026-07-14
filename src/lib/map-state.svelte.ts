import type { MultiPolygon, Polygon } from "geojson";
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
  additionalAttributions: string[];
  layers: MapLayer[];
  layerBeingMoved = $state<{
    index: number | undefined;
    center?: LatLng;
  }>({ index: undefined, center: undefined });
  previousBasemapBearing: number = $state(0);
  center: LatLng;
  maxPitch?: MapOptions["maxPitch"];
  minPitch?: MapOptions["minPitch"];
  pitch: MapOptions["pitch"];
  roll: MapOptions["roll"] = $state(undefined);
  elevation?: MapOptions["elevation"] = $state(undefined);
  zoom: Required<MapOptions>["zoom"];
  containerDimensions = $state({ x: 0, y: 0 });
  isBaseMapLoaded = $state(false);

  constructor(
    layerConfigs: LayerConfigs,
    minPitch?: MapOptions["minPitch"],
    maxPitch?: MapOptions["maxPitch"],
  ) {
    this.minPitch = $state(minPitch);
    this.maxPitch = $state(maxPitch);
    this.pitch = $state(layerConfigs[0].pitch);
    this.zoom = $state(layerConfigs[0].zoom ?? 4);
    const centerLngLat = maplibregl.LngLat.convert(layerConfigs[0].center ?? { lat: 0, lng: 0 });
    this.center = $state({ lat: centerLngLat.lat, lng: centerLngLat.lng });
    this.layers = $state(
      layerConfigs.map((layerConfig, index) => new MapLayer(this, index, layerConfig)),
    );
    this.additionalAttributions = $derived(
      this.layers.slice(1).flatMap((layer) => layer.attributions),
    );
    $effect.pre(() => {
      this.previousBasemapBearing = this.layers[0].bearing;
    });
    $effect(() => {
      if (this.layers[0].attributionControl) {
        this.layers[0].attributionControl.options.customAttribution = this.additionalAttributions;
        this.layers[0].attributionControl._updateAttributions();
      }
    });
  }

  /** Add an overlay layer to the map. */
  addLayer(layerConfig: OverlayLayer): string {
    const layer = new MapLayer(this, this.layers.length, layerConfig);
    this.layers.push(layer);
    return layer.id;
  }

  /** Reposition the base map to align with the center of the specified overlay layer. */
  flyToLayer(index: number) {
    if (index !== 0 && index < this.layers.length) {
      // TODO: Compute an appropriate zoom level based on the layer's bounds.
      this.layers[0].map?.flyTo({
        center: this.layers[index].baseMapPosition,
      });
    }
  }

  /** Remove the specified overlay layer. */
  removeLayer(index: number): string {
    if (index !== 0 && index < this.layers.length) {
      this.layers[index].map = undefined;
      const removedLayer = this.layers.splice(index, 1)[0];
      return removedLayer.id;
    } else {
      throw new Error("Invalid layer index");
    }
  }

  toLayerConfigs(options: ToLayerConfigsOptions = {}): LayerConfigs {
    const baseLayer: FirstLayer = {
      bearing: this.layers[0].bearing,
      center: this.center,
      geojson: options.includeGeojson ? this.layers[0].geojson : undefined,
      opacity: this.layers[0].opacity,
      pitch: this.pitch,
      style: this.layers[0].style,
      visible: this.layers[0].visible,
      zoom: this.zoom,
    };
    const overlayLayers: OverlayLayer[] = this.layers.slice(1).map((layer) => ({
      baseMapPosition: layer.baseMapPosition,
      bearing: layer.bearing,
      center: layer.center,
      geojson: options.includeGeojson ? layer.geojson : undefined,
      opacity: layer.opacity,
      style: layer.style,
      overlayCenter: layer.overlayCenter,
      visible: layer.visible,
    })) as OverlayLayer[];
    return [baseLayer, ...overlayLayers];
  }

  update(layers: LayerConfigs) {
    layers.forEach((layerConfig, i) => {
      if (i === 0) {
        this.center = layerConfig.center!;
        this.pitch = layerConfig.pitch;
        this.zoom = layerConfig.zoom ?? this.zoom;
        this.layers[0].update(layerConfig);
      } else if (i >= this.layers.length) {
        this.addLayer(layerConfig as OverlayLayer);
      } else {
        this.layers[i].update(layerConfig);
      }
    });
  }
}

export class MapLayer {
  attributions: string[];
  baseMapPosition: LatLng;
  bearing: number = $state(0);
  center: LatLng;
  pathBorderColor?: string;
  pathBorderWidth?: number;
  path?: string;
  clipPath?: string;
  geojson?: RegionGeometry;
  id: string;
  map?: maplibregl.Map = $state(undefined);
  projectionRevision: number = $state(0);
  opacity: number;
  overlayCenter: LatLng;
  style?: MapOptions["style"];
  styleUpdateIteration = $state(0);
  visible: boolean = $state(true);
  private lastProjectionCameraSignature = "";

  constructor(
    private mapState: MapState,
    private index: number,
    layerConfig: FirstLayer | OverlayLayer,
    id?: string,
  ) {
    this.id = id ?? `layer-${Math.random().toString(36).slice(2)}`;
    this.baseMapPosition = $state(
      index === 0 ? layerConfig.center! : (layerConfig as OverlayLayer).baseMapPosition,
    );
    this.bearing = layerConfig.bearing;
    this.pathBorderColor = $state(layerConfig.pathBorderColor);
    this.pathBorderWidth = $state(layerConfig.pathBorderWidth);
    this.opacity = $state(layerConfig.opacity ?? 1);
    this.overlayCenter = (layerConfig as OverlayLayer).overlayCenter ?? layerConfig.center!;
    this.geojson = $state(layerConfig.geojson);
    this.style = $state(layerConfig.style ?? (index === 0 ? DEFAULT_STYLE_URL : undefined));
    this.attributions = $derived.by(() => {
      const _ = [this.styleUpdateIteration];
      let attributions: Array<string> = [];
      if (this.attributionControl?.options.customAttribution) {
        if (Array.isArray(this.attributionControl.options.customAttribution)) {
          attributions = attributions.concat(
            this.attributionControl.options.customAttribution.map((attribution) =>
              typeof attribution !== "string" ? "" : attribution,
            ),
          );
        } else if (typeof this.attributionControl.options.customAttribution === "string") {
          attributions.push(this.attributionControl.options.customAttribution);
        }
      }
      const tileManagers = this.map?.style.tileManagers;
      for (const id in tileManagers) {
        const tileManager = tileManagers[id];
        if (tileManager.used || tileManager.usedForTerrain) {
          const source = tileManager.getSource();
          if (source.attribution && attributions.indexOf(source.attribution) < 0) {
            attributions.push(source.attribution);
          }
        }
      }
      return attributions;
    });
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
    this.path = $derived.by<string | undefined>(() => {
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
      return geometryToPath(this.map, this.geojson);
    });
    this.clipPath = $derived<string | undefined>(this.path ? `path("${this.path}")` : undefined);
  }

  get attributionControl(): maplibregl.AttributionControl | undefined {
    return this.map?._controls.find(
      (control) =>
        control instanceof maplibregl.AttributionControl ||
        Object.keys(control).includes("_toggleAttribution"),
    ) as maplibregl.AttributionControl | undefined;
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

  toggleVisibility() {
    this.visible = !this.visible;
  }

  update(layerConfig: FirstLayer | OverlayLayer) {
    this.baseMapPosition = (layerConfig as OverlayLayer).baseMapPosition ?? layerConfig.center;
    this.bearing = layerConfig.bearing;
    this.center = layerConfig.center!;
    this.pathBorderColor = layerConfig.pathBorderColor;
    this.pathBorderWidth = layerConfig.pathBorderWidth;
    this.geojson = layerConfig.geojson;
    this.opacity = layerConfig.opacity ?? 1;
    this.overlayCenter = (layerConfig as OverlayLayer).overlayCenter ?? layerConfig.center!;
    this.style = layerConfig.style ?? (this.index === 0 ? DEFAULT_STYLE_URL : undefined);
    this.visible = layerConfig.visible ?? true;
  }
}
