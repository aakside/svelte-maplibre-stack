import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    license: true,
  },
  plugins: [sveltekit()],
});
