import { runPipeline } from "./server/pipelineOrchestrator";

async function main() {
  const runId = 150009;
  console.log(`[continue-pipeline] Resuming pipeline run ${runId}...`);
  console.log(`[continue-pipeline] Started at: ${new Date().toISOString()}`);
  
  try {
    await runPipeline(runId);
    console.log(`[continue-pipeline] COMPLETED at: ${new Date().toISOString()}`);
    console.log("PIPELINE_RESULT:completed");
  } catch (err: any) {
    console.error(`[continue-pipeline] FAILED at: ${new Date().toISOString()}`);
    console.error("PIPELINE_ERROR:" + (err?.message || String(err)));
    process.exit(1);
  }
}

main();
