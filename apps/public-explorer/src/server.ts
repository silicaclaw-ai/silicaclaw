import express from "express";
import cors from "cors";
import { resolve } from "path";

const app = express();
const port = Number(process.env.PORT || 4311);

app.use(cors({ origin: true }));
app.use(express.static(resolve(process.cwd(), "apps", "public-explorer", "public")));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SilicaClaw public-explorer running: http://localhost:${port}`);
});
