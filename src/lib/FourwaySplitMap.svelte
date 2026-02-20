<script lang="ts">
  // This is a playground for testing out ideas for the Map component.
  // It is not meant to be a production-ready component.

  import maplibregl from "maplibre-gl";
  import { MapLibre, Projection } from "svelte-maplibre-gl";

  const INITIAL_ZOOM = 3.5;

  let centers = $state([
    { lng: 137, lat: 36.5 },
    { lng: -70, lat: 40 },
    { lng: 70, lat: -36.5 },
    { lng: -90, lat: -50 },
  ]);
  // svelte-ignore state_referenced_locally
  let previousBasemapCenter = $state(centers[0]); // eslint-disable-line svelte/prefer-writable-derived
  $effect(() => {
    previousBasemapCenter = centers[0];
  });
  let zoom = $state(INITIAL_ZOOM);
  let bearings = $state([0, 30, 60, 90]);
  // eslint-disable-next-line svelte/prefer-writable-derived
  let previousBasemapBearing = $state(0);
  $effect(() => {
    previousBasemapBearing = bearings[0];
  });
  let pitch = $state(0);
  let roll: number | undefined = $state(undefined);
  let elevation: number | undefined = $state(undefined);

  let width = $state(0);
  let height = $state(0);
  const dimensions = $derived(new maplibregl.Point(width, height));

  let maps: (maplibregl.Map | undefined)[] = $state([undefined, undefined, undefined, undefined]);

  export const ro = (node: Element) => {
    const ro = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  };
</script>

<div use:ro role="application" style="height: 100%; width: 100%;">
  <MapLibre
    style="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
    inlineStyle={"height: 100%; width: 100%; margin: 0px; padding: 0px; position: absolute; clip: rect(0px, " +
      width / 2 +
      "px, " +
      height / 2 +
      "px, 0px);"}
    bind:center={
      () => centers[0],
      (value) => {
        const previousCenterPoint = maps[0]?.project(previousBasemapCenter);
        const newCenterPoint = dimensions.sub(previousCenterPoint ?? new maplibregl.Point(0, 0));
        centers = [
          value,
          maps[1]?.unproject(newCenterPoint) ?? centers[1],
          maps[2]?.unproject(newCenterPoint) ?? centers[2],
          maps[3]?.unproject(newCenterPoint) ?? centers[3],
        ];
      }
    }
    bind:map={maps[0]}
    bind:zoom
    bind:bearing={
      () => bearings[0],
      (value) =>
        (bearings = [
          value,
          bearings[1] + (value - previousBasemapBearing),
          bearings[2] + (value - previousBasemapBearing),
          bearings[3] + (value - previousBasemapBearing),
        ])
    }
    bind:pitch
    bind:roll
    bind:elevation
    minPitch={0}
    maxPitch={0}
    attributionControl={false}
  >
    <Projection type="globe" />
  </MapLibre>
  <MapLibre
    style="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    inlineStyle={"height: 100%; width: 100%; margin: 0px; padding: 0px; position: absolute; clip: rect(0px, " +
      width +
      "px, " +
      height / 2 +
      "px, " +
      width / 2 +
      "px);"}
    bind:center={centers[1]}
    bind:map={maps[1]}
    bind:zoom={
      () =>
        zoom -
        Math.log2(
          Math.cos((centers[0].lat * Math.PI) / 180) / Math.cos((centers[1].lat * Math.PI) / 180),
        ),
      (value) =>
        (zoom =
          value -
          Math.log2(
            Math.cos((centers[1].lat * Math.PI) / 180) / Math.cos((centers[0].lat * Math.PI) / 180),
          ))
    }
    bind:bearing={
      () => bearings[1], (value) => (bearings = [bearings[0], value, bearings[2], bearings[3]])
    }
    bind:pitch
    bind:roll
    bind:elevation
    minPitch={0}
    maxPitch={0}
    attributionControl={false}
  >
    <Projection type="globe" />
  </MapLibre>
  <MapLibre
    style="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
    inlineStyle={"height: 100%; width: 100%; margin: 0px; padding: 0px; position: absolute; clip: rect(" +
      height / 2 +
      "px, " +
      width / 2 +
      "px, " +
      height +
      "px, 0px);"}
    bind:center={centers[2]}
    bind:map={maps[2]}
    bind:zoom={
      () =>
        zoom -
        Math.log2(
          Math.cos((centers[0].lat * Math.PI) / 180) / Math.cos((centers[2].lat * Math.PI) / 180),
        ),
      (value) =>
        (zoom =
          value -
          Math.log2(
            Math.cos((centers[2].lat * Math.PI) / 180) / Math.cos((centers[0].lat * Math.PI) / 180),
          ))
    }
    bind:bearing={
      () => bearings[2], (value) => (bearings = [bearings[0], bearings[1], value, bearings[3]])
    }
    bind:pitch
    bind:roll
    bind:elevation
    minPitch={0}
    maxPitch={0}
    attributionControl={false}
  >
    <Projection type="globe" />
  </MapLibre>
  <MapLibre
    style="https://demotiles.maplibre.org/style.json"
    inlineStyle={"height: 100%; width: 100%; margin: 0px; padding: 0px; position: absolute; clip: rect(" +
      height / 2 +
      "px, " +
      width +
      "px, " +
      height +
      "px, " +
      width / 2 +
      "px);"}
    bind:center={centers[3]}
    bind:map={maps[3]}
    bind:zoom={
      () =>
        zoom -
        Math.log2(
          Math.cos((centers[0].lat * Math.PI) / 180) / Math.cos((centers[3].lat * Math.PI) / 180),
        ),
      (value) =>
        (zoom =
          value -
          Math.log2(
            Math.cos((centers[3].lat * Math.PI) / 180) / Math.cos((centers[0].lat * Math.PI) / 180),
          ))
    }
    bind:bearing={
      () => bearings[3], (value) => (bearings = [bearings[0], bearings[1], bearings[2], value])
    }
    bind:pitch
    bind:roll
    bind:elevation
    minPitch={0}
    maxPitch={0}
    attributionControl={false}
  >
    <Projection type="globe" />
  </MapLibre>
</div>
