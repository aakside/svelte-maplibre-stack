<script lang="ts">
  import { center } from "@turf/turf";
  import type { Polygon } from "geojson";
  import maplibregl from "maplibre-gl";
  import { MapLibre, Projection } from "svelte-maplibre-gl";

  export interface Layer {
    baseMapCenter: maplibregl.LngLat;
    bearing: number;
    center: maplibregl.LngLat;
    geojson: Polygon;
    style?: string | maplibregl.StyleSpecification;
    zoom?: number;
  }

  export type FirstLayer = Omit<Layer, "baseMapCenter" | "geojson" | "zoom"> & {
    geojson?: Polygon;
    zoom: number;
  };

  interface Props {
    layers: [FirstLayer, ...Layer[]];
    style?: string | maplibregl.StyleSpecification;
  }

  let {
    layers = $bindable(),
    style = $bindable("https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"),
  }: Props = $props();

  let maps: (maplibregl.Map | undefined)[] = $state([]);

  let width = $state(0);
  let pixelRatio = $state(1);
  let prevBaseMapBearing = layers[0].bearing;
  let elevation: number | undefined = $state(undefined);
  let pitch = $state(0);
  let roll: number | undefined = $state(undefined);

  $effect(() => {
    if (layers.length > maps.length) {
      maps = [...maps, ...Array(layers.length - maps.length).fill(undefined)];
    } else if (layers.length < maps.length) {
      maps.slice(layers.length).forEach((map) => map?.remove());
      maps = maps.slice(0, layers.length);
    }
  });

  let layerSelectedGeometryCenters = $derived(
    layers.map((layer, index) =>
      maplibregl.LngLat.convert(
        index === 0
          ? layer.center
          : (center(layer.geojson!).geometry.coordinates as maplibregl.LngLatLike),
      ),
    ),
  );

  let layerBaseMapCenterPoints = $derived(
    layers.slice(1).map((layer) => {
      if (!maps[0]) {
        return { x: 0, y: 0 };
      }
      const _ = [layers[0].center, layers[0].zoom, pitch, width, pixelRatio];
      return maps[0].project((layer as Layer).baseMapCenter);
    }),
  );

  $effect(() => {
    layers.slice(1).forEach((layer, index) => {
      $effect(() => {
        layer.zoom =
          layers[0].zoom -
          Math.log2(
            Math.cos((layers[0].center.lat * Math.PI) / 180) /
              Math.cos((layer.center.lat * Math.PI) / 180),
          );
      });

      $effect(() => {
        layer.bearing += layers[0].bearing - prevBaseMapBearing;
      });

      $effect(() => {
        const map = maps[index + 1];
        if (map) {
          const selectedGeometryCenterPoint = map.project(layerSelectedGeometryCenters[index + 1]);
          layer.center = map.unproject([
            map._canvas.width / 2 / pixelRatio +
              (selectedGeometryCenterPoint.x - layerBaseMapCenterPoints[index].x),
            map._canvas.height / 2 / pixelRatio +
              (selectedGeometryCenterPoint.y - layerBaseMapCenterPoints[index].y),
          ]);
        }
      });
    });
  });

  let clipPaths = $derived<(string | undefined)[]>(
    layers.map((layer, index) => {
      const _ = [
        layer.center.lat,
        layer.center.lng,
        layers[index].zoom,
        layer.bearing,
        pitch,
        width,
      ];
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
    prevBaseMapBearing = layers[0].bearing;
  });

  export const ro = (node: Element) => {
    const ro = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      pixelRatio = maps[0]?._overridePixelRatio ?? window.devicePixelRatio;
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  };
</script>

<div style="height: 100%; width: 100%;" use:ro role="application">
  {#each layers as layer, i (i)}
    <MapLibre
      style={layer.style ?? style}
      inlineStyle={"height: 100%; width: 100%; margin: 0px; padding: 0px; position: absolute; " +
        (clipPaths[i] ? `clip-path: ${clipPaths[i]};` : undefined)}
      attributionControl={i === 0 ? undefined : false}
      aroundCenter={i === 0}
      bind:center={layer.center}
      bind:bearing={layer.bearing}
      bind:map={maps[i]}
      bind:zoom={
        () => layer.zoom, (layerZoom) => (layers[0].zoom = i === 0 ? layerZoom! : layers[0].zoom)
      }
      bind:pitch
      bind:roll
      bind:elevation
      minPitch={0}
      maxPitch={0}
      scrollZoom={i === 0}
      onmoveend={(ev) => {
        if (i !== 0 && ev.originalEvent) {
          const newSelectedGeometryCenterPoint = maps[i]!.project(layerSelectedGeometryCenters[i]);
          (layer as Layer).baseMapCenter = maps[0]!.unproject(newSelectedGeometryCenterPoint);
        }
      }}
    >
      <Projection type="globe" />
    </MapLibre>
  {/each}
</div>
