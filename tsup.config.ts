import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/server.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/socket.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    dts: false,
  },
  {
    entry: ["src/http-server.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
