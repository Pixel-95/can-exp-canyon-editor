import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function isWithinDirectory(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function repoAssetsPlugin(): Plugin {
  const assetsDirectory = path.resolve(__dirname, "../assets");

  return {
    name: "repo-assets",
    configureServer(server) {
      server.middlewares.use("/assets", async (req, res, next) => {
        try {
          const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
          const targetPath = path.resolve(assetsDirectory, `.${requestPath}`);
          if (!isWithinDirectory(assetsDirectory, targetPath)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }

          const targetStat = await stat(targetPath);
          if (!targetStat.isFile()) {
            next();
            return;
          }

          const payload = await readFile(targetPath);
          if (targetPath.toLowerCase().endsWith(".json")) {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          res.end(payload);
        } catch {
          next();
        }
      });
    },
    async writeBundle(options) {
      const outputDirectory =
        typeof options.dir === "string"
          ? path.resolve(options.dir)
          : path.resolve(__dirname, "../dist/renderer");
      await mkdir(outputDirectory, { recursive: true });
      await cp(assetsDirectory, path.join(outputDirectory, "assets"), { recursive: true });
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname),
  base: "./",
  plugins: [react(), repoAssetsPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/renderer"),
    emptyOutDir: true,
  },
});
