
import { runPipeline } from "./server/pipelineOrchestrator";

async function main() {
  try {
    await runPipeline(150009);
    console.log("PIPELINE_RESULT:completed");
  } catch (err: any) {
    console.error("PIPELINE_ERROR:" + (err?.message || String(err)));
    process.exit(1);
  }
}
main();
