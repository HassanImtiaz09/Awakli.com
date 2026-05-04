import { sql } from 'drizzle-orm';
import { getDb } from './server/db.ts';

const db = await getDb();
if (!db) { console.error('No DB'); process.exit(1); }

const bundles = [
  {
    genre_key: "shonen",
    name: "Shonen",
    description: "Bold action-driven style with dynamic poses, speed lines, and vibrant energy. Think Naruto, Demon Slayer, My Hero Academia.",
    prompt_template: "shonen anime style, dynamic action poses, bold outlines, vibrant saturated colors, speed lines, dramatic lighting, high energy composition, professional manga art",
    negative_prompt: "static poses, muted colors, realistic proportions, photographic, watercolor, pastel",
    color_palette: JSON.stringify({ primary: "#FF6B35", secondary: "#1A1A2E", accent: "#FFD700", background: "#0F0F23", highlight: "#FF4444", shadow: "#0A0A1A" }),
    frame_rate_default: 12,
    music_mood_vector: JSON.stringify({ energy: 0.85, valence: 0.7, tempo_bpm: 140, instrumentation_tags: ["electric_guitar", "drums", "orchestra", "choir"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "shonen_style", weight_range: [0.6, 0.9], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "sword",
    sort_order: 1,
  },
  {
    genre_key: "seinen",
    name: "Seinen",
    description: "Mature, detailed art with realistic proportions, atmospheric shading, and cinematic framing. Think Berserk, Vinland Saga, Ghost in the Shell.",
    prompt_template: "seinen anime style, mature detailed art, realistic proportions, atmospheric shading, cinematic composition, muted color palette, intricate linework, dramatic chiaroscuro lighting",
    negative_prompt: "chibi, super deformed, bright neon colors, sparkle effects, cute, kawaii, cartoonish",
    color_palette: JSON.stringify({ primary: "#4A4E69", secondary: "#22223B", accent: "#C9ADA7", background: "#1B1B2F", highlight: "#9A8C98", shadow: "#0D0D1A" }),
    frame_rate_default: 24,
    music_mood_vector: JSON.stringify({ energy: 0.5, valence: 0.3, tempo_bpm: 90, instrumentation_tags: ["piano", "strings", "ambient_synth", "cello"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "seinen_style", weight_range: [0.5, 0.85], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "shield",
    sort_order: 2,
  },
  {
    genre_key: "shoujo",
    name: "Shoujo",
    description: "Elegant, romantic style with soft colors, sparkle effects, floral motifs, and expressive eyes. Think Sailor Moon, Fruits Basket, Ouran.",
    prompt_template: "shoujo anime style, soft pastel colors, sparkle effects, floral backgrounds, elegant character design, large expressive eyes, romantic atmosphere, delicate linework, screen tones",
    negative_prompt: "dark atmosphere, gore, mecha, hard shadows, gritty, industrial, cyberpunk",
    color_palette: JSON.stringify({ primary: "#FFB6C1", secondary: "#E6E6FA", accent: "#FF69B4", background: "#FFF0F5", highlight: "#FFD700", shadow: "#DDA0DD" }),
    frame_rate_default: 12,
    music_mood_vector: JSON.stringify({ energy: 0.4, valence: 0.85, tempo_bpm: 110, instrumentation_tags: ["piano", "harp", "flute", "strings", "music_box"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "shoujo_style", weight_range: [0.6, 0.9], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "flower",
    sort_order: 3,
  },
  {
    genre_key: "mecha",
    name: "Mecha",
    description: "Detailed mechanical design with metallic shading, dynamic mech battles, and industrial environments. Think Gundam, Evangelion, Code Geass.",
    prompt_template: "mecha anime style, detailed mechanical design, metallic shading, dynamic robot poses, industrial environments, lens flare, cockpit HUD overlays, cinematic wide shots, professional mecha art",
    negative_prompt: "organic only, no machines, watercolor, chibi, cute, slice of life, pastel",
    color_palette: JSON.stringify({ primary: "#2E86AB", secondary: "#1C1C1C", accent: "#FF4444", background: "#0A0A1A", highlight: "#00BFFF", shadow: "#050510" }),
    frame_rate_default: 24,
    music_mood_vector: JSON.stringify({ energy: 0.9, valence: 0.5, tempo_bpm: 150, instrumentation_tags: ["orchestra", "electric_guitar", "synth", "choir", "taiko"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "mecha_style", weight_range: [0.7, 0.95], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "robot",
    sort_order: 4,
  },
  {
    genre_key: "isekai",
    name: "Isekai / Fantasy",
    description: "Lush fantasy worlds with magical effects, RPG-inspired UI elements, and vibrant otherworldly landscapes. Think Re:Zero, Mushoku Tensei, Konosuba.",
    prompt_template: "isekai fantasy anime style, lush fantasy world, magical particle effects, RPG-inspired composition, vibrant otherworldly landscapes, glowing runes, enchanted atmosphere, detailed fantasy architecture, professional anime art",
    negative_prompt: "modern city, technology, cyberpunk, industrial, monochrome, noir, realistic photography",
    color_palette: JSON.stringify({ primary: "#7B2D8E", secondary: "#1A472A", accent: "#FFD700", background: "#0F1A2E", highlight: "#00FF88", shadow: "#0A0A20" }),
    frame_rate_default: 12,
    music_mood_vector: JSON.stringify({ energy: 0.65, valence: 0.7, tempo_bpm: 120, instrumentation_tags: ["orchestra", "harp", "flute", "choir", "celtic_drums"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "isekai_style", weight_range: [0.6, 0.9], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "sparkles",
    sort_order: 5,
  },
  {
    genre_key: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon-drenched futuristic aesthetic with rain-slicked streets, holographic UI, and high-contrast lighting. Think Akira, Psycho-Pass, Cyberpunk Edgerunners.",
    prompt_template: "cyberpunk anime style, neon lighting, rain-slicked streets, holographic displays, futuristic technology, dark atmosphere, high contrast, chromatic aberration, lens flare, professional cyberpunk art",
    negative_prompt: "nature, medieval, fantasy, pastel colors, bright daylight, watercolor, cute, chibi",
    color_palette: JSON.stringify({ primary: "#FF00FF", secondary: "#00FFFF", accent: "#FF6600", background: "#0A0A1A", highlight: "#00FF00", shadow: "#050510" }),
    frame_rate_default: 24,
    music_mood_vector: JSON.stringify({ energy: 0.75, valence: 0.35, tempo_bpm: 130, instrumentation_tags: ["synth", "bass", "drum_machine", "glitch", "ambient"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "cyberpunk_style", weight_range: [0.7, 0.95], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "cpu",
    sort_order: 6,
  },
  {
    genre_key: "slice_of_life",
    name: "Slice of Life",
    description: "Warm, gentle aesthetic with soft lighting, detailed backgrounds of everyday settings, and natural color palettes. Think Violet Evergarden, March Comes in Like a Lion.",
    prompt_template: "slice of life anime style, warm soft lighting, detailed everyday backgrounds, natural color palette, gentle atmosphere, subtle expressions, golden hour lighting, cozy interior design, professional anime art",
    negative_prompt: "action, explosions, mecha, dark atmosphere, gore, neon, cyberpunk, fantasy magic",
    color_palette: JSON.stringify({ primary: "#E8B86D", secondary: "#87CEEB", accent: "#FF9A76", background: "#FFF8E7", highlight: "#FFE4B5", shadow: "#D2B48C" }),
    frame_rate_default: 12,
    music_mood_vector: JSON.stringify({ energy: 0.25, valence: 0.8, tempo_bpm: 85, instrumentation_tags: ["acoustic_guitar", "piano", "ukulele", "wind_chimes", "ambient"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "sol_style", weight_range: [0.5, 0.8], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "coffee",
    sort_order: 7,
  },
  {
    genre_key: "horror",
    name: "Horror / Thriller",
    description: "Unsettling atmosphere with distorted perspectives, heavy shadows, desaturated palettes, and psychological tension. Think Junji Ito, Another, Paranoia Agent.",
    prompt_template: "horror anime style, unsettling atmosphere, distorted perspective, heavy dramatic shadows, desaturated color palette, psychological tension, eerie lighting, grotesque detail, professional dark anime art",
    negative_prompt: "bright colors, cheerful, cute, sparkle effects, comedy, chibi, pastel, warm lighting",
    color_palette: JSON.stringify({ primary: "#8B0000", secondary: "#2F2F2F", accent: "#4A0E0E", background: "#0A0A0A", highlight: "#FF4444", shadow: "#000000" }),
    frame_rate_default: 24,
    music_mood_vector: JSON.stringify({ energy: 0.6, valence: 0.1, tempo_bpm: 70, instrumentation_tags: ["strings_dissonant", "ambient_drone", "music_box_detuned", "percussion_sparse"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "horror_style", weight_range: [0.6, 0.9], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "skull",
    sort_order: 8,
  },
  {
    genre_key: "watercolor",
    name: "Watercolor / Painterly",
    description: "Soft, painterly aesthetic with visible brushstrokes, color bleeds, and dreamy atmospheric washes. Think The Tale of Princess Kaguya, Children of the Sea.",
    prompt_template: "watercolor anime style, soft painterly washes, visible brushstrokes, color bleeds, dreamy atmosphere, textured paper grain, impressionistic backgrounds, delicate linework, professional watercolor animation art",
    negative_prompt: "sharp digital lines, neon colors, mechanical, cyberpunk, hard edges, flat colors, cel shading",
    color_palette: JSON.stringify({ primary: "#6B8E9B", secondary: "#C4A882", accent: "#D4756B", background: "#F5F0E8", highlight: "#E8D5B7", shadow: "#7A8B8B" }),
    frame_rate_default: 12,
    music_mood_vector: JSON.stringify({ energy: 0.2, valence: 0.6, tempo_bpm: 75, instrumentation_tags: ["piano", "flute", "harp", "ambient_pad", "wind"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "watercolor_style", weight_range: [0.7, 0.95], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "palette",
    sort_order: 9,
  },
  {
    genre_key: "noir",
    name: "Noir / Neo-Noir",
    description: "High-contrast monochrome with dramatic shadows, selective color accents, and cinematic noir framing. Think Cowboy Bebop, Darker than Black, Monster.",
    prompt_template: "noir anime style, high contrast black and white, dramatic shadows, selective color accents, cinematic noir framing, venetian blind shadows, rain, smoke, film grain, professional noir anime art",
    negative_prompt: "bright colors, cheerful, cute, fantasy, sparkle effects, pastel, warm tones, daylight",
    color_palette: JSON.stringify({ primary: "#C0C0C0", secondary: "#1A1A1A", accent: "#B22222", background: "#0D0D0D", highlight: "#FFFFFF", shadow: "#000000" }),
    frame_rate_default: 24,
    music_mood_vector: JSON.stringify({ energy: 0.45, valence: 0.25, tempo_bpm: 95, instrumentation_tags: ["jazz_saxophone", "piano", "upright_bass", "brush_drums", "trumpet_muted"] }),
    lora_config: JSON.stringify({ model_id: null, trigger_word: "noir_style", weight_range: [0.6, 0.9], compatible_bases: ["sdxl", "flux"] }),
    icon_identifier: "moon",
    sort_order: 10,
  },
];

// Insert bundles one by one with INSERT IGNORE to skip duplicates
for (const b of bundles) {
  try {
    await db.execute(sql`
      INSERT IGNORE INTO style_bundles
        (genre_key, name, description, prompt_template, negative_prompt, color_palette, frame_rate_default, music_mood_vector, lora_config, icon_identifier, sort_order)
      VALUES
        (${b.genre_key}, ${b.name}, ${b.description}, ${b.prompt_template}, ${b.negative_prompt}, ${b.color_palette}, ${b.frame_rate_default}, ${b.music_mood_vector}, ${b.lora_config}, ${b.icon_identifier}, ${b.sort_order})
    `);
    console.log(`Seeded: ${b.genre_key}`);
  } catch (err) {
    console.error(`Failed to seed ${b.genre_key}:`, err.message);
  }
}

console.log('Seed complete');
process.exit(0);
