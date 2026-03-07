<script lang="ts">
  import { MapLibre, Projection } from "svelte-maplibre-gl";
  import type { MapState } from "./map-state.svelte.ts";

  interface Props {
    mapState: MapState;
  }

  let { mapState = $bindable() }: Props = $props();
</script>

<div style="height: 100%; width: 100%;" role="application">
  {#each mapState.layers as layer, i (layer.id)}
    {#if mapState.isBaseMapLoaded || i === 0}
      <MapLibre
        attributionControl={i === 0 ? undefined : false}
        bind:bearing={
          () => mapState.layers[i].bearing,
          (value) =>
            mapState.layers.forEach(
              (layer, li) =>
                (layer.bearing =
                  li === i
                    ? value
                    : i === 0
                      ? layer.bearing + (value - mapState.previousBasemapBearing)
                      : layer.bearing),
            )
        }
        bind:center={
          () => {
            if (i === 0 || mapState.layerBeingMoved.index !== i) return layer.center;
          },
          (value) => {
            if (i === 0) {
              mapState.center = value!;
            }
            if (mapState.layerBeingMoved.index === i) {
              mapState.layerBeingMoved.center = value!;
            }
          }
        }
        bind:elevation={mapState.elevation}
        inlineStyle={`
          clip-path: ${layer.clipPath};
          height: 100%;
          margin: 0px;
          opacity: ${layer.opacity};
          padding: 0px;
          position: absolute;
          width: 100%;
          visibility: ${layer.visible ? "visible" : "hidden"};
        `}
        bind:map={layer.map}
        maxPitch={mapState.maxPitch}
        minPitch={mapState.minPitch}
        ondragend={(event) => {
          mapState.layerBeingMoved.index =
            mapState.layerBeingMoved.index === i ? undefined : mapState.layerBeingMoved.index;
          if (i !== 0 && event.originalEvent) {
            const overlayCenterPoint = layer.map!.project(layer.overlayCenter);
            const newBaseMapPosition = mapState.layers[0].map!.unproject(overlayCenterPoint);
            layer.baseMapPosition.lat = newBaseMapPosition.lat;
            layer.baseMapPosition.lng = newBaseMapPosition.lng;
          }
        }}
        ondragstart={() => {
          mapState.layerBeingMoved.index = i;
        }}
        onload={i === 0
          ? () => {
              mapState.containerDimensions.x = layer.map!._container.clientWidth;
              mapState.containerDimensions.y = layer.map!._container.clientHeight;
              mapState.isBaseMapLoaded = true;
            }
          : undefined}
        onmoveend={() => {
          if (i !== 0) {
            layer.markProjectionStaleFromMap();
          }
        }}
        onresize={i === 0
          ? () => {
              mapState.containerDimensions.x = layer.map!._container.clientWidth;
              mapState.containerDimensions.y = layer.map!._container.clientHeight;
            }
          : undefined}
        bind:pitch={mapState.pitch}
        bind:roll={mapState.roll}
        style={layer.style ?? mapState.style}
        bind:zoom={
          () =>
            i === 0
              ? mapState.zoom
              : mapState.zoom -
                Math.log2(
                  Math.cos((mapState.center.lat * Math.PI) / 180) /
                    Math.cos((layer.center.lat * Math.PI) / 180),
                ),
          (value) => {
            mapState.zoom =
              i === 0
                ? value
                : value -
                  Math.log2(
                    Math.cos((layer.center.lat * Math.PI) / 180) /
                      Math.cos((mapState.center.lat * Math.PI) / 180),
                  );
          }
        }
      >
        <Projection type="globe" />
      </MapLibre>
      {#if (layer.pathBorderWidth ?? 0 > 0) && layer.path && layer.visible}
        <svg
          aria-hidden="true"
          style="height: 100%; left: 0; pointer-events: none; position: absolute; top: 0; visibility: inherit; width: 100%;"
        >
          <path
            d={layer.path}
            fill="none"
            opacity={layer.opacity}
            stroke={layer.pathBorderColor ?? "black"}
            stroke-width={layer.pathBorderWidth}
            vector-effect="non-scaling-stroke"
          />
        </svg>
      {/if}
    {/if}
  {/each}
</div>
