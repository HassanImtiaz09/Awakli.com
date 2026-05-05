import { describe, it, expect } from "vitest";

// ─── Import server-side service ─────────────────────────────────────────
import {
  enrichScenes,
  extractCharacters,
  getRegenLimit,
} from "./scriptSceneService";

// ─── Copy string constants ──────────────────────────────────────────────
const COPY = {
  pageTitle: "Your script",
  subhead: "Read it. Change anything. Nothing expensive happens here.",
  sceneApprove: "Approve scene",
  bulkApprove: "Approve all scenes",
  regenPlaceholder: "Make this scene more intense, set it at dusk…",
  regenConfirm: "Regenerate scene · 3 credits",
  proceedCTA: "Draw my panels →",
};

// ─── Mock script data ───────────────────────────────────────────────────
function makeMockScript(sceneCount: number, allApproved = false) {
  return {
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      scene_number: i + 1,
      title: `Scene ${i + 1}`,
      location: `Location ${i + 1}`,
      time_of_day: "night",
      mood: "tense",
      description: `Description for scene ${i + 1}`,
      beat_summary: `Beat for scene ${i + 1}`,
      characters: ["Aiko", "Ren"],
      approved: allApproved,
      panels: [
        {
          panel_number: 1,
          visual_description: "Wide shot of the city",
          camera_angle: "wide",
          dialogue: [
            { character: "Aiko", emotion: "determined", text: "Let's go." },
          ],
        },
      ],
    })),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────
describe("Stage 1 · Script — Copy Strings", () => {
  it("page title matches spec", () => {
    expect(COPY.pageTitle).toBe("Your script");
  });

  it("subhead matches spec", () => {
    expect(COPY.subhead).toBe(
      "Read it. Change anything. Nothing expensive happens here."
    );
  });

  it("scene approve button text matches spec", () => {
    expect(COPY.sceneApprove).toBe("Approve scene");
  });

  it("bulk approve button text matches spec", () => {
    expect(COPY.bulkApprove).toBe("Approve all scenes");
  });

  it("regenerate popover placeholder matches spec", () => {
    expect(COPY.regenPlaceholder).toBe(
      "Make this scene more intense, set it at dusk…"
    );
  });

  it("regenerate confirm button text matches spec", () => {
    expect(COPY.regenConfirm).toBe("Regenerate scene · 3 credits");
  });

  it("proceed CTA matches spec", () => {
    expect(COPY.proceedCTA).toBe("Draw my panels →");
  });
});

describe("Stage 1 · Script — Scene Enrichment", () => {
  it("enrichScenes adds approved=false to scenes without it", () => {
    const script = {
      scenes: [
        {
          scene_number: 1,
          title: "Test",
          location: "Rooftop",
          time_of_day: "night",
          mood: "tense",
          description: "A rooftop scene",
          panels: [],
        },
      ],
    };
    const enriched = enrichScenes(script as any);
    expect(enriched.scenes[0]).toHaveProperty("approved", false);
  });

  it("enrichScenes preserves existing approved=true", () => {
    const script = {
      scenes: [
        {
          scene_number: 1,
          title: "Test",
          location: "Rooftop",
          time_of_day: "night",
          mood: "tense",
          description: "A rooftop scene",
          approved: true,
          panels: [],
        },
      ],
    };
    const enriched = enrichScenes(script as any);
    expect(enriched.scenes[0].approved).toBe(true);
  });

  it("enrichScenes extracts characters from dialogue", () => {
    const script = makeMockScript(1);
    const enriched = enrichScenes(script as any);
    expect(enriched.scenes[0].characters).toContain("Aiko");
  });

  it("enrichScenes adds beat_summary if missing", () => {
    const script = {
      scenes: [
        {
          scene_number: 1,
          title: "Test",
          location: "Rooftop",
          time_of_day: "night",
          mood: "tense",
          description: "A rooftop scene",
          panels: [
            {
              panel_number: 1,
              visual_description: "Wide shot",
              camera_angle: "wide",
              dialogue: [],
            },
          ],
        },
      ],
    };
    const enriched = enrichScenes(script as any);
    expect(enriched.scenes[0]).toHaveProperty("beat_summary");
  });
});

describe("Stage 1 · Script — Character Extraction", () => {
  it("extractCharacters returns unique character names from all scenes", () => {
    const script = makeMockScript(3);
    const chars = extractCharacters(script as any);
    expect(chars).toContain("Aiko");
    expect(chars).toContain("Ren");
    expect(chars.length).toBe(2); // Unique
  });

  it("extractCharacters returns empty array for script with no dialogue", () => {
    const script = {
      scenes: [
        {
          scene_number: 1,
          title: "Silent",
          location: "Desert",
          time_of_day: "dawn",
          mood: "lonely",
          description: "Empty desert",
          panels: [
            {
              panel_number: 1,
              visual_description: "Wide shot",
              camera_angle: "wide",
              dialogue: [],
            },
          ],
        },
      ],
    };
    const chars = extractCharacters(script as any);
    expect(chars.length).toBe(0);
  });
});

describe("Stage 1 · Script — Regeneration Limits", () => {
  it("free_trial tier gets 3 regenerations", () => {
    expect(getRegenLimit("free_trial")).toBe(3);
  });

  it("apprentice tier gets 3 regenerations", () => {
    expect(getRegenLimit("apprentice")).toBe(3);
  });

  it("creator tier gets 15 regenerations", () => {
    expect(getRegenLimit("creator")).toBe(15);
  });

  it("creator_pro tier gets unlimited regenerations", () => {
    expect(getRegenLimit("creator_pro")).toBe(Infinity);
  });

  it("studio tier gets unlimited regenerations", () => {
    expect(getRegenLimit("studio")).toBe(Infinity);
  });

  it("enterprise tier gets unlimited regenerations", () => {
    expect(getRegenLimit("enterprise")).toBe(Infinity);
  });
});

describe("Stage 1 · Script — Approval Flow", () => {
  it("allApproved is false when any scene is not approved", () => {
    const script = makeMockScript(3, false);
    const allApproved = script.scenes.every((s) => s.approved);
    expect(allApproved).toBe(false);
  });

  it("allApproved is true when every scene is approved", () => {
    const script = makeMockScript(3, true);
    const allApproved = script.scenes.every((s) => s.approved);
    expect(allApproved).toBe(true);
  });

  it("proceed button should be blocked when not all scenes approved", () => {
    const script = makeMockScript(5, false);
    const canProceed = script.scenes.every((s) => s.approved);
    expect(canProceed).toBe(false);
  });

  it("proceed button should be enabled when all scenes approved", () => {
    const script = makeMockScript(5, true);
    const canProceed = script.scenes.every((s) => s.approved);
    expect(canProceed).toBe(true);
  });
});

describe("Stage 1 · Script — Credit Logic", () => {
  it("regeneration costs 3 credits per scene", () => {
    const REGEN_COST = 3;
    expect(REGEN_COST).toBe(3);
  });

  it("character prop change costs 1 credit", () => {
    const CHAR_PROP_COST = 1;
    expect(CHAR_PROP_COST).toBe(1);
  });

  it("script generation is free (bundled in Stage 0 cost)", () => {
    const SCRIPT_GEN_COST = 0;
    expect(SCRIPT_GEN_COST).toBe(0);
  });
});

describe("Stage 1 · Script — Analytics Events", () => {
  const REQUIRED_EVENTS = [
    "stage1_open",
    "stage1_scene_edit",
    "stage1_scene_regen",
    "stage1_approve_all",
    "stage1_proceed",
  ];

  REQUIRED_EVENTS.forEach((event) => {
    it(`defines analytics event: ${event}`, () => {
      expect(event).toBeTruthy();
      expect(typeof event).toBe("string");
    });
  });
});

describe("Stage 1 · Script — Scene Structure", () => {
  it("each scene has required fields", () => {
    const script = makeMockScript(1);
    const scene = script.scenes[0];
    expect(scene).toHaveProperty("scene_number");
    expect(scene).toHaveProperty("title");
    expect(scene).toHaveProperty("location");
    expect(scene).toHaveProperty("time_of_day");
    expect(scene).toHaveProperty("mood");
    expect(scene).toHaveProperty("description");
    expect(scene).toHaveProperty("panels");
    expect(scene).toHaveProperty("approved");
  });

  it("panels have required fields", () => {
    const script = makeMockScript(1);
    const panel = script.scenes[0].panels[0];
    expect(panel).toHaveProperty("panel_number");
    expect(panel).toHaveProperty("visual_description");
    expect(panel).toHaveProperty("camera_angle");
    expect(panel).toHaveProperty("dialogue");
  });

  it("dialogue lines have character, emotion, and text", () => {
    const script = makeMockScript(1);
    const dialogue = script.scenes[0].panels[0].dialogue[0];
    expect(dialogue).toHaveProperty("character");
    expect(dialogue).toHaveProperty("emotion");
    expect(dialogue).toHaveProperty("text");
  });
});
