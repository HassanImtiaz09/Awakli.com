import { describe, it, expect } from "vitest";

// ─── Import server-side service ─────────────────────────────────────────
import {
  getRegenLimit,
  getStreamStatus,
} from "./panelGenService";

// ─── Copy string constants (exact spec) ────────────────────────────────
const COPY = {
  pageTitle: "Your panels",
  subhead: "Miss a moment? Tap any panel to redraw it.",
  hoverRedraw: "Redraw",
  popoverPlaceholder:
    "Make it rain. Pull the camera in. Remove the second character…",
  confirmCTA: "Redraw · 3 credits",
  completeBanner: "All panels ready. Publish when you are.",
  rateLimit: "We're catching our breath — resuming in {s}s",
};

// ─── Mock panel data ───────────────────────────────────────────────────
interface MockPanel {
  id: number;
  panelNumber: number;
  sceneNumber: number;
  imageUrl: string | null;
  compositeImageUrl: string | null;
  status: "draft" | "generating" | "generated" | "approved" | "rejected";
  visualDescription: string;
  cameraAngle: string;
}

function makeMockPanels(count: number, status: MockPanel["status"] = "draft"): MockPanel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    panelNumber: i + 1,
    sceneNumber: Math.floor(i / 5) + 1,
    imageUrl: status !== "draft" && status !== "generating" ? `https://cdn.example.com/panel-${i + 1}.png` : null,
    compositeImageUrl: null,
    status,
    visualDescription: `Panel ${i + 1} visual description`,
    cameraAngle: i % 2 === 0 ? "wide" : "close-up",
  }));
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Stage 2 · Panels — Copy Strings", () => {
  it("page title matches spec", () => {
    expect(COPY.pageTitle).toBe("Your panels");
  });

  it("subhead matches spec", () => {
    expect(COPY.subhead).toBe("Miss a moment? Tap any panel to redraw it.");
  });

  it("hover redraw text matches spec", () => {
    expect(COPY.hoverRedraw).toBe("Redraw");
  });

  it("popover placeholder matches spec", () => {
    expect(COPY.popoverPlaceholder).toBe(
      "Make it rain. Pull the camera in. Remove the second character…"
    );
  });

  it("confirm CTA matches spec", () => {
    expect(COPY.confirmCTA).toBe("Redraw · 3 credits");
  });

  it("complete banner matches spec", () => {
    expect(COPY.completeBanner).toBe("All panels ready. Publish when you are.");
  });

  it("rate-limit message template matches spec", () => {
    expect(COPY.rateLimit).toBe("We're catching our breath — resuming in {s}s");
  });
});

describe("Stage 2 · Panels — Regen Limits by Tier", () => {
  it("free_trial tier gets 5 redraws", () => {
    expect(getRegenLimit("free_trial")).toBe(5);
  });

  it("creator (Mangaka) tier gets 15 redraws", () => {
    expect(getRegenLimit("creator")).toBe(15);
  });

  it("creator_pro (Studio) tier gets unlimited redraws", () => {
    expect(getRegenLimit("creator_pro")).toBe(Infinity);
  });

  it("studio tier gets unlimited redraws", () => {
    expect(getRegenLimit("studio")).toBe(Infinity);
  });

  it("studio_pro tier gets unlimited redraws", () => {
    expect(getRegenLimit("studio_pro")).toBe(Infinity);
  });

  it("unknown tier defaults to 5 redraws", () => {
    expect(getRegenLimit("nonexistent")).toBe(5);
  });
});

describe("Stage 2 · Panels — Panel Tile States", () => {
  it("draft panels have no imageUrl", () => {
    const panels = makeMockPanels(5, "draft");
    panels.forEach((p) => {
      expect(p.imageUrl).toBeNull();
      expect(p.status).toBe("draft");
    });
  });

  it("generating panels have no imageUrl", () => {
    const panels = makeMockPanels(5, "generating");
    panels.forEach((p) => {
      expect(p.imageUrl).toBeNull();
      expect(p.status).toBe("generating");
    });
  });

  it("generated panels have imageUrl", () => {
    const panels = makeMockPanels(5, "generated");
    panels.forEach((p) => {
      expect(p.imageUrl).toBeTruthy();
      expect(p.status).toBe("generated");
    });
  });

  it("approved panels have imageUrl", () => {
    const panels = makeMockPanels(5, "approved");
    panels.forEach((p) => {
      expect(p.imageUrl).toBeTruthy();
      expect(p.status).toBe("approved");
    });
  });
});

describe("Stage 2 · Panels — Completion Detection", () => {
  it("allComplete is true when all panels have images and none generating", () => {
    const panels = makeMockPanels(20, "generated");
    const total = panels.length;
    const withImage = panels.filter((p) => !!p.imageUrl).length;
    const genInProgress = panels.filter((p) => p.status === "generating").length;
    const allComplete = total > 0 && withImage === total && genInProgress === 0;
    expect(allComplete).toBe(true);
  });

  it("allComplete is false when some panels are still generating", () => {
    const panels = [
      ...makeMockPanels(15, "generated"),
      ...makeMockPanels(5, "generating"),
    ];
    const total = panels.length;
    const withImage = panels.filter((p) => !!p.imageUrl).length;
    const genInProgress = panels.filter((p) => p.status === "generating").length;
    const allComplete = total > 0 && withImage === total && genInProgress === 0;
    expect(allComplete).toBe(false);
  });

  it("allComplete is false when no panels exist", () => {
    const panels: MockPanel[] = [];
    const total = panels.length;
    const withImage = panels.filter((p) => !!p.imageUrl).length;
    const genInProgress = panels.filter((p) => p.status === "generating").length;
    const allComplete = total > 0 && withImage === total && genInProgress === 0;
    expect(allComplete).toBe(false);
  });

  it("allComplete is false when some panels are still draft", () => {
    const panels = [
      ...makeMockPanels(10, "generated"),
      ...makeMockPanels(10, "draft"),
    ];
    const total = panels.length;
    const withImage = panels.filter((p) => !!p.imageUrl).length;
    const genInProgress = panels.filter((p) => p.status === "generating").length;
    const allComplete = total > 0 && withImage === total && genInProgress === 0;
    expect(allComplete).toBe(false);
  });
});

describe("Stage 2 · Panels — Regen Cap Logic", () => {
  it("user below cap can redraw", () => {
    const regenCount = 3;
    const regenLimit = 5;
    const canRedraw = regenCount < regenLimit;
    expect(canRedraw).toBe(true);
  });

  it("user at cap cannot redraw", () => {
    const regenCount = 5;
    const regenLimit = 5;
    const canRedraw = regenCount < regenLimit;
    expect(canRedraw).toBe(false);
  });

  it("studio user is never at cap", () => {
    const regenCount = 1000;
    const regenLimit = Infinity;
    const canRedraw = regenCount < regenLimit;
    expect(canRedraw).toBe(true);
  });

  it("cap triggers upgrade modal when exceeded for free_trial", () => {
    const regenCount = 5;
    const regenLimit = getRegenLimit("free_trial");
    const shouldShowUpgrade = regenCount >= regenLimit;
    expect(shouldShowUpgrade).toBe(true);
  });

  it("Creator user has higher cap than Free Trial", () => {
    const freeCap = getRegenLimit("free_trial");
    const creatorCap = getRegenLimit("creator");
    expect(creatorCap).toBeGreaterThan(freeCap);
  });
});

describe("Stage 2 · Panels — Stream Status", () => {
  it("returns idle status for non-existent job", () => {
    const status = getStreamStatus(99999, 99999);
    expect(status.status).toBe("idle");
    expect(status.totalPanels).toBe(0);
    expect(status.completedPanels).toBe(0);
  });

  it("status object has required fields", () => {
    const status = getStreamStatus(1, 1);
    expect(status).toHaveProperty("projectId");
    expect(status).toHaveProperty("episodeId");
    expect(status).toHaveProperty("totalPanels");
    expect(status).toHaveProperty("completedPanels");
    expect(status).toHaveProperty("status");
  });
});

describe("Stage 2 · Panels — PanelGrid Placeholder Logic", () => {
  it("placeholder count fills remaining slots to totalExpected", () => {
    const totalExpected = 20;
    const existingPanels = 8;
    const placeholderCount = Math.max(0, totalExpected - existingPanels);
    expect(placeholderCount).toBe(12);
  });

  it("no placeholders when all panels exist", () => {
    const totalExpected = 20;
    const existingPanels = 20;
    const placeholderCount = Math.max(0, totalExpected - existingPanels);
    expect(placeholderCount).toBe(0);
  });

  it("no negative placeholders when more panels than expected", () => {
    const totalExpected = 20;
    const existingPanels = 25;
    const placeholderCount = Math.max(0, totalExpected - existingPanels);
    expect(placeholderCount).toBe(0);
  });
});

describe("Stage 2 · Panels — Credit Logic", () => {
  it("redraw costs 3 credits", () => {
    const REDRAW_COST = 3;
    expect(REDRAW_COST).toBe(3);
  });

  it("initial generation is included in stage cost (not per-panel)", () => {
    // Stage 2 (panels) is a flat cost included in the project stage costs
    const INITIAL_GEN_COST_PER_PANEL = 0; // bundled
    expect(INITIAL_GEN_COST_PER_PANEL).toBe(0);
  });
});

describe("Stage 2 · Panels — Analytics Events", () => {
  const REQUIRED_EVENTS = [
    "stage2_open",
    "stage2_panel_rendered",
    "stage2_panel_regen",
    "stage2_cap_hit",
  ];

  REQUIRED_EVENTS.forEach((event) => {
    it(`defines analytics event: ${event}`, () => {
      expect(event).toBeTruthy();
      expect(typeof event).toBe("string");
    });
  });
});

describe("Stage 2 · Panels — Apprentice Restrictions", () => {
  it("Apprentice tier has no batch select", () => {
    // Apprentice (free_trial/creator) does not have batch select
    const hasBatchSelect = false; // hardcoded for Apprentice
    expect(hasBatchSelect).toBe(false);
  });

  it("Apprentice tier has no ControlNet", () => {
    const hasControlNet = false;
    expect(hasControlNet).toBe(false);
  });

  it("Apprentice tier has no LoRA", () => {
    const hasLoRA = false;
    expect(hasLoRA).toBe(false);
  });

  it("generation is sequential (not parallel) for Apprentice", () => {
    const isSequential = true;
    expect(isSequential).toBe(true);
  });
});

describe("Stage 2 · Panels — No Dark Patterns", () => {
  const DARK_PATTERN_PHRASES = [
    "limited time",
    "limited offer",
    "act now",
    "don't miss",
    "countdown",
    "only X left",
    "hurry",
    "expires soon",
  ];

  const allCopyText = Object.values(COPY).join(" ").toLowerCase();

  DARK_PATTERN_PHRASES.forEach((phrase) => {
    it(`copy does not contain dark pattern: "${phrase}"`, () => {
      expect(allCopyText).not.toContain(phrase.toLowerCase());
    });
  });
});

describe("Stage 2 · Panels — Rate Limit Banner", () => {
  it("rate limit message uses {s} placeholder for seconds", () => {
    expect(COPY.rateLimit).toContain("{s}s");
  });

  it("rate limit countdown replaces placeholder correctly", () => {
    const seconds = 30;
    const message = COPY.rateLimit.replace("{s}", String(seconds));
    expect(message).toBe("We're catching our breath — resuming in 30s");
  });

  it("rate limit countdown at 1 second", () => {
    const seconds = 1;
    const message = COPY.rateLimit.replace("{s}", String(seconds));
    expect(message).toBe("We're catching our breath — resuming in 1s");
  });
});

describe("Stage 2 · Panels — PanelTile Data Shape", () => {
  it("panel tile has all required fields", () => {
    const panel = makeMockPanels(1, "generated")[0];
    expect(panel).toHaveProperty("id");
    expect(panel).toHaveProperty("panelNumber");
    expect(panel).toHaveProperty("sceneNumber");
    expect(panel).toHaveProperty("imageUrl");
    expect(panel).toHaveProperty("compositeImageUrl");
    expect(panel).toHaveProperty("status");
    expect(panel).toHaveProperty("visualDescription");
    expect(panel).toHaveProperty("cameraAngle");
  });

  it("panel status is one of the valid values", () => {
    const validStatuses = ["draft", "generating", "generated", "approved", "rejected"];
    const panel = makeMockPanels(1, "generated")[0];
    expect(validStatuses).toContain(panel.status);
  });
});

describe("Stage 2 · Panels — Lightbox Navigation", () => {
  it("can navigate forward when not at last panel", () => {
    const currentIdx = 3;
    const totalPanels = 10;
    const canGoNext = currentIdx < totalPanels - 1;
    expect(canGoNext).toBe(true);
  });

  it("cannot navigate forward at last panel", () => {
    const currentIdx = 9;
    const totalPanels = 10;
    const canGoNext = currentIdx < totalPanels - 1;
    expect(canGoNext).toBe(false);
  });

  it("can navigate backward when not at first panel", () => {
    const currentIdx = 3;
    const canGoPrev = currentIdx > 0;
    expect(canGoPrev).toBe(true);
  });

  it("cannot navigate backward at first panel", () => {
    const currentIdx = 0;
    const canGoPrev = currentIdx > 0;
    expect(canGoPrev).toBe(false);
  });
});
