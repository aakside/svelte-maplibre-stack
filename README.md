# Svelte MapLibre Stack

Overlay clipped basemaps over each other.

## Known Issues

- Zooming in/out is visually unstable. Panning the basemap after zooming should correctly position overlays.

- Pinch zooming in/out over an overlay is disabled.

- Text labels in overlays are clipped.

## Developing

Install dependencies with `npm install` and start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To build:

```sh
npm pack
```

To create a production version of the demo:

```sh
npm run build
```

Preview the production build with `npm run preview`.

## License

Available under the [ISC License](./LICENSE.md).
