/**
 * D10 Craft Library — Sensei Agent
 *
 * The main D10 function that combines retrieval + LLM synthesis.
 * Operates in three engagement modes:
 *
 * - **Direct**: Answer a craft question using retrieved knowledge.
 * - **Consult**: Review an artifact and suggest improvements.
 * - **Validate**: Check an artifact against craft principles (pass/fail).
 *
 * The LLM always paraphrases — never reproduces source text verbatim.
 * The verbatim guard runs post-synthesis as a safety net.
 */

import { invokeLLM } from "../../_core/llm";
import { retrieveChunks } from "./retrieval";
import { checkVerbatimOverlap } from "./verbatim-guard";
import type { CraftQuery, CraftResult, EngagementMode, SubSensei } from "./types";
import { SUB_SENSEI_LABELS } from "./types";

// ─── System Prompts per Mode ────────────────────────────────────────────

function buildSystemPrompt(mode: EngagementMode, subSensei: SubSensei): string {
  const domain = SUB_SENSEI_LABELS[subSensei];

  const base = `You are D10 Sensei, a knowledgeable advisor for ${domain}. You draw on a curated library of anime, manga, and genga production knowledge to help creators improve their work.

CRITICAL RULES:
1. NEVER reproduce source text verbatim. Always paraphrase and synthesise.
2. Always attribute insights to their source (e.g., "According to [source title]...").
3. Be specific and actionable — avoid generic advice.
4. If the retrieved context doesn't contain relevant information, say so honestly.
5. Frame advice in terms of craft principles, not rigid rules.`;

  switch (mode) {
    case "direct":
      return `${base}

MODE: Direct Answer
You are answering a craft question. Synthesise the retrieved knowledge into a clear, practical answer. Include specific techniques, examples, and reasoning. Structure your response with clear sections if the answer is complex.`;

    case "consult":
      return `${base}

MODE: Consultation
You are reviewing a creator's work-in-progress and suggesting improvements. Be constructive and specific. For each suggestion:
1. Identify what's working well
2. Point out specific areas for improvement
3. Explain WHY the change would help (cite craft principles)
4. Suggest concrete alternatives

Format your response as a structured review with clear sections.`;

    case "validate":
      return `${base}

MODE: Validation
You are checking a creator's artifact against established craft principles. Return a structured assessment:
1. Overall verdict: "pass", "needs_revision", or "fail"
2. For each principle checked, note whether it passes or fails
3. For failures, explain what needs to change and why

Be fair but rigorous. A "pass" means the work meets professional standards for the relevant domain.`;
  }
}

function buildUserPrompt(query: CraftQuery, contextChunks: string): string {
  let prompt = "";

  if (contextChunks) {
    prompt += `RETRIEVED KNOWLEDGE:\n${contextChunks}\n\n`;
  }

  switch (query.mode) {
    case "direct":
      prompt += `QUESTION: ${query.query}`;
      break;
    case "consult":
      prompt += `ARTIFACT TO REVIEW:\n${query.artifactContext ?? "(no artifact provided)"}\n\nCONSULTATION REQUEST: ${query.query}`;
      break;
    case "validate":
      prompt += `ARTIFACT TO VALIDATE:\n${query.artifactContext ?? "(no artifact provided)"}\n\nVALIDATION CRITERIA: ${query.query}`;
      break;
  }

  if (query.pipelineStage) {
    prompt += `\n\nPIPELINE CONTEXT: This is for the "${query.pipelineStage}" stage of the production pipeline.`;
  }

  return prompt;
}

// ─── Main Sensei Function ───────────────────────────────────────────────

const MAX_VERBATIM_RETRIES = 2;

/**
 * Run the D10 Sensei agent: retrieve → synthesise → guard → return.
 */
export async function queryCraftLibrary(query: CraftQuery): Promise<CraftResult> {
  const startTime = Date.now();

  // Step 1: Retrieve relevant chunks
  const chunks = await retrieveChunks(query);

  // Step 2: Build context from retrieved chunks
  const contextChunks = chunks
    .map((c, i) => `[Source ${i + 1}: "${c.sourceTitle}" by ${c.sourceAuthor ?? "Unknown"}]\n${c.text}`)
    .join("\n\n---\n\n");

  const sourceTexts = chunks.map(c => c.text);

  // Step 3: LLM synthesis with mode-specific prompting
  let guidance = "";
  let costUsd = 0;
  let verdict: CraftResult["verdict"];
  let issues: string[] | undefined;
  let suggestions: string[] | undefined;

  const systemPrompt = buildSystemPrompt(query.mode, query.subSensei);
  const userPrompt = buildUserPrompt(query, contextChunks);

  // For validate mode, use structured JSON output
  if (query.mode === "validate") {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "craft_validation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["pass", "needs_revision", "fail"], description: "Overall validation verdict" },
              guidance: { type: "string", description: "Detailed assessment with reasoning" },
              issues: {
                type: "array",
                items: { type: "string" },
                description: "Specific issues found (empty if pass)",
              },
            },
            required: ["verdict", "guidance", "issues"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent) ?? "{}";
    try {
      const parsed = JSON.parse(content);
      guidance = parsed.guidance ?? "";
      verdict = parsed.verdict as CraftResult["verdict"];
      issues = parsed.issues ?? [];
    } catch {
      guidance = content;
      verdict = "needs_revision";
      issues = ["Failed to parse structured validation response"];
    }
    costUsd = 0.04; // Estimated cost for structured response
  } else if (query.mode === "consult") {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "craft_consultation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              guidance: { type: "string", description: "Detailed review with reasoning" },
              suggestions: {
                type: "array",
                items: { type: "string" },
                description: "Specific actionable suggestions",
              },
            },
            required: ["guidance", "suggestions"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent2 = response.choices?.[0]?.message?.content;
    const content2 = typeof rawContent2 === "string" ? rawContent2 : JSON.stringify(rawContent2) ?? "{}";
    try {
      const parsed = JSON.parse(content2);
      guidance = parsed.guidance ?? "";
      suggestions = parsed.suggestions ?? [];
    } catch {
      guidance = content2;
      suggestions = [];
    }
    costUsd = 0.04;
  } else {
    // Direct mode — plain text response
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawDirect = response.choices?.[0]?.message?.content;
    guidance = typeof rawDirect === "string" ? rawDirect : "";
    costUsd = 0.03;
  }

  // Step 4: Verbatim guard
  if (sourceTexts.length > 0 && guidance.length > 0) {
    let retries = 0;
    let guardResult = checkVerbatimOverlap(guidance, sourceTexts);

    while (!guardResult.passed && retries < MAX_VERBATIM_RETRIES) {
      retries++;
      // Re-synthesise with stronger paraphrase instruction
      const retryResponse = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt + "\n\nIMPORTANT: Your previous response contained too much verbatim overlap with source material. You MUST paraphrase more aggressively. Use your own words entirely." },
          { role: "user", content: userPrompt },
        ],
      });
      const rawRetry = retryResponse.choices?.[0]?.message?.content;
      guidance = typeof rawRetry === "string" ? rawRetry : guidance;
      costUsd += 0.03;
      guardResult = checkVerbatimOverlap(guidance, sourceTexts);
    }

    // If still failing after retries, add a disclaimer
    if (!guardResult.passed) {
      guidance = `[Note: This response may contain close paraphrasing of source material. Please verify independently.]\n\n${guidance}`;
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    guidance,
    mode: query.mode,
    subSensei: query.subSensei,
    sources: chunks,
    verdict,
    issues,
    suggestions,
    costUsd,
    durationMs,
  };
}
