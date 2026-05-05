import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

/* ═══════════════════════════════════════════════════════════════════════
   B6-Phase1 — Hotfix: React error #310 + Trending filter
   ═══════════════════════════════════════════════════════════════════════ */
describe("B6-Phase1: WatchProject defensive guards", () => {
  const src = read("client/src/pages/WatchProject.tsx");

  it("useMemo for jsonLd is null-safe (checks for p before accessing properties)", () => {
    const jsonLdIdx = src.indexOf("const jsonLd = useMemo");
    expect(jsonLdIdx).toBeGreaterThan(-1);
    const memoBlock = src.slice(jsonLdIdx, jsonLdIdx + 200);
    expect(memoBlock).toContain("if (!p)");
  });
});

describe("B6-Phase1: Home.tsx Trending filter", () => {
  const src = read("client/src/pages/Home.tsx");

  it("filters live titles before rendering", () => {
    expect(src).toContain("filterLiveTitles");
  });

  it("shows 'More coming tonight' fallback when catalog is empty", () => {
    expect(src).toContain("More titles coming tonight");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   B5 — Nav rename + regroup
   ═══════════════════════════════════════════════════════════════════════ */
describe("B5: Navigation rename and regroup", () => {
  const topNav = read("client/src/components/awakli/TopNav.tsx");
  const footer = read("client/src/components/awakli/MarketingFooter.tsx");

  it("TopNav uses 'Discover' instead of 'Watch' or 'Feed'", () => {
    expect(topNav).toContain("Discover");
    expect(topNav).not.toMatch(/label:\s*["']Feed["']/);
  });

  it("TopNav uses 'Characters' instead of 'Codex'", () => {
    expect(topNav).toContain("Characters");
    expect(topNav).not.toMatch(/label:\s*["']Codex["']/);
  });

  it("TopNav does not use legacy 'Compete' label", () => {
    expect(topNav).not.toMatch(/label:\s*["']Compete["']/);
  });

  it("TopNav includes Pricing tab", () => {
    expect(topNav).toContain("Pricing");
  });

  it("TopNav has creator and audience nav clusters", () => {
    expect(topNav).toContain("CREATOR_NAV");
    expect(topNav).toContain("AUDIENCE_NAV");
  });

  it("Footer labels match new nav names", () => {
    expect(footer).toContain("Discover");
    expect(footer).toContain("Characters");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   B2 — Logo system (Kitsune Mask identity)
   ═══════════════════════════════════════════════════════════════════════ */
describe("B2: Logo component — Kitsune Mask", () => {
  const logo = read("client/src/components/awakli/Logo.tsx");
  const topNav = read("client/src/components/awakli/TopNav.tsx");
  const footer = read("client/src/components/awakli/MarketingFooter.tsx");

  it("Logo.tsx exports Logo component with variant and theme props", () => {
    expect(logo).toContain("variant");
    expect(logo).toContain("theme");
    expect(logo).toMatch(/mark|horizontal|stacked/);
  });

  it("Logo.tsx uses an image-based mark (Kitsune Mask) via /manus-storage/", () => {
    expect(logo).toContain("/manus-storage/");
    expect(logo).toContain("<img");
    expect(logo).toContain("Kitsune");
  });

  it("Logo.tsx does NOT contain old inline SVG mark", () => {
    expect(logo).not.toContain("<svg");
    expect(logo).not.toContain("viewBox");
    expect(logo).not.toContain("logo-stroke-reveal");
  });

  it("Logo wordmark uses Orbitron font", () => {
    expect(logo).toContain("Orbitron");
    expect(logo).toContain("font-display");
  });

  it("TopNav imports and uses Logo component", () => {
    expect(topNav).toContain("Logo");
    expect(topNav).toMatch(/import.*Logo/);
  });

  it("MarketingFooter imports and uses Logo component", () => {
    expect(footer).toContain("Logo");
    expect(footer).toMatch(/import.*Logo/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   B1 — Typography (Orbitron throughout)
   ═══════════════════════════════════════════════════════════════════════ */
describe("B1: Typography update — Orbitron", () => {
  const indexHtml = read("client/index.html");
  const indexCss = read("client/src/index.css");

  it("index.html loads Orbitron from Google Fonts", () => {
    expect(indexHtml).toContain("Orbitron");
  });

  it("index.html does NOT load old fonts (Bebas Neue, Space Grotesk, Inter Tight)", () => {
    expect(indexHtml).not.toContain("Bebas+Neue");
    expect(indexHtml).not.toContain("Space+Grotesk");
    expect(indexHtml).not.toContain("Inter+Tight");
  });

  it("CSS tokens use Orbitron for display font", () => {
    expect(indexCss).toContain("--font-display:  'Orbitron'");
  });

  it("CSS tokens use Orbitron for heading font", () => {
    expect(indexCss).toContain("--font-heading:  'Orbitron'");
  });

  it("CSS tokens use Orbitron for body font", () => {
    expect(indexCss).toContain("--font-sans:     'Orbitron'");
  });

  it("CSS does NOT contain old font references", () => {
    expect(indexCss).not.toContain("Bebas Neue");
    expect(indexCss).not.toContain("Space Grotesk");
    expect(indexCss).not.toContain("Inter Tight");
  });

  it("Hero font size is scaled down (clamp with 6.5rem max)", () => {
    expect(indexCss).toMatch(/6\.5rem/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Color Theme — Violet/Magenta/Coral palette
   ═══════════════════════════════════════════════════════════════════════ */
describe("Color theme: Violet/Magenta/Coral palette", () => {
  const indexCss = read("client/src/index.css");

  it("Primary accent is now #E040FB (magenta) instead of old #00F0FF (cyan)", () => {
    expect(indexCss).toContain("--token-cyan:       #E040FB");
    expect(indexCss).not.toContain("--token-cyan:       #00F0FF");
  });

  it("Violet token is now #7C4DFF instead of old #6B5BFF", () => {
    expect(indexCss).toContain("--token-violet:       #7C4DFF");
    expect(indexCss).not.toContain("--token-violet:       #6B5BFF");
  });

  it("Opening gradient uses magenta/violet/coral (#E040FB, #7C4DFF, #FF6E7F)", () => {
    expect(indexCss).toContain("#E040FB");
    expect(indexCss).toContain("#7C4DFF");
    expect(indexCss).toContain("#FF6E7F");
  });

  it("Shadcn primary is #7C4DFF", () => {
    expect(indexCss).toContain("--primary:       #7C4DFF");
  });

  it("Shadcn accent is #E040FB", () => {
    expect(indexCss).toContain("--accent:        #E040FB");
  });

  it("Ring color is #E040FB", () => {
    expect(indexCss).toContain("--ring:          #E040FB");
  });

  it("Component files do NOT contain old #00F0FF or #6B5BFF hex values", () => {
    // Check key components that previously had hard-coded old colors
    const button = read("client/src/components/awakli/AwakliButton.tsx");
    const input = read("client/src/components/awakli/AwakliInput.tsx");
    const demo = read("client/src/components/awakli/DemoShowcase.tsx");

    expect(button).not.toContain("#00F0FF");
    expect(button).not.toContain("#6B5BFF");
    expect(input).not.toContain("#00F0FF");
    expect(input).not.toContain("#6B5BFF");
    expect(demo).not.toContain("#00F0FF");
    expect(demo).not.toContain("#6B5BFF");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Storage Proxy — Required for logo image serving
   ═══════════════════════════════════════════════════════════════════════ */
describe("Storage proxy setup", () => {
  const proxy = read("server/_core/storageProxy.ts");
  const index = read("server/_core/index.ts");

  it("storageProxy.ts exists and handles /manus-storage/* routes", () => {
    expect(proxy).toContain("manus-storage");
    expect(proxy).toContain("registerStorageProxy");
    expect(proxy).toContain("presign/get");
  });

  it("server/_core/index.ts imports and registers the storage proxy", () => {
    expect(index).toContain("registerStorageProxy");
    expect(index).toMatch(/import.*storageProxy/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   B3/B4 — Homepage section trim (UI Improvement Brief)
   ═══════════════════════════════════════════════════════════════════════ */
describe("Homepage layout: Hero → Demo → Proof → FeatureStrip → Content → Invitation", () => {
  const home = read("client/src/pages/Home.tsx");

  it("WatchItHappen (demo video) is imported and active", () => {
    expect(home).toMatch(/^import.*WatchItHappen/m);
  });

  it("StreamingTonight and MarqueeStrip imports are still commented out", () => {
    expect(home).not.toMatch(/^import.*StreamingTonight/m);
    expect(home).not.toMatch(/^import.*MarqueeStrip/m);
  });

  it("Home.tsx section order: Hero → DemoVideo → Proof → FeatureStrip → Content → Invitation", () => {
    const heroIdx = home.indexOf("ActOneHero");
    const demoIdx = home.indexOf("WatchItHappen", heroIdx);
    const proofIdx = home.indexOf("ActTwoProof", demoIdx);
    const featureIdx = home.indexOf("FeatureStrip", proofIdx);
    const invitationIdx = home.indexOf("ActThreeInvitation", featureIdx);
    expect(heroIdx).toBeGreaterThan(-1);
    expect(demoIdx).toBeGreaterThan(heroIdx);
    expect(proofIdx).toBeGreaterThan(demoIdx);
    expect(featureIdx).toBeGreaterThan(proofIdx);
    expect(invitationIdx).toBeGreaterThan(featureIdx);
  });

  it("Scroll indicator is removed", () => {
    expect(home).not.toContain('tracking-widest font-mono">Scroll</span>');
  });

  it("Home.tsx has 'More titles coming tonight' fallback", () => {
    expect(home).toContain("More titles coming tonight");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   B3/B4 — Component files still exist (not deleted, just unused)
   ═══════════════════════════════════════════════════════════════════════ */
describe("Deferred components still exist for future use", () => {
  it("WatchItHappen.tsx has demo video with /manus-storage/ source", () => {
    const comp = read("client/src/components/awakli/WatchItHappen.tsx");
    expect(comp).toContain("<video");
    expect(comp).toContain("/manus-storage/");
    expect(comp).toContain("data-component=\"demo-video\"");
  });

  it("WatchItHappen has poster start slide with 'See how the magic happens'", () => {
    const comp = read("client/src/components/awakli/WatchItHappen.tsx");
    expect(comp).toContain("See how the magic happens");
    expect(comp).toContain("here at Awakli");
    expect(comp).toContain('data-testid="poster-slide"');
    expect(comp).toContain("hasStarted");
  });

  it("WatchItHappen has video scrubber/progress bar", () => {
    const comp = read("client/src/components/awakli/WatchItHappen.tsx");
    expect(comp).toContain('data-testid="video-scrubber"');
    expect(comp).toContain("onScrubStart");
    expect(comp).toContain("progress");
    expect(comp).toContain("formatTime");
  });

  it("WatchItHappen has volume slider control", () => {
    const comp = read("client/src/components/awakli/WatchItHappen.tsx");
    expect(comp).toContain('data-testid="volume-slider"');
    expect(comp).toContain("handleVolumeChange");
    expect(comp).toContain("showVolumeSlider");
  });

  it("WatchItHappen has fullscreen toggle", () => {
    const comp = read("client/src/components/awakli/WatchItHappen.tsx");
    expect(comp).toContain("toggleFullscreen");
    expect(comp).toContain("Maximize");
  });

  it("WatchItHappen uses v4 video URL", () => {
    const comp = read("client/src/components/awakli/WatchItHappen.tsx");
    expect(comp).toContain("v4-final-homepage");
  });

  it("StreamingTonight.tsx still exists", () => {
    const comp = read("client/src/components/awakli/StreamingTonight.tsx");
    expect(comp).toContain("Free to watch");
  });

  it("MarqueeStrip.tsx still exists", () => {
    const comp = read("client/src/components/awakli/MarqueeStrip.tsx");
    expect(comp).toContain("marquee-track");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   B6-Phase2/3 — Seed content + self-healing
   ═══════════════════════════════════════════════════════════════════════ */
describe("B6-Phase2/3: Defensive rendering + rerank job", () => {
  it("rerankTrending job skeleton exists and exports rerankTrending function", () => {
    const job = read("server/jobs/rerankTrending.ts");
    expect(job).toContain("export async function rerankTrending");
    expect(job).toContain("MINIMUM_LIVE_THRESHOLD");
  });

  it("StreamingTonight has empty state fallback", () => {
    const streaming = read("client/src/components/awakli/StreamingTonight.tsx");
    expect(streaming).toContain("More titles streaming tonight");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI Improvement Brief — Navigation cleanup
   ═══════════════════════════════════════════════════════════════════════ */
describe("UI Brief: Navigation transparency + contrast", () => {
  const topNav = read("client/src/components/awakli/TopNav.tsx");

  it("TopNav uses scroll-based opacity transition (transparent-to-solid)", () => {
    expect(topNav).toContain("scrollY");
    expect(topNav).toMatch(/bg-\[#0D0D1A\]/);
  });

  it("TopNav inactive links use higher contrast text (not /20 or /30)", () => {
    expect(topNav).toMatch(/text-\[#(9494B8|F0F0F5|B8B8CC|B0B0CC)\]/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI Improvement Brief — Pricing page view toggle
   ═══════════════════════════════════════════════════════════════════════ */
describe("UI Brief: Pricing comparison toggle", () => {
  const pricing = read("client/src/pages/Pricing.tsx");

  it("Pricing page has Cards and Compare view toggle buttons", () => {
    expect(pricing).toContain("Cards");
    expect(pricing).toContain("Compare");
  });

  it("Pricing page imports LayoutGrid and Table2 icons", () => {
    expect(pricing).toContain("LayoutGrid");
    expect(pricing).toContain("Table2");
  });

  it("Pricing page has PricingView state type", () => {
    expect(pricing).toContain("PricingView");
    expect(pricing).toMatch(/"cards"\s*\|\s*"table"/);
  });

  it("Pricing page conditionally renders cards or table based on view state", () => {
    expect(pricing).toContain('view === "cards"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI Improvement Brief — Discover page cleanup
   ═══════════════════════════════════════════════════════════════════════ */
describe("UI Brief: Discover page badge removal", () => {
  const discover = read("client/src/pages/Discover.tsx");

  it("Just Created row does NOT have AI Generated badge", () => {
    expect(discover).not.toContain("AI Generated");
  });

  it("Just Created row still has the Wand2 icon", () => {
    expect(discover).toContain("Wand2");
  });
});

/* Leaderboard progress rings — REMOVED (feature deleted in Wave 3) */

/* ═══════════════════════════════════════════════════════════════════════
   UI Improvement Brief — Characters empty state
   ═══════════════════════════════════════════════════════════════════════ */
describe("UI Brief: Characters empty state redesign", () => {
  const chars = read("client/src/pages/CharacterLibrary.tsx");

  it("Toolbar is conditionally hidden when character list is empty", () => {
    expect(chars).toMatch(/characters\s*&&\s*characters\.length\s*>\s*0\s*&&\s*<div/);
  });

  it("Empty state has how-it-works mini-steps", () => {
    expect(chars).toContain("Create");
    expect(chars).toContain("Upload");
    expect(chars).toContain("Train");
    expect(chars).toContain("Animate");
    expect(chars).toContain("Reference sheets");
  });

  it("Empty state has decorative spinning ring", () => {
    expect(chars).toContain("spin_20s_linear_infinite");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI Improvement Brief — Create dashboard cleanup
   ═══════════════════════════════════════════════════════════════════════ */
describe("UI Brief: Create dashboard cleanup", () => {
  const create = read("client/src/pages/CreateDashboard.tsx");

  it("Active projects grid does NOT have a duplicate New Project card", () => {
    const gridSection = create.slice(
      create.indexOf("Active projects grid"),
      create.indexOf("Archived projects")
    );
    expect(gridSection).not.toContain("border-dashed");
    expect(gridSection).not.toContain("New Project");
  });

  it("Header still has the New Project button", () => {
    const headerSection = create.slice(
      create.indexOf("Header"),
      create.indexOf("Loading state")
    );
    expect(headerSection).toContain("New Project");
  });
});


/* ═══════════════════════════════════════════════════════════════════════
   Hero Background Animation
   ═══════════════════════════════════════════════════════════════════════ */
describe("Hero background animation", () => {
  const home = read("client/src/pages/Home.tsx");
  const css = read("client/src/index.css");

  it("Hero section has data-hero-animated attribute", () => {
    expect(home).toContain("data-hero-animated");
  });

  it("Hero has animation layer with aria-hidden", () => {
    expect(home).toContain("hero-anim-layer");
    expect(home).toContain('aria-hidden="true"');
  });

  it("Hero has three drifting gradient orbs", () => {
    expect(home).toContain("hero-orb-1");
    expect(home).toContain("hero-orb-2");
    expect(home).toContain("hero-orb-3");
  });

  it("Hero has floating particles with brand colors", () => {
    expect(home).toContain("hero-particle");
    expect(home).toContain("#E040FB");
    expect(home).toContain("#7C4DFF");
    expect(home).toContain("#FF6E7F");
  });

  it("Hero has scanline sweep element", () => {
    expect(home).toContain("hero-scanline");
  });

  it("Particles are generated via useMemo for stable references", () => {
    expect(home).toContain("useMemo");
    expect(home).toMatch(/Array\.from\(\{\s*length:\s*35/);
  });

  it("CSS defines hero-orb-drift keyframes", () => {
    expect(css).toContain("@keyframes hero-orb-drift-1");
    expect(css).toContain("@keyframes hero-orb-drift-2");
    expect(css).toContain("@keyframes hero-orb-drift-3");
  });

  it("CSS defines hero-particle-float keyframe", () => {
    expect(css).toContain("@keyframes hero-particle-float");
  });

  it("CSS defines hero-scanline-sweep keyframe", () => {
    expect(css).toContain("@keyframes hero-scanline-sweep");
  });

  it("CSS respects prefers-reduced-motion for hero animations", () => {
    // Find the reduced-motion block that targets hero elements
    const reducedMotionIdx = css.lastIndexOf("prefers-reduced-motion: reduce");
    const reducedBlock = css.slice(reducedMotionIdx, reducedMotionIdx + 500);
    expect(reducedBlock).toContain("hero-orb-1");
    expect(reducedBlock).toContain("hero-particle");
    expect(reducedBlock).toContain("hero-scanline");
  });
});
