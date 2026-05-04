import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import {
  Play, Pause, SkipForward, SkipBack, ChevronLeft, ChevronRight,
  ThumbsUp, ThumbsDown, MessageSquare, Share2, Maximize, Minimize,
  ArrowLeft, Film, Clock, Eye, BookOpen, Send, Trash2, ChevronDown
} from "lucide-react";
import { SEOHead, buildEpisodeJsonLd } from "@/components/awakli/SEOHead";

// ─── Typewriter Effect ─────────────────────────────────────────────────────
function TypewriterText({ text, speed = 40 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);
  return <span>{displayed}<span className="animate-pulse">|</span></span>;
}

// ─── Panel type ────────────────────────────────────────────────────────────
interface PanelData {
  id: number;
  sceneNumber: number;
  panelNumber: number;
  imageUrl: string | null;
  rawImageUrl?: string | null;
  visualDescription: string | null;
  cameraAngle: string | null;
  dialogue: unknown;
  sfx: string | null;
  transition: string | null;
}

export default function EpisodePlayer() {
  const params = useParams<{ slug: string; episodeNumber: string }>();
  const slug = params.slug || "";
  const episodeNumber = parseInt(params.episodeNumber || "1", 10);
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  // Fetch episode data via watch.project to get episode list, then find the right episode
  const projectQuery = trpc.watch.project.useQuery({ slug }, { enabled: !!slug });
  const project = projectQuery.data;
  const episodes = project?.episodes ?? [];
  const currentEpisode = episodes.find((ep: any) => ep.episodeNumber === episodeNumber);

  const storyboard = trpc.watch.storyboard.useQuery(
    { episodeId: currentEpisode?.id ?? 0 },
    { enabled: !!currentEpisode?.id }
  );

  const panels: PanelData[] = (storyboard.data?.panels ?? []) as PanelData[];

  // Record view on page load
  const recordView = trpc.publicContent.recordView.useMutation();
  const [viewRecorded, setViewRecorded] = useState(false);
  useEffect(() => {
    if (currentEpisode?.id && !viewRecorded) {
      recordView.mutate({
        contentType: "anime_episode",
        contentId: currentEpisode.id,
        source: "direct",
      });
      setViewRecorded(true);
    }
  }, [currentEpisode?.id, viewRecorded]);

  // Build JSON-LD for this episode
  const episodeJsonLd = useMemo(() => {
    if (!project || !currentEpisode) return undefined;
    return buildEpisodeJsonLd({
      title: currentEpisode.title || `Episode ${episodeNumber}`,
      description: currentEpisode.synopsis,
      thumbnailUrl: project.coverImageUrl,
      projectTitle: project.title,
      projectSlug: slug,
      episodeNumber,
      duration: panels.length * 4, // ~4 seconds per panel estimate
    });
  }, [project, currentEpisode, slug, episodeNumber, panels.length]);

  // Player state
  const [currentPanel, setCurrentPanel] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const playerRef = useRef<HTMLDivElement>(null);

  // Auto-advance
  useEffect(() => {
    if (!isPlaying || panels.length === 0) return;
    const timer = setInterval(() => {
      setCurrentPanel((prev) => {
        if (prev >= panels.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [isPlaying, panels.length]);

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [resetControlsTimer]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowRight": setCurrentPanel((p) => Math.min(p + 1, panels.length - 1)); break;
        case "ArrowLeft": setCurrentPanel((p) => Math.max(p - 1, 0)); break;
        case " ": e.preventDefault(); setIsPlaying((p) => !p); break;
        case "f": toggleFullscreen(); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panels.length]);

  const toggleFullscreen = () => {
    if (!playerRef.current) return;
    if (!document.fullscreenElement) {
      playerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const panel = panels[currentPanel];
  const dialogue = panel?.dialogue as Array<{ character: string; text: string; emotion: string }> | null;

  // Navigation
  const prevEpisode = episodes.find((ep: any) => ep.episodeNumber === episodeNumber - 1);
  const nextEpisode = episodes.find((ep: any) => ep.episodeNumber === episodeNumber + 1);

  if (projectQuery.isLoading || storyboard.isLoading) {
    return (
      <div className="min-h-screen bg-bg-void flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-2 border-token-violet/30 border-t-token-violet animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading episode...</p>
        </div>
      </div>
    );
  }

  if (!currentEpisode || !project) {
    return (
      <div className="min-h-screen bg-bg-void flex items-center justify-center">
        <div className="text-center">
          <Film className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h1 className="text-2xl font-display font-bold text-white mb-2">Episode Not Found</h1>
          <Link href={`/watch/${slug}`}>
            <button className="px-6 py-3 rounded-xl bg-token-violet text-white font-semibold mt-4">
              Back to Project
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-void text-white">
      {/* SEO: Dynamic meta tags for social sharing */}
      {project && currentEpisode && (
        <SEOHead
          title={`${project.title} - Ep ${episodeNumber}: ${currentEpisode.title || `Episode ${episodeNumber}`}`}
          description={currentEpisode.synopsis || `Watch Episode ${episodeNumber} of ${project.title} on Awakli`}
          image={project.coverImageUrl || undefined}
          url={`${window.location.origin}/watch/${slug}/${episodeNumber}`}
          type="video.other"
          jsonLd={episodeJsonLd}
        />
      )}

      {/* Player */}
      <div
        ref={playerRef}
        className="relative bg-black aspect-video max-h-[75vh] w-full overflow-hidden cursor-pointer"
        onMouseMove={resetControlsTimer}
        onClick={() => { if (panels.length > 0) setIsPlaying((p) => !p); }}
      >
        {/* Panel display */}
        <AnimatePresence mode="wait">
          {panel?.imageUrl ? (
            <motion.img
              key={panel.id}
              src={panel.imageUrl}
              alt={panel.visualDescription || "Panel"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-1 to-surface-2"
            >
              <div className="text-center">
                <BookOpen className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">{panels.length === 0 ? "No panels generated yet" : "Panel image not available"}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dialogue overlay */}
        {dialogue && dialogue.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 max-w-2xl w-full px-4"
          >
            <div className="bg-black/80 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              {dialogue.map((d, i) => (
                <div key={i} className="mb-1 last:mb-0">
                  <span className="text-token-violet font-semibold text-sm">{d.character}: </span>
                  <span className="text-white text-sm">
                    {isPlaying ? <TypewriterText text={d.text} /> : d.text}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* SFX overlay */}
        {panel?.sfx && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-8 right-8 px-4 py-2 bg-token-violet/80 rounded-lg font-display font-bold text-lg transform rotate-[-5deg]"
          >
            {panel.sfx}
          </motion.div>
        )}

        {/* Controls overlay */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar */}
              <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between pointer-events-auto">
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/watch/${slug}`); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 text-white hover:bg-black/60 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-sm">{project.title}</span>
                </button>
                <span className="text-sm text-gray-300 bg-black/40 px-3 py-1.5 rounded-lg">
                  Ep {episodeNumber}: {currentEpisode.title}
                </span>
              </div>

              {/* Bottom controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-white/20 rounded-full mb-3 cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    setCurrentPanel(Math.round(pct * (panels.length - 1)));
                  }}
                >
                  <div
                    className="h-full bg-gradient-to-r from-token-violet to-token-cyan rounded-full transition-all duration-300"
                    style={{ width: panels.length > 0 ? `${((currentPanel + 1) / panels.length) * 100}%` : "0%" }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {prevEpisode && (
                      <button onClick={() => navigate(`/watch/${slug}/${prevEpisode.episodeNumber}`)} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                        <SkipBack className="w-5 h-5" />
                      </button>
                    )}
                    <button onClick={() => setCurrentPanel((p) => Math.max(p - 1, 0))} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setIsPlaying((p) => !p)}
                      className="w-12 h-12 rounded-full bg-token-violet/90 flex items-center justify-center hover:bg-token-violet transition-colors"
                    >
                      {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
                    </button>
                    <button onClick={() => setCurrentPanel((p) => Math.min(p + 1, panels.length - 1))} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    {nextEpisode && (
                      <button onClick={() => navigate(`/watch/${slug}/${nextEpisode.episodeNumber}`)} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                        <SkipForward className="w-5 h-5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-300">
                      {currentPanel + 1} / {panels.length}
                    </span>
                    <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                      {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* End screen */}
        {currentPanel >= panels.length - 1 && !isPlaying && panels.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h3 className="text-2xl font-display font-bold mb-4">Episode Complete</h3>
              <div className="flex gap-3 justify-center">
                {nextEpisode ? (
                  <button
                    onClick={() => navigate(`/watch/${slug}/${nextEpisode.episodeNumber}`)}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-token-violet to-token-lavender text-white font-semibold flex items-center gap-2"
                  >
                    <SkipForward className="w-5 h-5" />
                    Next Episode
                  </button>
                ) : (
                  <Link href={`/watch/${slug}`}>
                    <button className="px-6 py-3 rounded-xl bg-white/10 text-white font-semibold">
                      Back to Project
                    </button>
                  </Link>
                )}
                <button
                  onClick={() => { setCurrentPanel(0); setIsPlaying(true); }}
                  className="px-6 py-3 rounded-xl border border-white/10 text-white font-semibold"
                >
                  Replay
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Below player: Voting, Comments, Episode info */}
      <div className="container py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left: Episode info + comments */}
          <div className="lg:col-span-2 space-y-8">
            {/* Episode title and voting */}
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold mb-2">
                Episode {episodeNumber}: {currentEpisode.title}
              </h1>
              {currentEpisode.synopsis && (
                <p className="text-gray-400 mb-4">{currentEpisode.synopsis}</p>
              )}
              {/* Share button */}
              <div className="flex items-center gap-4">
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(window.location.href); toast.success("Link copied!"); } catch { toast.error("Failed to copy"); }
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:text-white transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              </div>
            </div>

            {/* Comments */}
            <CommentsSection episodeId={currentEpisode.id} />
          </div>

          {/* Right: Episode list */}
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Film className="w-4 h-4 text-token-violet" />
              Episodes
            </h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
              {episodes.map((ep: any) => (
                <Link key={ep.id} href={`/watch/${slug}/${ep.episodeNumber}`}>
                  <div className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    ep.episodeNumber === episodeNumber
                      ? "bg-token-violet/10 border border-token-violet/30"
                      : "bg-surface-1/30 border border-white/5 hover:bg-surface-1/50"
                  }`}>
                    <span className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center text-sm font-bold">
                      {ep.episodeNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{ep.title}</p>
                      <p className="text-xs text-gray-500">{ep.panelCount || 0} panels</p>
                    </div>
                    {ep.episodeNumber === episodeNumber && (
                      <Play className="w-4 h-4 text-token-violet fill-token-violet flex-shrink-0" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Simple Markdown Renderer ─────────────────────────────────────────────
function renderMarkdown(text: string): string {
  // First escape HTML, then apply markdown formatting
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-white/10 rounded text-token-cyan text-xs">$1</code>')
    .replace(/\n/g, "<br/>");
  // Sanitize with DOMPurify to prevent XSS
  return DOMPurify.sanitize(escaped, {
    ALLOWED_TAGS: ["strong", "em", "code", "br"],
    ALLOWED_ATTR: ["class"],
  });
}

// ─── Comment type ─────────────────────────────────────────────────────────
interface CommentData {
  id: number;
  content: string;
  userId: number;
  userName?: string | null;
  createdAt: Date;
  parentId: number | null;
}

// ─── Single Comment Card ──────────────────────────────────────────────────
function CommentCard({
  comment, depth, episodeId, onRefetch, allComments,
}: {
  comment: CommentData;
  depth: number;
  episodeId: number;
  onRefetch: () => void;
  allComments: CommentData[];
}) {
  const { user, isAuthenticated } = useAuth();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showReplies, setShowReplies] = useState(true);

  const createComment = trpc.comments.create.useMutation({
    onSuccess: () => { setReplyText(""); setReplyOpen(false); onRefetch(); toast.success("Reply posted!"); },
  });
  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess: () => { onRefetch(); toast.success("Comment deleted"); },
  });

  const replies = allComments.filter((c) => c.parentId === comment.id);
  const canReply = depth < 3;

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
    createComment.mutate({ episodeId, content: replyText.trim(), parentId: comment.id });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={depth > 0 ? "ml-6 pl-4 border-l-2 border-token-cyan/20" : ""}
    >
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-token-cyan/30 to-token-lavender/30 flex items-center justify-center flex-shrink-0 text-xs font-bold">
          {(comment.userName || "U").charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-white">{comment.userName || "Anonymous"}</span>
            <span className="text-xs text-gray-500">{new Date(comment.createdAt).toLocaleDateString()}</span>
          </div>
          <p
            className="text-sm text-gray-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.content) }}
          />
          <div className="flex items-center gap-3 mt-1.5">
            {canReply && (
              <button
                onClick={() => { if (!isAuthenticated) { window.location.href = getLoginUrl(); return; } setReplyOpen(!replyOpen); }}
                className="text-xs text-gray-500 hover:text-token-cyan transition-colors"
              >
                Reply
              </button>
            )}
            {user && comment.userId === user.id && (
              <button
                onClick={() => deleteComment.mutate({ id: comment.id })}
                className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
          </div>

          {/* Reply input */}
          <AnimatePresence>
            {replyOpen && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={handleReply}
                className="mt-3 overflow-hidden"
              >
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply... (supports **bold**, *italic*, `code`)"
                  rows={2}
                  className="w-full bg-surface-1/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-token-cyan/50 resize-none"
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button type="button" onClick={() => setReplyOpen(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!replyText.trim() || createComment.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-token-cyan/20 text-token-cyan text-xs font-medium disabled:opacity-50 hover:bg-token-cyan/30 transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    {createComment.isPending ? "Posting..." : "Reply"}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Threaded replies */}
      {replies.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="text-xs text-token-cyan/70 hover:text-token-cyan flex items-center gap-1 mb-2 ml-11"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showReplies ? "" : "-rotate-90"}`} />
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </button>
          <AnimatePresence>
            {showReplies && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {replies.map((reply) => (
                  <CommentCard
                    key={reply.id}
                    comment={reply}
                    depth={depth + 1}
                    episodeId={episodeId}
                    onRefetch={onRefetch}
                    allComments={allComments}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

// ─── Comments Section ──────────────────────────────────────────────────────
function CommentsSection({ episodeId }: { episodeId: number }) {
  const { user, isAuthenticated } = useAuth();
  const [newComment, setNewComment] = useState("");
  const [sort, setSort] = useState<"newest" | "top" | "oldest">("newest");

  const comments = trpc.comments.list.useQuery({ episodeId, sort });
  const createComment = trpc.comments.create.useMutation({
    onSuccess: () => { setNewComment(""); comments.refetch(); toast.success("Comment posted!"); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
    createComment.mutate({ episodeId, content: newComment.trim() });
  };

  const commentList = (comments.data ?? []) as CommentData[];
  const topLevelComments = commentList.filter((c) => !c.parentId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-token-violet" />
          Comments ({commentList.length})
        </h3>
        <div className="flex gap-1">
          {(["newest", "top", "oldest"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sort === s ? "bg-token-violet/10 text-token-violet" : "text-gray-400 hover:text-white"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Comment input */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-token-violet/30 to-token-lavender/30 flex items-center justify-center flex-shrink-0 text-sm font-bold">
            {user?.name?.charAt(0) || "?"}
          </div>
          <div className="flex-1">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={isAuthenticated ? "Add a comment... (supports **bold**, *italic*, `code`)" : "Sign in to comment"}
              rows={2}
              className="w-full bg-surface-1/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-token-violet/50 resize-none"
            />
            <div className="flex justify-end mt-2">
              <button
                type="submit"
                disabled={!newComment.trim() || createComment.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-token-violet text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-token-violet/80 transition-colors"
              >
                <Send className="w-4 h-4" />
                {createComment.isPending ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Comment list — threaded */}
      <div className="space-y-4">
        {topLevelComments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            depth={0}
            episodeId={episodeId}
            onRefetch={() => comments.refetch()}
            allComments={commentList}
          />
        ))}
        {commentList.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No comments yet. Be the first!</p>
          </div>
        )}
      </div>
    </div>
  );
}
