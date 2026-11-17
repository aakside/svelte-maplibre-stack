import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export const isOverlaySource = (source: string) =>
  source.endsWith("/merged") || source.endsWith("/region");
export function isOverlayLayer(layer: LayerSpecification) {
  return "source" in layer && typeof layer.source === "string" && isOverlaySource(layer.source);
}
/** Both generations remain mounted until every replacement tile is ready. */
export function stageStyle(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  const retainedSources = new Set(
    previous?.layers.flatMap((layer) => ("source" in layer ? [layer.source] : [])) ?? [],
  );
  return {
    ...next,
    sources: {
      ...Object.fromEntries(
        Object.entries(previous?.sources ?? {}).filter(
          ([id]) => isOverlaySource(id) && retainedSources.has(id),
        ),
      ),
      ...next.sources,
    },
    layers: [
      ...next.layers.filter((layer) => !isOverlayLayer(layer)),
      ...(previous?.layers.filter(isOverlayLayer) ?? []),
      ...next.layers.filter(isOverlayLayer).map(
        (layer) =>
          ({
            ...layer,
            paint: {
              ...layer.paint,
              ...(layer.type === "symbol"
                ? { "text-opacity": 0, "icon-opacity": 0 }
                : { [`${layer.type}-opacity`]: 0 }),
            },
          }) as LayerSpecification,
      ),
    ],
  };
}
