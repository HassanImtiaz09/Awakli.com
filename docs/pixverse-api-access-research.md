# PixVerse API Access Research — Wave 9 Pre-Check

**Date:** 2026-05-09  
**Question:** Do we have a direct PixVerse API key? Does fal.ai expose C1 with multi-image Subject Reference and lip-sync? What's the path to direct access?

---

## 1. Current State: No Direct PixVerse API Key

- **No `PIXVERSE_API_KEY` env var** exists in the project secrets or `server/_core/env.ts`
- **All PixVerse access is via fal.ai** using our existing `FAL_API_KEY`
- Current adapter: `fal-ai/pixverse/v4.5/image-to-video` (single image input, no Subject Reference)

---

## 2. fal.ai PixVerse Coverage (Confirmed Available)

### 2a. PixVerse C1 Reference-to-Video ✅ AVAILABLE
- **Model ID:** `fal-ai/pixverse/c1/reference-to-video`
- **Multi-image Subject Reference:** YES — `image_references` array supports 1–7 references
  - Each reference has: `image_url`, `type` (subject | background), `ref_name`
  - Prompt uses `@ref_name` syntax (e.g., "A @character walks through @forest")
  - Up to 7 reference images per generation
- **Resolution:** 360p, 540p, 720p, 1080p
- **Duration:** 1–15 seconds (integer)
- **Audio generation:** `generate_audio_switch: true` enables BGM/SFX/dialogue
- **Pricing (fal.ai):** ~$0.04/second of output video (source: Megaton Monitor, fal.ai)
- **Anime style:** Not a dedicated parameter on C1 ref-to-video (style param exists on v4.5/v5.5 but NOT on C1 ref-to-video schema)

### 2b. PixVerse Lip-Sync ✅ AVAILABLE
- **Model ID:** `fal-ai/pixverse/lipsync`
- **Input:** `video_url` (required) + `audio_url` OR `text` + `voice_id` (TTS)
- **Pricing (fal.ai):** $0.04/second of output video; TTS adds $0.24/100 chars
- **Voices:** Emily, James, Isabella, Liam, Chloe, Adrian, Harper, Ava, Sophia, Julia, Mason, Jack, Oliver, Ethan, Auto
- **Max duration:** Not explicitly stated in schema (PixVerse direct API says 30s max)
- **Limitation:** Takes a video URL as input — must generate video first, then apply lip-sync as post-processing step

### 2c. Other fal.ai PixVerse Endpoints
- `fal-ai/pixverse/c1/image-to-video` — single image, 1080p, native audio
- `fal-ai/pixverse/v4.5/image-to-video` — our current adapter (anime style param)
- `fal-ai/pixverse/v5/image-to-video` — newer model
- `fal-ai/pixverse/v6/image-to-video` — latest (V6), 1080p, up to 15s
- `fal-ai/pixverse/v6/text-to-video` — text-to-video
- Various transition endpoints (C1, V5.5, V6)

---

## 3. fal.ai vs Direct PixVerse API — Feature Gap Analysis

| Feature | fal.ai (via FAL_API_KEY) | Direct PixVerse API (platform.pixverse.ai) |
|---------|--------------------------|---------------------------------------------|
| C1 Reference-to-Video | ✅ `fal-ai/pixverse/c1/reference-to-video` | ✅ `fusion/generate` with `model: "c1"` |
| Multi-image Subject Ref | ✅ 1–7 images | ✅ 1–3 items (docs say 1–3 for direct API) |
| Lip-Sync | ✅ `fal-ai/pixverse/lipsync` | ✅ `lip_sync/generate` |
| Sound Effects | ❓ Not seen as separate endpoint | ✅ `sound_effect/generate` |
| Restyle | ❓ Not confirmed | ✅ Available |
| Motion Control (Mimic) | ❓ Not confirmed | ✅ Available |
| Swap | ❓ Not confirmed | ✅ Available |
| Multi-transition | ❓ Not confirmed | ✅ Available |
| Modify | ❓ Not confirmed | ✅ Available |
| Anime style param | ✅ on v4.5 (not on C1 ref-to-video) | ❓ Not confirmed for C1 |
| Concurrent gen limit | Managed by fal.ai queue | Plan-dependent (varies by tier) |
| Webhook support | ✅ fal.ai webhooks | ✅ Native webhooks |

### Key Gaps via fal.ai:
1. **C1 ref-to-video supports MORE references (7) on fal.ai vs 3 on direct** — fal.ai is actually better here
2. **No confirmed gap for our Wave 9 needs** — C1 Subject Reference + Lip-sync are both available
3. **fal.ai adds queue management, auto-retry, and unified billing** — operational advantage

---

## 4. Direct PixVerse API Access Path

### How to Get a Key:
1. Create account at https://platform.pixverse.ai/
2. Navigate to API Keys section
3. Subscribe to a plan (starts at $100/month for Essential = 15,000 credits)
4. Generate API key

### Pricing (Direct):
| Plan | Monthly Cost | Credits | Effective $/credit |
|------|-------------|---------|-------------------|
| Essential | $100/mo | 15,000 | $0.0067 |
| Growth | $500/mo | ~100,000 | $0.005 |
| Business | $6,000/mo | 1,000,000+ | <$0.006 |

### C1 Credit Costs (Direct):
| Resolution | No Audio | With Audio |
|-----------|----------|-----------|
| 360p | 6 credits/sec | 8 credits/sec |
| 540p | 8 credits/sec | 10 credits/sec |
| 720p | 10 credits/sec | 13 credits/sec |
| 1080p | 19 credits/sec | 24 credits/sec |

### Effective Cost Comparison (5s, 720p, no audio):
- **fal.ai:** $0.04/sec × 5s = **$0.20/clip**
- **Direct (Essential):** 10 credits/sec × 5s = 50 credits × $0.0067 = **$0.33/clip**
- **Direct (Business):** 50 credits × $0.006 = **$0.30/clip**

**Conclusion: fal.ai is cheaper per-clip than direct PixVerse API at all tiers.**

---

## 5. Recommendation for Wave 9

### No direct PixVerse API key needed. fal.ai provides full coverage:

1. **C1 Subject Reference** — Available at `fal-ai/pixverse/c1/reference-to-video` with up to 7 reference images. This is the multi-character consistency feature needed for anime production.

2. **Lip-Sync** — Available at `fal-ai/pixverse/lipsync` at $0.04/sec. Takes video + audio/TTS, outputs lip-synced video.

3. **Cost advantage** — fal.ai is ~40% cheaper per clip than direct PixVerse API.

4. **Operational advantage** — Single API key (FAL_API_KEY already configured), unified billing, queue management, no separate account needed.

### Wave 9 Integration Path:
```
Step 1: Add PixVerse C1 adapter to provider-router
  - Model: fal-ai/pixverse/c1/reference-to-video
  - Input: image_references array with character LoRA renders as subjects
  - Prompt: "@character1 does X in @background" syntax
  
Step 2: Wire lip-sync as post-processing step
  - Model: fal-ai/pixverse/lipsync  
  - Input: generated video URL + Cartesia TTS audio URL
  - Replaces current Kling lip-sync path (or runs as fallback)

Step 3: Benchmark C1 ref-to-video vs current Kling V3 for anime quality
  - Compare: character consistency, motion quality, anime style adherence
  - Decision gate: switch default provider if C1 scores higher on CLIP
```

### Only pursue direct PixVerse API if:
- fal.ai removes PixVerse models (unlikely — they're a partner)
- Need features not exposed via fal.ai (Motion Control/Mimic, Swap)
- Volume exceeds fal.ai rate limits (enterprise concern, not current)
- Contact: api@pixverse.ai or api_business@pixverse.ai for enterprise
