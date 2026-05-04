import { useState, useRef, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, ChevronLeft, ChevronRight, Share2, Globe, Loader2,
  ArrowLeft, Maximize2, Minimize2, MessageSquare, X, CheckCircle2
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface PanelData {
  id: number;
  sceneNumber: number;
  panelNumber: number;
  imageUrl: string | null;
  visualDescription: string | null;
  cameraAngle: string | null;
  dialogue: any;
  sfx: string | null;
  status: string;
}

export default function CreateReader() {
  const [, params] = useRoute("/create/:projectId/read");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const projectId = params?.projectId ? parseInt(params.projectId) : 0;

  const [currentPanel, setCurrentPanel] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch status and panels
  const { data: status } = trpc.quickCreate.status.useQuery(
    { projectId },
    { enabled: projectId > 0 }
  );

  const firstChapterId = status?.chapters?.[0]?.id;
  const { data: scriptData } = trpc.quickCreate.getScript.useQuery(
    { episodeId: firstChapterId! },
    { enabled: !!firstChapterId }
  );

  const { data: panelsData } = trpc.quickCreate.getPanels.useQuery(
    { projectId, episodeId: firstChapterId },
    { enabled: projectId > 0 }
  );

  const publishMutation = trpc.quickCreate.publish.useMutation({
    onSuccess: () => {
      setPublishSuccess(true);
    },
  });

  const panels: PanelData[] = (panelsData ?? []).filter(
    (p: any) => p.status === "generated" && p.imageUrl
  ) as PanelData[];

  const panel = panels[currentPanel];
  const totalPanels = panels.length;

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setCurrentPanel((p) => Math.min(p + 1, totalPanels - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentPanel((p) => Math.max(p - 1, 0));
      } else if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [totalPanels]);

  const goNext = useCallback(() => {
    if (currentPanel < totalPanels - 1) {
      setCurrentPanel(currentPanel + 1);
    }
  }, [currentPanel, totalPanels]);

  const goPrev = useCallback(() => {
    if (currentPanel > 0) {
      setCurrentPanel(currentPanel - 1);
    }
  }, [currentPanel]);

  // Parse dialogue
  const dialogues = panel?.dialogue
    ? (Array.isArray(panel.dialogue) ? panel.dialogue : [])
    : [];

  if (!status || panels.length === 0) {
    return (
      <div className="min-h-screen bg-[#08080F] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[#E040FB] animate-spin mx-auto mb-4" />
          <p className="text-white/50">Loading your manga...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-[#08080F] flex flex-col ${isFullscreen ? "fixed inset-0 z-50" : ""}`} ref={containerRef}>
      {/* Top bar */}
      {!isFullscreen && (
        <div className="border-b border-white/5 bg-[#08080F]/90 backdrop-blur-xl sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/create/${projectId}`)} className="text-white/40 hover:text-white/70 transition">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-white font-semibold text-lg leading-tight">{status.title}</h1>
                <p className="text-white/40 text-xs">Chapter 1 &middot; Panel {currentPanel + 1} of {totalPanels}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFullscreen(true)}
                className="p-2 rounded-lg bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowPublishModal(true)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#E040FB] to-[#7C4DFF] text-white font-medium text-sm flex items-center gap-2"
              >
                <Globe className="w-4 h-4" /> Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reader area */}
      <div className="flex-1 flex items-center justify-center relative select-none" style={{ minHeight: isFullscreen ? "100vh" : "calc(100vh - 120px)" }}>
        {/* Navigation zones */}
        <button
          onClick={goPrev}
          disabled={currentPanel === 0}
          className="absolute left-0 top-0 bottom-0 w-1/4 z-10 flex items-center justify-start pl-4 opacity-0 hover:opacity-100 transition-opacity disabled:cursor-default"
        >
          {currentPanel > 0 && (
            <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
              <ChevronLeft className="w-6 h-6 text-white" />
            </div>
          )}
        </button>
        <button
          onClick={goNext}
          disabled={currentPanel === totalPanels - 1}
          className="absolute right-0 top-0 bottom-0 w-1/4 z-10 flex items-center justify-end pr-4 opacity-0 hover:opacity-100 transition-opacity disabled:cursor-default"
        >
          {currentPanel < totalPanels - 1 && (
            <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
              <ChevronRight className="w-6 h-6 text-white" />
            </div>
          )}
        </button>

        {/* Panel image */}
        <AnimatePresence mode="wait">
          <motion.div
            key={panel?.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3 }}
            className="relative max-w-3xl w-full mx-auto px-4"
          >
            {panel?.imageUrl && (
              <img
                src={panel.imageUrl}
                alt={`Panel ${panel.sceneNumber}-${panel.panelNumber}`}
                className="w-full rounded-xl shadow-2xl shadow-black/50"
                draggable={false}
              />
            )}

            {/* Dialogue overlay */}
            {dialogues.length > 0 && (
              <div className="absolute bottom-4 left-4 right-4 space-y-2">
                {dialogues.map((d: any, i: number) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.15 }}
                    className="bg-black/70 backdrop-blur-md rounded-lg px-4 py-2 border border-white/10"
                  >
                    <span className="text-[#E040FB] text-xs font-semibold">{d.character}</span>
                    <p className="text-white text-sm">{d.text}</p>
                  </motion.div>
                ))}
              </div>
            )}

            {/* SFX overlay */}
            {panel?.sfx && (
              <motion.div
                initial={{ scale: 0, rotate: -15 }}
                animate={{ scale: 1, rotate: 0 }}
                className="absolute top-4 right-4 bg-[#7C4DFF]/90 text-white font-bold text-lg px-3 py-1 rounded-lg transform rotate-3"
              >
                {panel.sfx}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Fullscreen exit */}
        {isFullscreen && (
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 z-20 p-2 rounded-lg bg-black/50 backdrop-blur text-white/60 hover:text-white transition"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Bottom panel strip */}
      <div className="border-t border-white/5 bg-[#08080F]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {panels.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setCurrentPanel(i)}
                className={`flex-shrink-0 w-16 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                  i === currentPanel
                    ? "border-[#7C4DFF] shadow-lg shadow-[#7C4DFF]/25 scale-105"
                    : "border-white/10 opacity-50 hover:opacity-80"
                }`}
              >
                {p.imageUrl && (
                  <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Publish modal */}
      <AnimatePresence>
        {showPublishModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onClick={() => { setShowPublishModal(false); setPublishSuccess(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#12121A] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {publishSuccess ? (
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring" }}
                    className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4"
                  >
                    <CheckCircle2 className="w-8 h-8 text-green-400" />
                  </motion.div>
                  <h2 className="text-2xl font-bold text-white mb-2">Published!</h2>
                  <p className="text-white/50 mb-6">
                    Your manga is now live on the Discover page. Share it with the community!
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => navigate("/discover")}
                      className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition"
                    >
                      View on Discover
                    </button>
                    <button
                      onClick={() => { setShowPublishModal(false); setPublishSuccess(false); }}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#E040FB] to-[#7C4DFF] text-white font-medium"
                    >
                      Keep Reading
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="w-14 h-14 rounded-full bg-[#6C63FF]/10 flex items-center justify-center mx-auto mb-4">
                    <Globe className="w-7 h-7 text-[#6C63FF]" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Publish to Community</h2>
                  <p className="text-white/50 mb-6">
                    Make your manga visible on the Discover page. Other users can read and comment on it.
                  </p>
                  <button
                    onClick={() => publishMutation.mutate({ projectId })}
                    disabled={publishMutation.isPending}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-[#E040FB] to-[#7C4DFF] text-white font-semibold text-lg shadow-lg shadow-[#7C4DFF]/25 hover:shadow-[#7C4DFF]/40 transition-all disabled:opacity-50"
                  >
                    {publishMutation.isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" /> Publishing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Share2 className="w-5 h-5" /> Publish Now
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setShowPublishModal(false)}
                    className="mt-3 text-white/40 hover:text-white/60 text-sm transition"
                  >
                    Not yet
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
