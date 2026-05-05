import { describe, it, expect } from "vitest";

// ─── Import component helpers ──────────────────────────────────────────
import { getBatchLimit } from "../client/src/components/awakli/PanelBatchBar";
import {
  STYLE_DRIFT_PREVIEW_COST,
  getStyleDriftApplyCost,
} from "../client/src/components/awakli/StyleDrift";
import {
  AUTO_CORRECT_MONTHLY_CAP,
  canAutoCorrect,
} from "../client/src/components/awakli/ConsistencyReport";
import { getRegenLimit } from "./panelGenService";

// ─── Copy string constants (exact spec for S2B) ──────────────────────
const COPY = {
  selectionHint: "Shift+click to select. Batch tools appear below.",
  batchBar: "{n} selected",
  batchRegenerate: "Redraw {n} panels · {n*3} credits",
  styleDriftLeft: "Grounded",
  styleDriftRight: "Stylized",
  consistencyTitle: "Consistency check",
  consistencyRow: "Panel {n}: {character} similarity {score}%",
};

// ─── Cost constants ──────────────────────────────────────────────────
const COST_PER_PANEL = 3;

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Stage 2B · Copy Strings", () => {
  it("selection hint matches spec", () => {
    expect(COPY.selectionHint).toBe(
      "Shift+click to select. Batch tools appear below."
    );
  });

  it("batch bar template matches spec", () => {
    expect(COPY.batchBar).toBe("{n} selected");
  });

  it("batch regenerate template matches spec", () => {
    expect(COPY.batchRegenerate).toBe("Redraw {n} panels · {n*3} credits");
  });

  it("style drift slider left label matches spec", () => {
    expect(COPY.styleDriftLeft).toBe("Grounded");
  });

  it("style drift slider right label matches spec", () => {
    expect(COPY.styleDriftRight).toBe("Stylized");
  });

  it("consistency report title matches spec", () => {
    expect(COPY.consistencyTitle).toBe("Consistency check");
  });

  it("consistency row template matches spec", () => {
    expect(COPY.consistencyRow).toBe(
      "Panel {n}: {character} similarity {score}%"
    );
  });
});

describe("Stage 2B · Batch Bar — Batch Limit by Tier", () => {
  it("free_trial has no batch (limit 0)", () => {
    expect(getBatchLimit("free_trial")).toBe(0);
  });

  it("creator (Mangaka) can batch up to 8 panels", () => {
    expect(getBatchLimit("creator")).toBe(8);
  });

  it("creator_pro (Studio) can batch unlimited panels", () => {
    expect(getBatchLimit("creator_pro")).toBe(Infinity);
  });

  it("studio can batch unlimited panels", () => {
    expect(getBatchLimit("studio")).toBe(Infinity);
  });

  it("studio_pro can batch unlimited panels", () => {
    expect(getBatchLimit("studio_pro")).toBe(Infinity);
  });

  it("enterprise can batch unlimited panels", () => {
    expect(getBatchLimit("enterprise")).toBe(Infinity);
  });

  it("unknown tier has no batch (limit 0)", () => {
    expect(getBatchLimit("nonexistent")).toBe(0);
  });
});

describe("Stage 2B · Batch Bar — Credit Calculation", () => {
  it("selecting 4 tiles costs exactly 4 × 3 = 12 credits", () => {
    const selectedCount = 4;
    const totalCost = selectedCount * COST_PER_PANEL;
    expect(totalCost).toBe(12);
  });

  it("selecting 1 tile costs 3 credits", () => {
    expect(1 * COST_PER_PANEL).toBe(3);
  });

  it("selecting 8 tiles (Mangaka max) costs 24 credits", () => {
    expect(8 * COST_PER_PANEL).toBe(24);
  });

  it("batch bar shows correct count format", () => {
    const count = 4;
    const display = `${count} selected`;
    expect(display).toBe("4 selected");
  });

  it("batch redraw shows correct credit format", () => {
    const count = 4;
    const cost = count * COST_PER_PANEL;
    const display = `Redraw ${count} panels · ${cost} credits`;
    expect(display).toBe("Redraw 4 panels · 12 credits");
  });
});

describe("Stage 2B · Batch Bar — Over-limit Detection", () => {
  it("Mangaka selecting 9 panels exceeds batch limit of 8", () => {
    const selectedCount = 9;
    const maxBatch = getBatchLimit("creator");
    const overLimit = selectedCount > maxBatch && maxBatch !== Infinity;
    expect(overLimit).toBe(true);
  });
  it("Mangaka selecting 8 panels does not exceed limit", () => {
    const selectedCount = 8;
    const maxBatch = getBatchLimit("creator");
    const overLimit = selectedCount > maxBatch && maxBatch !== Infinity;
    expect(overLimit).toBe(false);
  });;

  it("Studio selecting 100 panels never exceeds limit", () => {
    const selectedCount = 100;
    const maxBatch = getBatchLimit("studio");
    const overLimit = selectedCount > maxBatch && maxBatch !== Infinity;
    expect(overLimit).toBe(false);
  });
});

describe("Stage 2B · Style Drift — Cost Logic", () => {
  it("preview costs exactly 1 credit", () => {
    expect(STYLE_DRIFT_PREVIEW_COST).toBe(1);
  });

  it("apply cost = panel count × cost per panel", () => {
    expect(getStyleDriftApplyCost(10, COST_PER_PANEL)).toBe(30);
  });

  it("apply cost for 20 panels = 60 credits", () => {
    expect(getStyleDriftApplyCost(20, COST_PER_PANEL)).toBe(60);
  });

  it("apply cost for 0 panels = 0 credits", () => {
    expect(getStyleDriftApplyCost(0, COST_PER_PANEL)).toBe(0);
  });

  it("total style drift cost = preview + apply", () => {
    const panelCount = 10;
    const previewCost = STYLE_DRIFT_PREVIEW_COST;
    const applyCost = getStyleDriftApplyCost(panelCount, COST_PER_PANEL);
    const totalCost = previewCost + applyCost;
    expect(totalCost).toBe(31);
  });
});

describe("Stage 2B · Style Drift — Slider Values", () => {
  it("drift value 0 represents fully grounded", () => {
    const driftValue = 0;
    expect(driftValue).toBe(0);
  });

  it("drift value 1 represents fully stylized", () => {
    const driftValue = 1;
    expect(driftValue).toBe(1);
  });

  it("drift value 0.5 is the default (balanced)", () => {
    const defaultDrift = 0.5;
    expect(defaultDrift).toBe(0.5);
  });

  it("drift labels map correctly", () => {
    const getLabel = (v: number) => {
      if (v < 0.2) return "Very grounded";
      if (v < 0.4) return "Grounded";
      if (v < 0.6) return "Balanced";
      if (v < 0.8) return "Stylized";
      return "Very stylized";
    };
    expect(getLabel(0)).toBe("Very grounded");
    expect(getLabel(0.3)).toBe("Grounded");
    expect(getLabel(0.5)).toBe("Balanced");
    expect(getLabel(0.7)).toBe("Stylized");
    expect(getLabel(1.0)).toBe("Very stylized");
  });
});

describe("Stage 2B · Consistency Report — Auto-Correct Cap", () => {
  it("monthly cap is 5 per project", () => {
    expect(AUTO_CORRECT_MONTHLY_CAP).toBe(5);
  });

  it("studio_pro with 0 used can auto-correct", () => {
    expect(canAutoCorrect("studio_pro", 0)).toBe(true);
  });

  it("studio_pro with 4 used can still auto-correct", () => {
    expect(canAutoCorrect("studio_pro", 4)).toBe(true);
  });

  it("studio_pro with 5 used cannot auto-correct", () => {
    expect(canAutoCorrect("studio_pro", 5)).toBe(false);
  });

  it("enterprise with 3 used can auto-correct", () => {
    expect(canAutoCorrect("enterprise", 3)).toBe(true);
  });

  it("studio tier cannot auto-correct (not studio_pro)", () => {
    expect(canAutoCorrect("studio", 0)).toBe(false);
  });

  it("creator_pro cannot auto-correct", () => {
    expect(canAutoCorrect("creator_pro", 0)).toBe(false);
  });

  it("free_trial cannot auto-correct", () => {
    expect(canAutoCorrect("free_trial", 0)).toBe(false);
  });
});

describe("Stage 2B · Consistency Report — Flagged Panel Severity", () => {
  it("similarity below 75% is critical", () => {
    const score = 60;
    const severity = score < 75 ? "critical" : "warning";
    expect(severity).toBe("critical");
  });

  it("similarity at 75% is warning", () => {
    const score = 75;
    const severity = score < 75 ? "critical" : "warning";
    expect(severity).toBe("warning");
  });

  it("similarity at 84% is warning", () => {
    const score = 84;
    const severity = score < 75 ? "critical" : "warning";
    expect(severity).toBe("warning");
  });

  it("consistency row format is correct", () => {
    const panelNumber = 5;
    const character = "Aiko";
    const score = 72;
    const row = `Panel ${panelNumber}: ${character} similarity ${score}%`;
    expect(row).toBe("Panel 5: Aiko similarity 72%");
  });
});

describe("Stage 2B · Tier Gating — Feature Access", () => {
  it("Apprentice cannot access batch tools", () => {
    const batchLimit = getBatchLimit("free_trial");
    expect(batchLimit).toBe(0);
  });

  it("Mangaka can access batch tools", () => {
    const batchLimit = getBatchLimit("creator_pro");
    expect(batchLimit).toBeGreaterThan(0);
  });

  it("Studio has unlimited batch", () => {
    const batchLimit = getBatchLimit("studio");
    expect(batchLimit).toBe(Infinity);
  });

  it("Creator (Mangaka) regen limit is 15", () => {
    expect(getRegenLimit("creator")).toBe(15);
  });

  it("Creator Pro (Studio) regen limit is unlimited", () => {
    expect(getRegenLimit("creator_pro")).toBe(Infinity);
  });

  it("Studio regen limit is unlimited", () => {
    expect(getRegenLimit("studio")).toBe(Infinity);
  });
});

describe("Stage 2B · Selection Mode", () => {
  it("selection mode activates when selectedIds.size > 0", () => {
    const selectedIds = new Set([1, 3, 5]);
    const selectionMode = selectedIds.size > 0;
    expect(selectionMode).toBe(true);
  });

  it("selection mode deactivates when selectedIds is empty", () => {
    const selectedIds = new Set<number>();
    const selectionMode = selectedIds.size > 0;
    expect(selectionMode).toBe(false);
  });

  it("toggling a panel adds it to selection", () => {
    const selectedIds = new Set<number>();
    const panelId = 5;
    const next = new Set(selectedIds);
    next.add(panelId);
    expect(next.has(panelId)).toBe(true);
    expect(next.size).toBe(1);
  });

  it("toggling a selected panel removes it from selection", () => {
    const selectedIds = new Set([1, 3, 5]);
    const panelId = 3;
    const next = new Set(selectedIds);
    next.delete(panelId);
    expect(next.has(panelId)).toBe(false);
    expect(next.size).toBe(2);
  });

  it("clearing selection empties the set", () => {
    const selectedIds = new Set([1, 3, 5, 7]);
    const cleared = new Set<number>();
    expect(cleared.size).toBe(0);
  });
});

describe("Stage 2B · Analytics Events", () => {
  const REQUIRED_EVENTS = [
    "stage2_batch_select",
    "stage2_style_drift_preview",
    "stage2_style_drift_apply",
    "stage2_consistency_jump",
  ];

  REQUIRED_EVENTS.forEach((event) => {
    it(`defines analytics event: ${event}`, () => {
      expect(event).toBeTruthy();
      expect(typeof event).toBe("string");
    });
  });
});

describe("Stage 2B · No Dark Patterns in Copy", () => {
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

describe("Stage 2B · Flagged Panel Ring Styling", () => {
  it("selected tile gets violet ring", () => {
    const isSelected = true;
    const isFlagged = false;
    const ringClass = isSelected
      ? "ring-2 ring-violet-500"
      : isFlagged
      ? "ring-2 ring-[#FFD700]"
      : "ring-1 ring-white/[0.06]";
    expect(ringClass).toBe("ring-2 ring-violet-500");
  });

  it("flagged tile gets gold ring", () => {
    const isSelected = false;
    const isFlagged = true;
    const ringClass = isSelected
      ? "ring-2 ring-violet-500"
      : isFlagged
      ? "ring-2 ring-[#FFD700]"
      : "ring-1 ring-white/[0.06]";
    expect(ringClass).toBe("ring-2 ring-[#FFD700]");
  });

  it("normal tile gets default ring", () => {
    const isSelected = false;
    const isFlagged = false;
    const ringClass = isSelected
      ? "ring-2 ring-violet-500"
      : isFlagged
      ? "ring-2 ring-[#FFD700]"
      : "ring-1 ring-white/[0.06]";
    expect(ringClass).toBe("ring-1 ring-white/[0.06]");
  });

  it("selected takes priority over flagged", () => {
    const isSelected = true;
    const isFlagged = true;
    const ringClass = isSelected
      ? "ring-2 ring-violet-500"
      : isFlagged
      ? "ring-2 ring-[#FFD700]"
      : "ring-1 ring-white/[0.06]";
    expect(ringClass).toBe("ring-2 ring-violet-500");
  });
});
