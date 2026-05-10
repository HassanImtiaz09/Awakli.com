# Wave 9 Audit Findings

## Confirmation 1: Unit Test Scope — GAPS FOUND

### Current 11 tests cover:
1. Stage 1: Parse LLM response into typed beats
2. Stage 1: Throw when LLM returns no beats (error propagation)
3. Stage 2: Build character reference map from input
4. Stage 2: FIRST_LIGHT_CHARACTERS fixture includes all 3 chars
5. Stage 3: Call fal.ai with correct C1 parameters
6. Stage 4: First Light voice assignments for all 3 characters
7. Prompt Templates: Apply dark character lighting mitigation
8. Prompt Templates: Return undefined for non-dark characters
9. Provider Router: Return default fal.ai config
10. Provider Router: Direct PixVerse config available
11. Fixtures: Build First Light config with all required fields

### MISSING tests (must add):
- [ ] Integration: Full orchestrator end-to-end with mocked APIs
- [ ] Failure: Stage 3 error propagates to orchestrator (not swallowed)
- [ ] Failure: Stage 4 lip-sync failure triggers Kling backup
- [ ] Failure: Stage 5 fails if zero video assets from Stage 3 (no slideshow fallback)
- [ ] Asset validation: Stage 5 assembleVideo throws on empty beatClips
- [ ] Asset validation: Stage 5 validateFinalVideo catches undersized files
- [ ] Error propagation: Each stage failure recorded in state.errors[]

## Confirmation 2: Wave 9 Refinements

### 2a. CLIP Character-Region Cropping — PARTIAL
- ClipHarnessConfig has `useCharacterRegionCropping` flag and `characterRegionThreshold` (0.80)
- DEFAULT_CLIP_CONFIG sets `useCharacterRegionCropping: true`
- BUT: orchestrator.ts line 100 overrides to `useCharacterRegionCropping: false`
- scoreWithClip uses LLM vision as proxy, NOT actual CLIP with face detection
- GAP: No actual face detection/segmentation code exists

### 2b. Dark-Character Lighting — CONFIRMED
- 6 mitigation patterns in prompt-templates.ts
- applyDarkCharLighting function with trigger keyword matching
- Fallback pattern for any dark background
- Orchestrator enriches beats in Stage 2 with darkCharLightingOverride
- Renji documented as isDarkCharacter=true in fixtures

### 2c. Direct PixVerse Contingency — CONFIRMED
- PIXVERSE_API_KEY registered in env.ts
- provider-router.ts has full direct PixVerse adapter (video + lip-sync)
- Config-flag swap via USE_DIRECT_PIXVERSE=true env var
- getActiveConfig() checks flag and returns appropriate config
- $100/mo Essential plan documented

## Confirmation 3: Kling Lip-Sync Backup — CONFIRMED
- applyKlingLipSync function calls fal-ai/kling-video/v2/master/lip-sync
- applyLipSync dispatches based on LipSyncProvider type
- runStage4 has explicit fallback: if primary fails, tries kling_lipsync
- LipSyncProvider type: "fal_pixverse_lipsync" | "kling_lipsync"

## Confirmation 4: Deferrals

### 4a. Inworld TTS — CORRECTLY OUT OF SCOPE
- VoiceProvider type includes "inworld" but no implementation exists
- ElevenLabs is primary, Cartesia is fallback
- Inworld is in the type system for future use, not in Wave 9 scope

### 4b. Bilingual JP+EN — NOT DOCUMENTED AS WAVE 10 ITEM
- GAP: No Wave 9.5/10 work item exists in todo.md for bilingual validation
- Must add explicit work item

## Confirmation 5: Stage 5 Audio Mastering Depth — CONFIRMED WITH CAVEATS

### Real -16 LUFS multi-bus mix — YES
- normalizeAudio uses ffmpeg loudnorm filter with I=-16:TP=-1.5:LRA=11
- 4-bus mix: voice (-16 LUFS), music (-22 LUFS), SFX (placeholder), ambient (placeholder)
- Music ducked by 0.4 weight during voice
- Final master loudnorm pass at -16 LUFS
- Audio codec: AAC 192kbps (not 16kbps mono)

### Transition selection — PARTIAL
- Beat.transition type supports: cut, crossfade, fade_to_black, wipe
- BUT: assembleVideo uses concat demuxer (cuts only)
- Comment says "crossfade/wipe transitions require xfade filter — implement in production"
- GAP: Only hard cuts actually work

### Music bed beat-alignment — NO
- Music is normalized and mixed at constant level
- No beat-alignment or tempo-matching logic exists
- Music is simply ducked during voice

### File-size and audio-format validation gates — YES
- validateFinalVideo checks: file size (max 500MB, min 0.1MB)
- Duration via ffprobe
- Master LUFS measurement via ffprobe
- Format validation (mp4)
