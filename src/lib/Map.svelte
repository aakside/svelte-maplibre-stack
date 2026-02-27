<script lang="ts">
  import type { Polygon } from "geojson";
  import maplibregl, { type MapOptions } from "maplibre-gl";
  import { untrack } from "svelte";
  import { MapLibre, Projection } from "svelte-maplibre-gl";

  export interface FirstLayer {
    bearing: number;
    geojson?: Polygon;
    opacity?: number;
    style?: string | maplibregl.StyleSpecification;
  }

  export interface OverlayLayer extends Omit<FirstLayer, "center" | "geojson"> {
    /**
     * The position on the base map that the overlay layer should be anchored to.
     */
    baseMapPosition: maplibregl.LngLat;
    /**
     * The center of the overlay map initially used to guide the calculation of the overlay map's center.
     */
    center?: maplibregl.LngLat;
    geojson: Polygon;
    /**
     * The point on the overlay that should be aligned with the base map position (`baseMapPosition`). This is needed to compute the center of the overlay map based on the base map's center and the layer's base map position.
     */
    overlayCenter: maplibregl.LngLat;
  }

  export type Layers = [FirstLayer, ...OverlayLayer[]];

  export interface MapState {
    baseMapPositions: maplibregl.LngLat[];
    bearings: number[];
    containerDimensions: { x: number; y: number };
  }

  interface Props {
    center: maplibregl.LngLat;
    layers: Layers;
    maxPitch?: MapOptions["maxPitch"];
    minPitch?: MapOptions["minPitch"];
    pitch?: MapOptions["pitch"];
    roll?: MapOptions["roll"];
    elevation?: MapOptions["elevation"];
    style?: MapOptions["style"];
    zoom?: MapOptions["zoom"];
  }

  let {
    center = $bindable(),
    elevation = $bindable(undefined),
    layers,
    maxPitch = $bindable(undefined),
    minPitch = $bindable(undefined),
    pitch = $bindable(0),
    roll = $bindable(undefined),
    style = $bindable("https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"),
    zoom = $bindable(5),
  }: Props = $props();

  let maps = $state<(maplibregl.Map | undefined)[]>([]);
  // eslint-disable-next-line svelte/prefer-writable-derived
  let previousBasemapBearing = $state(0);
  let isBaseMapLoaded = $state(false);

  export const mapState = $state<MapState>({
    baseMapPositions: [],
    bearings: [],
    containerDimensions: { x: 0, y: 0 },
  });

  let overlayGeneration = $state(0);
  let layerBeingMoved = $state<{
    index: number | undefined;
    center: maplibregl.LngLat | undefined;
  }>({ index: undefined, center: undefined });

  $effect.pre(() => {
    untrack(() => {
      if (maps.length > 1) {
        overlayGeneration++;
        maps = [maps[0], ...layers.slice(1).map(() => undefined)];
      } else {
        maps = layers.map(() => undefined);
      }
    });
    mapState.baseMapPositions = [
      untrack(() => center),
      ...layers.slice(1).map((layer) => (layer as OverlayLayer).baseMapPosition),
    ];
    mapState.bearings = layers.map((layer) => layer.bearing);
    previousBasemapBearing = layers[0].bearing;
  });

  let centers = $derived.by(() => {
    let _ = [mapState.bearings, layerBeingMoved.index, zoom];
    return maps.map((map, i) => {
      if (i === 0) {
        return center;
      }
      const layer = layers[i] as OverlayLayer;
      if (map) {
        const baseMapPositionPoint = maps[0]!.project(mapState.baseMapPositions[i]);
        const overlayCenterPoint = map.project(layer.overlayCenter);
        return map.unproject(
          new maplibregl.Point(mapState.containerDimensions.x, mapState.containerDimensions.y)
            .div(2)
            .add(overlayCenterPoint)
            .sub(baseMapPositionPoint),
        );
      }
      return layer.center ?? layer.overlayCenter;
    });
  });

  let clipPaths = $derived<(string | undefined)[]>(
    maps.map((map, index) => {
      const _ = [mapState.bearings[index], centers[index], layerBeingMoved.center, pitch, zoom];
      if (!maps[index] || !layers[index].geojson) {
        return undefined;
      }
      const pathData = layers[index].geojson.coordinates
        .map((ring) => {
          if (ring.length === 0) {
            return "";
          }
          const [start, ...rest] = ring;
          const startPoint = map!.project(start as maplibregl.LngLatLike);
          const segments = rest
            .map(([lng, lat]) => {
              const point = map!.project([lng, lat]);
              return `L ${point.x} ${point.y}`;
            })
            .join(" ");
          return `M ${startPoint.x} ${startPoint.y} ${segments} Z`;
        })
        .filter(Boolean)
        .join(" ");
      return pathData.length > 0 ? `path("${pathData}")` : undefined;
    }),
  );

  $effect(() => {
    previousBasemapBearing = mapState.bearings[0];
  });
</script>

<div style="height: 100%; width: 100%;" role="application">
  {#each maps as _, i (i === 0 ? "base" : `overlay-${i}-${overlayGeneration}`)}
    {#if isBaseMapLoaded || i === 0}
      <MapLibre
        attributionControl={i === 0 ? undefined : false}
        bind:bearing={
          () => mapState.bearings[i],
          (value) =>
            (mapState.bearings = mapState.bearings.map((bearing, bi) =>
              i === bi ? value : i === 0 ? bearing + (value - previousBasemapBearing) : bearing,
            ))
        }
        bind:center={
          () => {
            if (i === 0 || layerBeingMoved.index !== i) return centers[i];
          },
          (value) => {
            if (i === 0) {
              center = value!;
            }
            if (layerBeingMoved.index === i) {
              layerBeingMoved.center = value!;
            }
          }
        }
        bind:elevation
        inlineStyle={`
        height: 100%;
        margin: 0px;
        opacity: ` +
          (i === 0 ? 1 : (layers[i].opacity ?? 1)) +
          "; " +
          (clipPaths[i] ? `clip-path: ${clipPaths[i]};` : undefined) +
          `
        padding: 0px;
        position: absolute;
        width: 100%;
      `}
        bind:map={maps[i]}
        {maxPitch}
        {minPitch}
        ondragend={(event) => {
          layerBeingMoved.index = layerBeingMoved.index === i ? undefined : layerBeingMoved.index;
          if (i !== 0 && event.originalEvent) {
            const overlayCenterPoint = maps[i]!.project((layers[i] as OverlayLayer).overlayCenter);
            mapState.baseMapPositions[i] = maps[0]!.unproject(overlayCenterPoint);
          }
        }}
        ondragstart={() => {
          layerBeingMoved.index = i;
        }}
        onload={i === 0
          ? () => {
              mapState.containerDimensions.x = maps[i]!._container.clientWidth;
              mapState.containerDimensions.y = maps[i]!._container.clientHeight;
              isBaseMapLoaded = true;
            }
          : undefined}
        onresize={i === 0
          ? () => {
              mapState.containerDimensions.x = maps[i]!._container.clientWidth;
              mapState.containerDimensions.y = maps[i]!._container.clientHeight;
            }
          : undefined}
        bind:pitch
        bind:roll
        style={layers[i].style ?? style}
        bind:zoom={
          () =>
            i === 0
              ? zoom
              : zoom -
                Math.log2(
                  Math.cos((centers[0].lat * Math.PI) / 180) /
                    Math.cos((centers[i].lat * Math.PI) / 180),
                ),
          (value) => {
            zoom =
              i === 0
                ? value
                : value -
                  Math.log2(
                    Math.cos((centers[i].lat * Math.PI) / 180) /
                      Math.cos((centers[0].lat * Math.PI) / 180),
                  );
          }
        }
      >
        <Projection type="globe" />
      </MapLibre>
    {/if}
  {/each}
</div>
