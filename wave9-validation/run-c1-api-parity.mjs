/**
 * Wave 9 API-Parity Validation
 * 
 * Calls fal-ai/pixverse/c1/reference-to-video with the exact Phase 1.6 Scene 1 parameters:
 * - 3 character references (mira, kazuo, renji) via Subject Reference
 * - @ref_name prompt syntax
 * - 15s duration, 720p, no audio
 * - Negative prompt matching consumer-UI test
 * 
 * Output: downloaded video for CLIP comparison against consumer-UI Scene 1.mp4
 */
import { fal } from "@fal-ai/client";
import { writeFileSync } from "fs";

// Configure fal.ai
const FAL_KEY = process.env.FAL_API_KEY;
if (!FAL_KEY) {
  console.error("ERROR: FAL_API_KEY not set");
  process.exit(1);
}
fal.config({ credentials: FAL_KEY });

// Character reference URLs (uploaded to CDN)
const MIRA_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663430072618/ApqdBWQWjcOwVPFs.png";
const KAZUO_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663430072618/lwtRWyEDTbERHYxp.png";
const RENJI_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663430072618/NZcZWEiHqxWNkpgi.png";

// Exact prompt from Phase 1.6 Scene 1 (per user's pasted_content_2.txt)
// Per PixVerse docs: @ref_name must be followed by a space, and ref_name must exactly match.
// The parenthetical character descriptions are kept but separated from the @ref_name with a space.
const PROMPT = `Hand-drawn 2D anime, traditional cel-shaded animation, classic shōnen aesthetic. Three-character action shot. @mira wearing white sleeveless gi with red sash and black ponytail with magenta tips, @kazuo with shaved head and black sleeveless top, and @renji the half-demon with burned right side of face and glowing red eye in dark grey combat top clash in a sunset stone arena. @kazuo charges from @mira left throwing a heavy punch — she ducks under it. Simultaneously @renji lunges from her right with a clawed strike, his red eye blazing. @mira spins low, kicks @kazuo away in one fluid motion, then rises to block @renji strike with her forearm. Sakuga-quality animation, dust particles, motion lines, sunset orange and red lighting, dynamic camera angles. Maintain hand-drawn 2D anime style throughout — no 3D rendering, no CGI, no photorealistic shading.`;

const NEGATIVE_PROMPT = "3D rendering, CGI, photorealistic, video game graphics, smooth gradients, plastic texture, wax figure";

async function main() {
  console.log("=== Wave 9 API-Parity Validation ===");
  console.log(`Model: fal-ai/pixverse/c1/reference-to-video`);
  console.log(`Duration: 15s | Resolution: 720p | Audio: OFF`);
  console.log(`References: mira, kazuo, renji`);
  console.log("");
  console.log("Submitting to fal.ai queue...");
  
  const startTime = Date.now();
  
  try {
    const result = await fal.subscribe("fal-ai/pixverse/c1/reference-to-video", {
      input: {
        prompt: PROMPT,
        negative_prompt: NEGATIVE_PROMPT,
        image_references: [
          { image_url: MIRA_URL, type: "subject", ref_name: "mira" },
          { image_url: KAZUO_URL, type: "subject", ref_name: "kazuo" },
          { image_url: RENJI_URL, type: "subject", ref_name: "renji" },
        ],
        duration: 15,
        resolution: "720p",
        generate_audio_switch: false,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_QUEUE") {
          console.log(`  Queue position: ${update.queue_position ?? "unknown"}`);
        } else if (update.status === "IN_PROGRESS") {
          console.log(`  Generating... (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
        }
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Generation complete in ${elapsed}s`);
    console.log(`Result:`, JSON.stringify(result.data, null, 2));

    // Download the video
    const videoUrl = result.data?.video?.url;
    if (!videoUrl) {
      console.error("ERROR: No video URL in response");
      console.error("Full response:", JSON.stringify(result, null, 2));
      process.exit(1);
    }

    console.log(`\nVideo URL: ${videoUrl}`);
    console.log("Downloading video...");
    
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) throw new Error(`Download failed: ${videoResp.status}`);
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
    writeFileSync("/home/ubuntu/awakli/wave9-validation/api_scene1_output.mp4", videoBuffer);
    console.log(`Saved: wave9-validation/api_scene1_output.mp4 (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Save metadata
    const metadata = {
      timestamp: new Date().toISOString(),
      model: "fal-ai/pixverse/c1/reference-to-video",
      elapsed_seconds: parseFloat(elapsed),
      video_url: videoUrl,
      file_size_bytes: videoBuffer.length,
      parameters: {
        duration: 15,
        resolution: "720p",
        generate_audio_switch: false,
        references: ["mira", "kazuo", "renji"],
      },
      cost_estimate_usd: 15 * 0.04, // $0.04/sec × 15s = $0.60
      request_id: result.requestId,
    };
    writeFileSync("/home/ubuntu/awakli/wave9-validation/api_parity_metadata.json", JSON.stringify(metadata, null, 2));
    console.log("\nMetadata saved to api_parity_metadata.json");
    console.log(`Estimated cost: $${metadata.cost_estimate_usd.toFixed(2)}`);
    
  } catch (err) {
    console.error("\n❌ Generation FAILED:");
    console.error(err.message || err);
    if (err.body) console.error("Response body:", JSON.stringify(err.body, null, 2));
    process.exit(1);
  }
}

main();
