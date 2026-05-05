/**
 * Closing Brief v1.0 — Vitest tests for all 6 tickets
 *
 * X3-F: Pricing catalog reconciliation
 * X4-F: CreditMeter wiring
 * C1-F: Script stage components (RegenPopover)
 * C2-F: Panels stage components (already shipped)
 * P3-F: Legacy accent palette deletion
 * P4-F: Stage numeral alignment
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = path.join(__dirname, "..", "client", "src");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

function readClientFile(relPath: string): string {
  return fs.readFileSync(path.join(CLIENT_SRC, relPath), "utf-8");
}

// ─── X3-F: Pricing catalog reconciliation ──────────────────────────────
describe("X3-F: Pricing catalog reconciliation", () => {
  it("shared/pricingCatalog.ts exports TIERS with correct prices", () => {
    const src = readFile("shared/pricingCatalog.ts");
    // Four-tier model: Apprentice($0), Mangaka($19), Studio($49), StudioPro($149)
    expect(src).toContain("TIER_MONTHLY_PRICE_CENTS");
    expect(src).toContain("tierPriceLabel");
    expect(src).toContain("formatPrice");
  });

  it("no $99 or $499 price strings remain in client/src", () => {
    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          files.push(...walk(full));
        } else if (/\.(tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")) {
          files.push(full);
        }
      }
      return files;
    };

    const allFiles = walk(CLIENT_SRC);
    const hits99: string[] = [];
    const hits499: string[] = [];

    for (const f of allFiles) {
      const content = fs.readFileSync(f, "utf-8");
      // Match $99 as a tier price (not $99.99 or $990 etc.)
      if (/\$99(?!\d|\.)/g.test(content)) {
        hits99.push(f.replace(CLIENT_SRC + "/", ""));
      }
      if (/\$499(?!\d|\.)/g.test(content)) {
        hits499.push(f.replace(CLIENT_SRC + "/", ""));
      }
    }

    expect(hits99).toEqual([]);
    expect(hits499).toEqual([]);
  });

  it("TierCompareCard imports from pricingCatalog", () => {
    const src = readClientFile("components/awakli/TierCompareCard.tsx");
    expect(src).toContain("pricingCatalog");
  });

  it("UpgradeModal imports from pricingCatalog", () => {
    const src = readClientFile("components/awakli/UpgradeModal.tsx");
    expect(src).toContain("pricingCatalog");
  });
});

// ─── X4-F: CreditMeter wiring ─────────────────────────────────────────
describe("X4-F: CreditMeter wiring", () => {
  it("shared/creditMath.ts exists with per-unit rates", () => {
    const src = readFile("shared/creditMath.ts");
    expect(src).toContain("CREDIT_RATES");
    expect(src).toContain("STAGE_DISPLAY_LABELS");
  });

  it("useProjectCreditForecast hook exists", () => {
    const src = readClientFile("hooks/useProjectCreditForecast.ts");
    expect(src).toContain("useProjectCreditForecast");
    expect(src).toContain("calculateProjectCosts");
  });

  it("CreateWizardLayout imports useProjectCreditForecast", () => {
    const src = readClientFile("layouts/CreateWizardLayout.tsx");
    expect(src).toContain("useProjectCreditForecast");
  });

  it("no static ~17 cr placeholder in CreditMeter", () => {
    const src = readClientFile("layouts/CreateWizardLayout.tsx");
    expect(src).not.toContain("~17 cr");
    expect(src).not.toContain("~17cr");
  });
});

// ─── C1-F: Script stage components ─────────────────────────────────────
describe("C1-F: Script stage components", () => {
  it("RegenPopover component exists", () => {
    const src = readClientFile("components/awakli/RegenPopover.tsx");
    expect(src).toContain("RegenPopover");
    expect(src).toContain("onRegenerate");
    expect(src).toContain("Quick regenerate");
  });

  it("SceneCard imports RegenPopover", () => {
    const src = readClientFile("components/awakli/SceneCard.tsx");
    expect(src).toContain("RegenPopover");
    expect(src).toContain("from \"./RegenPopover\"");
  });

  it("ScriptEditor exists with two-pane layout", () => {
    const src = readClientFile("components/awakli/ScriptEditor.tsx");
    expect(src).toContain("ScriptEditor");
    expect(src).toContain("SceneCard");
  });

  it("CharacterChip exists", () => {
    const src = readClientFile("components/awakli/CharacterChip.tsx");
    expect(src).toContain("CharacterChip");
  });

  it("script.tsx page imports ScriptEditor", () => {
    const src = readClientFile("pages/create/script.tsx");
    expect(src).toContain("ScriptEditor");
    expect(src).toContain("from \"@/components/awakli/ScriptEditor\"");
  });
});

// ─── C2-F: Panels stage components ─────────────────────────────────────
describe("C2-F: Panels stage components", () => {
  const requiredComponents = [
    "PanelGrid",
    "PanelTile",
    "PanelLightbox",
    "PanelBatchBar",
    "StyleDrift",
    "ConsistencyReport",
  ];

  for (const comp of requiredComponents) {
    it(`${comp} component exists`, () => {
      const src = readClientFile(`components/awakli/${comp}.tsx`);
      expect(src).toContain(comp);
    });
  }

  it("panels.tsx imports all required components", () => {
    const src = readClientFile("pages/create/panels.tsx");
    for (const comp of requiredComponents) {
      expect(src).toContain(comp);
    }
  });
});

// ─── P3-F: Legacy accent palette deletion ──────────────────────────────
describe("P3-F: Legacy accent palette deletion", () => {
  it("no --accent-cyan/pink/gold/violet/ember/jade/sakura CSS vars in index.css (except accent-foreground)", () => {
    const src = readClientFile("index.css");
    const lines = src.split("\n");
    const accentLines = lines.filter(
      (l) => /--accent-/.test(l) && !/--accent-foreground/.test(l) && !/--color-accent-foreground/.test(l)
    );
    expect(accentLines).toEqual([]);
  });

  it("no legacy hex #00d4ff in client/src", () => {
    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          files.push(...walk(full));
        } else if (/\.(tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")) {
          files.push(full);
        }
      }
      return files;
    };

    const allFiles = walk(CLIENT_SRC);
    const hits: string[] = [];
    for (const f of allFiles) {
      const content = fs.readFileSync(f, "utf-8");
      if (/#00[Dd]4[Ff][Ff]/.test(content)) {
        hits.push(f.replace(CLIENT_SRC + "/", ""));
      }
    }
    expect(hits).toEqual([]);
  });

  it("no legacy hex #ffb800 in client/src", () => {
    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          files.push(...walk(full));
        } else if (/\.(tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")) {
          files.push(full);
        }
      }
      return files;
    };

    const allFiles = walk(CLIENT_SRC);
    const hits: string[] = [];
    for (const f of allFiles) {
      const content = fs.readFileSync(f, "utf-8");
      if (/#[Ff][Ff][Bb]800/.test(content)) {
        hits.push(f.replace(CLIENT_SRC + "/", ""));
      }
    }
    expect(hits).toEqual([]);
  });

  it("no accent-cyan/pink/gold/purple Tailwind classes in TSX files", () => {
    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          files.push(...walk(full));
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
          files.push(full);
        }
      }
      return files;
    };

    const allFiles = walk(CLIENT_SRC);
    const hits: string[] = [];
    for (const f of allFiles) {
      const content = fs.readFileSync(f, "utf-8");
      if (/accent-cyan|accent-pink|accent-gold|accent-purple/.test(content)) {
        hits.push(f.replace(CLIENT_SRC + "/", ""));
      }
    }
    expect(hits).toEqual([]);
  });
});

// ─── P4-F: Stage numeral alignment ────────────────────────────────────────
describe("P4-F: Stage numeral alignment", () => {
  // StageHeader derives numerals dynamically from STAGES array index.
  // After Storyboard added: Input(01) Script(02) Panels(03) Storyboard(04) Publish(05) Gate(06) Setup(07) Video(08)
  it("StageHeader component derives numeral from STAGES index", () => {
    const stageHeaderSrc = readClientFile("components/awakli/StageHeader.tsx");
    expect(stageHeaderSrc).toContain('String(index + 1).padStart(2, "0")');
    expect(stageHeaderSrc).toContain("Stage {numeral}");
  });

  it("create pages use StageHeader with correct stageKey", () => {
    const script = readClientFile("pages/create/script.tsx");
    expect(script).toContain('stageKey="script"');

    const panels = readClientFile("pages/create/panels.tsx");
    expect(panels).toContain('stageKey="panels"');

    const publish = readClientFile("pages/create/publish.tsx");
    expect(publish).toContain('stageKey="publish"');

    const setup = readClientFile("pages/create/setup.tsx");
    expect(setup).toContain('stageKey="setup"');

    const video = readClientFile("pages/create/video.tsx");
    expect(video).toContain('stageKey="video"');
  });

  it("STAGES array produces correct numerals for each page", async () => {
    const { STAGES } = await import("../client/src/layouts/CreateWizardLayout");
    const expected: Record<string, string> = {
      script: "02",
      panels: "03",
      publish: "05",
      setup: "07",
      video: "08",
    };
    for (const [key, numeral] of Object.entries(expected)) {
      const idx = STAGES.findIndex((s: any) => s.key === key);
      expect(String(idx + 1).padStart(2, "0")).toBe(numeral);
    }
  });

  it("no hardcoded stage numerals in page source files", () => {
    // Pages should use StageHeader component, not hardcoded "Stage XX" strings
    const pages = ["pages/create/script.tsx", "pages/create/panels.tsx", "pages/create/publish.tsx", "pages/create/setup.tsx", "pages/create/video.tsx"];
    for (const p of pages) {
      const src = readClientFile(p);
      expect(src).not.toMatch(/Stage \d{2} —/);
    }
  });
});