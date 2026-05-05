/**
 * Wave 2 (C1-C3) Fix Brief Tests
 *
 * C1: Script — scene cards, regen, approve-all, credit cost labels
 * C2: Panels — grid, lightbox, batch tools, SSE, tier-gated features
 * C3: Publish — preview, cover designer, watermark, progress copy, anime CTA
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const CLIENT_SRC = path.resolve(__dirname, "../client/src");

// ─── C1: Script Stage ──────────────────────────────────────────────────

describe("C1: Script Stage", () => {
  it("ScriptEditor has draggable scene list with DndContext", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/ScriptEditor.tsx"),
      "utf-8"
    );
    expect(src).toContain("DndContext");
    expect(src).toContain("SortableContext");
    expect(src).toContain("SortableSceneCard");
  });

  it("ScriptEditor has approve-all button", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/ScriptEditor.tsx"),
      "utf-8"
    );
    expect(src).toContain("Approve all scenes");
    expect(src).toContain("approveAllMut");
  });

  it("ScriptEditor has scene detail panel with regen", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/ScriptEditor.tsx"),
      "utf-8"
    );
    expect(src).toContain("SceneDetailPanel");
    expect(src).toContain("onRegenerate");
  });

  it("SceneCard regen buttons show 3c credit cost", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/SceneCard.tsx"),
      "utf-8"
    );
    expect(src).toContain("(3c)");
    // RegenPopover shows dynamic cost via creditCost prop (default 3)
    const popover = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/RegenPopover.tsx"),
      "utf-8"
    );
    expect(popover).toContain("creditCost = 3");
  });

  it("ScriptEditor detail panel regen shows 3c cost", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/ScriptEditor.tsx"),
      "utf-8"
    );
    expect(src).toContain("(3c)");
  });

  it("Script page has character rename propagation", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/awakli/ScriptEditor.tsx"),
      "utf-8"
    );
    expect(src).toContain("RenameDialog");
    expect(src).toContain("renameMut");
  });
});

// ─── C2: Panels Stage ──────────────────────────────────────────────────

describe("C2: Panels Stage", () => {
  it("Panels page has PanelGrid component", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("PanelGrid");
    expect(src).toContain("panelTiles");
  });

  it("Panels page has SSE streaming for panel generation", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("EventSource");
    expect(src).toContain("panel_complete");
    expect(src).toContain("generation_complete");
  });

  it("Panels page has PanelLightbox for zoom/redraw", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("PanelLightbox");
    expect(src).toContain("lightboxPanelId");
  });

  it("Panels page has batch selection (shift-click)", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("selectedIds");
    expect(src).toContain("selectionMode");
    expect(src).toContain("Shift+click to select");
  });

  it("Panels page has PanelBatchBar for Mangaka+", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("PanelBatchBar");
    expect(src).toContain("hasBatchTools");
  });

  it("Panels page has StyleDrift for Mangaka+", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("StyleDrift");
    expect(src).toContain("styleDriftOpen");
  });

  it("Panels page has ConsistencyReport for Mangaka+", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("ConsistencyReport");
    expect(src).toContain("flaggedPanels");
  });

  it("Panels page has rate limit banner with countdown", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("rateLimitSeconds");
    expect(src).toContain("catching our breath");
  });

  it("Panels page has regen counter with tier limit", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("regenCount");
    expect(src).toContain("regenLimit");
    expect(src).toContain("redraws used this project");
  });

  it("Panels page shows 'All panels ready' completion banner", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/panels.tsx"),
      "utf-8"
    );
    expect(src).toContain("All panels ready. Publish when you are.");
  });
});

// ─── C3: Publish Stage ─────────────────────────────────────────────────

describe("C3: Publish Stage", () => {
  it("Publish page has PublishPreview component", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("PublishPreview");
  });

  it("Publish page has CoverDesigner with 3 presets", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("CoverDesigner");
    expect(src).toContain("stylePreset");
    expect(src).toContain("shonen");
  });

  it("Publish page has WatermarkToggle with tier-aware behavior", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("WatermarkToggle");
    expect(src).toContain("getWatermarkBehavior");
    expect(src).toContain("locked_on");
  });

  it("Publish page has exact progress copy strings", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("Composing pages\u2026");
    expect(src).toContain("Generating thumbnails\u2026");
    expect(src).toContain("Creating your share link\u2026");
  });

  it("Publish page has success state with 'Your episode is live.'", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("Your episode is live.");
  });

  it("Publish page has 'Make it move' CTA to anime-gate", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("Make it move");
    expect(src).toContain("/create/anime-gate");
  });

  it("Publish page fetches real panels from API (not mock)", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("trpc.panels.listByEpisode.useQuery");
    expect(src).toContain("trpc.episodes.listByProject.useQuery");
  });

  it("Publish page has share buttons (copy link, share, QR)", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("handleCopyLink");
    expect(src).toContain("handleShare");
    expect(src).toContain("QR Code");
  });

  it("Publish page has visibility toggle for Mangaka+", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "pages/create/publish.tsx"),
      "utf-8"
    );
    expect(src).toContain("canToggleVisibility");
    expect(src).toContain("Unlisted");
  });
});
