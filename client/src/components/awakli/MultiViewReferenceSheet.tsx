/**
 * Wave 2 Item 2: Multi-View Reference Sheet Component
 *
 * Displays a 4-panel grid (front, three-quarter, side, back) with:
 * - CLIP scores per view
 * - Per-view approve/reject
 * - Full-sheet approval gate
 * - Regeneration controls
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Check, X, RefreshCw, Loader2, Sparkles, Eye,
  ChevronDown, ChevronUp, AlertTriangle, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────

interface ViewData {
  id: number;
  viewAngle: string;
  imageUrl: string | null;
  clipScore: number | null;
  status: string;
  attemptNumber: number;
  generationCostUsd: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

interface GateData {
  id: number;
  status: string;
  overallClipScore: number | null;
  totalCostUsd: number | null;
  totalAttempts: number;
  approvedAt: Date | null;
  rejectedReason: string | null;
}

interface Props {
  characterId: number;
  projectId: number;
  characterName: string;
  styleBundleKey?: string;
  onApproved?: () => void;
}

// ─── View Labels ──────────────────────────────────────────────────────

const VIEW_LABELS: Record<string, { label: string; shortLabel: string }> = {
  front: { label: "Front View", shortLabel: "Front" },
  three_quarter: { label: "Three-Quarter View", shortLabel: "3/4" },
  side: { label: "Side Profile", shortLabel: "Side" },
  back: { label: "Back View", shortLabel: "Back" },
};

const VIEW_ORDER = ["front", "three_quarter", "side", "back"];

// ─── CLIP Score Badge ─────────────────────────────────────────────────

function ClipScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;

  const color =
    score >= 0.85 ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" :
    score >= 0.7 ? "text-amber-400 border-amber-400/30 bg-amber-400/10" :
    "text-red-400 border-red-400/30 bg-red-400/10";

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border",
      color,
    )}>
      <Shield size={8} />
      {(score * 100).toFixed(0)}%
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "text-gray-400 bg-gray-400/10 border-gray-400/30" },
    generating: { label: "Generating...", className: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
    generated: { label: "Generated", className: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30" },
    approved: { label: "Approved", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
    rejected: { label: "Rejected", className: "text-red-400 bg-red-400/10 border-red-400/30" },
    failed: { label: "Failed", className: "text-red-400 bg-red-400/10 border-red-400/30" },
  };

  const c = config[status] ?? config.pending;
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border", c.className)}>
      {c.label}
    </span>
  );
}

// ─── Single View Panel ────────────────────────────────────────────────

function ViewPanel({
  view,
  onApprove,
  onReject,
  onRegenerate,
  isRegenerating,
  gateApproved,
}: {
  view: ViewData;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  gateApproved: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const label = VIEW_LABELS[view.viewAngle] ?? { label: view.viewAngle, shortLabel: view.viewAngle };

  return (
    <motion.div
      className={cn(
        "relative rounded-xl border overflow-hidden transition-all",
        view.status === "approved" ? "border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]" :
        view.status === "rejected" ? "border-red-500/40" :
        "border-white/10 hover:border-white/20",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Image */}
      <div className="aspect-[3/4] bg-[var(--bg-elevated)] relative">
        {view.status === "generating" || isRegenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 size={24} className="animate-spin text-[var(--token-cyan)]" />
            <span className="text-xs text-[var(--text-muted)]">Generating...</span>
          </div>
        ) : view.imageUrl ? (
          <img
            src={view.imageUrl}
            alt={`${label.label}`}
            className={cn(
              "w-full h-full object-cover transition-all",
              view.status === "rejected" && "opacity-40 grayscale",
            )}
          />
        ) : view.status === "failed" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <AlertTriangle size={24} className="text-red-400" />
            <span className="text-xs text-red-400">Generation failed</span>
            {view.errorMessage && (
              <span className="text-[10px] text-red-400/60 px-3 text-center line-clamp-2">
                {view.errorMessage}
              </span>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Eye size={24} className="text-[var(--text-muted)]" />
          </div>
        )}

        {/* Hover overlay with actions */}
        <AnimatePresence>
          {hovered && view.imageUrl && !gateApproved && (
            <motion.div
              className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {view.status !== "approved" && (
                <button
                  onClick={onApprove}
                  className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  title="Approve this view"
                >
                  <Check size={16} />
                </button>
              )}
              {view.status !== "rejected" && (
                <button
                  onClick={onReject}
                  className="p-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors"
                  title="Reject this view"
                >
                  <X size={16} />
                </button>
              )}
              <button
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                title="Regenerate this view"
              >
                <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="p-2 bg-[var(--bg-overlay)] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--text-secondary)]">{label.shortLabel}</span>
          <StatusBadge status={view.status} />
        </div>
        <ClipScoreBadge score={view.clipScore} />
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export default function MultiViewReferenceSheet({
  characterId,
  projectId,
  characterName,
  styleBundleKey,
  onApproved,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [regeneratingViewId, setRegeneratingViewId] = useState<number | null>(null);

  // Queries
  const { data: status, refetch } = trpc.characterDesigner.getStatus.useQuery(
    { characterId },
    { refetchInterval: (query) => {
      // Auto-refetch while generating
      const gate = query.state.data?.gate;
      if (gate?.status === "pending") return 3000;
      return false;
    }},
  );

  // Mutations
  const generateMutation = trpc.characterDesigner.generateViews.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Multi-view reference sheet generated!");
    },
    onError: (err) => toast.error(err.message),
  });

  const approveMutation = trpc.characterDesigner.approveSheet.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Reference sheet approved! Character is ready for downstream agents.");
      onApproved?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = trpc.characterDesigner.rejectSheet.useMutation({
    onSuccess: () => {
      refetch();
      toast.info("Reference sheet rejected. You can regenerate views.");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateViewMutation = trpc.characterDesigner.updateViewStatus.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast.error(err.message),
  });

  const regenerateViewMutation = trpc.characterDesigner.regenerateView.useMutation({
    onSuccess: () => {
      setRegeneratingViewId(null);
      refetch();
      toast.success("View regenerated!");
    },
    onError: (err) => {
      setRegeneratingViewId(null);
      toast.error(err.message);
    },
  });

  const gate = status?.gate;
  const views = status?.views ?? [];
  const isGenerating = generateMutation.isPending;
  const gateApproved = gate?.status === "approved";

  // Sort views by canonical order
  const sortedViews = [...views].sort(
    (a, b) => VIEW_ORDER.indexOf(a.viewAngle) - VIEW_ORDER.indexOf(b.viewAngle)
  );

  const handleGenerate = () => {
    generateMutation.mutate({
      characterId,
      projectId,
      styleBundleKey,
    });
  };

  const handleApproveSheet = () => {
    approveMutation.mutate({ characterId });
  };

  const handleRejectSheet = () => {
    const reason = prompt("Why are you rejecting this reference sheet?");
    if (reason) {
      rejectMutation.mutate({ characterId, reason });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5">
          <Eye size={12} />
          Multi-View Reference Sheet
          {gate && (
            <StatusBadge status={gate.status} />
          )}
        </h4>
        {gate && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-0.5"
          >
            Details {showDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>

      {/* Details panel */}
      <AnimatePresence>
        {showDetails && gate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-white/10 bg-[var(--bg-elevated)] p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Overall CLIP Score</span>
                <ClipScoreBadge score={gate.overallClipScore} />
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Total Cost</span>
                <span className="text-[var(--text-secondary)] font-mono">
                  ${gate.totalCostUsd?.toFixed(2) ?? "0.00"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Generation Attempts</span>
                <span className="text-[var(--text-secondary)]">{gate.totalAttempts}</span>
              </div>
              {gate.rejectedReason && (
                <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                  <span className="text-red-400">Rejection reason: {gate.rejectedReason}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* View Grid */}
      {views.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {sortedViews.map((view) => (
              <ViewPanel
                key={view.id}
                view={view}
                gateApproved={gateApproved}
                isRegenerating={regeneratingViewId === view.id}
                onApprove={() => updateViewMutation.mutate({ viewId: view.id, status: "approved" })}
                onReject={() => updateViewMutation.mutate({ viewId: view.id, status: "rejected" })}
                onRegenerate={() => {
                  setRegeneratingViewId(view.id);
                  regenerateViewMutation.mutate({ viewId: view.id });
                }}
              />
            ))}
          </div>

          {/* Sheet-level actions */}
          {!gateApproved && gate?.status === "all_views_generated" && (
            <div className="flex gap-2">
              <Button
                onClick={handleApproveSheet}
                disabled={approveMutation.isPending}
                className="flex-1 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30"
                size="sm"
              >
                {approveMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin mr-1" />
                ) : (
                  <Check size={14} className="mr-1" />
                )}
                Approve All Views
              </Button>
              <Button
                onClick={handleRejectSheet}
                disabled={rejectMutation.isPending}
                variant="outline"
                className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                size="sm"
              >
                <X size={14} className="mr-1" />
                Reject
              </Button>
            </div>
          )}

          {/* Regenerate all after rejection */}
          {gate?.status === "rejected" && (
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full bg-gradient-to-r from-[var(--token-cyan)] to-[#7C4DFF] text-white"
              size="sm"
            >
              {isGenerating ? (
                <Loader2 size={14} className="animate-spin mr-1" />
              ) : (
                <RefreshCw size={14} className="mr-1" />
              )}
              Regenerate All Views
            </Button>
          )}

          {/* Approved badge */}
          {gateApproved && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Shield size={16} className="text-emerald-400" />
              <div>
                <p className="text-xs font-medium text-emerald-400">Reference Sheet Approved</p>
                <p className="text-[10px] text-emerald-400/60">
                  Character views are locked and available for downstream pipeline agents.
                </p>
              </div>
            </div>
          )}
        </>
      ) : isGenerating ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {VIEW_ORDER.map(angle => (
              <div key={angle} className="aspect-[3/4] rounded-xl skeleton-shimmer" />
            ))}
          </div>
          <p className="text-xs text-center text-[var(--text-muted)]">
            Generating {characterName}'s multi-view reference sheet...
          </p>
        </div>
      ) : (
        <div className="text-center py-6">
          <div className="grid grid-cols-4 gap-1 mb-3 mx-auto max-w-[200px]">
            {VIEW_ORDER.map(angle => (
              <div key={angle} className="aspect-[3/4] rounded bg-white/5 border border-dashed border-white/10 flex items-center justify-center">
                <span className="text-[8px] text-[var(--text-muted)]">
                  {VIEW_LABELS[angle]?.shortLabel}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Generate a 4-view reference sheet with CLIP validation
          </p>
        </div>
      )}

      {/* Generate button (when no views exist yet) */}
      {views.length === 0 && !isGenerating && (
        <motion.button
          onClick={handleGenerate}
          className={cn(
            "w-full py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2",
            "bg-gradient-to-r from-[var(--token-cyan)] to-[#7C4DFF] text-white",
            "hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Sparkles size={14} />
          Generate Multi-View Reference Sheet
        </motion.button>
      )}
    </div>
  );
}
