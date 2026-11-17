# Single-globe vector composition

The public MapState / MapLayer configuration remains the integration boundary. All
layers share one MapLibre map, camera, symbol collision domain, and gesture surface.
The unclipped basemap retains its native sources so moving an overlay does not
reload the basemap. Overlay geometry is clipped in source coordinates, relocated, and encoded into
namespaced MVT source layers. Labels are clipped by their geometry/anchor, never by
CSS, so glyphs may extend past the region boundary.

Placement is a Mercator similarity transform: source anchor to destination anchor,
rotation relative to the base bearing, and a cosine latitude scale preserving local
ground size at the anchor. This is locally scale preserving, not an equal-area
projection for continent-sized regions. The renderer can still use globe projection.

Tile requests inverse-transform destination bounds, select the corresponding source
zoom, fetch overlapping upstream tiles, and merge the transformed features. Source
zoom bounds come from TileJSON or the MapLibre vector source specification. Requests
are abortable; errors must reach MapLibre's error event and MapState.error.

Style sources, layers, sprite names and glyph stacks need isolated namespaces.
Overlay backgrounds become polygon fills. Unsupported overlay source types must
fail explicitly. Style replacement must not reset camera or expose stale async work.

Dragging a region uses one pointer only. A second touch cancels region movement and
returns control to MapLibre's pinch handler. Changes to placement invalidate tiles;
camera zoom and pan do not change placement. Visibility, opacity, borders, layer
removal, serialization, and mixed style resources must remain usable.

The library has released versions. Existing exported configuration names remain;
MapLayer.map now refers to the shared map. FourwaySplitMap is a separate experimental
comparison component, not the implementation of Map.

## Loading and interaction performance

Source regions are projected once per configuration. Decoded, clipped source
features are reused across destination tiles and placement changes. Preparation
is retained for the current destination zoom and invalidated when source geometry
or URLs change. Independent contributions and upstream requests run concurrently;
shared in-flight fetches have independent consumer cancellation. Bounding boxes
reject unrelated features before polygon clipping, and rectangular interiors pass
through unchanged. Destination indexing starts at the root and only subdivides
along the requested tile path.

Worker configurations are sent once per revision; tile messages contain only a
revision and coordinates. A replacement style stages invisible overlay layers
alongside the displayed generation, then swaps them after all replacement sources
are loaded. Superseded generations are removed. Paint-only changes reuse existing
vector sources. Errors remain visible through MapState.error and the onerror hook.

Dragging captures the selected overlay into a temporary transparent bitmap on the
same map's render events. This avoids translating MapLibre paint across unchanged
tile stencil masks, which would cut gaps at tile boundaries. The bitmap moves once
per animation frame; source placement is committed on pointer release. There is
one live map and WebGL context; the temporary 2D canvases are disposed after the
replacement renders or the gesture is cancelled. The preview contains the visible
viewport at drag start; newly revealed offscreen content arrives with final tiles.
