import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ChevronDown, ChevronRight, Plus, Sparkles, Loader2,
  FileText, Lock, Check, RefreshCw, AlertTriangle,
  Camera, MessageSquare, Volume2, ArrowRightLeft,
  BookOpen, Clock, Layers,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import TransitionTimeline from "@/components/awakli/TransitionTimeline";
import ColorScriptViewer from "@/components/awakli/ColorScriptViewer";

// ─── Types ────────────────────────────────────────────────────────────────

interface PanelDialogue {
  character: string;
  text: string;
  emotion: string;
}

interface ScriptPanel {
  panel_number: number;
  visual_description: string;
  camera_angle: string;
  dialogue: PanelDialogue[];
  sfx: string | null;
  transition: string | null;
}

interface ScriptScene {
  scene_number: number;
  location: string;
  time_of_day: string;
  mood: string;
  description: string;
  panels: ScriptPanel[];
}

interface ScriptContent {
  episode_title: string;
  synopsis: string;
  scenes: ScriptScene[];
}

// ─── Episode List Panel ───────────────────────────────────────────────────

function EpisodeListPanel({
  projectId,
  activeEpisodeId,
  onSelect,
}: {
  projectId: number;
  activeEpisodeId: number | null;
  onSelect: (id: number) => void;
}) {
  const { data: episodes, isLoading, refetch } = trpc.episodes.listByProject.useQuery({ projectId });
  const generateMutation = trpc.episodes.generateScript.useMutation();
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    const nextEpNum = (episodes?.length ?? 0) + 1;
    setGenerating(true);
    try {
      const result = await generateMutation.mutateAsync({
        projectId,
        episodeNumbers: [nextEpNum],
      });
      toast.success(`Generating Episode ${nextEpNum}...`);
      // Poll for completion
      const pollInterval = setInterval(async () => {
        await refetch();
      }, 3000);
      setTimeout(() => clearInterval(pollInterval), 60000);
    } catch {
      toast.error("Failed to start script generation");
    } finally {
      setGenerating(false);
    }
  };

  const statusColors: Record<string, string> = {
    draft: "text-[var(--text-muted)]",
    generating: "text-[var(--token-gold)]",
    generated: "text-[var(--token-cyan)]",
    approved: "text-[var(--status-success)]",
    locked: "text-[var(--status-success)]",
  };

  return (
    <div className="w-72 shrink-0 border-r border-white/5 bg-[var(--bg-base)] flex flex-col h-full">
      <div className="p-4 border-b border-white/5">
        <h3 className="text-sm font-heading font-semibold text-[var(--text-primary)]">Episodes</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-lg skeleton-shimmer" />
            ))}
          </div>
        )}

        {episodes?.map((ep) => (
          <motion.button
            key={ep.id}
            onClick={() => onSelect(ep.id)}
            className={cn(
              "w-full text-left p-3 rounded-lg border transition-all",
              activeEpisodeId === ep.id
                ? "bg-[var(--bg-elevated)] border-l-2 border-l-[var(--token-cyan)] border-t-white/5 border-r-white/5 border-b-white/5"
                : "bg-transparent border-white/5 hover:bg-[var(--bg-elevated)]/50"
            )}
            whileHover={{ x: 2 }}
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-2xl font-bold text-[var(--text-muted)]">
                {String(ep.episodeNumber).padStart(2, "0")}
              </span>
              <span className={cn("text-xs font-medium capitalize", statusColors[ep.status] || "text-[var(--text-muted)]")}>
                {ep.status === "generating" && <Loader2 size={10} className="inline animate-spin mr-1" />}
                {ep.status === "locked" && <Lock size={10} className="inline mr-1" />}
                {ep.status}
              </span>
            </div>
            <p className="text-sm text-[var(--text-primary)] mt-1 truncate">{ep.title}</p>
            {ep.panelCount ? (
              <p className="text-xs text-[var(--text-muted)] mt-1">{ep.panelCount} panels</p>
            ) : null}
          </motion.button>
        ))}
      </div>

      <div className="p-3 border-t border-white/5">
        <motion.button
          onClick={handleGenerate}
          disabled={generating || generateMutation.isPending}
          className={cn(
            "w-full p-3 rounded-lg border-2 border-dashed border-white/10 text-sm font-medium",
            "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--token-cyan)]/30",
            "flex items-center justify-center gap-2 transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          {generating || generateMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Generate New Episode
        </motion.button>
      </div>
    </div>
  );
}

// ─── Panel Card ───────────────────────────────────────────────────────────

function PanelCard({ panel, onRewrite }: { panel: ScriptPanel; onRewrite: (field: string, text: string) => void }) {
  const [hoveredField, setHoveredField] = useState<string | null>(null);

  const cameraIcons: Record<string, string> = {
    "wide": "🎬",
    "medium": "📷",
    "close-up": "🔍",
    "extreme-close-up": "👁️",
    "birds-eye": "🦅",
  };

  return (
    <motion.div
      className="rounded-xl border border-white/10 bg-[var(--bg-elevated)] overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex">
        {/* Left: Image placeholder */}
        <div className="w-[120px] h-auto min-h-[90px] shrink-0 bg-[var(--bg-overlay)] flex items-center justify-center border-r border-white/5">
          <div className="text-center">
            <Camera size={20} className="mx-auto text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)] mt-1 block">Panel {panel.panel_number}</span>
          </div>
        </div>

        {/* Right: Content */}
        <div className="flex-1 p-3 space-y-3">
          {/* Visual description */}
          <div
            className="relative group"
            onMouseEnter={() => setHoveredField("visual")}
            onMouseLeave={() => setHoveredField(null)}
          >
            <p className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-overlay)] p-2 rounded-lg leading-relaxed">
              {panel.visual_description}
            </p>
            <AnimatePresence>
              {hoveredField === "visual" && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => onRewrite("visualDescription", panel.visual_description)}
                  className="absolute -top-2 -right-2 p-1.5 rounded-full bg-[var(--token-cyan)] text-white shadow-lg"
                  title="Rewrite with AI"
                >
                  <Sparkles size={10} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Dialogue */}
          {panel.dialogue.length > 0 && (
            <div className="space-y-1.5">
              {panel.dialogue.map((d, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 group relative"
                  onMouseEnter={() => setHoveredField(`dialogue-${i}`)}
                  onMouseLeave={() => setHoveredField(null)}
                >
                  <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[var(--token-cyan)]/15 text-[var(--token-cyan)]">
                    {d.character}
                  </span>
                  <span className="text-xs text-[var(--text-primary)] flex-1">"{d.text}"</span>
                  <span className="text-[10px] text-[var(--text-muted)] italic shrink-0">{d.emotion}</span>
                  <AnimatePresence>
                    {hoveredField === `dialogue-${i}` && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => onRewrite("dialogue", d.text)}
                        className="absolute -top-1 -right-1 p-1 rounded-full bg-[var(--token-cyan)] text-white shadow-lg"
                        title="Rewrite with AI"
                      >
                        <Sparkles size={8} />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <Camera size={10} />
              {cameraIcons[panel.camera_angle] || ""} {panel.camera_angle}
            </span>
            {panel.sfx && (
              <span className="flex items-center gap-1">
                <Volume2 size={10} />
                {panel.sfx}
              </span>
            )}
            {panel.transition && (
              <span className="flex items-center gap-1">
                <ArrowRightLeft size={10} />
                {panel.transition}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Editor ──────────────────────────────────────────────────────────

export default function ScriptEditor() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const [activeEpisodeId, setActiveEpisodeId] = useState<number | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showColorPanel, setShowColorPanel] = useState(false);

  const { data: episode, isLoading: episodeLoading, refetch: refetchEpisode } = trpc.episodes.get.useQuery(
    { id: activeEpisodeId! },
    { enabled: !!activeEpisodeId, refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "generating" ? 3000 : false;
    }},
  );

  const approveMutation = trpc.episodes.approveScript.useMutation();
  const rewriteMutation = trpc.panels.aiRewrite.useMutation();

  const script = episode?.scriptContent as ScriptContent | null;

  const wordCount = useMemo(() => {
    if (!script) return 0;
    let count = 0;
    for (const scene of script.scenes) {
      count += scene.description.split(/\s+/).length;
      for (const panel of scene.panels) {
        count += panel.visual_description.split(/\s+/).length;
        for (const d of panel.dialogue) {
          count += d.text.split(/\s+/).length;
        }
      }
    }
    return count;
  }, [script]);

  const panelCount = useMemo(() => {
    if (!script) return 0;
    return script.scenes.reduce((acc, s) => acc + s.panels.length, 0);
  }, [script]);

  const handleRewrite = async (field: string, currentText: string) => {
    try {
      const result = await rewriteMutation.mutateAsync({
        panelId: 0, // Not saving to DB, just getting rewrite
        field: field === "visualDescription" ? "visualDescription" : "dialogue",
        currentText,
      });
      toast.success("Text rewritten! (Preview only — save to apply)");
      // In a full implementation, this would update the local state
    } catch {
      toast.error("AI rewrite failed");
    }
  };

  const handleApprove = async () => {
    if (!activeEpisodeId) return;
    try {
      await approveMutation.mutateAsync({ id: activeEpisodeId });
      toast.success("Script approved and locked!");
      setShowApproveModal(false);
      refetchEpisode();
    } catch {
      toast.error("Failed to approve script");
    }
  };

  const timeBadgeColors: Record<string, string> = {
    day: "bg-[var(--token-gold)]/15 text-[var(--token-gold)]",
    night: "bg-[#6C5CE7]/15 text-[#6C5CE7]",
    dawn: "bg-[#B388FF]/15 text-[#B388FF]",
    dusk: "bg-[#7C4DFF]/15 text-[#E040FB]",
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Episode list */}
      <EpisodeListPanel
        projectId={projectId}
        activeEpisodeId={activeEpisodeId}
        onSelect={setActiveEpisodeId}
      />

      {/* Main editor area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!activeEpisodeId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <FileText size={48} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-lg text-[var(--text-secondary)]">Select an episode to edit</p>
              <p className="text-sm text-[var(--text-muted)]">Or generate a new one from the sidebar</p>
            </div>
          </div>
        ) : episodeLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-[var(--token-cyan)]" />
          </div>
        ) : episode?.status === "generating" ? (
          <div className="flex-1 flex items-center justify-center">
            <motion.div
              className="text-center space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <Sparkles size={48} className="mx-auto text-[var(--token-gold)]" />
              </motion.div>
              <p className="text-lg text-[var(--text-primary)]">Generating script...</p>
              <p className="text-sm text-[var(--text-muted)]">AI is crafting your episode. This may take a moment.</p>
              <div className="w-48 mx-auto h-1 rounded-full bg-[var(--bg-overlay)] overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[var(--token-cyan)] to-[var(--token-cyan)]"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  style={{ width: "50%" }}
                />
              </div>
            </motion.div>
          </div>
        ) : !script ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <BookOpen size={48} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-lg text-[var(--text-secondary)]">No script content yet</p>
              <p className="text-sm text-[var(--text-muted)]">This episode is in draft state</p>
            </div>
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-h2 text-[var(--text-primary)]">{script.episode_title}</h2>
                <span className={cn(
                  "px-2 py-0.5 rounded-md text-xs font-medium capitalize",
                  episode?.status === "locked"
                    ? "bg-[var(--status-success)]/15 text-[var(--status-success)]"
                    : "bg-[var(--token-cyan)]/15 text-[var(--token-cyan)]"
                )}>
                  {episode?.status === "locked" && <Lock size={10} className="inline mr-1" />}
                  {episode?.status}
                </span>
              </div>
            </div>

            {/* Synopsis */}
            {script.synopsis && (
              <div className="px-6 py-3 border-b border-white/5 bg-[var(--bg-base)]">
                <p className="text-sm text-[var(--text-secondary)] italic">{script.synopsis}</p>
              </div>
            )}

            {/* Transition Timeline */}
            {activeEpisodeId && (
              <div className="px-6 pt-4">
                <TransitionTimeline episodeId={activeEpisodeId} compact />
              </div>
            )}

            {/* Scenes accordion */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <Accordion type="multiple" defaultValue={script.scenes.map(s => `scene-${s.scene_number}`)}>
                {script.scenes.map((scene) => (
                  <AccordionItem key={scene.scene_number} value={`scene-${scene.scene_number}`} className="border-white/5">
                    <AccordionTrigger className="hover:no-underline py-4">
                      <div className="flex items-center gap-3 text-left">
                        <span className="font-heading font-semibold text-[var(--text-primary)]">
                          Scene {scene.scene_number}: {scene.location}
                        </span>
                        <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-medium", timeBadgeColors[scene.time_of_day] || "bg-white/10 text-[var(--text-muted)]")}>
                          {scene.time_of_day}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/5 text-[var(--text-muted)]">
                          {scene.mood}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="text-sm text-[var(--text-secondary)] mb-4 pl-1">{scene.description}</p>
                      <div className="space-y-3">
                        {scene.panels.map((panel) => (
                          <PanelCard
                            key={panel.panel_number}
                            panel={panel}
                            onRewrite={handleRewrite}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-white/5 bg-[var(--bg-base)] shrink-0">
              <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <BookOpen size={12} />
                  {wordCount.toLocaleString()} words
                </span>
                <span className="flex items-center gap-1">
                  <Layers size={12} />
                  {panelCount} panels
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  ~{Math.ceil(panelCount * 0.5)} min
                </span>
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={() => setShowColorPanel(!showColorPanel)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    showColorPanel
                      ? "bg-[var(--token-cyan)]/20 text-[var(--token-cyan)] border border-[var(--token-cyan)]/30"
                      : "bg-[var(--bg-elevated)] border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Color Script
                </motion.button>
                {episode?.status !== "locked" && (
                  <motion.button
                    onClick={() => setShowApproveModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--token-cyan)] text-white hover:bg-[var(--token-violet-hover)] transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Check size={14} />
                    Approve Script
                  </motion.button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Color Script Side Panel */}
      <AnimatePresence>
        {showColorPanel && activeEpisodeId && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-l border-white/5 bg-[var(--bg-base)] overflow-y-auto overflow-x-hidden shrink-0"
          >
            <div className="p-4 w-[320px]">
              <ColorScriptViewer
                projectId={projectId}
                episodeId={activeEpisodeId}
                onApproved={() => toast.success("Color script approved for pipeline!")}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Approve confirmation modal */}
      <Dialog open={showApproveModal} onOpenChange={setShowApproveModal}>
        <DialogContent className="bg-[var(--bg-elevated)] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)]">Lock this script for production?</DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              Once approved, this script will be locked and cannot be edited. Panel images can then be generated from the locked script.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowApproveModal(false)} className="border-white/10 text-[var(--text-secondary)]">
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="bg-[var(--token-cyan)] text-white hover:bg-[var(--token-violet-hover)]"
            >
              {approveMutation.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : <Lock size={14} className="mr-2" />}
              Approve & Lock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
