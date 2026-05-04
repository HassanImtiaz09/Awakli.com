/**
 * Demo Recording Page — /demo-recording
 * Admin-only page that plays the entire ~90-second demo sequence automatically.
 * Used by Puppeteer to capture the screen recording for the landing page video.
 *
 * Shots: Prompt → Script → Panels → Customize → Transform → LiveDag → LoraMarket → Community → CTA
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { DEMO_SCENARIO, DEMO_SHOTS, DEMO_TOTAL_DURATION_MS, DEMO_PANELS } from "../../../shared/demo-scenario";
import { trpc } from "../lib/trpc";
import { useAuth } from "../_core/hooks/useAuth";

// ─── Types ───────────────────────────────────────────────────────────────

type ShotName = keyof typeof DEMO_SHOTS;

interface ShotProps {
  elapsed: number;       // ms elapsed since this shot started
  duration: number;      // total ms for this shot
  assets: DemoAssets;
}

interface DemoAssets {
  panelUrls: string[];
  characterUrls: Record<string, string>;
  scriptText: string;
  fallbackUrls: string[];
}

// ─── Utility Hooks ───────────────────────────────────────────────────────

function useTypewriter(text: string, speed: number, startDelay: number, elapsed: number) {
  const adjustedElapsed = elapsed - startDelay;
  if (adjustedElapsed <= 0) return "";
  const charsToShow = Math.min(Math.floor(adjustedElapsed / speed), text.length);
  return text.slice(0, charsToShow);
}

// ─── Shot 1: Prompt (0–8s) ──────────────────────────────────────────────

function PromptShot({ elapsed, assets }: ShotProps) {
  const prompt = DEMO_SCENARIO.prompt;
  const typedText = useTypewriter(prompt, 60, 500, elapsed);
  const showGenres = elapsed > prompt.length * 60 + 800;
  const showButton = elapsed > prompt.length * 60 + 1600;
  const buttonClicked = elapsed > 7200;

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#0a0a0f] px-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="text-3xl font-bold text-white tracking-wider">AWAKLI</div>
        <span className="text-xs text-pink-400 border border-pink-400/30 px-2 py-0.5 rounded-full">BETA</span>
      </div>

      {/* Title */}
      <h1 className="text-5xl font-bold text-white mb-3 font-display">
        Turn Your <span className="text-pink-500">Ideas</span> Into Anime.
      </h1>
      <p className="text-gray-400 text-lg mb-10">Describe your story. AI does the rest.</p>

      {/* Prompt Input */}
      <div className="w-full max-w-3xl bg-[#12121a] border border-gray-800 rounded-2xl p-6 mb-6">
        <div className="text-gray-300 text-lg min-h-[60px] font-mono">
          {typedText}
          {typedText.length < prompt.length && (
            <span className="inline-block w-0.5 h-5 bg-pink-500 ml-0.5 animate-pulse" />
          )}
        </div>
      </div>

      {/* Genre Pills */}
      <div className="flex gap-3 mb-8" style={{ opacity: showGenres ? 1 : 0, transition: "opacity 0.4s" }}>
        {DEMO_SCENARIO.genre.map((g, i) => (
          <span
            key={g}
            className="px-4 py-2 rounded-full text-sm font-medium border transition-all duration-500"
            style={{
              borderColor: showGenres ? "rgb(236, 72, 153)" : "transparent",
              backgroundColor: showGenres ? "rgba(236, 72, 153, 0.15)" : "transparent",
              color: showGenres ? "rgb(236, 72, 153)" : "transparent",
              transitionDelay: `${i * 200}ms`,
            }}
          >
            {g.charAt(0).toUpperCase() + g.slice(1)}
          </span>
        ))}
      </div>

      {/* Generate Button */}
      <button
        className="px-8 py-4 rounded-xl text-lg font-semibold transition-all duration-300"
        style={{
          opacity: showButton ? 1 : 0,
          transform: buttonClicked ? "scale(0.95)" : showButton ? "scale(1)" : "scale(0.9)",
          background: buttonClicked
            ? "linear-gradient(135deg, #ec4899, #8b5cf6)"
            : "linear-gradient(135deg, #f472b6, #a78bfa)",
          color: "white",
          boxShadow: buttonClicked
            ? "0 0 40px rgba(236, 72, 153, 0.6)"
            : showButton
            ? "0 0 20px rgba(236, 72, 153, 0.3)"
            : "none",
        }}
      >
        ✨ Generate Now
      </button>

      {/* Shot label */}
      <ShotLabel text={DEMO_SHOTS.prompt.label} />
    </div>
  );
}

// ─── Shot 2: Script (8–15s) ─────────────────────────────────────────────

function ScriptShot({ elapsed, assets }: ShotProps) {
  const scriptLines = (assets.scriptText || FALLBACK_SCRIPT).split("\n").filter(Boolean);
  const typedLines = Math.min(Math.floor(elapsed / 400), scriptLines.length);

  return (
    <div className="flex h-full bg-[#0a0a0f]">
      {/* Left: Script */}
      <div className="w-1/2 p-8 overflow-hidden">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
          <span className="text-pink-400 text-sm font-medium">AI Writing Script...</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-4">{DEMO_SCENARIO.title}</h2>
        <div className="space-y-1 font-mono text-sm">
          {scriptLines.slice(0, typedLines).map((line, i) => (
            <div
              key={i}
              className={`transition-opacity duration-300 ${
                line.startsWith("SCENE") || line.startsWith("INT.") || line.startsWith("EXT.")
                  ? "text-yellow-400 font-bold mt-3"
                  : line.includes(":")
                  ? "text-cyan-300"
                  : "text-gray-400"
              }`}
              style={{ opacity: i === typedLines - 1 ? 0.7 : 1 }}
            >
              {line}
            </div>
          ))}
          {typedLines < scriptLines.length && (
            <span className="inline-block w-2 h-4 bg-pink-500 animate-pulse" />
          )}
        </div>
      </div>

      {/* Right: Skeleton Panels */}
      <div className="w-1/2 p-8">
        <h3 className="text-lg font-semibold text-gray-400 mb-4">Generating Panels...</h3>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg overflow-hidden"
              style={{
                aspectRatio: DEMO_PANELS[i]?.width && DEMO_PANELS[i]?.height
                  ? `${DEMO_PANELS[i].width}/${DEMO_PANELS[i].height}`
                  : "4/3",
              }}
            >
              <div className="w-full h-full bg-gray-800 animate-pulse relative overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)",
                    animation: `shimmer 1.5s infinite ${i * 0.2}s`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <ShotLabel text={DEMO_SHOTS.script.label} />
    </div>
  );
}

// ─── Shot 3: Panels (15–28s) ────────────────────────────────────────────

function PanelsShot({ elapsed, assets }: ShotProps) {
  const panelRevealInterval = 2000; // 2s between each panel reveal
  const revealedCount = Math.min(Math.floor(elapsed / panelRevealInterval) + 1, 6);
  const zoomProgress = Math.min(elapsed / 13000, 1);
  const scale = 1.3 - 0.3 * easeOutCubic(zoomProgress);

  return (
    <div className="flex h-full bg-[#0a0a0f]">
      {/* Left: Script (static, completed) */}
      <div className="w-2/5 p-8 opacity-60">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-green-400 text-sm font-medium">Script Complete</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-3">{DEMO_SCENARIO.title}</h2>
        <div className="text-xs text-gray-500 font-mono space-y-0.5">
          {(assets.scriptText || FALLBACK_SCRIPT).split("\n").filter(Boolean).slice(0, 12).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>

      {/* Right: Panel Grid with reveals */}
      <div className="w-3/5 p-6 flex items-center justify-center overflow-hidden">
        <div
          className="grid grid-cols-2 gap-3 w-full transition-transform"
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {DEMO_PANELS.map((panel, i) => {
            const isRevealed = i < revealedCount;
            const isRevealing = i === revealedCount - 1;
            const panelUrl = assets.panelUrls[i];

            return (
              <div
                key={i}
                className="rounded-lg overflow-hidden relative"
                style={{
                  aspectRatio: `${panel.width}/${panel.height}`,
                }}
              >
                {/* Skeleton */}
                <div
                  className="absolute inset-0 bg-gray-800"
                  style={{
                    opacity: isRevealed ? 0 : 1,
                    transition: "opacity 0.4s ease-out",
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
                      animation: isRevealing ? "shimmer 0.5s infinite" : `shimmer 1.5s infinite ${i * 0.2}s`,
                    }}
                  />
                </div>

                {/* Revealed Panel */}
                {panelUrl && (
                  <img
                    src={panelUrl}
                    alt={`Panel ${i + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                      opacity: isRevealed ? 1 : 0,
                      transform: isRevealed ? "scale(1)" : "scale(0.95)",
                      filter: isRevealing
                        ? "brightness(1.5) blur(2px)"
                        : isRevealed
                        ? "brightness(1) blur(0)"
                        : "brightness(2) blur(10px)",
                      transition: "all 0.5s ease-out",
                    }}
                  />
                )}

                {/* Light sweep on reveal */}
                {isRevealing && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: "linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.3) 50%, transparent 70%)",
                      animation: "sweepRight 0.6s ease-out",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ShotLabel text={DEMO_SHOTS.panels.label} />
    </div>
  );
}

// ─── Shot 4: Customize (28–40s) ─────────────────────────────────────────

function CustomizeShot({ elapsed, assets }: ShotProps) {
  const subDuration = 2400;
  const currentSub = Math.min(Math.floor(elapsed / subDuration), 4);
  const subElapsed = elapsed - currentSub * subDuration;
  const fadeProgress = subElapsed < 200 ? subElapsed / 200 : 1;

  const subs = [
    { title: "Art Style", icon: "🎨" },
    { title: "Character Design", icon: "👤" },
    { title: "Voice Casting", icon: "🎙️" },
    { title: "Animation Style", icon: "🎬" },
    { title: "Music & Sound", icon: "🎵" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#0a0a0f] relative">
      {/* Sub-scene indicator */}
      <div className="absolute top-8 flex gap-2">
        {subs.map((s, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300"
            style={{
              backgroundColor: i === currentSub ? "rgba(236, 72, 153, 0.2)" : "rgba(255,255,255,0.05)",
              borderColor: i === currentSub ? "rgb(236, 72, 153)" : "transparent",
              border: "1px solid",
              color: i === currentSub ? "rgb(236, 72, 153)" : "rgb(107, 114, 128)",
            }}
          >
            <span>{s.icon}</span> {s.title}
          </div>
        ))}
      </div>

      {/* Current sub-scene content */}
      <div style={{ opacity: fadeProgress, transition: "opacity 0.2s" }} className="w-full max-w-4xl px-8">
        {currentSub === 0 && <ArtStyleSub elapsed={subElapsed} />}
        {currentSub === 1 && <CharacterSub elapsed={subElapsed} assets={assets} />}
        {currentSub === 2 && <VoiceSub elapsed={subElapsed} />}
        {currentSub === 3 && <AnimationSub elapsed={subElapsed} />}
        {currentSub === 4 && <MusicSub elapsed={subElapsed} />}
      </div>

      <ShotLabel text={DEMO_SHOTS.customize.label} />
    </div>
  );
}

function ArtStyleSub({ elapsed }: { elapsed: number }) {
  const styles = ["Shonen", "Seinen", "Cyberpunk", "Watercolor", "Noir", "Mecha"];
  const hoveredIndex = Math.floor(elapsed / 600) % styles.length;

  return (
    <div>
      <h2 className="text-3xl font-bold text-white text-center mb-6">Choose Your Art Style</h2>
      <div className="grid grid-cols-3 gap-4">
        {styles.map((style, i) => (
          <div
            key={style}
            className="rounded-xl p-4 text-center transition-all duration-300"
            style={{
              backgroundColor: i === hoveredIndex ? "rgba(236, 72, 153, 0.15)" : "rgba(255,255,255,0.03)",
              border: `2px solid ${i === hoveredIndex ? "rgb(236, 72, 153)" : "rgba(255,255,255,0.1)"}`,
              boxShadow: i === hoveredIndex ? "0 0 20px rgba(236, 72, 153, 0.3)" : "none",
              transform: i === hoveredIndex ? "scale(1.05)" : "scale(1)",
            }}
          >
            <div className="w-full aspect-video bg-gray-800 rounded-lg mb-2" />
            <span className="text-white font-medium">{style}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CharacterSub({ elapsed, assets }: { elapsed: number; assets: DemoAssets }) {
  const views = ["portrait", "full_body", "three_quarter", "action_pose", "expression_sheet"];
  const activeView = Math.floor(elapsed / 480) % views.length;

  return (
    <div>
      <h2 className="text-3xl font-bold text-white text-center mb-6">Character Gallery</h2>
      <div className="flex gap-4 justify-center">
        {views.map((view, i) => {
          const url = assets.characterUrls[view];
          return (
            <div
              key={view}
              className="rounded-xl overflow-hidden transition-all duration-300"
              style={{
                width: i === activeView ? "200px" : "120px",
                border: `2px solid ${i === activeView ? "rgb(56, 189, 248)" : "rgba(255,255,255,0.1)"}`,
                boxShadow: i === activeView ? "0 0 20px rgba(56, 189, 248, 0.3)" : "none",
              }}
            >
              {url ? (
                <img src={url} alt={view} className="w-full aspect-[3/4] object-cover" />
              ) : (
                <div className="w-full aspect-[3/4] bg-gray-800 animate-pulse" />
              )}
              <div className="p-2 text-center text-xs text-gray-400 capitalize">
                {view.replace("_", " ")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoiceSub({ elapsed }: { elapsed: number }) {
  return (
    <div className="text-center">
      <h2 className="text-3xl font-bold text-white mb-6">Voice Casting</h2>
      <div className="bg-[#12121a] rounded-xl p-6 max-w-md mx-auto border border-gray-800">
        <div className="text-cyan-400 font-semibold mb-2">Kai Tanaka — Deep, Intense</div>
        <div className="flex items-center gap-1 h-12 justify-center">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="w-1.5 bg-cyan-400 rounded-full transition-all"
              style={{
                height: `${20 + Math.sin((elapsed / 100 + i * 0.5)) * 15}px`,
                opacity: 0.5 + Math.sin((elapsed / 150 + i * 0.3)) * 0.5,
              }}
            />
          ))}
        </div>
        <div className="text-gray-500 text-sm mt-2">Playing audition sample...</div>
      </div>
    </div>
  );
}

function AnimationSub({ elapsed }: { elapsed: number }) {
  const styles = ["Motion Comic", "Limited Animation", "Full Sakuga", "Cel-Shaded", "Rotoscope"];
  const active = Math.floor(elapsed / 480) % styles.length;

  return (
    <div className="text-center">
      <h2 className="text-3xl font-bold text-white mb-6">Animation Style</h2>
      <div className="flex gap-3 justify-center">
        {styles.map((style, i) => (
          <div
            key={style}
            className="rounded-xl p-4 w-36 transition-all duration-300"
            style={{
              backgroundColor: i === active ? "rgba(168, 85, 247, 0.15)" : "rgba(255,255,255,0.03)",
              border: `2px solid ${i === active ? "rgb(168, 85, 247)" : "rgba(255,255,255,0.1)"}`,
              transform: i === active ? "translateY(-4px)" : "translateY(0)",
            }}
          >
            <div className="w-full aspect-video bg-gray-800 rounded-lg mb-2" />
            <span className="text-white text-sm font-medium">{style}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MusicSub({ elapsed }: { elapsed: number }) {
  return (
    <div className="text-center">
      <h2 className="text-3xl font-bold text-white mb-6">Music Studio</h2>
      <div className="bg-[#12121a] rounded-xl p-6 max-w-lg mx-auto border border-gray-800">
        <div className="text-purple-400 font-semibold mb-4">🎵 Opening Theme — Cyberpunk Synth</div>
        <div className="flex items-end gap-1 h-16 justify-center">
          {Array.from({ length: 32 }).map((_, i) => (
            <div
              key={i}
              className="w-2 rounded-t transition-all"
              style={{
                height: `${10 + Math.abs(Math.sin((elapsed / 200 + i * 0.4))) * 50}px`,
                backgroundColor: `hsl(${280 + i * 3}, 70%, ${50 + Math.sin((elapsed / 300 + i)) * 20}%)`,
              }}
            />
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-3">
          <span>0:00</span>
          <span>Generating...</span>
          <span>1:30</span>
        </div>
      </div>
    </div>
  );
}

// ─── Shot 5: Transform (40–50s) ─ Manga-to-Anime side-by-side morph ────────

const MANGA_SOURCE_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/beat5-manga-source-aebNjZw6s8gRzS76UH8sYx.webp";
const ANIME_RESULT_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/beat5-anime-result-iL44imGnqqkTNjeLVbBgnC.webp";
const WS_DASHBOARD_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/beat6-ws-dashboard-WhHV4ovRF9zbYJKjLp6Ve9.webp";
const LORA_DETAIL_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/beat7-lora-detail-FymtiH3tSnHM6XDzhb2jo4.webp";

function TransformShot({ elapsed }: ShotProps) {
  // Phase 1 (0-3s): Manga full screen
  // Phase 2 (3-5s): Crossfade to anime
  // Phase 3 (5-8s): Anime full screen
  // Phase 4 (8-10s): Text overlay
  const crossfadeProgress = Math.min(Math.max((elapsed - 3000) / 2000, 0), 1);
  const kenBurns = 1 + Math.min(elapsed / 50000, 0.06);
  const showText = elapsed > 7500;

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Manga panel (fading out) */}
      <img
        src={MANGA_SOURCE_URL}
        alt="Manga panel"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: 1 - crossfadeProgress,
          transform: `scale(${kenBurns})`,
          transition: "opacity 0.3s",
        }}
      />

      {/* Anime version (fading in) */}
      <img
        src={ANIME_RESULT_URL}
        alt="Anime version"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: crossfadeProgress,
          transform: `scale(${kenBurns})`,
          transition: "opacity 0.3s",
        }}
      />

      {/* Label: MANGA → ANIME */}
      <div className="absolute top-8 left-0 right-0 flex justify-center gap-8 pointer-events-none">
        <span
          className="px-4 py-2 rounded-full text-sm font-bold border"
          style={{
            opacity: 1 - crossfadeProgress * 0.7,
            borderColor: "rgba(255,255,255,0.3)",
            backgroundColor: "rgba(0,0,0,0.5)",
            color: "white",
          }}
        >
          MANGA
        </span>
        <span
          className="text-2xl text-white"
          style={{ opacity: crossfadeProgress > 0.1 && crossfadeProgress < 0.9 ? 1 : 0, transition: "opacity 0.3s" }}
        >
          →
        </span>
        <span
          className="px-4 py-2 rounded-full text-sm font-bold border"
          style={{
            opacity: crossfadeProgress * 0.7 + 0.3,
            borderColor: "rgb(236, 72, 153)",
            backgroundColor: "rgba(236, 72, 153, 0.2)",
            color: "rgb(236, 72, 153)",
          }}
        >
          ANIME
        </span>
      </div>

      {/* Text overlay */}
      {showText && (
        <div
          className="absolute bottom-16 left-0 right-0 text-center"
          style={{ opacity: Math.min((elapsed - 7500) / 500, 1) }}
        >
          <p className="text-4xl font-bold text-white drop-shadow-2xl">
            Same characters. Same scenes. <span className="text-pink-400">Brought to life.</span>
          </p>
        </div>
      )}

      <ShotLabel text={DEMO_SHOTS.transform.label} />
    </div>
  );
}

// ─── Shot 6: Live DAG Dashboard (50–60s) ─────────────────────────────

function LiveDagShot({ elapsed }: ShotProps) {
  const kenBurns = 1 + Math.min(elapsed / 50000, 0.04);
  const showSubtitle = elapsed > 3500;

  // Simulate DAG node progression
  const dagNodes = [
    { name: "Script", completeAt: 0 },
    { name: "Panels", completeAt: 0 },
    { name: "Characters", completeAt: 0 },
    { name: "Video Gen", completeAt: 2000 },
    { name: "Voice Sync", completeAt: 5000 },
    { name: "Music", completeAt: 7000 },
    { name: "Assembly", completeAt: 9000 },
  ];

  const completedCount = dagNodes.filter(n => elapsed >= n.completeAt + 1500).length;
  const progress = Math.min(completedCount / dagNodes.length, 1);

  return (
    <div className="relative w-full h-full bg-[#0a0a0f] overflow-hidden">
      {/* Dashboard mockup background */}
      <img
        src={WS_DASHBOARD_URL}
        alt="Generation Dashboard"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: `scale(${kenBurns})`, transformOrigin: "center center" }}
      />

      {/* Overlay with animated elements */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent">
        {/* Animated progress overlay */}
        <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center">
          <div
            className="text-cyan-400 text-lg font-semibold mb-2"
            style={{ opacity: showSubtitle ? 1 : 0, transition: "opacity 0.5s" }}
          >
            Every slice. Every frame. Live.
          </div>

          {/* Simulated toast notifications */}
          {elapsed > 4000 && elapsed < 7000 && (
            <div
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: "rgba(34, 197, 94, 0.2)",
                border: "1px solid rgb(34, 197, 94)",
                color: "rgb(34, 197, 94)",
                opacity: Math.min((elapsed - 4000) / 300, 1),
                animation: "subtleFloat 2s ease-in-out infinite",
              }}
            >
              ✓ Slice 4 of 12 complete
            </div>
          )}
          {elapsed > 7000 && (
            <div
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: "rgba(34, 197, 94, 0.2)",
                border: "1px solid rgb(34, 197, 94)",
                color: "rgb(34, 197, 94)",
                opacity: Math.min((elapsed - 7000) / 300, 1),
                animation: "subtleFloat 2s ease-in-out infinite",
              }}
            >
              ✓ Slice 8 of 12 complete
            </div>
          )}
        </div>
      </div>

      <ShotLabel text={DEMO_SHOTS.liveDag.label} />
    </div>
  );
}

// ─── Shot 7: LoRA Marketplace (60–70s) ──────────────────────────────

function LoraMarketShot({ elapsed }: ShotProps) {
  const kenBurns = 1 + Math.min(elapsed / 50000, 0.04);
  const showSubtitle = elapsed > 3500;
  const showForkHighlight = elapsed > 5000;

  return (
    <div className="relative w-full h-full bg-[#0a0a0f] overflow-hidden">
      {/* LoRA detail mockup background */}
      <img
        src={LORA_DETAIL_URL}
        alt="LoRA Marketplace"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: `scale(${kenBurns})`, transformOrigin: "center center" }}
      />

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent">
        <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center">
          <div
            className="text-pink-400 text-lg font-semibold mb-2"
            style={{ opacity: showSubtitle ? 1 : 0, transition: "opacity 0.5s" }}
          >
            Fork. Fine-tune. Save 75% on training.
          </div>

          {/* Fork highlight pulse */}
          {showForkHighlight && (
            <div
              className="px-6 py-3 rounded-xl text-white font-semibold text-sm"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                boxShadow: "0 0 30px rgba(236, 72, 153, 0.5)",
                animation: "pulseGlow 1.5s ease-in-out infinite",
                opacity: Math.min((elapsed - 5000) / 500, 1),
              }}
            >
              ✨ Fork & Fine-tune
            </div>
          )}
        </div>
      </div>

      <ShotLabel text={DEMO_SHOTS.loraMarket.label} />
    </div>
  );
}

// ─── Shot 8: Community (70–80s) ───────────────────────────────────────

function CommunityShot({ elapsed, assets }: ShotProps) {
  const slides = assets.fallbackUrls.length > 0 ? assets.fallbackUrls : assets.panelUrls;
  const slideDuration = 2500;
  const currentSlide = Math.min(Math.floor(elapsed / slideDuration), slides.length - 1);
  const slideElapsed = elapsed - currentSlide * slideDuration;
  const fadeProgress = slideElapsed < 300 ? slideElapsed / 300 : slideElapsed > slideDuration - 300 ? (slideDuration - slideElapsed) / 300 : 1;
  const kenBurns = 1 + (slideElapsed / slideDuration) * 0.05;

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {slides[currentSlide] && (
        <img
          src={slides[currentSlide]}
          alt={`Community slide ${currentSlide + 1}`}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: fadeProgress,
            transform: `scale(${kenBurns})`,
            transition: "opacity 0.3s",
          }}
        />
      )}

      {/* Overlay with stats */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 flex flex-col justify-end p-12">
        <h2 className="text-4xl font-bold text-white mb-4">Join the Community</h2>
        <div className="flex gap-8">
          <StatBadge label="Manga Created" value="12,000+" />
          <StatBadge label="Anime Episodes" value="500+" />
          <StatBadge label="Creators" value="8,000+" />
        </div>
      </div>

      <ShotLabel text={DEMO_SHOTS.community.label} />
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-pink-400">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </div>
  );
}

// ─── Shot 9: CTA (80–90s) ───────────────────────────────────────────────

function CTAShot({ elapsed }: ShotProps) {
  const logoVisible = elapsed > 500;
  const taglineVisible = elapsed > 1500;
  const buttonVisible = elapsed > 2500;

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#0a0a0f]">
      {/* Logo */}
      <div
        className="text-6xl font-bold tracking-wider transition-all duration-700"
        style={{
          opacity: logoVisible ? 1 : 0,
          transform: logoVisible ? "scale(1)" : "scale(0.8)",
          color: "white",
        }}
      >
        AWAKLI
      </div>

      {/* Tagline */}
      <p
        className="text-xl text-gray-400 mt-4 transition-all duration-700"
        style={{
          opacity: taglineVisible ? 1 : 0,
          transform: taglineVisible ? "translateY(0)" : "translateY(10px)",
        }}
      >
        Turn Your Ideas Into Anime.
      </p>

      {/* CTA Button */}
      <button
        className="mt-8 px-10 py-4 rounded-xl text-lg font-semibold text-white transition-all duration-700"
        style={{
          opacity: buttonVisible ? 1 : 0,
          transform: buttonVisible ? "translateY(0)" : "translateY(20px)",
          background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
          boxShadow: buttonVisible ? "0 0 40px rgba(236, 72, 153, 0.4)" : "none",
          animation: buttonVisible ? "pulseGlow 2s ease-in-out infinite" : "none",
        }}
      >
        ✨ Start Creating — Free
      </button>
    </div>
  );
}

// ─── Shot Label Overlay ─────────────────────────────────────────────────

function ShotLabel({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="absolute bottom-6 left-0 right-0 text-center pointer-events-none">
      <span className="inline-block px-6 py-2 bg-black/60 backdrop-blur-sm rounded-full text-white text-sm font-medium border border-white/10">
        {text}
      </span>
    </div>
  );
}

// ─── Easing Functions ───────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ─── Fallback Script ────────────────────────────────────────────────────

const FALLBACK_SCRIPT = `SCENE 1 — EXT. NEO-TOKYO SKYLINE — NIGHT

Rain hammers the neon-lit towers of Neo-Tokyo. Holographic billboards flicker through the downpour.

KAI (V.O.): The city never sleeps. Neither do its nightmares.

SCENE 2 — EXT. DARK ALLEY — CONTINUOUS

KAI TANAKA walks through a narrow alley. His cybernetic eye pulses blue, scanning.

KAI: NEXUS, what do you see?

NEXUS materializes as a translucent blue hologram beside him.

NEXUS: Residual dream energy. Someone was here. Recently.

KAI: How recently?

NEXUS: Minutes. The signature is still warm.

KAI stops. His eye flares brighter.

KAI: Then we're close.

SCENE 3 — EXT. ROOFTOP — CONTINUOUS

KAI leaps between rooftops, coat streaming behind him.

A HOODED FIGURE stands at the edge, data streams swirling around their fingers.

HOODED FIGURE: You shouldn't have followed me, Detective.

KAI: The dreams... they're not just memories.

HOODED FIGURE: No. They're doors.

Reality SHATTERS around them like breaking glass. Colors swirl. The dream world opens.`;

// ─── CSS Keyframes (injected) ───────────────────────────────────────────

const DEMO_STYLES = `
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes sweepRight {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes subtleFloat {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-5px); }
}
@keyframes pulseGlow {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
`;

// ─── Main Component ─────────────────────────────────────────────────────

export default function DemoRecording() {
  const { user, loading: authLoading } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  // Load demo assets from platform config
  const { data: configData } = trpc.admin.getDemoConfig.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    retry: false,
  });

  const assets = useMemo<DemoAssets>(() => ({
    panelUrls: configData?.panelUrls || [],
    characterUrls: configData?.characterUrls || {},
    scriptText: configData?.scriptText || FALLBACK_SCRIPT,
    fallbackUrls: configData?.fallbackUrls || [],
  }), [configData]);

  // Preload all images (hardcoded shot assets + admin config assets)
  useEffect(() => {
    // Always preload the hardcoded shot images
    const hardcodedUrls = [
      MANGA_SOURCE_URL,
      ANIME_RESULT_URL,
      WS_DASHBOARD_URL,
      LORA_DETAIL_URL,
    ];

    const configUrls = [
      ...assets.panelUrls,
      ...Object.values(assets.characterUrls),
      ...assets.fallbackUrls,
    ].filter(Boolean);

    // If user is not admin, only preload hardcoded assets
    const allUrls = (!user || user.role !== "admin")
      ? hardcodedUrls
      : [...hardcodedUrls, ...configUrls];

    if (allUrls.length === 0) {
      setIsReady(true);
      return;
    }

    let loaded = 0;
    const total = allUrls.length;

    allUrls.forEach((url) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = img.onerror = () => {
        loaded++;
        if (loaded >= total) setIsReady(true);
      };
      img.src = url;
    });

    // Timeout fallback
    const timeout = setTimeout(() => setIsReady(true), 15000);
    return () => clearTimeout(timeout);
  }, [assets, user, configData]);

  // Auto-start if ?autoplay=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoplay") === "true" && isReady && !isPlaying) {
      startPlayback();
    }
  }, [isReady]);

  // Master timing controller
  const tick = useCallback(() => {
    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    if (elapsed >= DEMO_TOTAL_DURATION_MS + 4000) {
      // 2s black at end + 2s buffer
      setElapsedMs(DEMO_TOTAL_DURATION_MS);
      setIsComplete(true);
      setIsPlaying(false);
      return;
    }

    // Subtract 2s of initial black
    setElapsedMs(Math.max(0, elapsed - 2000));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startPlayback = useCallback(() => {
    startTimeRef.current = performance.now();
    setIsPlaying(true);
    setIsComplete(false);
    setElapsedMs(0);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Determine current shot
  const currentShot = useMemo<ShotName>(() => {
    const shots = Object.entries(DEMO_SHOTS) as [ShotName, { start: number; duration: number }][];
    for (let i = shots.length - 1; i >= 0; i--) {
      if (elapsedMs >= shots[i][1].start) return shots[i][0];
    }
    return "prompt";
  }, [elapsedMs]);

  const shotConfig = DEMO_SHOTS[currentShot];
  const shotElapsed = elapsedMs - shotConfig.start;

  // Auth check
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0f] text-white">
        Loading...
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0f] text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-gray-400">This page is only accessible to administrators.</p>
        </div>
      </div>
    );
  }

  // Loading screen
  if (!isReady) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0f] text-white">
        <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-400">Loading demo assets...</p>
      </div>
    );
  }

  // Not playing yet
  if (!isPlaying && !isComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0f] text-white">
        <style>{DEMO_STYLES}</style>
        <h1 className="text-4xl font-bold mb-4">Demo Recording</h1>
        <p className="text-gray-400 mb-8">90-second scripted demo sequence</p>
        <button
          onClick={startPlayback}
          className="px-8 py-4 rounded-xl text-lg font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
        >
          ▶ Start Playback
        </button>
        <p className="text-gray-600 text-sm mt-4">
          Add ?autoplay=true for automatic start (Puppeteer recording)
        </p>
      </div>
    );
  }

  // Shot renderer
  const shotProps: ShotProps = {
    elapsed: shotElapsed,
    duration: shotConfig.duration,
    assets,
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden" data-demo-ready={isReady} data-demo-complete={isComplete || undefined}>
      <style>{DEMO_STYLES}</style>

      {/* Current shot */}
      <div className="w-full h-full">
        {currentShot === "prompt" && <PromptShot {...shotProps} />}
        {currentShot === "script" && <ScriptShot {...shotProps} />}
        {currentShot === "panels" && <PanelsShot {...shotProps} />}
        {currentShot === "customize" && <CustomizeShot {...shotProps} />}
        {currentShot === "transform" && <TransformShot {...shotProps} />}
        {currentShot === "liveDag" && <LiveDagShot {...shotProps} />}
        {currentShot === "loraMarket" && <LoraMarketShot {...shotProps} />}
        {currentShot === "community" && <CommunityShot {...shotProps} />}
        {currentShot === "cta" && <CTAShot {...shotProps} />}
      </div>

      {/* Timeline indicator (admin overlay) */}
      <div className="absolute top-2 left-2 right-2 flex items-center gap-2 pointer-events-none">
        <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(elapsedMs / DEMO_TOTAL_DURATION_MS) * 100}%`,
              background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
            }}
          />
        </div>
        <span className="text-xs text-gray-500 font-mono w-16 text-right">
          {(elapsedMs / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Complete overlay */}
      {isComplete && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
          <p className="text-2xl font-bold text-white mb-4">Recording Complete</p>
          <button
            onClick={startPlayback}
            className="px-6 py-3 rounded-xl text-white font-semibold"
            style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
          >
            ▶ Replay
          </button>
        </div>
      )}
    </div>
  );
}
