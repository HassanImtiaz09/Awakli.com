"""
Wave 8 CLIP Character Consistency Scoring
==========================================
Computes cosine similarity between each of the 21 panel keyframes
and the 2 character reference sheets (Mira, Master Gen).

Uses OpenAI CLIP (ViT-B/32) for image embeddings.
Produces a 21×2 similarity matrix + per-panel scores.
"""
import json
import os
import sys
import numpy as np
from PIL import Image

# Try to use CLIP via transformers
try:
    from transformers import CLIPProcessor, CLIPModel
    import torch
except ImportError:
    print("ERROR: transformers/torch not installed")
    sys.exit(1)

KEYFRAMES_DIR = "/home/ubuntu/awakli/wave8-artifacts/keyframes"
REFS_DIR = "/home/ubuntu/awakli/wave8-artifacts/character-refs"
OUTPUT_FILE = "/home/ubuntu/awakli/wave8-artifacts/clip-consistency-scores.json"

def load_clip_model():
    """Load CLIP ViT-B/32 model and processor"""
    print("Loading CLIP ViT-B/32...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()
    return model, processor

def get_image_embedding(model, processor, image_path):
    """Get CLIP image embedding for a single image"""
    image = Image.open(image_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = model.get_image_features(**inputs)
    # outputs is a tensor when using get_image_features
    if hasattr(outputs, 'pooler_output'):
        embedding = outputs.pooler_output
    elif isinstance(outputs, torch.Tensor):
        embedding = outputs
    else:
        embedding = outputs[0] if isinstance(outputs, tuple) else outputs
    # Normalize
    embedding = embedding / embedding.norm(dim=-1, keepdim=True)
    return embedding.squeeze().numpy()

def cosine_similarity(a, b):
    """Compute cosine similarity between two vectors"""
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

def main():
    model, processor = load_clip_model()
    
    # Load character reference embeddings
    # The character refs are stored as data URLs in the DB, but we need to
    # extract them. For now, check if we have them locally
    ref_files = {}
    if os.path.exists(REFS_DIR):
        for f in sorted(os.listdir(REFS_DIR)):
            if f.endswith(".png") or f.endswith(".jpg"):
                ref_files[f.split(".")[0]] = os.path.join(REFS_DIR, f)
    
    if not ref_files:
        print("No character reference files found. Generating from DB data URLs...")
        # Fall back to using the panel images themselves as pseudo-references
        # Use panel_01 (Mira in dojo) and panel_09 (Master Gen speaking)
        ref_files = {
            "mira_pseudo": os.path.join(KEYFRAMES_DIR, "panel_01.png"),
            "gen_pseudo": os.path.join(KEYFRAMES_DIR, "panel_09.png"),
        }
        print(f"  Using pseudo-references: {list(ref_files.keys())}")
    
    # Compute reference embeddings
    print("\nComputing reference embeddings...")
    ref_embeddings = {}
    for name, path in ref_files.items():
        if os.path.exists(path):
            ref_embeddings[name] = get_image_embedding(model, processor, path)
            print(f"  {name}: embedding shape {ref_embeddings[name].shape}")
    
    # Compute panel embeddings and similarity matrix
    print("\nComputing panel embeddings (21 panels)...")
    results = []
    similarity_matrix = []
    
    for i in range(1, 22):
        panel_path = os.path.join(KEYFRAMES_DIR, f"panel_{i:02d}.png")
        if not os.path.exists(panel_path):
            print(f"  Panel {i:02d}: MISSING")
            results.append({"panel": i, "error": "file not found"})
            similarity_matrix.append({})
            continue
        
        panel_embedding = get_image_embedding(model, processor, panel_path)
        
        # Compute similarity to each reference
        sims = {}
        for ref_name, ref_emb in ref_embeddings.items():
            sim = cosine_similarity(panel_embedding, ref_emb)
            sims[ref_name] = round(sim, 4)
        
        results.append({
            "panel": i,
            "similarities": sims,
            "max_similarity": max(sims.values()) if sims else 0,
            "best_match": max(sims, key=sims.get) if sims else "none",
        })
        similarity_matrix.append(sims)
        print(f"  Panel {i:02d}: {sims}")
    
    # Compute aggregate statistics
    all_sims = [r["max_similarity"] for r in results if "similarities" in r]
    mira_sims = [r["similarities"].get("mira_pseudo", 0) for r in results if "similarities" in r]
    gen_sims = [r["similarities"].get("gen_pseudo", 0) for r in results if "similarities" in r]
    
    output = {
        "metadata": {
            "model": "openai/clip-vit-base-patch32",
            "method": "cosine similarity of CLIP image embeddings",
            "referenceType": "pseudo (panel_01 as Mira, panel_09 as Master Gen)" if "mira_pseudo" in ref_embeddings else "character sheets",
            "panelCount": 21,
            "timestamp": "2026-05-09"
        },
        "aggregateStats": {
            "meanMaxSimilarity": round(float(np.mean(all_sims)), 4) if all_sims else 0,
            "stdMaxSimilarity": round(float(np.std(all_sims)), 4) if all_sims else 0,
            "meanMiraSimilarity": round(float(np.mean(mira_sims)), 4) if mira_sims else 0,
            "meanGenSimilarity": round(float(np.mean(gen_sims)), 4) if gen_sims else 0,
            "minSimilarity": round(float(min(all_sims)), 4) if all_sims else 0,
            "maxSimilarity": round(float(max(all_sims)), 4) if all_sims else 0,
        },
        "perPanelScores": results,
        "interpretation": {
            "note": "CLIP cosine similarity ranges from -1 to 1. For same-character consistency, scores >0.85 indicate strong visual identity preservation. Scores <0.70 suggest significant style/identity drift.",
            "threshold_strong": 0.85,
            "threshold_acceptable": 0.75,
            "threshold_poor": 0.70
        }
    }
    
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"CLIP Consistency Scoring Complete")
    print(f"{'='*60}")
    print(f"Mean max similarity: {output['aggregateStats']['meanMaxSimilarity']}")
    print(f"Mean Mira similarity: {output['aggregateStats']['meanMiraSimilarity']}")
    print(f"Mean Gen similarity: {output['aggregateStats']['meanGenSimilarity']}")
    print(f"Min similarity: {output['aggregateStats']['minSimilarity']}")
    print(f"Max similarity: {output['aggregateStats']['maxSimilarity']}")
    print(f"\nResults saved to: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
