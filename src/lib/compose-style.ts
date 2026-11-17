import type {
  LayerSpecification,
  StyleSpecification,
  VectorSourceSpecification,
} from "maplibre-gl";
import {
  mapGeometry,
  createTransform,
  type Region,
  type Placement,
  type Contribution,
} from "./vector-tiles.js";

export interface StyleLayerConfig {
  id: string;
  style: string | StyleSpecification;
  visible: boolean;
  opacity: number;
  region?: Region;
  placement?: Placement;
  pathBorderWidth?: number;
  pathBorderColor?: string;
}
export interface ComposedStyle {
  style: StyleSpecification;
  contributions: Contribution[];
  glyphs: Record<string, string>;
}
async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Style resource ${url}: HTTP ${response.status}`);
  return response.json();
}
export function createStyleResourceLoader() {
  const resources = new Map<string, unknown>();
  return async function load<T>(url: string, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (resources.has(url)) return resources.get(url) as T;
    const result = await json<T>(url, signal);
    resources.set(url, result);
    return result;
  };
}
function absolute(url: string, base?: string) {
  return base ? new URL(url, base).href : url;
}
// URL retains placeholders encoded by new URL; MapLibre requires literal placeholders.
function template(url: string, base?: string) {
  return absolute(url, base).replaceAll("%7B", "{").replaceAll("%7D", "}");
}
function prefixImage(value: unknown, namespace: string): unknown {
  if (typeof value === "string") return value ? `${namespace}:${value}` : "";
  if (Array.isArray(value) && value[0] === "image")
    return ["image", prefixImage(value[1], namespace)];
  if (Array.isArray(value) && value[0] === "coalesce")
    return ["coalesce", ...value.slice(1).map((item) => prefixImage(item, namespace))];
  if (Array.isArray(value) && ["case", "match", "step"].includes(value[0])) {
    const result = [...value];
    const start = value[0] === "match" ? 3 : 2;
    for (let i = start; i < result.length; i += 2) result[i] = prefixImage(value[i], namespace);
    if (value[0] !== "step")
      result[result.length - 1] = prefixImage(value[value.length - 1], namespace);
    return result;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "stops" in value) {
    const fn = value as { stops: [unknown, unknown][]; default?: unknown };
    return {
      ...fn,
      stops: fn.stops.map(([input, output]) => [input, prefixImage(output, namespace)]),
      ...(fn.default === undefined ? {} : { default: prefixImage(fn.default, namespace) }),
    };
  }
  // Concatenation also supports data-driven image expressions and legacy token strings.
  return ["concat", `${namespace}:`, value];
}
function prefixFonts(value: unknown, namespace: string): unknown {
  if (!Array.isArray(value)) {
    if (value && typeof value === "object" && "stops" in value) {
      const fn = value as { stops: [unknown, unknown][] };
      return {
        ...fn,
        stops: fn.stops.map(([input, output]) => [input, prefixFonts(output, namespace)]),
      };
    }
    throw new Error(`Unsupported text-font in ${namespace}`);
  }
  const [operator, ...args] = value;
  if (operator === "literal") return [operator, prefixFonts(args[0], namespace)];
  if (operator === "match" || operator === "case" || operator === "step") {
    const result = [...value];
    const start = operator === "case" ? 2 : operator === "step" ? 2 : 3;
    for (let i = start; i < result.length; i += 2) result[i] = prefixFonts(result[i], namespace);
    if (operator !== "step")
      result[result.length - 1] = prefixFonts(value[value.length - 1], namespace);
    return result;
  }
  if (operator === "coalesce")
    return [operator, ...args.map((value) => prefixFonts(value, namespace))];
  if (value.every((font) => typeof font === "string") && !["get", "var"].includes(operator))
    return value.map((font) => `${namespace}::${font}`);
  throw new Error(`Unsupported text-font expression in ${namespace}`);
}
function opacity(value: unknown, multiplier: number): unknown {
  if (multiplier === 1 && value !== undefined) return value;
  if (
    Array.isArray(value) &&
    ["interpolate", "interpolate-hcl", "interpolate-lab", "step"].includes(value[0])
  ) {
    const result = [...value];
    for (let i = value[0] === "step" ? 2 : 4; i < value.length; i += 2)
      result[i] = opacity(value[i], multiplier);
    return result;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const fn = value as { stops?: [unknown, number][]; default?: number };
    if (!fn.stops) throw new Error("Unsupported opacity function");
    return {
      ...fn,
      stops: fn.stops.map(([stop, output]) => [stop, output * multiplier]),
      ...(fn.default === undefined ? {} : { default: fn.default * multiplier }),
    };
  }

  return typeof value === "number"
    ? value * multiplier
    : value === undefined
      ? multiplier
      : ["*", value, multiplier];
}
export async function composeStyle(
  configs: StyleLayerConfig[],
  protocol: string,
  signal: AbortSignal,
  load: typeof json = json,
): Promise<ComposedStyle> {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [],
    projection: { type: "globe" },
  };
  const contributions: Contribution[] = [];
  const glyphs: Record<string, string> = {};
  const sprites: { id: string; url: string }[] = [];
  const attributions = new Set<string>();
  for (const [index, config] of configs.entries()) {
    signal.throwIfAborted();
    const base = typeof config.style === "string" ? config.style : undefined;
    const original =
      typeof config.style === "string"
        ? await load<StyleSpecification>(config.style, signal)
        : config.style;
    if (original.glyphs) glyphs[config.id] = template(original.glyphs, base);
    let spriteNamespace = config.id;
    if (original.sprite) {
      const entries =
        typeof original.sprite === "string"
          ? [{ id: "default", url: original.sprite }]
          : original.sprite;
      for (const entry of entries) {
        const url = absolute(entry.url, base);
        const existing = sprites.find((sprite) => sprite.url === url);
        const id =
          existing?.id ?? (entry.id === "default" ? config.id : `${config.id}-${entry.id}`);
        if (!existing) sprites.push({ id, url });
        if (entry.id === "default") spriteNamespace = id;
      }
    }
    for (const [sourceId, source] of Object.entries(original.sources)) {
      if (source.type !== "vector") {
        if (index !== 0)
          throw new Error(`Overlay source ${sourceId} must be vector; received ${source.type}`);
        style.sources[`${config.id}/${sourceId}`] = structuredClone(source);
        continue;
      }
      const metadata = source.url
        ? await load<VectorSourceSpecification>(absolute(source.url, base), signal)
        : source;
      const resolved = { ...metadata, ...source };
      if (!resolved.tiles?.length)
        throw new Error(`Vector source ${sourceId} has no tile templates`);
      if (resolved.attribution) attributions.add(resolved.attribution);
      if (index === 0 && !config.region) {
        const { url: _url, ...native } = resolved;
        style.sources[`${config.id}/${sourceId}`] = {
          ...native,
          type: "vector",
          tiles: resolved.tiles.map((url) =>
            template(url, source.url ? absolute(source.url, base) : base),
          ),
        };
        continue;
      }
      if (config.visible)
        contributions.push({
          id: `${config.id}/${sourceId}`,
          tiles: resolved.tiles.map((url) =>
            template(url, source.url ? absolute(source.url, base) : base),
          ),
          minzoom: resolved.minzoom ?? 0,
          maxzoom: resolved.maxzoom ?? 22,
          scheme: resolved.scheme,
          region: config.region,
          placement: config.placement,
        });
    }
    const geometry = config.region
      ? config.placement
        ? mapGeometry(config.region, createTransform(config.placement).forward)
        : config.region
      : undefined;
    const regionSource = `${config.id}/region`;
    if (geometry)
      style.sources[regionSource] = {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry },
      };
    for (const originalLayer of original.layers) {
      const layer = structuredClone(originalLayer) as unknown as Record<string, unknown>;
      layer.id = `${config.id}/${originalLayer.id}`;
      const layout = (layer.layout ?? {}) as Record<string, unknown>;
      layer.layout = layout;
      if (!config.visible) layout.visibility = "none";
      const paint = (layer.paint ?? {}) as Record<string, unknown>;
      layer.paint = paint;
      if (layer.source) {
        const source = original.sources[layer.source as string];
        if (!source) throw new Error(`Missing style source ${layer.source}`);
        if (source.type === "vector" && (index !== 0 || config.region)) {
          layer["source-layer"] = `${config.id}/${layer.source}/${layer["source-layer"]}`;
          layer.source = "merged";
        } else layer.source = `${config.id}/${layer.source}`;
      }
      if (layer.type === "background" && geometry) {
        layer.type = "fill";
        layer.source = regionSource;
        for (const key of Object.keys(paint)) {
          paint[key.replace("background-", "fill-")] = paint[key];
          delete paint[key];
        }
      } else if (layer.type === "background" && index > 0) continue;
      for (const key of ["icon-image"])
        if (layout[key] !== undefined) layout[key] = prefixImage(layout[key], spriteNamespace);
      for (const key of ["fill-pattern", "line-pattern", "background-pattern"])
        if (paint[key] !== undefined) paint[key] = prefixImage(paint[key], spriteNamespace);
      if (layer.type === "symbol") {
        const fonts = layout["text-font"] ?? ["Open Sans Regular", "Arial Unicode MS Regular"];
        layout["text-font"] = prefixFonts(fonts, config.id);
        paint["text-opacity"] = opacity(paint["text-opacity"], config.opacity);
        paint["icon-opacity"] = opacity(paint["icon-opacity"], config.opacity);
      } else {
        const key = `${layer.type}-opacity`;
        paint[key] = opacity(paint[key], config.opacity);
      }
      style.layers.push(layer as unknown as LayerSpecification);
    }
    if (geometry && config.pathBorderWidth)
      style.layers.push({
        id: `${config.id}/border`,
        type: "line",
        source: regionSource,
        layout: { visibility: config.visible ? "visible" : "none" },
        paint: {
          "line-width": config.pathBorderWidth,
          "line-color": config.pathBorderColor ?? "black",
          "line-opacity": config.opacity,
        },
      });
  }
  style.sources.merged = {
    type: "vector",
    tiles: [`${protocol}://tiles/{z}/{x}/{y}`],
    attribution: [...attributions].join(" | "),
  };
  if (sprites.length) style.sprite = sprites;
  style.glyphs = `${protocol}://glyphs/{fontstack}/{range}.pbf`;
  return { style, contributions, glyphs };
}
