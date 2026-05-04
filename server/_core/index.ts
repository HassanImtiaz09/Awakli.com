import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../stripe/webhook";
import { registerImageWebhookRoutes } from "../image-router/webhooks";
import { rateLimitMiddleware } from "./rate-limit";
import { requestTimingMiddleware, healthHandler } from "../observability";
import { startCanaryScheduler, startIdempotencyCleanupScheduler } from "../image-router/canary-probes";
import { setupGenerationWebSocket } from "../ws-generation";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const server = createServer(app);

  // Stripe webhook needs raw body BEFORE json parser
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Observability: request timing
  app.use(requestTimingMiddleware);

  // Health endpoint (before auth/rate-limit)
  app.get("/api/health", healthHandler);

  // Security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  // SEO: sitemap.xml
  app.get("/sitemap.xml", async (req, res) => {
    try {
      const { getPublishedProjects } = await import("../db");
      const projects = await getPublishedProjects({ limit: 500, offset: 0, sort: "newest" });
      const origin = `${req.protocol}://${req.get("host")}`;
      const now = new Date().toISOString().split("T")[0];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      // Static pages
      for (const path of ["/", "/discover", "/trending", "/pricing", "/create"]) {
        xml += `  <url><loc>${origin}${path}</loc><changefreq>daily</changefreq><priority>${path === "/" ? "1.0" : "0.8"}</priority><lastmod>${now}</lastmod></url>\n`;
      }
      // Published projects
      for (const p of projects) {
        if (p.slug) {
          xml += `  <url><loc>${origin}/watch/${p.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
          xml += `  <url><loc>${origin}/m/${p.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
        }
      }
      xml += `</urlset>`;
      res.set("Content-Type", "application/xml");
      res.set("Cache-Control", "public, max-age=3600");
      res.send(xml);
    } catch (err) {
      console.error("[Sitemap] Error generating sitemap:", err);
      res.status(500).send("Error generating sitemap");
    }
  });

  // SEO: robots.txt
  app.get("/robots.txt", (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.set("Content-Type", "text/plain");
    res.send(`User-agent: *\nAllow: /\nDisallow: /studio/\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
  });

  // HITL Gate SSE endpoint (before OAuth to avoid conflicts)
  const { registerHitlSseRoutes } = await import("../hitl/sse-handler");
  registerHitlSseRoutes(app);

  // HITL Timeout Cron Scheduler (every 5 minutes)
  const { startCronScheduler, registerShutdownHandlers, registerCronRoutes } = await import("../hitl/cron-scheduler");
  registerCronRoutes(app);
  registerShutdownHandlers();
  startCronScheduler(); // 5-min interval, runs first tick immediately

  // H-4: Rate limiting on API routes
  app.use(rateLimitMiddleware);

  // Image generation webhooks (after JSON parser)
  registerImageWebhookRoutes(app);

  // Storage proxy for /manus-storage/* paths
  registerStorageProxy(app);

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // ─── Panel generation SSE stream ──────────────────────────────────────────
  const { registerPanelStreamRoutes } = await import("../panelGenService");
  registerPanelStreamRoutes(app);

  // ─── OG Meta Injection for social crawlers (/m/:slug, /watch/:slug) ─────
  const SOCIAL_BOT_RE = /facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot|Baiduspider/i;
  app.get(["/m/:slug", "/watch/:slug"], async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    if (!SOCIAL_BOT_RE.test(ua)) return next(); // Not a bot, let SPA handle it
    try {
      const { getProjectBySlug, formatViewCount } = await import("../db");
      const project = await getProjectBySlug(req.params.slug);
      if (!project || project.visibility !== "public") return next();
      const origin = `${req.protocol}://${req.get("host")}`;
      const url = `${origin}${req.originalUrl}`;
      const title = project.title ? `${project.title} — Awakli` : "Awakli";
      const desc = project.description || `Read ${project.title || "this manga"} on Awakli`;
      const image = project.coverImageUrl || `${origin}/og-default.png`;
      const views = formatViewCount(project.viewCount ?? 0);
      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Cache-Control", "public, max-age=300");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="Awakli" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${image}" />
  <meta name="robots" content="index, follow" />
</head>
<body>
  <h1>${title}</h1>
  <p>${desc}</p>
  <p>${views} views</p>
  <a href="${url}">Read on Awakli</a>
</body>
</html>`);
    } catch (err) {
      console.error("[OG Meta] Error:", err);
      next();
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Attach WebSocket server for real-time generation events
  setupGenerationWebSocket(server);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Start canary probe scheduler after server is listening
    startCanaryScheduler();

    // Start idempotency cleanup scheduler (unconditional, not gated by ENABLE_CANARIES)
    startIdempotencyCleanupScheduler();
  });
}

startServer().catch(console.error);
