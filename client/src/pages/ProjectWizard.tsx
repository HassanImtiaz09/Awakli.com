import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  Sparkles, ChevronRight, ChevronLeft, Check, Loader2,
  Swords, Heart, Rocket, Ghost, Laugh, Wand2, Crown,
  Skull, Palette, Eye, Zap, BookOpen, Baby, GraduationCap, User,
  ArrowLeft, Shield, Cpu, Coffee, Moon, Flower, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────

const GENRES = [
  { id: "action",   label: "Action",   icon: Swords, color: "#FF4444" },
  { id: "romance",  label: "Romance",  icon: Heart,  color: "#FF69B4" },
  { id: "sci-fi",   label: "Sci-Fi",   icon: Rocket, color: "#E040FB" },
  { id: "horror",   label: "Horror",   icon: Ghost,  color: "#E74C3C" },
  { id: "comedy",   label: "Comedy",   icon: Laugh,  color: "#F39C12" },
  { id: "fantasy",  label: "Fantasy",  icon: Wand2,  color: "#9B59B6" },
  { id: "drama",    label: "Drama",    icon: Crown,  color: "#FFD60A" },
  { id: "thriller", label: "Thriller", icon: Skull,  color: "#7C4DFF" },
  { id: "slice-of-life", label: "Slice of Life", icon: Palette, color: "#2ECC71" },
] as const;

const TONES = [
  "Dark & Gritty", "Light & Fun", "Epic & Grand", "Mysterious",
  "Emotional", "Action-Packed", "Philosophical", "Whimsical",
] as const;

const AUDIENCES = [
  { id: "kids" as const,  label: "Kids",  icon: Baby,          desc: "Ages 6-12, family-friendly" },
  { id: "teen" as const,  label: "Teen",  icon: GraduationCap, desc: "Ages 13-17, PG-13 content" },
  { id: "adult" as const, label: "Adult", icon: User,          desc: "Ages 18+, mature themes" },
];

// Icon mapping for style bundle iconIdentifier → Lucide component
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  sword: Swords,
  shield: Shield,
  flower: Flower,
  robot: Bot,
  sparkles: Sparkles,
  cpu: Cpu,
  coffee: Coffee,
  skull: Skull,
  palette: Palette,
  moon: Moon,
  eye: Eye,
};

// Fallback static styles (used only if DB query fails)
const FALLBACK_STYLES = [
  { id: "shonen",     label: "Shonen",     desc: "Bold action, vibrant energy" },
  { id: "seinen",     label: "Seinen",     desc: "Mature, cinematic detail" },
  { id: "shoujo",     label: "Shoujo",     desc: "Soft, expressive beauty" },
  { id: "cyberpunk",  label: "Cyberpunk",  desc: "Neon-lit, futuristic" },
  { id: "watercolor", label: "Watercolor", desc: "Dreamy, painterly" },
  { id: "noir",       label: "Noir",       desc: "High contrast, shadows" },
];

// ─── Step Indicator ───────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-0 py-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <motion.div
            className={cn(
              "w-3 h-3 rounded-full relative z-10 transition-all duration-500",
              i < current ? "bg-[var(--token-cyan)]" :
              i === current ? "bg-[var(--token-cyan)]" :
              "bg-[var(--text-muted)]"
            )}
            animate={{
              scale: i === current ? 1.4 : 1,
              boxShadow: i === current
                ? "0 0 16px rgba(124,77,255,0.6)"
                : i < current
                  ? "0 0 8px rgba(224,64,251,0.4)"
                  : "none",
            }}
            transition={{ duration: 0.4 }}
          />
          {i < total - 1 && (
            <div className="w-16 h-0.5 mx-1">
              <motion.div
                className="h-full rounded-full"
                animate={{
                  backgroundColor: i < current ? "var(--token-cyan)" : "var(--text-muted)",
                  opacity: i < current ? 1 : 0.3,
                }}
                transition={{ duration: 0.4 }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Name Your Story ──────────────────────────────────────────────

function StepName({
  title, setTitle, genres, setGenres, tone, setTone, audience, setAudience,
}: {
  title: string; setTitle: (v: string) => void;
  genres: string[]; setGenres: (v: string[]) => void;
  tone: string; setTone: (v: string) => void;
  audience: "kids" | "teen" | "adult"; setAudience: (v: "kids" | "teen" | "adult") => void;
}) {
  const toggleGenre = (id: string) => {
    setGenres(genres.includes(id) ? genres.filter(g => g !== id) : [...genres, id]);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div className="text-center space-y-3">
        <h1 className="text-display text-[var(--text-primary)]">What will you create?</h1>
        <p className="text-[var(--text-secondary)] text-lg">Give your story a name and choose its identity</p>
      </div>

      {/* Title */}
      <div className="relative">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter your story title..."
          className="w-full bg-transparent text-h2 text-center text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border-0 border-b-2 border-[var(--text-muted)] focus:border-[var(--token-cyan)] outline-none pb-3 transition-colors"
          maxLength={255}
        />
      </div>

      {/* Genre Grid */}
      <div>
        <label className="text-label text-[var(--text-secondary)] mb-3 block">Genre (select one or more)</label>
        <div className="grid grid-cols-3 gap-3">
          {GENRES.map((g) => {
            const Icon = g.icon;
            const selected = genres.includes(g.id);
            return (
              <motion.button
                key={g.id}
                onClick={() => toggleGenre(g.id)}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all",
                  selected
                    ? "border-transparent"
                    : "border-white/10 hover:border-white/20"
                )}
                style={{
                  backgroundColor: selected ? `${g.color}20` : "var(--bg-elevated)",
                  boxShadow: selected ? `0 0 20px ${g.color}30` : "none",
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Icon size={16} style={{ color: selected ? g.color : "var(--text-muted)" }} />
                <span className={cn("text-sm font-medium", selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                  {g.label}
                </span>
                {selected && <Check size={14} className="ml-auto" style={{ color: g.color }} />}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Tone */}
      <div>
        <label className="text-label text-[var(--text-secondary)] mb-3 block">Tone</label>
        <div className="grid grid-cols-4 gap-2">
          {TONES.map((t) => (
            <motion.button
              key={t}
              onClick={() => setTone(t)}
              className={cn(
                "px-3 py-2 rounded-lg text-sm font-medium border transition-all",
                tone === t
                  ? "bg-[var(--token-cyan)]/15 border-[var(--token-cyan)]/40 text-[var(--token-cyan)]"
                  : "bg-[var(--bg-elevated)] border-white/10 text-[var(--text-secondary)] hover:border-white/20"
              )}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              {t}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Audience */}
      <div>
        <label className="text-label text-[var(--text-secondary)] mb-3 block">Target Audience</label>
        <div className="grid grid-cols-3 gap-3">
          {AUDIENCES.map((a) => {
            const Icon = a.icon;
            const selected = audience === a.id;
            return (
              <motion.button
                key={a.id}
                onClick={() => setAudience(a.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-xl border transition-all",
                  selected
                    ? "bg-[var(--token-cyan)]/10 border-[var(--token-cyan)]/40"
                    : "bg-[var(--bg-elevated)] border-white/10 hover:border-white/20"
                )}
                style={{ boxShadow: selected ? "var(--shadow-glow-pink)" : "none" }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Icon size={24} className={selected ? "text-[var(--token-cyan)]" : "text-[var(--text-muted)]"} />
                <span className={cn("font-medium", selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                  {a.label}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{a.desc}</span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Describe Your World ──────────────────────────────────────────

function StepDescribe({
  description, setDescription,
}: {
  description: string; setDescription: (v: string) => void;
}) {
  const [enhanced, setEnhanced] = useState<string | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const enhanceMutation = trpc.ai.enhanceDescription.useMutation();

  const handleEnhance = async () => {
    if (!description.trim()) {
      toast.error("Write something first to enhance!");
      return;
    }
    try {
      const result = await enhanceMutation.mutateAsync({ text: description });
      setEnhanced(result.enhanced);
      setShowEnhanced(true);
      toast.success("Description enhanced!");
    } catch {
      toast.error("Enhancement failed. Try again.");
    }
  };

  const acceptEnhanced = () => {
    if (enhanced) {
      setDescription(enhanced);
      setEnhanced(null);
      setShowEnhanced(false);
    }
  };

  // Typewriter heading
  const [headingText, setHeadingText] = useState("");
  const fullHeading = "Tell us your story";
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setHeadingText(fullHeading.slice(0, i + 1));
      i++;
      if (i >= fullHeading.length) clearInterval(interval);
    }, 60);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-display text-[var(--text-primary)]">
          {headingText}
          <motion.span
            className="inline-block w-0.5 h-8 bg-[var(--token-cyan)] ml-1 align-middle"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        </h1>
        <p className="text-[var(--text-secondary)] text-lg">
          Describe the world, characters, and story you envision
        </p>
      </div>

      <div className="relative">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="In a world where..."
          rows={8}
          className="w-full bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] rounded-xl border border-white/10 focus:border-[var(--token-cyan)] outline-none p-5 text-base leading-relaxed resize-none transition-colors"
        />

        {/* Enhanced version */}
        <AnimatePresence>
          {showEnhanced && enhanced && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-4 p-5 rounded-xl border border-[var(--token-cyan)]/30 bg-[var(--token-cyan)]/5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-[var(--token-cyan)]" />
                <span className="text-sm font-medium text-[var(--token-cyan)]">AI Enhanced</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{enhanced}</p>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={acceptEnhanced}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--token-cyan)] text-white hover:bg-[var(--token-violet-hover)] transition-colors"
                >
                  Use Enhanced
                </button>
                <button
                  onClick={() => { setEnhanced(null); setShowEnhanced(false); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-white/10 text-[var(--text-secondary)] hover:border-white/20 transition-colors"
                >
                  Keep Original
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-end mt-3">
          <motion.button
            onClick={handleEnhance}
            disabled={enhanceMutation.isPending || !description.trim()}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              "bg-[var(--bg-elevated)] border border-white/10 text-[var(--text-secondary)]",
              "hover:border-[var(--token-cyan)]/40 hover:text-[var(--token-cyan)]",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {enhanceMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {enhanceMutation.isPending ? "Enhancing..." : "AI Enhance"}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Choose Your Style (DB-backed Style Bundles) ─────────────────

function StepStyle({
  style, setStyle,
}: {
  style: string; setStyle: (v: string) => void;
}) {
  // Fetch active style bundles from DB
  const { data: bundles, isLoading, isError } = trpc.styleBundles.listActive.useQuery();

  // Derive display items: DB bundles or fallback
  const styleItems = useMemo(() => {
    if (bundles && bundles.length > 0) {
      return bundles.map((b: any) => ({
        id: b.genreKey,
        label: b.name,
        desc: b.description || "",
        iconId: b.iconIdentifier,
        colorPalette: b.colorPalette as any,
        previewImageUrl: b.previewImageUrl,
      }));
    }
    // Fallback to static list if DB query fails or returns empty
    return FALLBACK_STYLES.map(s => ({
      id: s.id,
      label: s.label,
      desc: s.desc,
      iconId: null as string | null,
      colorPalette: null as any,
      previewImageUrl: null as string | null,
    }));
  }, [bundles]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-display text-[var(--text-primary)]">Pick an art style</h1>
        <p className="text-[var(--text-secondary)] text-lg">Choose the visual direction for your anime</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="animate-spin text-[var(--token-cyan)]" />
          <span className="ml-3 text-[var(--text-secondary)]">Loading style bundles...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {styleItems.map((s) => {
            const selected = style === s.id;
            const IconComp = s.iconId ? ICON_MAP[s.iconId] || Eye : Eye;
            const accentColor = s.colorPalette?.accent || "var(--token-cyan)";

            return (
              <motion.button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={cn(
                  "relative overflow-hidden rounded-xl border transition-all",
                  "aspect-[3/4] flex flex-col justify-end p-4",
                  selected
                    ? "border-[var(--token-cyan)] ring-2 ring-[var(--token-cyan)]/30"
                    : "border-white/10 hover:border-white/20"
                )}
                style={{
                  background: s.colorPalette
                    ? `linear-gradient(180deg, ${s.colorPalette.background || "var(--bg-elevated)"} 0%, ${s.colorPalette.shadow || "var(--bg-overlay)"} 100%)`
                    : `linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-overlay) 100%)`,
                  boxShadow: selected ? `0 0 24px ${accentColor}40` : "none",
                }}
                whileHover={{ scale: 1.03, y: -4 }}
                whileTap={{ scale: 0.98 }}
                animate={{ scale: selected ? 1.03 : 1 }}
                transition={{ duration: 0.2 }}
              >
                {/* Style icon/preview area */}
                {s.previewImageUrl ? (
                  <img
                    src={s.previewImageUrl}
                    alt={s.label}
                    className="absolute inset-0 w-full h-full object-cover opacity-40"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center opacity-25">
                    <IconComp
                      size={56}
                      style={{ color: s.colorPalette?.accent || "var(--text-muted)" }}
                    />
                  </div>
                )}

                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[var(--bg-void)]/95 via-[var(--bg-void)]/60 to-transparent" />

                <div className="relative z-10">
                  <h3 className="text-base font-heading font-semibold text-[var(--text-primary)]">{s.label}</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">{s.desc}</p>
                </div>

                {selected && (
                  <motion.div
                    className="absolute top-3 right-3 w-6 h-6 rounded-full bg-[var(--token-cyan)] flex items-center justify-center"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <Check size={14} className="text-white" />
                  </motion.div>
                )}

                {/* Color palette preview dots */}
                {s.colorPalette && (
                  <div className="absolute top-3 left-3 flex gap-1">
                    {[s.colorPalette.primary, s.colorPalette.accent, s.colorPalette.highlight].filter(Boolean).map((c: string, i: number) => (
                      <div
                        key={i}
                        className="w-2.5 h-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      )}

      {isError && (
        <p className="text-center text-sm text-[var(--text-muted)]">
          Using default styles. Custom style bundles will be available soon.
        </p>
      )}
    </div>
  );
}

// ─── Step 4: Review & Create ──────────────────────────────────────────────

function StepReview({
  title, genres, tone, audience, description, style, isCreating, onCreate,
}: {
  title: string; genres: string[]; tone: string; audience: string;
  description: string; style: string; isCreating: boolean; onCreate: () => void;
}) {
  // Fetch the selected style bundle for display
  const { data: bundles } = trpc.styleBundles.listActive.useQuery();
  const selectedBundle = bundles?.find((b: any) => b.genreKey === style);
  const styleName = selectedBundle?.name || style;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-display text-[var(--text-primary)]">Review & Create</h1>
        <p className="text-[var(--text-secondary)] text-lg">Everything looks good? Let's bring it to life.</p>
      </div>

      <motion.div
        className="rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: "var(--gradient-card)" }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="p-6 space-y-5">
          <div>
            <span className="text-label text-[var(--text-muted)]">Title</span>
            <p className="text-h3 text-[var(--text-primary)] mt-1">{title || "Untitled Project"}</p>
          </div>

          {genres.length > 0 && (
            <div>
              <span className="text-label text-[var(--text-muted)]">Genre</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {genres.map((g) => {
                  const genre = GENRES.find(x => x.id === g);
                  return (
                    <span
                      key={g}
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{ backgroundColor: `${genre?.color}20`, color: genre?.color }}
                    >
                      {genre?.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {tone && (
            <div>
              <span className="text-label text-[var(--text-muted)]">Tone</span>
              <p className="text-[var(--text-secondary)] mt-1">{tone}</p>
            </div>
          )}

          <div>
            <span className="text-label text-[var(--text-muted)]">Audience</span>
            <p className="text-[var(--text-secondary)] mt-1 capitalize">{audience}</p>
          </div>

          {description && (
            <div>
              <span className="text-label text-[var(--text-muted)]">Description</span>
              <p className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-4">{description}</p>
            </div>
          )}

          <div>
            <span className="text-label text-[var(--text-muted)]">Art Style</span>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[var(--text-secondary)] capitalize">{styleName}</p>
              {selectedBundle?.colorPalette != null && (
                <div className="flex gap-1 ml-2">
                  {((): React.ReactNode => {
                    const p = selectedBundle.colorPalette as Record<string, string> | null;
                    if (!p) return null;
                    return [p.primary, p.accent].filter(Boolean).map((c, i) => (
                      <div
                        key={i}
                        className="w-3 h-3 rounded-full border border-white/20"
                        style={{ backgroundColor: c }}
                      />
                    ));
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      <motion.button
        onClick={onCreate}
        disabled={isCreating || !title.trim()}
        className={cn(
          "w-full py-4 rounded-xl text-lg font-heading font-semibold transition-all",
          "bg-gradient-to-r from-[var(--token-cyan)] to-[#7C4DFF] text-white",
          "hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        {isCreating ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={20} className="animate-spin" />
            Creating your project...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Zap size={20} />
            Create Project
          </span>
        )}
      </motion.button>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────

export default function ProjectWizard() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);

  // Form state
  const [title, setTitle] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState<"kids" | "teen" | "adult">("teen");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("default");

  const createMutation = trpc.projects.create.useMutation();

  const canNext = useCallback(() => {
    switch (step) {
      case 0: return title.trim().length > 0;
      case 1: return true; // description is optional
      case 2: return style !== "default";
      case 3: return title.trim().length > 0;
      default: return false;
    }
  }, [step, title, style]);

  const handleCreate = async () => {
    try {
      const result = await createMutation.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        genre: genres.join(", ") || undefined,
        animeStyle: style as any,
        tone: tone || undefined,
        targetAudience: audience,
        visibility: "private",
      });

      // Fire confetti
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#7C4DFF", "#B388FF", "#E040FB", "#FFD60A", "#9B59B6"],
      });

      toast.success("Project created! Redirecting to studio...");

      setTimeout(() => {
        navigate(`/studio/project/${result.id}`);
      }, 2000);
    } catch {
      toast.error("Failed to create project. Please try again.");
    }
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
      x: direction > 0 ? -300 : 300,
      opacity: 0,
    }),
  };

  const [direction, setDirection] = useState(1);

  const goNext = () => {
    if (canNext() && step < 3) {
      setDirection(1);
      setStep(step + 1);
    }
  };

  const goPrev = () => {
    if (step > 0) {
      setDirection(-1);
      setStep(step - 1);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-void)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate("/studio")}
          className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Studio
        </button>
        <span className="text-label text-[var(--text-muted)]">Step {step + 1} of 4</span>
      </div>

      <StepIndicator current={step} total={4} />

      {/* Step content */}
      <div className="flex-1 px-6 pb-8 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35, ease: "easeInOut" }}
          >
            {step === 0 && (
              <StepName
                title={title} setTitle={setTitle}
                genres={genres} setGenres={setGenres}
                tone={tone} setTone={setTone}
                audience={audience} setAudience={setAudience}
              />
            )}
            {step === 1 && (
              <StepDescribe description={description} setDescription={setDescription} />
            )}
            {step === 2 && (
              <StepStyle style={style} setStyle={setStyle} />
            )}
            {step === 3 && (
              <StepReview
                title={title} genres={genres} tone={tone} audience={audience}
                description={description} style={style}
                isCreating={createMutation.isPending}
                onCreate={handleCreate}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <div className="sticky bottom-0 flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[var(--bg-void)]/80 backdrop-blur-sm">
        <motion.button
          onClick={goPrev}
          disabled={step === 0}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all",
            "border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-white/20",
            "disabled:opacity-30 disabled:cursor-not-allowed"
          )}
          whileHover={{ scale: step > 0 ? 1.02 : 1 }}
          whileTap={{ scale: step > 0 ? 0.98 : 1 }}
        >
          <ChevronLeft size={16} />
          Back
        </motion.button>

        {step < 3 && (
          <motion.button
            onClick={goNext}
            disabled={!canNext()}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all",
              "bg-[var(--token-cyan)] text-white hover:bg-[var(--token-violet-hover)]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            whileHover={{ scale: canNext() ? 1.02 : 1 }}
            whileTap={{ scale: canNext() ? 0.98 : 1 }}
          >
            Next
            <ChevronRight size={16} />
          </motion.button>
        )}
      </div>
    </div>
  );
}
