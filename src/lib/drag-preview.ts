import type { Map as MapLibreMap } from "maplibre-gl";

/** A static, transparent overlay capture avoids MapLibre's untranslated tile stencil. */
export function createDragPreview(map: MapLibreMap, container: HTMLElement, id: string) {
  const layers = map.getStyle().layers;
  const selected = (layerId: string) => layerId.includes(`/${id}/`);
  const makeCanvas = (zIndex: string) => {
    const canvas = container.ownerDocument.createElement("canvas");
    const source = map.getCanvas();
    canvas.width = source.width;
    canvas.height = source.height;
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex,
    });
    return canvas;
  };
  const backdrop = makeCanvas("1"),
    overlay = makeCanvas("2");
  let disposed = false;
  let isolated = false;
  let listener: (() => void) | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const visibility = (target: boolean, hide: boolean) => {
    for (const layer of layers) {
      if (selected(layer.id) !== target || !map.getLayer(layer.id)) continue;
      const keys =
        layer.type === "symbol"
          ? ["text-opacity", "icon-opacity"]
          : layer.type === "hillshade"
            ? ["hillshade-shadow-color", "hillshade-highlight-color", "hillshade-accent-color"]
            : [`${layer.type}-opacity`];
      const paint = layer.paint as Record<string, unknown> | undefined;
      for (const key of keys) {
        // Paint changes leave sources in use; visibility:none would unload basemap tiles.
        map.setPaintProperty(layer.id, `${key}-transition`, { duration: 0, delay: 0 });
        map.setPaintProperty(
          layer.id,
          key,
          hide ? (layer.type === "hillshade" ? "rgba(0,0,0,0)" : 0) : paint?.[key],
        );
        if (!hide)
          map.setPaintProperty(layer.id, `${key}-transition`, paint?.[`${key}-transition`]);
      }
    }
  };
  const frame = (callback: () => void) => {
    listener = () => {
      listener = undefined;
      if (!disposed) callback();
    };
    map.once("render", listener);
    map.triggerRepaint();
  };
  const capture = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create overlay drag preview");
    context.drawImage(map.getCanvas(), 0, 0);
    container.append(canvas);
  };
  frame(() => {
    capture(backdrop);
    isolated = true;
    visibility(false, true);
    frame(() => {
      capture(overlay);
      visibility(false, false);
      isolated = false;
      visibility(true, true);
      frame(() => {
        backdrop.remove();
        resolveReady();
      });
    });
  });
  return {
    ready,
    move(offset: [number, number]) {
      overlay.style.transform = `translate(${offset[0]}px, ${offset[1]}px)`;
    },
    dispose() {
      disposed = true;
      if (listener) map.off("render", listener);
      if (isolated) visibility(false, false);
      visibility(true, false);
      backdrop.remove();
      overlay.remove();
      resolveReady();
    },
  };
}
