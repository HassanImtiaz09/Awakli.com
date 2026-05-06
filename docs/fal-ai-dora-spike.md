# fal.ai Multi-DoRA Technical Spike — Finding Document

**Date:** May 6, 2026  
**Duration:** 0.5 days  
**Verdict:** GO — fal.ai natively supports multi-adapter composition for our use case

---

## Question

Does fal.ai's custom inference support loading 3 DoRA adapters simultaneously with individual weight control, plus IP-Adapter conditioning, in a single generation pass?

## Answer: Yes

The `fal-ai/flux-general` endpoint explicitly supports this exact configuration. No custom endpoint or sequential-with-merge fallback is required.

---

## Evidence

### 1. Multi-LoRA Composition (Unlimited Adapters)

From the fal.ai flux-general model page:

> "Multi-LoRA composition: Merge unlimited LoRAs with individual weight control in a single generation pass, no manual model merging or separate inference calls required"

The `loras` parameter accepts `list<LoraWeight>` with no upper bound. Each adapter has independent `scale` control.

### 2. DoRA Compatibility at Inference Time

DoRA (Weight-Decomposed Low-Rank Adaptation, Liu et al. 2024) decomposes pretrained weights into magnitude and direction components during **training**. The resulting adapter files are stored in standard `.safetensors` format, structurally identical to LoRA adapters at inference time.

From the DoRA paper (arXiv:2402.09353):

> "DoRA consistently outperforms LoRA without sacrificing inference efficiency"

This means DoRA-trained adapters load through the same `loras[].path` parameter as standard LoRA adapters. No special "DoRA mode" flag is needed — the inference engine treats them identically.

### 3. IP-Adapter Simultaneous Support

The flux-general endpoint supports IP-Adapter alongside LoRA stacking in the same API call:

```json
{
  "loras": [...],
  "ip_adapters": [
    {
      "path": "ip-adapter-model-path",
      "image_url": "reference-image-url",
      "scale": 0.4
    }
  ]
}
```

This maps directly to our RAG-retrieved genre reference conditioning.

### 4. Per-Layer Scale Control

The `scale` parameter supports dictionary format for per-layer weight control:

> "Providing a dictionary as `{"layer_name": layer_scale}` allows per-layer lora scale settings. Layers with no scale provided will have scale 1.0."

This enables fine-grained blending between genre, character, and sakufuu adapters at different transformer layers.

---

## Recommended Implementation

### Primary Endpoint: `fal-ai/flux-general`

```typescript
const result = await fal.subscribe('fal-ai/flux-general', {
  input: {
    prompt: scenePrompt,
    loras: [
      { path: genreDoraUrl, scale: stageBlendWeights.genre },
      { path: characterDoraUrl, scale: stageBlendWeights.character },
      { path: sakufuuDoraUrl, scale: stageBlendWeights.sakufuu }
    ],
    ip_adapters: [
      {
        path: 'xlabs-ai/flux-ip-adapter',
        image_url: ragRetrievedReferenceUrl,
        scale: ipAdapterWeight  // 0.4-0.5 default
      }
    ],
    num_inference_steps: 28,
    guidance_scale: 3.5
  }
});
```

### Cost

- $0.075 per megapixel (flux-general with extensions)
- Compared to $0.055/megapixel for flux-lora (no ControlNet/IP-Adapter)
- The $0.02/megapixel premium buys us IP-Adapter conditioning — worth it for genre signal

### Cold-Start Fallback

When genre retrieval pool has low confidence (< 500 frames):
- Skip IP-Adapter conditioning
- Use `fal-ai/flux-lora` endpoint at $0.055/megapixel (LoRA-only, no IP-Adapter)
- Three DoRA adapters still stack via the loras array

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| DoRA adapter file incompatibility with fal.ai loader | Very Low | High | DoRA uses standard safetensors format; test with first trained adapter before full pipeline integration |
| Per-layer scale dictionary not working as documented | Low | Medium | Fall back to global scale per adapter; still functional |
| IP-Adapter + 3 LoRAs causes quality degradation | Medium | Medium | Reduce IP-Adapter scale; test empirically with sakuga shots |
| fal.ai rate limits under high-volume generation | Low | Medium | RunPod fallback executor already planned (Item 1.5) |

---

## Impact on Item 1 Estimate

No change to the 7–10 day estimate. The spike confirms the primary path (fal.ai) is viable, which means:
- Item 1.4 (FalCompositionExecutor) proceeds as planned
- Item 1.5 (RunPodCompositionExecutor) remains as cost-optimized alternative, not a required fallback
- No sequential-with-merge complexity needed

---

## Next Steps

1. Proceed to Item 5 (RAG Retrieval Pool Seeding)
2. Then Item 1 (AdapterComposer implementation using flux-general endpoint)
3. First real validation: train a test DoRA adapter and confirm it loads via flux-general loras array
