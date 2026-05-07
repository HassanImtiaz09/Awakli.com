# StoryMaker Architecture Analysis (Wave 7 Item 1a Spike)

## Key Architecture Facts

- **Base Model**: SDXL (Stable Diffusion XL) — specifically uses `huaquan/YamerMIX_v11` as base
- **Pipeline**: Custom `StableDiffusionXLStoryMakerPipeline` (extends diffusers SDXL pipeline)
- **Adapter Type**: IP-Adapter variant with face/clothing/body encoding
- **Model Weights**: `RED-AIGC/StoryMaker` on HuggingFace — single file `mask.bin`
- **Image Encoder**: `laion/CLIP-ViT-H-14-laion2B-s32B-b79K`
- **Face Analysis**: InsightFace `buffalo_l` model (CUDA/CPU providers)
- **Dependencies**: diffusers, opencv-python, transformers, accelerate, insightface, torch
- **VRAM**: SDXL-based → ~12-16GB minimum for fp16 inference
- **Inference Steps**: 25 (default), UniPCMultistepScheduler
- **Output Resolution**: 1280×960 (portrait) or configurable

## Input Requirements
- `image`: Face reference image (PIL Image, RGB)
- `mask_image`: Clothing/body mask (PIL Image, RGB)
- `face_info`: InsightFace analysis result (bbox, landmarks, embedding)
- `prompt`: Text prompt for scene description
- `negative_prompt`: Quality control
- `ip_adapter_scale`: 0.8 default (face identity strength)
- `lora_scale`: 0.8 default (clothing/body identity strength)

## Deployment Options

### Option A: fal.ai Custom Inference
- fal.ai supports custom model deployment via `fal-serverless`
- Requires containerized model with predict function
- SDXL models are well-supported on fal.ai infrastructure
- Cold start: ~30-60s for SDXL models
- Warm inference: ~5-15s per image

### Option B: RunPod Serverless
- RunPod supports custom Docker containers
- Can use A100/A40/L40S GPUs (all have sufficient VRAM)
- Cold start: configurable (min workers = 0 for cost, min workers > 0 for latency)
- More control over scaling and cost

## Mitsua Compatibility Assessment
- StoryMaker is SDXL-based (not SD1.5, not Flux)
- Awakli's existing pipeline uses fal.ai providers (Kling, PixVerse, etc.) for VIDEO generation
- StoryMaker generates IMAGES (character reference sheets) not video
- The generated character images then feed into video generation as reference frames
- DoRA/PiSSA adapters in Awakli operate at the video generation stage
- Composition question: StoryMaker output → video model input (sequential, not concurrent)
- This means Mitsua compatibility is about the IMAGE→VIDEO handoff quality, not adapter stacking

## Mitsua Compatibility Spike Plan
1. Deploy StoryMaker on fal.ai custom inference (or RunPod if rejected)
2. Generate 5 character reference images with anime-style prompts
3. Feed those images into existing video pipeline (PixVerse/Kling) as reference
4. Score: face similarity across poses, outfit consistency, hair-color stability
5. Compare with current pipeline (no StoryMaker) for baseline

## Training Code Available
- `train_storymaker.py` — can fine-tune on custom anime datasets
- `mp_dataset.py` — multi-person dataset loader
- `train.sh` — training script launcher
