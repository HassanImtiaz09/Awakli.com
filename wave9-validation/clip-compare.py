"""
Wave 9 API-Parity Validation — CLIP Comparison
Compares character identity preservation between:
  - API output: wave9-validation/api_scene1_output.mp4
  - Consumer-UI baseline: wave9-validation/Scene1.mp4
  - Character references: mira_reference.png, kazuo_reference.png, renji_reference.png

Methodology:
  1. Extract frames from both videos at 1fps
  2. Compute CLIP embeddings for each frame and each character reference
  3. Compute cosine similarity between each frame and each character ref
  4. Report mean/max/min similarity scores for both videos
  5. Compare API vs consumer-UI scores to assess parity
"""
import os
import sys
import json
import subprocess
import numpy as np
from pathlib import Path

# Install dependencies if needed
try:
    import torch
    import clip
    from PIL import Image
except ImportError:
    print("Installing CLIP dependencies...")
    subprocess.run([sys.executable, "-m", "pip", "install", "git+https://github.com/openai/CLIP.git", "torch", "torchvision", "Pillow"], 
                   capture_output=True, check=True)
    import torch
    import clip
    from PIL import Image

BASE_DIR = Path("/home/ubuntu/awakli/wave9-validation")

def extract_frames(video_path, output_dir, fps=1):
    """Extract frames from video at given fps"""
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-q:v", "2",
        str(output_dir / "frame_%04d.png"),
        "-y"
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    frames = sorted(output_dir.glob("frame_*.png"))
    print(f"  Extracted {len(frames)} frames from {video_path.name}")
    return frames

def compute_clip_scores(model, preprocess, device, ref_images, video_frames):
    """Compute CLIP cosine similarity between reference images and video frames"""
    # Encode reference images
    ref_features = []
    for ref_path in ref_images:
        img = preprocess(Image.open(ref_path)).unsqueeze(0).to(device)
        with torch.no_grad():
            feat = model.encode_image(img)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            ref_features.append(feat)
    
    # Encode video frames
    frame_features = []
    for frame_path in video_frames:
        img = preprocess(Image.open(frame_path)).unsqueeze(0).to(device)
        with torch.no_grad():
            feat = model.encode_image(img)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            frame_features.append(feat)
    
    # Compute similarity matrix: [n_refs x n_frames]
    scores = {}
    ref_names = ["mira", "kazuo", "renji"]
    for i, (ref_feat, name) in enumerate(zip(ref_features, ref_names)):
        sims = []
        for frame_feat in frame_features:
            sim = (ref_feat @ frame_feat.T).item()
            sims.append(sim)
        scores[name] = {
            "mean": float(np.mean(sims)),
            "max": float(np.max(sims)),
            "min": float(np.min(sims)),
            "std": float(np.std(sims)),
            "per_frame": [float(s) for s in sims],
        }
    
    # Overall mean across all refs
    all_means = [scores[n]["mean"] for n in ref_names]
    scores["overall_mean"] = float(np.mean(all_means))
    
    return scores

def main():
    print("=== Wave 9 CLIP Comparison: API vs Consumer-UI ===\n")
    
    # Load CLIP model
    print("Loading CLIP ViT-B/32...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, preprocess = clip.load("ViT-B/32", device=device)
    print(f"  Device: {device}\n")
    
    # Reference images
    ref_images = [
        BASE_DIR / "mira_reference.png",
        BASE_DIR / "kazuo_reference.png",
        BASE_DIR / "renji_reference.png",
    ]
    for ref in ref_images:
        if not ref.exists():
            print(f"ERROR: Reference image not found: {ref}")
            sys.exit(1)
    
    # Extract frames from both videos
    api_video = BASE_DIR / "api_scene1_output.mp4"
    consumer_video = BASE_DIR / "Scene1.mp4"
    
    if not api_video.exists():
        print(f"ERROR: API output not found: {api_video}")
        sys.exit(1)
    if not consumer_video.exists():
        print(f"ERROR: Consumer-UI baseline not found: {consumer_video}")
        sys.exit(1)
    
    print("Extracting frames...")
    api_frames_dir = BASE_DIR / "frames_api"
    consumer_frames_dir = BASE_DIR / "frames_consumer"
    
    api_frames = extract_frames(api_video, api_frames_dir, fps=1)
    consumer_frames = extract_frames(consumer_video, consumer_frames_dir, fps=1)
    
    # Compute CLIP scores
    print("\nComputing CLIP scores for API output...")
    api_scores = compute_clip_scores(model, preprocess, device, ref_images, api_frames)
    
    print("Computing CLIP scores for Consumer-UI baseline...")
    consumer_scores = compute_clip_scores(model, preprocess, device, ref_images, consumer_frames)
    
    # Report
    print("\n" + "="*70)
    print("CLIP SIMILARITY RESULTS (ViT-B/32 cosine similarity)")
    print("="*70)
    print(f"\n{'Character':<12} {'Metric':<8} {'API Output':<14} {'Consumer-UI':<14} {'Delta':<10}")
    print("-"*58)
    
    for char in ["mira", "kazuo", "renji"]:
        for metric in ["mean", "max", "min"]:
            api_val = api_scores[char][metric]
            con_val = consumer_scores[char][metric]
            delta = api_val - con_val
            sign = "+" if delta >= 0 else ""
            print(f"{char:<12} {metric:<8} {api_val:.4f}        {con_val:.4f}        {sign}{delta:.4f}")
        print()
    
    print(f"{'OVERALL':<12} {'mean':<8} {api_scores['overall_mean']:.4f}        {consumer_scores['overall_mean']:.4f}        {'+' if api_scores['overall_mean'] >= consumer_scores['overall_mean'] else ''}{api_scores['overall_mean'] - consumer_scores['overall_mean']:.4f}")
    
    # Parity assessment
    print("\n" + "="*70)
    print("PARITY ASSESSMENT")
    print("="*70)
    delta_overall = api_scores['overall_mean'] - consumer_scores['overall_mean']
    
    if abs(delta_overall) < 0.02:
        verdict = "PASS — API output is at parity with consumer-UI (delta < 0.02)"
    elif delta_overall > 0:
        verdict = "PASS (EXCEEDS) — API output scores HIGHER than consumer-UI"
    elif delta_overall > -0.05:
        verdict = "MARGINAL — API output slightly below consumer-UI (delta < 0.05)"
    else:
        verdict = "FAIL — API output significantly below consumer-UI (delta >= 0.05)"
    
    print(f"\n  Overall delta: {'+' if delta_overall >= 0 else ''}{delta_overall:.4f}")
    print(f"  Verdict: {verdict}")
    print(f"\n  Threshold for Wave 9 proceed: mean max-sim >= 0.70 (per Wave 8 diagnostic)")
    print(f"  API overall mean: {api_scores['overall_mean']:.4f}")
    print(f"  Consumer-UI overall mean: {consumer_scores['overall_mean']:.4f}")
    
    # Save results
    results = {
        "timestamp": __import__("datetime").datetime.now().isoformat(),
        "model": "CLIP ViT-B/32",
        "device": device,
        "api_output": {
            "video": str(api_video),
            "n_frames": len(api_frames),
            "scores": api_scores,
        },
        "consumer_ui": {
            "video": str(consumer_video),
            "n_frames": len(consumer_frames),
            "scores": consumer_scores,
        },
        "delta_overall": delta_overall,
        "verdict": verdict,
    }
    
    results_path = BASE_DIR / "clip_comparison_results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Full results saved to: {results_path}")

if __name__ == "__main__":
    main()
