import express from "express";
import cors from "cors";
import { resolve } from "path";
import { existsSync } from "fs";
import defaults from "../../../config/silicaclaw-defaults.json";

const app = express();
const port = Number(process.env.PORT || defaults.ports.public_explorer);

function resolvePublicExplorerStaticDir(): string {
  const candidates = [
    resolve(process.cwd(), "public"),
    resolve(process.cwd(), "apps", "public-explorer", "public"),
    resolve(__dirname, "..", "public"),
    resolve(__dirname, "..", "..", "apps", "public-explorer", "public"),
  ];

  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) {
      return dir;
    }
  }

  return candidates[0];
}

app.use(cors({ origin: true }));
app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    data: {
      local_console_api_base: defaults.bridge.api_base,
      local_console_port: defaults.ports.local_console,
    },
  });
});
app.use(express.static(resolvePublicExplorerStaticDir()));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SilicaClaw public-explorer running: http://localhost:${port}`);
});
