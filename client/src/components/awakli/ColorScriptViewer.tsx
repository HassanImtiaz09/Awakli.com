/**
 * Wave 2 Item 3: Color Script Viewer
 *
 * Displays the D6 Color Director output:
 * - Character palette swatches
 * - Scene palette strips
 * - Mood progression arc visualization
 * - Palette editing (when unlocked)
 * - Approval gate UI
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Palette, Lock, Unlock, Check, X, RefreshCw, Loader2,
  Sparkles, Eye, ChevronDown, ChevronUp, Sun, Moon, Cloud,
} from "lucide-react";

interface ColorScriptViewerProps {
  projectId: number;
  episodeId: number;
  styleBundleKey?: string;
  onApproved?: () => void;
}

export default function ColorScriptViewer({
  projectId,
  episodeId,
  styleBundleKey,
  onApproved,
}: ColorScriptViewerProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>("characters");
  const [editingColor, setEditingColor] = useState<{
    type: "character" | "scene";
    id: number;
    field: string;
    value: string;
  } | null>(null);

  const utils = trpc.useUtils();

  const { data: colorScript, isLoading } = trpc.colorDirector.getByEpisode.useQuery(
    { episodeId },
    { enabled: !!episodeId }
  );

  const generateMutation = trpc.colorDirector.generate.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      toast.success("Color script generated!");
    },
    onError: (err) => toast.error(`Generation failed: ${err.message}`),
  });

  const approveMutation = trpc.colorDirector.approve.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      toast.success("Color script approved!");
      onApproved?.();
    },
    onError: (err) => toast.error(`Approval failed: ${err.message}`),
  });

  const rejectMutation = trpc.colorDirector.reject.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      toast.success("Color script rejected");
    },
    onError: (err) => toast.error(`Rejection failed: ${err.message}`),
  });

  const lockMutation = trpc.colorDirector.lockPalettes.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      toast.success("Palettes locked");
    },
  });

  const unlockMutation = trpc.colorDirector.unlockPalettes.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      toast.success("Palettes unlocked");
    },
  });

  const updateCharPalette = trpc.colorDirector.updateCharacterPalette.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      setEditingColor(null);
      toast.success("Palette updated");
    },
  });

  const updateScenePalette = trpc.colorDirector.updateScenePalette.useMutation({
    onSuccess: () => {
      utils.colorDirector.getByEpisode.invalidate({ episodeId });
      setEditingColor(null);
      toast.success("Scene palette updated");
    },
  });

  const isLocked = colorScript?.paletteLock?.locked ?? false;
  const canEdit = colorScript && ["generated", "approved"].includes(colorScript.status) && !isLocked;
  const canApprove = colorScript?.status === "generated";
  const canLock = colorScript?.status === "approved";

  // ─── No Color Script Yet ─────────────────────────────────────────
  if (!colorScript && !isLoading) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 rounded-xl border border-white/10 bg-[var(--bg-overlay)]">
          <Palette size={40} className="mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-sm text-[var(--text-muted)] mb-4">
            No color script generated for this episode yet
          </p>
          <motion.button
            onClick={() => generateMutation.mutate({ projectId, episodeId, styleBundleKey })}
            disabled={generateMutation.isPending}
            className={cn(
              "px-6 py-2.5 rounded-xl text-sm font-medium transition-all inline-flex items-center gap-2",
              "bg-gradient-to-r from-[var(--token-cyan)] to-[#7C4DFF] text-white",
              "hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {generateMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Generating...</>
            ) : (
              <><Sparkles size={14} /> Generate Color Script</>
            )}
          </motion.button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-xl skeleton-shimmer" />
        ))}
      </div>
    );
  }

  const characterPalettes = colorScript?.characterPalettes ?? [];
  const scenePalettes = colorScript?.scenePalettes ?? [];
  const moodProgression = colorScript?.moodProgression ?? [];

  return (
    <div className="space-y-4">
      {/* Header with status + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-[var(--token-cyan)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">Color Script</span>
          <StatusBadge status={colorScript!.status} />
        </div>
        <div className="flex items-center gap-2">
          {isLocked && (
            <button
              onClick={() => unlockMutation.mutate({ id: colorScript!.id })}
              className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
              title="Unlock palettes"
            >
              <Unlock size={14} />
            </button>
          )}
          {canLock && (
            <button
              onClick={() => lockMutation.mutate({
                id: colorScript!.id,
                palettes: ["characters", "scenes", "mood"],
              })}
              className="p-1.5 rounded-lg bg-[var(--bg-elevated)] border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="Lock all palettes"
            >
              <Lock size={14} />
            </button>
          )}
          <button
            onClick={() => generateMutation.mutate({ projectId, episodeId, styleBundleKey })}
            disabled={generateMutation.isPending}
            className="p-1.5 rounded-lg bg-[var(--bg-elevated)] border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            title="Regenerate"
          >
            <RefreshCw size={14} className={generateMutation.isPending ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Character Palettes */}
      <CollapsibleSection
        title={`Character Palettes (${characterPalettes.length})`}
        icon={<Eye size={14} />}
        expanded={expandedSection === "characters"}
        onToggle={() => setExpandedSection(expandedSection === "characters" ? null : "characters")}
      >
        <div className="space-y-3">
          {(characterPalettes as any[]).map((cp: any) => (
            <div key={cp.characterId} className="rounded-lg border border-white/5 bg-[var(--bg-elevated)] p-3">
              <p className="text-xs font-medium text-[var(--text-primary)] mb-2">{cp.characterName}</p>
              <div className="flex flex-wrap gap-1.5">
                {["primary", "secondary", "accent", "skin", "hair", "eyes", "outline"].map(field => (
                  <ColorSwatch
                    key={field}
                    label={field}
                    color={cp[field]}
                    editable={!!canEdit}
                    onEdit={(newColor) => {
                      if (colorScript) {
                        updateCharPalette.mutate({
                          colorScriptId: colorScript.id,
                          characterId: cp.characterId,
                          updates: { [field]: newColor },
                        });
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Scene Palettes */}
      <CollapsibleSection
        title={`Scene Palettes (${scenePalettes.length})`}
        icon={<Sun size={14} />}
        expanded={expandedSection === "scenes"}
        onToggle={() => setExpandedSection(expandedSection === "scenes" ? null : "scenes")}
      >
        <div className="space-y-3">
          {(scenePalettes as any[]).map((sp: any) => (
            <div key={sp.sceneNumber} className="rounded-lg border border-white/5 bg-[var(--bg-elevated)] p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-[var(--text-primary)]">Scene {sp.sceneNumber}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <TimeOfDayIcon timeOfDay={sp.timeOfDay} />
                  <span>{sp.timeOfDay}</span>
                  <span className="opacity-50">|</span>
                  <span>{sp.weather}</span>
                </div>
              </div>
              {/* Palette strip */}
              <div className="flex rounded-md overflow-hidden h-6 mb-2">
                {["background", "midground", "foreground", "ambient", "lighting", "accent"].map(field => (
                  <div
                    key={field}
                    className="flex-1 relative group cursor-pointer"
                    style={{ backgroundColor: sp[field] }}
                    title={`${field}: ${sp[field]}`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                      <span className="text-[8px] text-white font-mono">{sp[field]}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {["background", "midground", "foreground", "ambient", "lighting", "accent"].map(field => (
                  <span key={field} className="text-[9px] text-[var(--text-muted)]">{field}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Mood Progression Arc */}
      <CollapsibleSection
        title="Mood Progression"
        icon={<Moon size={14} />}
        expanded={expandedSection === "mood"}
        onToggle={() => setExpandedSection(expandedSection === "mood" ? null : "mood")}
      >
        <MoodArc points={moodProgression as any[]} />
      </CollapsibleSection>

      {/* Approval Gate */}
      {canApprove && (
        <div className="flex gap-2 pt-2">
          <motion.button
            onClick={() => approveMutation.mutate({ id: colorScript!.id })}
            disabled={approveMutation.isPending}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2",
              "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
              "hover:bg-emerald-500/30 disabled:opacity-50"
            )}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <Check size={14} /> Approve Color Script
          </motion.button>
          <motion.button
            onClick={() => {
              const reason = prompt("Reason for rejection:");
              if (reason) rejectMutation.mutate({ id: colorScript!.id, reason });
            }}
            disabled={rejectMutation.isPending}
            className={cn(
              "px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2",
              "bg-red-500/10 text-red-400 border border-red-500/20",
              "hover:bg-red-500/20 disabled:opacity-50"
            )}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <X size={14} /> Reject
          </motion.button>
        </div>
      )}

      {/* Cost info */}
      {colorScript && (
        <p className="text-[10px] text-[var(--text-muted)] text-right">
          Generation cost: ${colorScript.generationCostUsd.toFixed(4)}
        </p>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: "bg-gray-500/10", text: "text-gray-400", label: "Pending" },
    generating: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Generating" },
    generated: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Review" },
    approved: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Approved" },
    rejected: { bg: "bg-red-500/10", text: "text-red-400", label: "Rejected" },
    locked: { bg: "bg-purple-500/10", text: "text-purple-400", label: "Locked" },
  };
  const c = config[status] || config.pending;
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", c.bg, c.text)}>
      {c.label}
    </span>
  );
}

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[var(--bg-overlay)] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          {icon}
          {title}
        </div>
        {expanded ? <ChevronUp size={14} className="text-[var(--text-muted)]" /> : <ChevronDown size={14} className="text-[var(--text-muted)]" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ColorSwatch({
  label,
  color,
  editable,
  onEdit,
}: {
  label: string;
  color: string;
  editable: boolean;
  onEdit: (newColor: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="relative group">
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/5 bg-black/20",
          editable && "cursor-pointer hover:border-white/20"
        )}
        onClick={() => editable && setShowPicker(!showPicker)}
      >
        <div
          className="w-4 h-4 rounded-sm border border-white/10"
          style={{ backgroundColor: color }}
        />
        <span className="text-[9px] text-[var(--text-muted)]">{label}</span>
      </div>
      {showPicker && (
        <div className="absolute top-full left-0 mt-1 z-50 p-2 rounded-lg bg-[var(--bg-elevated)] border border-white/10 shadow-xl">
          <input
            type="color"
            value={color}
            onChange={(e) => {
              onEdit(e.target.value);
              setShowPicker(false);
            }}
            className="w-8 h-8 cursor-pointer"
          />
          <p className="text-[8px] text-[var(--text-muted)] mt-1 font-mono">{color}</p>
        </div>
      )}
    </div>
  );
}

function TimeOfDayIcon({ timeOfDay }: { timeOfDay: string }) {
  switch (timeOfDay) {
    case "dawn":
    case "morning":
    case "noon":
    case "afternoon":
      return <Sun size={10} className="text-amber-400" />;
    case "dusk":
      return <Cloud size={10} className="text-orange-400" />;
    case "night":
      return <Moon size={10} className="text-indigo-400" />;
    default:
      return <Sun size={10} className="text-[var(--text-muted)]" />;
  }
}

function MoodArc({ points }: { points: any[] }) {
  if (!points.length) {
    return <p className="text-xs text-[var(--text-muted)] text-center py-4">No mood data</p>;
  }

  const maxScene = Math.max(...points.map(p => p.sceneNumber));

  return (
    <div className="space-y-3">
      {/* Visual arc */}
      <div className="relative h-24 rounded-lg bg-black/20 border border-white/5 overflow-hidden">
        <svg viewBox={`0 0 ${maxScene * 100} 100`} className="w-full h-full" preserveAspectRatio="none">
          {/* Warmth line */}
          <polyline
            fill="none"
            stroke="#FF6B35"
            strokeWidth="2"
            points={points.map(p => `${p.sceneNumber * 100 - 50},${100 - p.warmth * 100}`).join(" ")}
          />
          {/* Saturation line */}
          <polyline
            fill="none"
            stroke="#7C4DFF"
            strokeWidth="2"
            points={points.map(p => `${p.sceneNumber * 100 - 50},${100 - p.saturation * 100}`).join(" ")}
          />
          {/* Brightness line */}
          <polyline
            fill="none"
            stroke="#FFD700"
            strokeWidth="2"
            points={points.map(p => `${p.sceneNumber * 100 - 50},${100 - p.brightness * 100}`).join(" ")}
          />
          {/* Dominant hue dots */}
          {points.map(p => (
            <circle
              key={p.sceneNumber}
              cx={p.sceneNumber * 100 - 50}
              cy={50}
              r="6"
              fill={p.dominantHue}
              stroke="white"
              strokeWidth="1"
              opacity="0.8"
            />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[10px]">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#FF6B35]" /> Warmth
        </span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#7C4DFF]" /> Saturation
        </span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#FFD700]" /> Brightness
        </span>
      </div>

      {/* Mood labels */}
      <div className="flex flex-wrap gap-1.5">
        {points.map(p => (
          <div
            key={p.sceneNumber}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/5 bg-black/20"
          >
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.dominantHue }} />
            <span className="text-[9px] text-[var(--text-muted)]">
              S{p.sceneNumber}: {p.mood}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
