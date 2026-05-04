/**
 * Anime Watch Page — Public anime episode player
 *
 * Route: /anime/:projectId/:episodeId
 *
 * Features:
 *   - Cloudflare Stream iframe embed with poster thumbnail
 *   - SRT subtitle track support
 *   - Episode metadata sidebar (title, synopsis, characters, episode number)
 *   - Previous/next episode navigation
 *   - Social sharing (copy link, share to X/Twitter)
 *   - Creator attribution with link to profile
 *   - View count tracking
 *   - Like button with animated heart and count
 *   - Comments section with threaded replies
 *   - Related episodes carousel
 *   - Responsive: full-width video on mobile, sidebar on desktop
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Film,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Share2,
  Copy,
  ExternalLink,
  Eye,
  Clock,
  BookOpen,
  Subtitles,
  Users,
  Play,
  Loader2,
  Check,
  Download,
  Heart,
  MessageSquare,
  Send,
  Trash2,
  CornerDownRight,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { SEOHead, buildEpisodeJsonLd } from "@/components/awakli/SEOHead";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Format helpers ──────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(date);
}

// ─── Share helpers ───────────────────────────────────────────────────────

function getShareUrl(projectId: number, episodeId: number): string {
  return `${window.location.origin}/anime/${projectId}/${episodeId}`;
}

function shareToTwitter(title: string, url: string) {
  const text = encodeURIComponent(`Watch "${title}" on Awakli`);
  const encodedUrl = encodeURIComponent(url);
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodedUrl}`, "_blank");
}

// ─── Like Button Component ──────────────────────────────────────────────

function LikeButton({ episodeId: _episodeId }: { episodeId: number }) {
  // Like/vote system removed in Wave 1. Placeholder share button.
  return (
    <motion.button
      onClick={async () => {
        try { await navigator.clipboard.writeText(window.location.href); } catch { /* noop */ }
      }}
      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 hover:border-[#E040FB]/30 transition-all text-sm"
      whileTap={{ scale: 0.95 }}
    >
      <Heart className="w-5 h-5 text-[#9494B8]" />
      <span className="text-[#9494B8]">Share</span>
    </motion.button>
  );
}

// ─── Comments Section Component ─────────────────────────────────────────

function CommentsSection({ episodeId }: { episodeId: number }) {
  const { user, isAuthenticated } = useAuth();
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; userName: string } | null>(null);
  const [sort, setSort] = useState<"newest" | "oldest" | "top">("newest");
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();

  const commentsQuery = trpc.engagement.getComments.useQuery(
    { episodeId, sort, page, pageSize: 20 },
    { enabled: episodeId > 0 },
  );

  const addCommentMutation = trpc.engagement.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      setReplyTo(null);
      utils.engagement.getComments.invalidate({ episodeId });
      toast.success("Comment posted");
    },
    onError: () => {
      toast.error("Failed to post comment");
    },
  });

  const deleteCommentMutation = trpc.engagement.deleteComment.useMutation({
    onSuccess: () => {
      utils.engagement.getComments.invalidate({ episodeId });
      toast.success("Comment deleted");
    },
  });

  const handleSubmit = () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl(window.location.pathname);
      return;
    }
    const trimmed = commentText.trim();
    if (!trimmed) return;
    addCommentMutation.mutate({
      episodeId,
      content: trimmed,
      parentId: replyTo?.id,
    });
  };

  const comments = commentsQuery.data?.comments ?? [];
  const total = commentsQuery.data?.total ?? 0;
  const hasMore = commentsQuery.data?.hasMore ?? false;

  // Separate top-level and replies
  const topLevel = comments.filter((c) => !c.parentId);
  const replies = comments.filter((c) => c.parentId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-display font-bold text-[#F0F0F5] flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[#9B59B6]" />
          Comments
          {total > 0 && (
            <span className="text-sm font-normal text-[#9494B8]">({total})</span>
          )}
        </h3>
        <div className="flex gap-1">
          {(["newest", "oldest", "top"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setSort(s); setPage(1); }}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                sort === s
                  ? "bg-[#7C4DFF]/20 text-[#B388FF]"
                  : "text-[#9494B8] hover:text-[#F0F0F5] hover:bg-white/5"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Comment input */}
      <div className="bg-[#0D0D1A] rounded-xl border border-white/5 p-4">
        {replyTo && (
          <div className="flex items-center gap-2 mb-2 text-xs text-[#9494B8]">
            <CornerDownRight className="w-3 h-3" />
            Replying to <span className="text-[#B388FF] font-medium">{replyTo.userName}</span>
            <button
              onClick={() => setReplyTo(null)}
              className="text-[#5C5C7A] hover:text-[#F0F0F5] ml-1"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7C4DFF] to-[#E040FB] flex items-center justify-center text-xs font-bold text-white shrink-0">
            {isAuthenticated ? (user?.name?.[0]?.toUpperCase() ?? "U") : "?"}
          </div>
          <div className="flex-1">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={isAuthenticated ? "Write a comment..." : "Sign in to comment..."}
              className="w-full bg-transparent text-sm text-[#F0F0F5] placeholder-[#5C5C7A] resize-none outline-none min-h-[60px]"
              maxLength={2000}
              disabled={!isAuthenticated}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmit();
                }
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-[#5C5C7A]">
                {commentText.length}/2000
              </span>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!commentText.trim() || addCommentMutation.isPending}
                className="bg-[#7C4DFF] hover:bg-[#7C4DFF]/80 text-white gap-1.5 text-xs"
              >
                {addCommentMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Comment list */}
      {commentsQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-[#9494B8]" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-8">
          <MessageSquare className="w-10 h-10 text-[#5C5C7A] mx-auto mb-2" />
          <p className="text-sm text-[#9494B8]">No comments yet. Be the first!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {topLevel.map((comment) => {
            const commentReplies = replies.filter((r) => r.parentId === comment.id);
            return (
              <div key={comment.id}>
                <CommentCard
                  comment={comment}
                  isOwn={user?.id === comment.userId}
                  onReply={() => setReplyTo({ id: comment.id, userName: comment.userName || "User" })}
                  onDelete={() => deleteCommentMutation.mutate({ commentId: comment.id })}
                />
                {commentReplies.length > 0 && (
                  <div className="ml-10 mt-2 space-y-2 border-l-2 border-white/5 pl-4">
                    {commentReplies.map((reply) => (
                      <CommentCard
                        key={reply.id}
                        comment={reply}
                        isOwn={user?.id === reply.userId}
                        onReply={() => setReplyTo({ id: comment.id, userName: reply.userName || "User" })}
                        onDelete={() => deleteCommentMutation.mutate({ commentId: reply.id })}
                        isReply
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="w-full py-2 text-sm text-[#9494B8] hover:text-[#F0F0F5] transition-colors"
            >
              Load more comments...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CommentCard({
  comment,
  isOwn,
  onReply,
  onDelete,
  isReply = false,
}: {
  comment: {
    id: number;
    userId: number;
    userName: string | null;
    content: string;
    createdAt: Date;
    upvotes: number | null;
  };
  isOwn: boolean;
  onReply: () => void;
  onDelete: () => void;
  isReply?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-[#0D0D1A] rounded-xl border border-white/5 p-4 ${isReply ? "bg-[#0D0D1A]/50" : ""}`}
    >
      <div className="flex gap-3">
        <div className={`${isReply ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs"} rounded-full bg-gradient-to-br from-[#7C4DFF]/60 to-[#9B59B6]/60 flex items-center justify-center font-bold text-white shrink-0`}>
          {(comment.userName || "U")[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[#F0F0F5]">
              {comment.userName || "Anonymous"}
            </span>
            <span className="text-xs text-[#5C5C7A]">
              {timeAgo(comment.createdAt)}
            </span>
          </div>
          <p className="text-sm text-[#B0B0CC] leading-relaxed whitespace-pre-wrap break-words">
            {comment.content}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={onReply}
              className="text-xs text-[#9494B8] hover:text-[#B388FF] transition-colors flex items-center gap-1"
            >
              <CornerDownRight className="w-3 h-3" />
              Reply
            </button>
            {isOwn && (
              <button
                onClick={onDelete}
                className="text-xs text-[#5C5C7A] hover:text-[#E74C3C] transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Related Episodes Carousel ──────────────────────────────────────────

function RelatedEpisodes({ episodeId, projectId }: { episodeId: number; projectId: number }) {
  const [, navigate] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const relatedQuery = trpc.engagement.getRelatedEpisodes.useQuery(
    { episodeId, projectId, limit: 12 },
    { enabled: episodeId > 0 && projectId > 0 },
  );

  const episodes = relatedQuery.data ?? [];

  if (relatedQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[#9494B8]" />
      </div>
    );
  }

  if (episodes.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-display font-bold text-[#F0F0F5] flex items-center gap-2">
        <Play className="w-5 h-5 text-[#E040FB]" />
        More Episodes
      </h3>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
      >
        {episodes.map((ep) => (
          <motion.div
            key={ep.id}
            className="shrink-0 w-48 bg-[#0D0D1A] rounded-xl border border-white/5 overflow-hidden cursor-pointer hover:border-[#7C4DFF]/30 transition-all group"
            whileHover={{ y: -2 }}
            onClick={() => navigate(`/anime/${ep.projectId}/${ep.id}`)}
          >
            <div className="aspect-video bg-[#1C1C35] relative overflow-hidden">
              {ep.streamThumbnailUrl ? (
                <img
                  src={ep.streamThumbnailUrl}
                  alt={ep.title || `Episode ${ep.episodeNumber}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Play className="w-8 h-8 text-[#5C5C7A]" />
                </div>
              )}
              {ep.durationSeconds != null && ep.durationSeconds > 0 && (
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white font-mono">
                  {formatDuration(ep.durationSeconds)}
                </span>
              )}
              {ep.source === "similar-genre" && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#7C4DFF]/80 text-[10px] text-white font-medium">
                  Similar
                </span>
              )}
            </div>
            <div className="p-2.5">
              <p className="text-xs font-medium text-[#F0F0F5] line-clamp-1">
                {ep.title || `Episode ${ep.episodeNumber}`}
              </p>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-[#9494B8]">
                <span>Ep {ep.episodeNumber}</span>
                {ep.viewCount > 0 && (
                  <>
                    <span>·</span>
                    <span>{formatViewCount(ep.viewCount)} views</span>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function AnimeWatchPage() {
  const params = useParams<{ projectId: string; episodeId: string }>();
  const projectId = parseInt(params.projectId || "0", 10);
  const episodeId = parseInt(params.episodeId || "0", 10);
  const [, navigate] = useLocation();
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  // Fetch episode player data (public endpoint)
  const playerQuery = trpc.animePublish.getEpisodePlayer.useQuery(
    { projectId, episodeId },
    { enabled: projectId > 0 && episodeId > 0, retry: 1 },
  );

  const data = playerQuery.data;
  const episode = data?.episode;
  const project = data?.project;
  const player = data?.player;
  const characters = data?.characters ?? [];
  const navigation = data?.navigation;
  const subtitleTracks = data?.subtitleTracks ?? [];

  // Language selector state
  const [selectedLanguage, setSelectedLanguage] = useState("en");

  // Close share menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    }
    if (showShareMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showShareMenu]);

  // SEO
  const jsonLd = useMemo(() => {
    if (!episode || !project) return undefined;
    return buildEpisodeJsonLd({
      title: episode.title,
      description: episode.synopsis || undefined,
      thumbnailUrl: player?.streamThumbnailUrl || project.coverImageUrl || undefined,
      projectTitle: project.title,
      projectSlug: project.slug || String(project.id),
      episodeNumber: episode.episodeNumber,
      duration: episode.duration || undefined,
    });
  }, [episode, project, player]);

  // Copy share link
  const copyLink = useCallback(() => {
    const url = getShareUrl(projectId, episodeId);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }, [projectId, episodeId]);

  // ─── Loading ──────────────────────────────────────────────────────────

  if (playerQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[#05050C] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="w-16 h-16 rounded-full border-2 border-[#7C4DFF]/30 border-t-[#7C4DFF] animate-spin mx-auto mb-4" />
          <p className="text-[#9494B8] font-sans text-sm">Loading episode...</p>
        </motion.div>
      </div>
    );
  }

  // ─── Error / Not Found ────────────────────────────────────────────────

  if (playerQuery.error || !data) {
    return (
      <div className="min-h-screen bg-[#05050C] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md mx-auto px-6"
        >
          <Film className="w-16 h-16 text-[#5C5C7A] mx-auto mb-4" />
          <h1 className="text-2xl font-display font-bold text-[#F0F0F5] mb-2">
            Episode Not Found
          </h1>
          <p className="text-[#9494B8] mb-6">
            This episode may not be published yet, or the link may be incorrect.
          </p>
          <Button
            onClick={() => navigate("/discover")}
            className="bg-[#7C4DFF] hover:bg-[#7C4DFF]/80 text-white"
          >
            Browse Discover
          </Button>
        </motion.div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────

  const shareUrl = getShareUrl(projectId, episodeId);

  return (
    <div className="min-h-screen bg-[#05050C] text-[#F0F0F5]">
      {/* SEO */}
      {episode && project && (
        <SEOHead
          title={`${project.title} - Ep ${episode.episodeNumber}: ${episode.title}`}
          description={episode.synopsis || `Watch Episode ${episode.episodeNumber} of ${project.title} on Awakli`}
          image={player?.streamThumbnailUrl || project.coverImageUrl || undefined}
          url={shareUrl}
          type="video.other"
          jsonLd={jsonLd}
        />
      )}

      {/* Top navigation bar */}
      <header className="sticky top-0 z-50 bg-[#05050C]/90 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(project?.slug ? `/watch/${project.slug}` : "/discover")}
              className="p-2 rounded-lg hover:bg-[#1C1C35] transition-colors text-[#9494B8] hover:text-[#F0F0F5]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="hidden sm:block">
              <Link href={project?.slug ? `/watch/${project.slug}` : "/discover"}>
                <span className="text-sm text-[#9494B8] hover:text-[#7C4DFF] transition-colors cursor-pointer">
                  {project?.title}
                </span>
              </Link>
              <span className="text-[#5C5C7A] mx-2">/</span>
              <span className="text-sm text-[#F0F0F5] font-medium">
                Ep {episode?.episodeNumber}
              </span>
            </div>
          </div>

          {/* Share button */}
          <div className="relative" ref={shareRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowShareMenu(!showShareMenu)}
              className="gap-2 border-white/10 text-[#9494B8] hover:text-[#F0F0F5]"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </Button>

            <AnimatePresence>
              {showShareMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-56 bg-[#151528] border border-white/10 rounded-xl shadow-xl overflow-hidden z-50"
                >
                  <button
                    onClick={copyLink}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#1C1C35] transition-colors text-sm"
                  >
                    {copied ? <Check className="w-4 h-4 text-[#2ECC71]" /> : <Copy className="w-4 h-4 text-[#9494B8]" />}
                    <span>{copied ? "Copied!" : "Copy link"}</span>
                  </button>
                  <button
                    onClick={() => {
                      shareToTwitter(episode?.title || "Anime Episode", shareUrl);
                      setShowShareMenu(false);
                    }}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#1C1C35] transition-colors text-sm"
                  >
                    <ExternalLink className="w-4 h-4 text-[#9494B8]" />
                    <span>Share on X / Twitter</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video player — takes 2/3 on desktop */}
          <div className="lg:col-span-2 space-y-4">
            {/* Video embed */}
            <div className="relative aspect-video bg-[#0D0D1A] rounded-2xl overflow-hidden border border-white/5 shadow-lg">
              {player?.streamEmbedUrl ? (
                <iframe
                  src={player.streamEmbedUrl}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  title={episode?.title || "Anime Episode"}
                />
              ) : player?.videoUrl ? (
                <video
                  src={player.videoUrl}
                  controls
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                  poster={player.streamThumbnailUrl || undefined}
                >
                  {subtitleTracks.length > 0 ? (
                    subtitleTracks.map((track) => (
                      <track
                        key={track.language}
                        kind="subtitles"
                        src={track.vttUrl}
                        srcLang={track.language}
                        label={track.label}
                        default={track.language === selectedLanguage}
                      />
                    ))
                  ) : (player.vttUrl || player.srtUrl) ? (
                    <track
                      kind="subtitles"
                      src={(player.vttUrl || player.srtUrl) ?? undefined}
                      srcLang="en"
                      label="English"
                      default
                    />
                  ) : null}
                </video>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <Play className="w-16 h-16 text-[#5C5C7A] mx-auto mb-3" />
                    <p className="text-[#9494B8] text-sm">Video not available</p>
                  </div>
                </div>
              )}
            </div>

            {/* Episode title and metadata + Like button */}
            <div className="space-y-3">
              <h1 className="text-xl sm:text-2xl font-display font-bold text-[#F0F0F5]">
                Episode {episode?.episodeNumber}: {episode?.title}
              </h1>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4 text-sm text-[#9494B8]">
                  {episode?.viewCount !== undefined && (
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-4 h-4" />
                      {formatViewCount(episode.viewCount)} views
                    </span>
                  )}
                  {episode?.duration != null && episode.duration > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      {formatDuration(episode.duration!)}
                    </span>
                  )}
                  {episode?.publishedAt && (
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4" />
                      {formatDate(episode.publishedAt)}
                    </span>
                  )}
                  {(player?.srtUrl || player?.vttUrl || subtitleTracks.length > 0) && (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#2ECC71]/15 text-[#2ECC71] text-xs font-semibold">
                        <Subtitles className="w-3.5 h-3.5" />
                        CC
                        {subtitleTracks.length > 1 && (
                          <span className="ml-0.5">{subtitleTracks.length}</span>
                        )}
                      </span>
                    </span>
                  )}
                </div>

                {/* Like button */}
                <LikeButton episodeId={episodeId} />
              </div>
            </div>

            {/* Episode navigation */}
            <div className="flex items-center justify-between py-3 border-t border-b border-white/5">
              {navigation?.prevEpisode ? (
                <button
                  onClick={() => navigate(`/anime/${projectId}/${navigation.prevEpisode!.id}`)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#1C1C35] transition-colors text-sm"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <div className="text-left">
                    <div className="text-[#5C5C7A] text-xs">Previous</div>
                    <div className="text-[#F0F0F5]">Ep {navigation.prevEpisode.episodeNumber}</div>
                  </div>
                </button>
              ) : (
                <div />
              )}

              <span className="text-[#5C5C7A] text-xs">
                {navigation?.currentIndex} of {navigation?.totalEpisodes}
              </span>

              {navigation?.nextEpisode ? (
                <button
                  onClick={() => navigate(`/anime/${projectId}/${navigation.nextEpisode!.id}`)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#1C1C35] transition-colors text-sm"
                >
                  <div className="text-right">
                    <div className="text-[#5C5C7A] text-xs">Next</div>
                    <div className="text-[#F0F0F5]">Ep {navigation.nextEpisode.episodeNumber}</div>
                  </div>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <div />
              )}
            </div>

            {/* Synopsis */}
            {episode?.synopsis && (
              <div className="bg-[#0D0D1A] rounded-xl p-5 border border-white/5">
                <h3 className="text-sm font-semibold text-[#9494B8] uppercase tracking-wider mb-2">
                  Synopsis
                </h3>
                <p className="text-[#F0F0F5] text-sm leading-relaxed">
                  {episode.synopsis}
                </p>
              </div>
            )}

            {/* Comments Section */}
            <CommentsSection episodeId={episodeId} />

            {/* Related Episodes */}
            <RelatedEpisodes episodeId={episodeId} projectId={projectId} />
          </div>

          {/* Sidebar — 1/3 on desktop */}
          <div className="space-y-5">
            {/* Project card */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-[#0D0D1A] rounded-2xl border border-white/5 overflow-hidden"
            >
              {project?.coverImageUrl && (
                <Link href={project.slug ? `/watch/${project.slug}` : `/discover`}>
                  <img
                    src={project.coverImageUrl}
                    alt={project.title}
                    className="w-full h-40 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  />
                </Link>
              )}
              <div className="p-4 space-y-3">
                <Link href={project?.slug ? `/watch/${project.slug}` : `/discover`}>
                  <h2 className="text-lg font-display font-bold text-[#F0F0F5] hover:text-[#7C4DFF] transition-colors cursor-pointer">
                    {project?.title}
                  </h2>
                </Link>
                {project?.description && (
                  <p className="text-[#9494B8] text-sm line-clamp-3">
                    {project.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {project?.genre && (
                    <span className="px-2.5 py-1 rounded-full bg-[#7C4DFF]/10 text-[#7C4DFF] text-xs font-medium">
                      {project.genre}
                    </span>
                  )}
                  {project?.animeStyle && project.animeStyle !== "default" && (
                    <span className="px-2.5 py-1 rounded-full bg-[#00BCD4]/10 text-[#00BCD4] text-xs font-medium">
                      {project.animeStyle}
                    </span>
                  )}
                </div>

                {/* Creator link */}
                {project?.creatorId && (
                  <Link href={`/profile/${project.creatorId}`}>
                    <div className="flex items-center gap-2 pt-2 border-t border-white/5 cursor-pointer hover:opacity-80 transition-opacity">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7C4DFF] to-[#00BCD4] flex items-center justify-center text-xs font-bold text-white">
                        C
                      </div>
                      <span className="text-sm text-[#9494B8]">View creator profile</span>
                    </div>
                  </Link>
                )}
              </div>
            </motion.div>

            {/* Characters */}
            {characters.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-[#0D0D1A] rounded-2xl border border-white/5 p-4"
              >
                <h3 className="text-sm font-semibold text-[#9494B8] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Characters
                </h3>
                <div className="space-y-2">
                  {characters.slice(0, 6).map((char) => {
                    return (
                      <div
                        key={char.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#1C1C35] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7C4DFF]/30 to-[#00BCD4]/30 flex items-center justify-center text-xs font-bold text-[#F0F0F5] border border-white/10">
                          {(char.name || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[#F0F0F5]">{char.name}</div>
                          {char.role && (
                            <div className="text-xs text-[#5C5C7A] capitalize">{char.role}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {characters.length > 6 && (
                    <p className="text-xs text-[#5C5C7A] text-center pt-1">
                      +{characters.length - 6} more characters
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Subtitles & Language Selector */}
            {(player?.srtUrl || subtitleTracks.length > 0) && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-[#0D0D1A] rounded-2xl border border-white/5 p-4"
              >
                <h3 className="text-sm font-semibold text-[#9494B8] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Subtitles className="w-4 h-4" />
                  Subtitles
                </h3>

                {/* Language selector */}
                {subtitleTracks.length > 1 && (
                  <div className="mb-3">
                    <label className="text-xs text-[#5C5C7A] mb-1 block">Language</label>
                    <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                      <SelectTrigger className="w-full bg-[#1C1C35] border-white/10 text-[#F0F0F5] text-sm">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1C1C35] border-white/10">
                        {subtitleTracks.map((track) => (
                          <SelectItem key={track.language} value={track.language} className="text-[#F0F0F5] text-sm">
                            {track.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Download links */}
                <div className="space-y-2">
                  {subtitleTracks.length > 0 ? (
                    subtitleTracks
                      .filter((t) => t.language === selectedLanguage)
                      .map((track) => (
                        <div key={track.language} className="space-y-1">
                          {track.srtUrl && (
                            <a
                              href={track.srtUrl}
                              download={`${project?.title || "episode"}-ep${episode?.episodeNumber || 1}-${track.language}.srt`}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1C1C35] hover:bg-[#1C1C35]/80 transition-colors text-sm text-[#F0F0F5]"
                            >
                              <Download className="w-4 h-4 text-[#2ECC71]" />
                              Download SRT ({track.label})
                            </a>
                          )}
                          {track.vttUrl && (
                            <a
                              href={track.vttUrl}
                              download={`${project?.title || "episode"}-ep${episode?.episodeNumber || 1}-${track.language}.vtt`}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1C1C35] hover:bg-[#1C1C35]/80 transition-colors text-sm text-[#F0F0F5]"
                            >
                              <Download className="w-4 h-4 text-[#7B61FF]" />
                              Download VTT ({track.label})
                            </a>
                          )}
                        </div>
                      ))
                  ) : player?.srtUrl ? (
                    <a
                      href={player.srtUrl}
                      download={`${project?.title || "episode"}-ep${episode?.episodeNumber || 1}.srt`}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1C1C35] hover:bg-[#1C1C35]/80 transition-colors text-sm text-[#F0F0F5]"
                    >
                      <Download className="w-4 h-4 text-[#2ECC71]" />
                      Download SRT
                    </a>
                  ) : null}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
