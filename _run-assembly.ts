/**
 * Run just the assembly stage for pipeline run 150009.
 * Skips music gen (which is stuck on MiniMax API) and proceeds directly to assembly.
 */
import { getDb, getPipelineAssetsByRun, createPipelineAsset, getEpisodeById, getPanelsByEpisode, updateEpisode } from "./server/db";
import { pipelineRuns } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { assembleVideo, type TransitionSpec, type TransitionType } from "./server/video-assembly";
import { storagePut } from "./server/storage";
import { nanoid } from "nanoid";

async function runAssembly() {
  const runId = 150009;
  const episodeId = 900006; // From the smoke test
  
  console.log(`[Assembly] Starting assembly for pipeline run ${runId}, episode ${episodeId}`);
  
  // Get drizzle DB instance
  const db = await getDb();
  if (!db) {
    console.error("[Assembly] Could not connect to database!");
    process.exit(1);
  }
  
  // Update pipeline status to assembly stage
  await db.update(pipelineRuns)
    .set({ currentNode: "assembly" as any, progress: 85 })
    .where(eq(pipelineRuns.id, runId));
  
  console.log("[Assembly] Updated pipeline to assembly stage");
  
  // Gather all pipeline assets
  const allAssets = await getPipelineAssetsByRun(runId);
  console.log(`[Assembly] Found ${allAssets.length} total assets`);
  
  // Collect video clips (sorted by panel number)
  const rawVideoAssets = allAssets
    .filter((a: any) => a.assetType === "video_clip" || a.assetType === "synced_clip")
    .map((a: any) => {
      const meta = (a.metadata || {}) as any;
      return {
        url: a.url,
        panelId: a.panelId || 0,
        panelNumber: meta.panelNumber ?? a.panelId ?? 0,
        duration: meta.duration || 5,
        hasNativeAudio: meta.hasNativeAudio || false,
        assetType: a.assetType as string,
      };
    });
  
  // Deduplicate: for each panelId, prefer synced_clip over video_clip
  const panelClipMap = new Map<number, typeof rawVideoAssets[0]>();
  for (const clip of rawVideoAssets) {
    const existing = panelClipMap.get(clip.panelId);
    if (!existing) {
      panelClipMap.set(clip.panelId, clip);
    } else if (clip.assetType === "synced_clip" && existing.assetType === "video_clip") {
      panelClipMap.set(clip.panelId, clip);
      console.log(`[Assembly] Panel ${clip.panelNumber}: using lip-synced clip over original`);
    }
  }
  const videoClips = Array.from(panelClipMap.values());
  
  // Collect voice clips
  const voiceClips = allAssets
    .filter((a: any) => a.assetType === "voice_clip")
    .map((a: any) => {
      const meta = (a.metadata || {}) as any;
      return {
        url: a.url,
        panelId: a.panelId || 0,
        duration: meta.duration || 3,
        text: meta.text || "",
      };
    });
  
  // Collect music track (we have 1 music_segment from a partial success)
  const musicAsset = allAssets.find((a: any) => a.assetType === "music_segment");
  const musicTrack = musicAsset ? {
    url: musicAsset.url,
    duration: ((musicAsset.metadata as any)?.duration) || 0,
    isFallback: ((musicAsset.metadata as any)?.fallback) || false,
  } : null;
  
  console.log(`[Assembly] ${videoClips.length} video clips, ${voiceClips.length} voice clips, music: ${musicTrack ? 'yes' : 'none'}`);
  
  if (videoClips.length === 0) {
    console.error("[Assembly] No video clips found for assembly!");
    process.exit(1);
  }
  
  // Build transitions (default to cut)
  const episodePanels = await getPanelsByEpisode(episodeId);
  const panelTransitionMap = new Map<number, { type: TransitionType; duration: number }>();
  for (const p of episodePanels) {
    panelTransitionMap.set(p.id, {
      type: (p.transition as TransitionType) || "cut",
      duration: p.transitionDuration ?? 0.5,
    });
  }
  
  const transitions: TransitionSpec[] = videoClips.map(vc => {
    const t = panelTransitionMap.get(vc.panelId);
    return t ? { type: t.type, duration: t.duration } : { type: "cut" as TransitionType, duration: 0.5 };
  });
  
  console.log(`[Assembly] Calling assembleVideo with ${videoClips.length} clips...`);
  
  try {
    const result = await assembleVideo({
      videoClips,
      voiceClips,
      musicTrack,
      episodeTitle: "First Light - Episode 1 (Smoke Test)",
      transitions,
      enableLipSync: false,
      enableFoley: false,
      enableAmbient: false,
      skipVoiceValidation: true,
    });
    
    console.log(`[Assembly] Video assembled: ${result.totalDuration.toFixed(1)}s, ${(result.videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // Upload to S3
    const finalKey = `pipeline/${runId}/final-${nanoid(6)}.mp4`;
    const { url } = await storagePut(finalKey, result.videoBuffer, "video/mp4");
    
    console.log(`\n✅ FINAL VIDEO URL:\n${url}\n`);
    
    // Store asset in DB
    await createPipelineAsset({
      pipelineRunId: runId,
      episodeId,
      assetType: "final_video",
      url,
      metadata: {
        duration: result.totalDuration,
        format: result.format,
        resolution: result.resolution,
        sizeBytes: result.videoBuffer.length,
        clipCount: videoClips.length,
        voiceClipCount: voiceClips.length,
        hasMusic: musicTrack ? !musicTrack.isFallback : false,
      } as any,
      nodeSource: "assembly",
    });
    
    // Mark pipeline as completed
    await db.update(pipelineRuns)
      .set({ status: "completed" as any, progress: 100, completedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));
    
    console.log("[Assembly] Pipeline marked as completed!");
    
  } catch (err: any) {
    console.error(`[Assembly] FAILED:`, err.message || err);
    console.error(err.stack);
  }
  
  process.exit(0);
}

runAssembly().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
