import { Express } from "express";

type SocialRoutesDeps = {
  getSocialConfigView: () => unknown;
  getIntegrationSummary: () => unknown;
  exportSocialTemplate: () => { filename: string; content: string };
  reloadSocialConfig: () => Promise<unknown>;
  generateDefaultSocialMd: () => Promise<unknown>;
};

function sendOk(res: any, data: unknown, meta?: Record<string, unknown>) {
  res.json({ ok: true, data, meta });
}

function sendError(res: any, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerSocialRoutes(app: Express, deps: SocialRoutesDeps): void {
  app.get("/api/social/config", (_req, res) => {
    sendOk(res, deps.getSocialConfigView());
  });

  app.get("/api/social/integration-summary", (_req, res) => {
    sendOk(res, deps.getIntegrationSummary());
  });

  app.get("/api/social/export-template", (_req, res) => {
    sendOk(res, deps.exportSocialTemplate());
  });

  app.post("/api/social/reload", async (_req, res) => {
    try {
      const result = await deps.reloadSocialConfig();
      sendOk(res, result, { message: "Social config reloaded" });
    } catch (error) {
      sendError(
        res,
        500,
        "SOCIAL_RELOAD_FAILED",
        error instanceof Error ? error.message : "Social reload failed"
      );
    }
  });

  app.post("/api/social/generate-default", async (_req, res) => {
    try {
      const result = await deps.generateDefaultSocialMd();
      sendOk(
        res,
        result,
        { message: (result as { created?: boolean }).created ? "Default social.md generated" : "social.md already exists" }
      );
    } catch (error) {
      sendError(
        res,
        500,
        "SOCIAL_GENERATE_FAILED",
        error instanceof Error ? error.message : "social.md generation failed"
      );
    }
  });
}
