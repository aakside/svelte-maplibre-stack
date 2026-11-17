<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createDragPreview } from "./drag-preview.js";
  import { stageStyle } from "./style-transition.js";
  import { cameraOptions } from "./camera-options.js";
  import { OverlayGesture } from "./overlay-gesture.js";
  import maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import type { MapState } from "./map-state.svelte.js";
  import {
    createStyleResourceLoader,
    composeStyle,
    type ComposedStyle,
    type StyleLayerConfig,
  } from "./compose-style.js";
  import { contains, createTransform } from "./vector-tiles.js";

  import { installRuntimeImageBridge } from "./runtime-images.js";
  import { createTileClient } from "./tile-client.js";

  interface Props {
    mapState: MapState;
    onerror?: (error: Error) => void;
  }
  let { mapState = $bindable(), onerror }: Props = $props();
  let container: HTMLDivElement;
  let map = $state<maplibregl.Map>();
  let protocol = $state("");
  let composed: ComposedStyle | undefined;
  let revision = 0;
  let tileClient: ReturnType<typeof createTileClient>;
  let displayed: maplibregl.StyleSpecification | undefined;
  let pendingStyle: maplibregl.StyleSpecification | undefined;
  let displayedSignature = "";
  let pendingSignature = "";
  let dragging = false;
  let previewFrame: number | undefined;
  let preview: { id: string; offset: [number, number] } | undefined;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- protocol registry is deliberately nonreactive
  const snapshots = new Map<number, ComposedStyle>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient DOM resources
  const dragPreviews = new Map<
    string,
    { image: ReturnType<typeof createDragPreview>; offset: [number, number] }
  >();
  function previewOffset(id: string, offset: [number, number]) {
    const item = dragPreviews.get(id);
    if (item) {
      item.offset = offset;
      item.image.move(offset);
    }
  }
  function finishStyle() {
    if (!map || !pendingStyle || dragging) return;
    const target = pendingStyle;
    const sources = Object.keys(target.sources).filter(
      (id) => id.endsWith("/merged") || id.endsWith("/region"),
    );
    if (!sources.every((id) => map!.getSource(id) && map!.isSourceLoaded(id))) return;
    pendingStyle = undefined;
    map.setStyle(target, { diff: true });
    displayed = target;
    displayedSignature = pendingSignature;
    preview = undefined;
    const completed = [...dragPreviews.values()];
    dragPreviews.clear();
    map.once("render", () => completed.forEach((item) => item.image.dispose()));
    tileClient.retain([revision]);
    for (const key of snapshots.keys()) if (key !== revision) snapshots.delete(key);
  }
  const loadStyleResource = createStyleResourceLoader();
  function report(error: unknown) {
    if (error instanceof Error && error.name === "AbortError") return;
    mapState.error = error instanceof Error ? error : new Error(String(error));
    onerror?.(mapState.error);
  }
  const configs = $derived.by(() =>
    mapState.layers.map(
      (layer, index): StyleLayerConfig => ({
        id: layer.id,
        style: (layer.style ?? mapState.layers[0].style) as StyleLayerConfig["style"],
        visible: layer.visible,
        opacity: layer.opacity,
        region: layer.geojson,
        placement: index
          ? {
              overlayCenter: { ...layer.overlayCenter },
              baseMapPosition: { ...layer.baseMapPosition },
              bearing: layer.bearing - mapState.layers[0].bearing,
            }
          : undefined,
        pathBorderColor: layer.pathBorderColor,
        pathBorderWidth: layer.pathBorderWidth,
      }),
    ),
  );
  $effect(() => {
    const currentMap = map,
      currentConfigs = $state.snapshot(configs as unknown) as StyleLayerConfig[],
      currentProtocol = protocol;
    if (!currentMap || !currentProtocol) return;
    const controller = new AbortController();
    composeStyle(currentConfigs, currentProtocol, controller.signal, loadStyleResource)
      .then(async (result) => {
        await Promise.all([...dragPreviews.values()].map((item) => item.image.ready));
        if (controller.signal.aborted) return;
        composed = result;
        mapState.error = undefined;
        const signature = JSON.stringify(result.contributions);
        const reuse = displayed && !pendingStyle && signature === displayedSignature;
        const generation = reuse ? revision : ++revision;
        snapshots.set(generation, result);
        if (!reuse) tileClient.configure(generation, result.contributions);
        const style = structuredClone(result.style);
        style.transition = { duration: 0, delay: 0 };
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local construction only
        const renamed = new Map<string, string>();
        for (const id of Object.keys(style.sources)) {
          if (id !== "merged" && !id.endsWith("/region")) continue;
          const name = `${generation}/${id}`;
          renamed.set(id, name);
          style.sources[name] = style.sources[id];
          delete style.sources[id];
        }
        (style.sources[`${generation}/merged`] as maplibregl.VectorSourceSpecification).tiles = [
          `${currentProtocol}://tiles/{z}/{x}/{y}?revision=${generation}`,
        ];
        for (const layer of style.layers) {
          if (
            !("source" in layer) ||
            typeof layer.source !== "string" ||
            !renamed.has(layer.source)
          )
            continue;
          layer.source = renamed.get(layer.source)!;
          layer.id = `${generation}/${layer.id}`;
        }
        if (reuse) {
          currentMap.setStyle(style, { diff: true });
          pendingStyle = style;
          pendingSignature = signature;
          finishStyle();
          return;
        }
        pendingSignature = signature;
        pendingStyle = style;
        // Capture any drag preview paint values before staging the replacement.
        const previous = displayed ? currentMap.getStyle() : undefined;
        if (previous && displayed)
          previous.layers = previous.layers.filter((layer) =>
            displayed!.layers.some((old) => old.id === layer.id),
          );
        currentMap.setStyle(stageStyle(previous, style), { diff: true });
        const retained = new Set([
          generation,
          ...(displayed
            ? Object.keys(displayed.sources)
                .filter((id) => id.endsWith("/merged"))
                .map((id) => Number(id.split("/")[0]))
            : []),
        ]);
        for (const key of snapshots.keys()) if (!retained.has(key)) snapshots.delete(key);
        tileClient.retain([...retained]);
        currentMap.triggerRepaint();
      })
      .catch(report);
    return () => controller.abort();
  });
  $effect(() => {
    const currentMap = map;
    const center = { ...mapState.center },
      zoom = mapState.zoom,
      bearing = mapState.layers[0].bearing,
      pitch = mapState.pitch,
      roll = mapState.roll,
      elevation = mapState.elevation;
    if (currentMap)
      untrack(() => {
        const actual = currentMap.getCenter();
        if (
          actual.lng !== center.lng ||
          actual.lat !== center.lat ||
          currentMap.getZoom() !== zoom ||
          currentMap.getBearing() !== bearing ||
          (pitch !== undefined && currentMap.getPitch() !== pitch) ||
          (roll !== undefined && currentMap.getRoll() !== roll)
        )
          currentMap.jumpTo(cameraOptions({ center, zoom, bearing, pitch, roll, elevation }));
      });
  });
  $effect(() => {
    const instance = map,
      minPitch = mapState.minPitch,
      maxPitch = mapState.maxPitch,
      locked = mapState.layers[0].isBearingLocked;
    if (!instance) return;
    untrack(() => {
      if (instance.getMinPitch() !== (minPitch ?? 0)) instance.setMinPitch(minPitch ?? 0);
      if (instance.getMaxPitch() !== (maxPitch ?? 60)) instance.setMaxPitch(maxPitch ?? 60);
      if (locked) {
        instance.dragRotate.disable();
        instance.touchZoomRotate.disableRotation();
      } else {
        instance.dragRotate.enable();
        instance.touchZoomRotate.enableRotation();
      }
    });
  });
  $effect(() => {
    const instance = map;
    for (const layer of mapState.layers) layer.map = instance;
  });
  onMount(() => {
    const tiles = createTileClient();
    tileClient = tiles;
    const name = `stack-${crypto.randomUUID()}`;
    protocol = name;
    maplibregl.addProtocol(name, async (request, controller) => {
      const url = new URL(request.url);
      const generation = Number(url.searchParams.get("revision"));
      const snapshot = url.hostname === "glyphs" ? composed : snapshots.get(generation);
      if (!snapshot) throw new Error("Map composition is not ready");
      if (url.hostname === "glyphs") {
        const [stack, range] = url.pathname.slice(1).split("/");
        const fonts = decodeURIComponent(stack).split(",");
        const namespace = fonts[0].split("::")[0];
        const template = snapshot.glyphs[namespace];
        if (!template) throw new Error(`Missing glyph template for ${namespace}`);
        const upstream = template
          .replace(
            "{fontstack}",
            encodeURIComponent(fonts.map((font) => font.slice(namespace.length + 2)).join(",")),
          )
          .replace("{range}", range.replace(/\.pbf$/, ""));
        const response = await fetch(upstream, { signal: controller.signal });
        if (!response.ok) throw new Error(`Glyph request: HTTP ${response.status}`);
        return { data: await response.arrayBuffer() };
      }
      const [z, x, y] = url.pathname.slice(1).split("/").map(Number);
      const data = await tiles.request({ z, x, y }, generation, controller.signal);
      return {
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      };
    });
    const instance = new maplibregl.Map({
      container,
      attributionControl: false,
      style: { version: 8, sources: {}, layers: [] },
      center: mapState.center,
      zoom: mapState.zoom,
      bearing: mapState.layers[0].bearing,
      ...(mapState.pitch === undefined ? {} : { pitch: mapState.pitch }),
      ...(mapState.roll === undefined ? {} : { roll: mapState.roll }),
      ...(mapState.minPitch === undefined ? {} : { minPitch: mapState.minPitch }),
      ...(mapState.maxPitch === undefined ? {} : { maxPitch: mapState.maxPitch }),
    });
    const attributionControl = new maplibregl.AttributionControl();
    instance.addControl(attributionControl);
    mapState.attributionControl = attributionControl;
    const removeImageBridge = installRuntimeImageBridge(instance, () => {
      const sprites = composed?.style.sprite;
      return Array.isArray(sprites) ? sprites.map((sprite) => sprite.id) : [];
    });
    map = instance;
    instance.on("render", finishStyle);
    instance.on("error", (event) => {
      // A failed replacement must not evict the last successfully rendered overlay.
      if (
        pendingStyle &&
        "sourceId" in event &&
        typeof event.sourceId === "string" &&
        event.sourceId in pendingStyle.sources &&
        (event.sourceId.endsWith("/merged") || event.sourceId.endsWith("/region"))
      )
        pendingStyle = undefined;
      report(event.error);
    });
    instance.on("load", () => {
      mapState.isBaseMapLoaded = true;
    });
    instance.on("styledata", () => {
      for (const layer of mapState.layers) layer.styleUpdateIteration++;
    });
    const resize = () => {
      mapState.containerDimensions = { x: container.clientWidth, y: container.clientHeight };
    };
    const observer = new ResizeObserver(() => {
      instance.resize();
      resize();
    });
    observer.observe(container);
    resize();
    instance.on("move", () => {
      const center = instance.getCenter();
      mapState.center = { lat: center.lat, lng: center.lng };
      mapState.zoom = instance.getZoom();
      mapState.pitch = instance.getPitch();
      mapState.roll = instance.getRoll();
      if (instance.getBearing() !== mapState.layers[0].bearing)
        mapState.setBearing(0, instance.getBearing());
      for (const layer of mapState.layers) layer.markProjectionStaleFromMap();
    });
    const gesture = new OverlayGesture<{
      id: string;
      start: maplibregl.LngLat;
      anchor: { lng: number; lat: number };
      screen: [number, number];
      destination: { lng: number; lat: number };
      offset: [number, number];
    }>(() => {
      dragging = false;
      mapState.layerBeingMoved.index = undefined;
      instance.dragPan.enable();
    });
    const position = (event: PointerEvent) =>
      instance.unproject([
        event.clientX - container.getBoundingClientRect().left,
        event.clientY - container.getBoundingClientRect().top,
      ]);
    const down = (event: PointerEvent) => {
      if (!gesture.pointerDown(event.pointerId)) return;
      if (event.button !== 0) return;
      const point = position(event);
      for (let i = mapState.layers.length - 1; i > 0; i--) {
        const layer = mapState.layers[i];
        if (!layer.visible || !layer.geojson) continue;
        const original = createTransform({
          overlayCenter: layer.overlayCenter,
          baseMapPosition: layer.baseMapPosition,
          bearing: layer.bearing - mapState.layers[0].bearing,
        }).inverse([point.lng, point.lat]);
        if (contains(original, layer.geojson)) {
          const anchor = { ...layer.baseMapPosition };
          const existingPreview = dragPreviews.get(layer.id);
          const initialOffset: [number, number] = existingPreview
            ? [...existingPreview.offset]
            : [0, 0];
          if (!existingPreview)
            dragPreviews.set(layer.id, {
              image: createDragPreview(instance, container, layer.id),
              offset: [0, 0],
            });
          dragging = true;
          gesture.start(
            {
              id: layer.id,
              start: point,
              anchor,
              screen: [event.clientX, event.clientY],
              destination: anchor,
              offset: initialOffset,
            },
            () => {
              if (previewFrame !== undefined) cancelAnimationFrame(previewFrame);
              previewFrame = undefined;
              if (existingPreview) previewOffset(layer.id, initialOffset);
              else {
                dragPreviews.get(layer.id)?.image.dispose();
                dragPreviews.delete(layer.id);
              }
              preview = undefined;
            },
          );
          mapState.layerBeingMoved.index = i;
          instance.dragPan.disable();
          break;
        }
      }
    };
    const move = (event: PointerEvent) => {
      const drag = gesture.value;
      if (!drag) return;
      const layer = mapState.layers.find((layer) => layer.id === drag!.id);
      if (!layer) {
        gesture.cancel();
        return;
      }
      const point = position(event);
      drag.destination = {
        lng: drag.anchor.lng + point.lng - drag.start.lng,
        lat: drag.anchor.lat + point.lat - drag.start.lat,
      };
      preview = {
        id: drag.id,
        offset: [
          drag.offset[0] + event.clientX - drag.screen[0],
          drag.offset[1] + event.clientY - drag.screen[1],
        ],
      };
      if (previewFrame === undefined)
        previewFrame = requestAnimationFrame(() => {
          previewFrame = undefined;
          if (preview) previewOffset(preview.id, preview.offset);
        });
    };
    const up = (event: PointerEvent) => {
      const drag = gesture.value;
      if (drag) {
        const layer = mapState.layers.find((layer) => layer.id === drag.id);
        if (layer) layer.baseMapPosition = drag.destination;
      }
      gesture.pointerUp(event.pointerId);
    };
    const cancel = () => gesture.cancel();
    instance.on("movestart", () => {
      // A viewport capture must not remain fixed on screen during camera gestures.
      gesture.cancel();
      if (previewFrame !== undefined) cancelAnimationFrame(previewFrame);
      previewFrame = undefined;
      for (const item of dragPreviews.values()) item.image.dispose();
      dragPreviews.clear();
      preview = undefined;
    });
    container.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      if (previewFrame !== undefined) cancelAnimationFrame(previewFrame);
      for (const item of dragPreviews.values()) item.image.dispose();
      dragPreviews.clear();
      observer.disconnect();
      container.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      removeImageBridge();
      tiles.dispose();
      instance.remove();
      maplibregl.removeProtocol(name);
      map = undefined;
      for (const layer of mapState.layers) layer.map = undefined;
      mapState.attributionControl = undefined;
      mapState.isBaseMapLoaded = false;
    };
  });
</script>

<div bind:this={container} class="map" role="application" aria-label="Interactive map"></div>

<style>
  .map {
    height: 100%;
    width: 100%;
    position: relative;
  }
</style>
