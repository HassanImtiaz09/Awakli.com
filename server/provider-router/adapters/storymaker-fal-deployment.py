"""
Wave 7 — Item 1a: StoryMaker fal.ai Custom Inference Deployment Spec

This file defines the fal.ai App class for deploying RED-AIGC StoryMaker
as a custom serverless endpoint on fal.ai infrastructure.

DEPLOYMENT PREREQUISITES:
1. fal.ai Enterprise Serverless access (requires access request)
2. fal-serverless CLI installed: pip install fal-serverless
3. Authentication: fal auth login

DEPLOYMENT STEPS:
1. Request Enterprise access at https://fal.ai/enterprise
2. Once approved: fal-serverless deploy storymaker-fal-deployment.py
3. Note the endpoint URL (e.g., https://fal.run/{user_id}/storymaker-v1)
4. Set STORYMAKER_ENDPOINT_URL env var in Awakli project settings

ARCHITECTURE:
- Base Model: SDXL (YamerMIX_v11)
- Identity: IP-Adapter variant with InsightFace face/clothing/body encoding
- Model Weights: RED-AIGC/StoryMaker (mask.bin)
- Image Encoder: CLIP-ViT-H-14-laion2B
- Face Analysis: InsightFace buffalo_l
- VRAM: ~16GB fp16 (A100 recommended)
- Inference: 25 steps, UniPCMultistepScheduler
- Output: 1024x1024 default (up to 1536x1536)

COST ESTIMATE:
- Cold start: ~45-60s (model loading + InsightFace init)
- Warm inference: ~8-12s per image
- GPU cost: ~$0.08-0.12 per generation (A100 at $1.10/min)

@see wave7-storymaker-architecture.md
@see https://github.com/RED-AIGC/StoryMaker
"""

import fal

# ─── Container Image Definition ──────────────────────────────────────────────

DOCKERFILE = """
FROM python:3.10-slim

# System dependencies for InsightFace + OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \\
    libgl1-mesa-glx \\
    libglib2.0-0 \\
    libsm6 \\
    libxext6 \\
    libxrender-dev \\
    wget \\
    git \\
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
RUN pip install --no-cache-dir \\
    torch==2.1.2 \\
    torchvision==0.16.2 \\
    diffusers==0.25.1 \\
    transformers==4.36.2 \\
    accelerate==0.25.0 \\
    safetensors==0.4.1 \\
    insightface==0.7.3 \\
    onnxruntime-gpu==1.16.3 \\
    opencv-python-headless==4.9.0.80 \\
    Pillow==10.2.0 \\
    numpy==1.26.3 \\
    huggingface_hub==0.20.3

# Download model weights at build time (faster cold starts)
RUN python -c "from huggingface_hub import hf_hub_download; \\
    hf_hub_download('RED-AIGC/StoryMaker', 'mask.bin'); \\
    hf_hub_download('huaquan/YamerMIX_v11', 'YamerMIX_v11.safetensors'); \\
    hf_hub_download('laion/CLIP-ViT-H-14-laion2B-s32B-b79K', 'open_clip_pytorch_model.bin')"

# Download InsightFace model
RUN mkdir -p /root/.insightface/models/buffalo_l && \\
    wget -q https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip -O /tmp/buffalo_l.zip && \\
    unzip -q /tmp/buffalo_l.zip -d /root/.insightface/models/buffalo_l/ && \\
    rm /tmp/buffalo_l.zip

WORKDIR /app
"""


# ─── fal.ai App Class ────────────────────────────────────────────────────────

@fal.App(
    name="storymaker-v1",
    image=fal.ContainerImage.from_dockerfile_str(DOCKERFILE),
    machine_type="GPU-A100",  # 80GB VRAM, sufficient for SDXL + InsightFace
    keep_alive=300,  # Keep warm for 5 minutes between requests
    max_concurrency=4,
    min_concurrency=0,  # Scale to zero when idle (cost optimization)
)
class StoryMakerApp:
    """
    RED-AIGC StoryMaker — Identity-Preserved Character Generation.
    
    Generates anime character images with consistent face, outfit, hairstyle,
    and body proportions using IP-Adapter + InsightFace encoding.
    """

    def setup(self):
        """Load models on cold start. Called once per container lifecycle."""
        import torch
        from diffusers import UniPCMultistepScheduler
        from huggingface_hub import hf_hub_download
        from insightface.app import FaceAnalysis

        # Initialize InsightFace
        self.face_app = FaceAnalysis(
            name="buffalo_l",
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self.face_app.prepare(ctx_id=0, det_size=(640, 640))

        # Load StoryMaker pipeline
        # Note: StoryMaker uses a custom pipeline class that extends SDXL
        from storymaker_pipeline import StableDiffusionXLStoryMakerPipeline

        model_path = hf_hub_download("huaquan/YamerMIX_v11", "YamerMIX_v11.safetensors")
        storymaker_path = hf_hub_download("RED-AIGC/StoryMaker", "mask.bin")

        self.pipe = StableDiffusionXLStoryMakerPipeline.from_single_file(
            model_path,
            torch_dtype=torch.float16,
            use_safetensors=True,
        )
        self.pipe.scheduler = UniPCMultistepScheduler.from_config(
            self.pipe.scheduler.config
        )
        self.pipe.load_storymaker_adapter(storymaker_path)
        self.pipe.to("cuda")

        # Enable memory optimizations
        self.pipe.enable_xformers_memory_efficient_attention()

        self.device = "cuda"
        self.is_ready = True

    @fal.endpoint("/generate")
    def generate(self, request: dict) -> dict:
        """
        Generate an identity-preserved character image.
        
        Input:
            face_image_url: str — URL to face reference image
            outfit_image_url: str — URL to outfit reference image (optional)
            prompt: str — Generation prompt
            negative_prompt: str — Negative prompt (optional)
            ip_adapter_scale: float — Face identity strength (0.0-1.0, default 0.8)
            lora_scale: float — Outfit/body identity strength (0.0-1.0, default 0.8)
            width: int — Output width (default 1024)
            height: int — Output height (default 1024)
            num_inference_steps: int — Denoising steps (default 25)
            guidance_scale: float — CFG scale (default 7.5)
            seed: int — Random seed (optional)
            anime_conditioning: bool — Apply anime style (default True)
            target_pose: str — Target pose angle (default "front")
            character_id: str — Character ID for tracking (optional)
            
        Output:
            images: [{ url: str }] — Generated image URL(s)
            seed: int — Seed used
            face_analysis: { face_count, bbox, embedding, confidence }
            timings: { inference: float, cold_start: float | None }
        """
        import time
        import torch
        import numpy as np
        from PIL import Image
        import requests
        from io import BytesIO

        start_time = time.time()

        # Parse inputs
        face_image_url = request["face_image_url"]
        outfit_image_url = request.get("outfit_image_url", face_image_url)
        prompt = request["prompt"]
        negative_prompt = request.get("negative_prompt", "low quality, blurry, deformed")
        ip_adapter_scale = request.get("ip_adapter_scale", 0.8)
        lora_scale = request.get("lora_scale", 0.8)
        width = request.get("width", 1024)
        height = request.get("height", 1024)
        num_inference_steps = request.get("num_inference_steps", 25)
        guidance_scale = request.get("guidance_scale", 7.5)
        seed = request.get("seed", None)
        anime_conditioning = request.get("anime_conditioning", True)
        target_pose = request.get("target_pose", "front")

        # Download reference images
        face_image = self._download_image(face_image_url)
        outfit_image = self._download_image(outfit_image_url)

        # Run InsightFace analysis on face image
        face_info = self._analyze_face(face_image)
        if face_info is None:
            return {"error": "No face detected in reference image", "status": "failed"}

        # Apply anime conditioning to prompt
        if anime_conditioning:
            prompt = self._apply_anime_conditioning(prompt, target_pose)

        # Set seed
        if seed is None:
            seed = torch.randint(0, 2**31, (1,)).item()
        generator = torch.Generator(device=self.device).manual_seed(seed)

        # Generate image
        with torch.inference_mode():
            result = self.pipe(
                image=face_image,
                mask_image=outfit_image,
                face_info=face_info,
                prompt=prompt,
                negative_prompt=negative_prompt,
                ip_adapter_scale=ip_adapter_scale,
                lora_scale=lora_scale,
                width=width,
                height=height,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                generator=generator,
            )

        output_image = result.images[0]
        inference_time = time.time() - start_time

        # Analyze output face for downstream comparison
        output_face_info = self._analyze_face(output_image)

        # Save to temporary URL (fal.ai handles S3 upload)
        import tempfile
        import os
        
        temp_path = os.path.join(tempfile.gettempdir(), f"storymaker_{seed}.png")
        output_image.save(temp_path, "PNG")

        # Build face analysis response
        face_analysis_response = None
        if output_face_info is not None:
            face_analysis_response = {
                "face_count": 1,
                "bbox": output_face_info.bbox.tolist() if hasattr(output_face_info, "bbox") else None,
                "embedding": output_face_info.embedding.tolist() if hasattr(output_face_info, "embedding") else None,
                "confidence": float(output_face_info.det_score) if hasattr(output_face_info, "det_score") else 0.9,
            }

        return {
            "images": [{"url": fal.upload_file(temp_path)}],
            "seed": seed,
            "face_analysis": face_analysis_response,
            "timings": {
                "inference": inference_time,
                "cold_start": None,  # Set by fal.ai platform
            },
        }

    @fal.endpoint("/health")
    def health(self, request: dict) -> dict:
        """Health check endpoint."""
        return {
            "status": "healthy" if getattr(self, "is_ready", False) else "loading",
            "model": "storymaker_v1",
            "gpu": "A100",
        }

    # ─── Private Helpers ─────────────────────────────────────────────────────

    def _download_image(self, url: str):
        """Download image from URL and return PIL Image."""
        import requests
        from PIL import Image
        from io import BytesIO

        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return Image.open(BytesIO(response.content)).convert("RGB")

    def _analyze_face(self, image):
        """Run InsightFace analysis on a PIL Image."""
        import numpy as np

        # Convert PIL to numpy array for InsightFace
        img_array = np.array(image)
        # InsightFace expects BGR
        img_bgr = img_array[:, :, ::-1]

        faces = self.face_app.get(img_bgr)
        if len(faces) == 0:
            return None

        # Return the largest/most prominent face
        return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))

    def _apply_anime_conditioning(self, prompt: str, target_pose: str) -> str:
        """Enhance prompt with anime-style conditioning and pose guidance."""
        pose_suffixes = {
            "front": "front view, facing camera, centered composition",
            "three_quarter": "three-quarter view, slight angle, dynamic pose",
            "side": "side profile view, clean silhouette",
            "back": "back view, facing away, showing outfit details",
            "custom": "",
        }

        anime_prefix = "anime style, professional character design, clean linework, vibrant colors, "
        pose_suffix = pose_suffixes.get(target_pose, "")

        enhanced = f"{anime_prefix}{prompt}"
        if pose_suffix:
            enhanced = f"{enhanced}, {pose_suffix}"

        return enhanced
