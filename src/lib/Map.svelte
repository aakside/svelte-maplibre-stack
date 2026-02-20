<script lang="ts">
  import type { Polygon } from "geojson";
  import maplibregl, { type MapOptions } from "maplibre-gl";
  import { createEventDispatcher, untrack } from "svelte";
  import { MapLibre, Projection } from "svelte-maplibre-gl";

  export interface CustomEvents {
    resize: { containerDimensions: [number, number] };
  }

  export interface FirstLayer {
    bearing: number;
    geojson?: Polygon;
    opacity?: number;
    style?: string | maplibregl.StyleSpecification;
  }

  export interface OverlayLayer extends Omit<FirstLayer, "geojson"> {
    /**
     * The position on the base map that the overlay layer should be anchored to.
     */
    baseMapPosition: maplibregl.LngLat;
    geojson: Polygon;
    /**
     * The point on the overlay that should be aligned with the base map position (`baseMapPosition`). This is needed to compute the center of the overlay map based on the base map's center and the layer's base map position.
     */
    overlayCenter: maplibregl.LngLat;
  }

  export type Layers = [FirstLayer, ...OverlayLayer[]];

  export interface MapState {
    containerDimensions: [number, number];
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
  let baseMapPositions = $state<maplibregl.LngLat[]>([]);
  let bearings = $state<number[]>([]);
  let previousBasemapBearing = $state(0);

  export const mapState = $state<MapState>({ containerDimensions: [0, 0] });

  let layerBeingMoved = $state<{
    index: number | undefined;
    center: maplibregl.LngLat | undefined;
  }>({ index: undefined, center: undefined });

  const dispatch = createEventDispatcher();

  $effect.pre(() => {
    if (layers.length > maps.length) {
      maps = [...maps, ...Array(layers.length - maps.length).fill(undefined)];
    } else if (layers.length < maps.length) {
      maps.slice(layers.length).forEach((map) => map?.remove());
      maps = maps.slice(0, layers.length);
    }
    baseMapPositions = [
      untrack(() => center),
      ...layers.slice(1).map((layer) => (layer as OverlayLayer).baseMapPosition),
    ];
    bearings = layers.map((layer) => layer.bearing);
    previousBasemapBearing = layers[0].bearing;
  });

  let centers = $derived.by(() => {
    let _ = [bearings, layerBeingMoved, zoom];
    return maps.map((map, i) => {
      if (i === 0) {
        return center;
      }
      if (map) {
        const baseMapPositionPoint = maps[0]!.project(baseMapPositions[i]);
        const selectedGeometryCenterPoint = map.project((layers[i] as OverlayLayer).overlayCenter);
        return map.unproject(
          maplibregl.Point.convert(mapState.containerDimensions)
            .div(2)
            .add(selectedGeometryCenterPoint)
            .sub(baseMapPositionPoint),
        );
      }
      return (layers[i] as OverlayLayer).overlayCenter;
    });
  });

  let clipPaths = $derived<(string | undefined)[]>(
    layers.map((layer, index) => {
      const _ = [bearings[index], centers[index], layerBeingMoved.center, pitch, zoom];
      if (!maps[index] || !layer.geojson) {
        return undefined;
      }
      const pathData = layer.geojson.coordinates
        .map((ring) => {
          if (ring.length === 0) {
            return "";
          }
          const [start, ...rest] = ring;
          const startPoint = maps[index]!.project(start as maplibregl.LngLatLike);
          const segments = rest
            .map(([lng, lat]) => {
              const point = maps[index]!.project([lng, lat]);
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
    previousBasemapBearing = bearings[0];
  });
</script>

<div style="height: 100vh; width: 100vw;" role="application">
  {#each maps as _, i (i)}
    <MapLibre
      attributionControl={i === 0 ? undefined : false}
      bind:bearing={
        () => bearings[i],
        (value) =>
          (bearings = bearings.map((bearing, bi) =>
            i === bi ? value : i === 0 ? bearing + (value - previousBasemapBearing) : bearing,
          ))
      }
      bind:center={
        () => {
          if (i === 0) return center;
          if (layerBeingMoved.index !== i) return centers[i];
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
          baseMapPositions[i] = maps[0]!.unproject(overlayCenterPoint);
        }
      }}
      ondragstart={() => {
        layerBeingMoved.index = i;
      }}
      onrender={i === 0
        ? () => {
            mapState.containerDimensions = [
              maps[i]!._container.clientWidth,
              maps[i]!._container.clientHeight,
            ];
            dispatch("resize", { containerDimensions: mapState.containerDimensions });
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
  {/each}
</div>
