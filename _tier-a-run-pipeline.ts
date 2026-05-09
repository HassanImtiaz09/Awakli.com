
import { runPipeline } from "./server/pipelineOrchestrator";
async function main() {
  try {
    await runPipeline(150004);
    console.log("PIPELINE_RESULT:completed");
  } catch (e: any) {
    console.error("PIPELINE_ERROR:" + e.message);
    process.exit(1);
  }
}
main();
