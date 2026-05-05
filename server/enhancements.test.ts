/**
 * Post Fix-Brief Enhancements Tests
 * - Feature 1: Debounced autosave for style/tone/audience on Input page
 * - Feature 2: Real QR code generation on Publish success
 * - Feature 3: "Back to manga" link on anime-gate page
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "..");

function readFile(rel: string) {
  return readFileSync(resolve(root, rel), "utf-8");
}

// ─── Feature 1: Debounced autosave for style/tone/audience ──────────────────

describe("Feature 1 – Debounced autosave for style/tone/audience", () => {
  const inputSrc = readFile("client/src/pages/create/input.tsx");

  it("imports useRef from React", () => {
    expect(inputSrc).toContain("useRef");
    expect(inputSrc).toMatch(/import\s*\{[^}]*useRef[^}]*\}\s*from\s*"react"/);
  });

  it("creates an autosaveTimerRef for debounce timeout", () => {
    expect(inputSrc).toContain("autosaveTimerRef");
    expect(inputSrc).toContain("useRef<ReturnType<typeof setTimeout> | null>(null)");
  });

  it("creates a prevStyleRef to track previous values and skip initial render", () => {
    expect(inputSrc).toContain("prevStyleRef");
    expect(inputSrc).toContain("prevStyleRef.current.animeStyle === animeStyle");
  });

  it("uses useEffect with animeStyle, tone, targetAudience, projectId dependencies", () => {
    // The effect should depend on all three selectors plus projectId
    expect(inputSrc).toContain("[animeStyle, tone, targetAudience, projectId]");
  });

  it("calls updateMut.mutate (not mutateAsync) for fire-and-forget autosave", () => {
    // Inside the debounce timer, it should use .mutate (non-blocking)
    const autosaveSection = inputSrc.slice(
      inputSrc.indexOf("autosaveTimerRef.current = setTimeout"),
      inputSrc.indexOf("autosaveTimerRef.current = setTimeout") + 300
    );
    expect(autosaveSection).toContain("updateMut.mutate(");
  });

  it("uses 800ms debounce delay", () => {
    expect(inputSrc).toContain("}, 800)");
  });

  it("clears timeout on cleanup to prevent stale saves", () => {
    expect(inputSrc).toContain("clearTimeout(autosaveTimerRef.current)");
  });

  it("skips autosave when projectId is not set", () => {
    const effectSection = inputSrc.slice(
      inputSrc.indexOf("Debounced autosave"),
      inputSrc.indexOf("Debounced autosave") + 600
    );
    expect(effectSection).toContain("!projectId");
  });
});

// ─── Feature 2: Real QR code generation ─────────────────────────────────────

describe("Feature 2 – Real QR code generation on Publish success", () => {
  const publishSrc = readFile("client/src/pages/create/publish.tsx");

  it("imports QRCode from qrcode library", () => {
    expect(publishSrc).toContain('import QRCode from "qrcode"');
  });

  it("has showQR and qrDataUrl state variables", () => {
    expect(publishSrc).toContain("const [showQR, setShowQR] = useState(false)");
    expect(publishSrc).toContain("const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)");
  });

  it("generates QR code with QRCode.toDataURL on button click", () => {
    expect(publishSrc).toContain("QRCode.toDataURL(publicUrl");
  });

  it("uses transparent background for QR code (dark theme friendly)", () => {
    expect(publishSrc).toContain('"#00000000"');
  });

  it("no longer shows 'coming soon' toast for QR code", () => {
    expect(publishSrc).not.toContain("QR code coming soon");
  });

  it("renders a QR code modal overlay with AnimatePresence", () => {
    expect(publishSrc).toContain("showQR && qrDataUrl");
    expect(publishSrc).toContain("QR Code Modal");
  });

  it("displays 'Scan to read' heading in the QR modal", () => {
    expect(publishSrc).toContain("Scan to read");
  });

  it("shows the public URL text below the QR code", () => {
    // The modal shows the publicUrl as text
    const modalSection = publishSrc.slice(
      publishSrc.indexOf("QR Code Modal"),
      publishSrc.indexOf("QR Code Modal") + 2000
    );
    expect(modalSection).toContain("{publicUrl}");
  });

  it("has a Download PNG button that creates a download link", () => {
    expect(publishSrc).toContain("Download PNG");
    expect(publishSrc).toContain("link.download");
    expect(publishSrc).toContain("awakli-qr-");
  });

  it("has a Copy Link button in the QR modal", () => {
    const modalSection = publishSrc.slice(
      publishSrc.indexOf("QR Code Modal"),
      publishSrc.indexOf("QR Code Modal") + 3500
    );
    expect(modalSection).toContain("Copy Link");
    expect(modalSection).toContain("navigator.clipboard.writeText");
  });

  it("tracks stage3_qr_open analytics event", () => {
    expect(publishSrc).toContain("stage3_qr_open");
  });

  it("tracks stage3_qr_download analytics event", () => {
    expect(publishSrc).toContain("stage3_qr_download");
  });

  it("closes QR modal when clicking the backdrop", () => {
    expect(publishSrc).toContain("onClick={() => setShowQR(false)}");
  });

  it("has a close button (×) in the QR modal", () => {
    expect(publishSrc).toContain("Close QR code");
    expect(publishSrc).toContain("&times;");
  });
});

// ─── Feature 3: "Back to manga" link on anime-gate ──────────────────────────

describe("Feature 3 – Back to manga link on anime-gate", () => {
  const animeGateSrc = readFile("client/src/pages/create/anime-gate.tsx");
  const tierCardSrc = readFile("client/src/components/awakli/TierCompareCard.tsx");

  it("TierCompareCard accepts optional mangaSlug prop", () => {
    expect(tierCardSrc).toContain("mangaSlug?: string | null");
  });

  it("TierCompareCard destructures mangaSlug in function params", () => {
    expect(tierCardSrc).toContain("mangaSlug,");
  });

  it("TierCompareCard renders 'Back to your manga' link when mangaSlug is present", () => {
    expect(tierCardSrc).toContain("Back to your manga");
    expect(tierCardSrc).toContain("{mangaSlug && (");
  });

  it("TierCompareCard links to /m/{slug} for the back link", () => {
    expect(tierCardSrc).toContain("href={`/m/${mangaSlug}`}");
  });

  it("TierCompareCard imports BookOpen icon for the back link", () => {
    expect(tierCardSrc).toContain("BookOpen");
    expect(tierCardSrc).toMatch(/import\s*\{[^}]*BookOpen[^}]*\}/);
  });

  it("anime-gate passes project?.slug as mangaSlug to TierCompareCard in idle state", () => {
    const idleIdx = animeGateSrc.indexOf("Idle state (default");
    expect(idleIdx).toBeGreaterThan(0);
    const idleSection = animeGateSrc.slice(idleIdx, idleIdx + 1000);
    expect(idleSection).toContain("mangaSlug={project?.slug}");
  });

  it("anime-gate passes project?.slug as mangaSlug to TierCompareCard in checkout state", () => {
    const checkoutIdx = animeGateSrc.indexOf("Checkout waiting");
    expect(checkoutIdx).toBeGreaterThan(0);
    const checkoutSection = animeGateSrc.slice(checkoutIdx, checkoutIdx + 1600);
    expect(checkoutSection).toContain("mangaSlug={project?.slug}");
  });

  it("TierCompareCard still has the original decline link", () => {
    expect(tierCardSrc).toContain("TIER_CARD_COPY.smallLink");
    expect(tierCardSrc).toContain("onDecline");
  });

  it("Back to manga link appears before the decline link in the DOM", () => {
    const backIdx = tierCardSrc.indexOf("Back to your manga");
    const declineIdx = tierCardSrc.indexOf("TIER_CARD_COPY.smallLink");
    expect(backIdx).toBeGreaterThan(0);
    expect(declineIdx).toBeGreaterThan(0);
    expect(backIdx).toBeLessThan(declineIdx);
  });
});
