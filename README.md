# Svelte MapLibre Stack

Place clipped vector basemaps on one interactive globe.

`Map` renders one MapLibre canvas. A worker clips, relocates, and merges overlay
vector tiles into namespaced source layers. The basemap keeps its native sources,
so overlay changes do not reload it. All layers share the camera and label collision
system. Labels can extend beyond region edges without CSS clipping.

## Usage

Existing `Map`, `MapState`, `MapLayer`, and layer configuration exports remain available.

```svelte
<script lang="ts">
  import { Map, MapState } from "@aakside/svelte-maplibre-stack";

  const mapState = new MapState([
    {
      bearing: 0,
      center: { lng: -87.63, lat: 41.88 },
      visible: true,
      zoom: 12,
    },
  ]);
</script>

<div style="height: 100vh;">
  <Map {mapState} />
</div>
```

Add overlays with `mapState.addLayer({ baseMapPosition, overlayCenter, bearing,
geojson, visible, style })`. `geojson` is a Polygon or MultiPolygon in source
coordinates; `overlayCenter` is aligned with `baseMapPosition`. An omitted overlay
style inherits the base style. The demo includes light and dark Manhattan overlays
positioned beside Chicago.

One-finger or mouse dragging moves a region. A second pointer cancels region movement
and leaves pinch zoom/rotation to the camera. Visibility, opacity, bearing locks,
borders, `flyToLayer`, and configuration serialization remain available.

## Integration changes

- Every `MapLayer.map` refers to the same MapLibre instance. Attach global controls
  and listeners once per map. Runtime image generators are bridged to namespaced
  sprite images, including asynchronous generators.
- Layer and source-layer IDs are namespaced. Code querying original style IDs must
  use the composed IDs from `layer.map.getStyle()`.
- `clipPath` remains available for existing controls that detect a region; it is
  no longer applied to a canvas. Borders are MapLibre line layers.
- `MapState.update()` replaces the layer configuration, including removing surplus
  overlays. Removing an overlay never removes the shared map.
- Use `onerror` on `Map` and/or render `mapState.error` in an alert. Tile, style,
  glyph, and unsupported-source errors are surfaced rather than replaced by empty
  tiles. The demo renders this alert.

## Supported data

Overlay styles must use vector sources with XYZ or TMS MVT tiles, directly or via
TileJSON. Raster, terrain, and other non-vector overlay sources are rejected.
Basemap sources retain their normal MapLibre behavior. Styles and resources must
be browser-accessible with the appropriate CORS headers. Inline styles should use
absolute resource URLs; URL-loaded styles resolve relative resource paths.

Placement uses a Mercator similarity transform, including latitude scale and
rotation. Scale is preserved locally at the anchor, not globally across large
continental regions. Anchors and region coordinates must be within Web Mercator's
latitude domain (approximately ±85.0511°).

Static font stacks and literal stacks in match/case/step/coalesce expressions are
supported. Font names supplied entirely by feature data require normalization in
the source style. Custom source protocols, authenticated request transforms, and
terrain relocation are not implemented.

The build requires a bundler supporting module workers via `new URL(...,
import.meta.url)`, such as Vite. The worker ships in the package.

## Development

```sh
npm install
npm test
npm run check
npm run lint
npm run dev
```

Hot reload is enabled by default. `npm run build` builds the demo and validates the
package. `npm pack` creates the library package; `npm run preview` previews the demo.

See [the rendering design](docs/vector-tiles.md) for geometry and interaction rules.
`FourwaySplitMap` remains a separate experimental comparison component.

## License

Available under the [ISC License](./LICENSE.md).
