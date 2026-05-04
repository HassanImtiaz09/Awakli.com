import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { SEOHead, buildMangaJsonLd } from "@/components/awakli/SEOHead";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";
import {
  Play, Star, ChevronRight, Plus, Check, Share2, Clock, Film,
  ThumbsUp, ThumbsDown, Eye, BookmarkPlus, Bookmark, Users,
  ArrowLeft, Calendar, Sparkles, Trophy, Flame
} from "lucide-react";
import SneakPeekCard from "@/components/awakli/SneakPeekCard";
import DownloadModal from "@/components/awakli/DownloadModal";
import ShareSheet from "@/components/awakli/ShareSheet";
import { Download } from "lucide-react";

function ScrollReveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay }} className={className}>
      {children}
    </motion.div>
  );
}

export default function WatchProject() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const project = trpc.watch.project.useQuery({ slug }, { enabled: !!slug });
  const watchlistStatus = trpc.watchlist.isAdded.useQuery(
    { projectId: project.data?.id ?? 0 },
    { enabled: isAuthenticated && !!project.data?.id }
  );
  const addToWatchlist = trpc.watchlist.add.useMutation({
    onSuccess: () => { watchlistStatus.refetch(); toast.success("Added to watchlist"); },
  });
  const removeFromWatchlist = trpc.watchlist.remove.useMutation({
    onSuccess: () => { watchlistStatus.refetch(); toast.success("Removed from watchlist"); },
  });

  const [showDownload, setShowDownload] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);

  // Record view on page load
  const recordView = trpc.publicContent.recordView.useMutation();
  const [viewRecorded, setViewRecorded] = useState(false);
  const projectData = project.data;
  useEffect(() => {
    if (projectData?.id && !viewRecorded) {
      recordView.mutate({
        contentType: "project",
        contentId: projectData.id,
        source: "direct",
      });
      setViewRecorded(true);
    }
  }, [projectData?.id, viewRecorded]);

  const p = project.data;

  // Build JSON-LD structured data — must be above early returns (React hooks rule)
  const jsonLd = useMemo(() => {
    if (!p) return undefined;
    return buildMangaJsonLd({
      title: p.title,
      description: p.description,
      coverImageUrl: p.coverImageUrl,
      slug: slug,
      userName: p.userName ?? null,
      genre: p.genre,
      createdAt: typeof p.createdAt === 'object' ? (p.createdAt as Date).toISOString() : p.createdAt,
    });
  }, [p, slug]);

  // Stable references for handlers — must be above early returns (React hooks rule)
  const inWatchlist = watchlistStatus.data?.inWatchlist ?? false;

  const handleWatchlistToggle = useCallback(() => {
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
    if (!p) return;
    if (inWatchlist) {
      removeFromWatchlist.mutate({ projectId: p.id });
    } else {
      addToWatchlist.mutate({ projectId: p.id });
    }
  }, [isAuthenticated, p, inWatchlist, addToWatchlist, removeFromWatchlist]);

  const handleShare = useCallback(() => {
    setShowShareSheet(true);
  }, []);

  if (project.isLoading) {
    return (
      <div className="min-h-screen bg-bg-void">
        <div className="h-[60vh] bg-surface-1 animate-pulse" />
        <div className="container py-8">
          <div className="h-8 bg-surface-1 rounded animate-pulse w-1/3 mb-4" />
          <div className="h-4 bg-surface-1 rounded animate-pulse w-2/3 mb-2" />
          <div className="h-4 bg-surface-1 rounded animate-pulse w-1/2" />
        </div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="min-h-screen bg-bg-void flex items-center justify-center">
        <div className="text-center space-y-4">
          <Film className="w-16 h-16 text-gray-600 mx-auto" />
          <h1 className="text-2xl font-display font-bold text-white">Coming Soon</h1>
          <p className="text-gray-400 max-w-md mx-auto">This title is being animated — check back tomorrow to watch it.</p>
          <div className="flex gap-3 justify-center pt-2">
            <Link href="/discover">
              <button className="px-6 py-3 rounded-xl bg-token-violet text-white font-semibold hover:bg-token-violet/80 transition-colors">
                Browse Catalog
              </button>
            </Link>
            <Link href="/">
              <button className="px-6 py-3 rounded-xl border border-white/10 text-white/70 font-semibold hover:bg-white/5 transition-colors">
                Back to Home
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const episodes = p.episodes ?? [];

  return (
    <div className="min-h-screen bg-bg-void text-white">
      {/* SEO: Dynamic meta tags for social sharing */}
      {p && (
        <SEOHead
          title={p.title}
          description={p.description || `Watch ${p.title} on Awakli — AI-powered manga-to-anime platform`}
          image={p.coverImageUrl || undefined}
          url={`${window.location.origin}/watch/${slug}`}
          type="article"
          jsonLd={jsonLd}
        />
      )}

      {/* Hero Banner */}
      <section className="relative h-[55vh] md:h-[65vh] overflow-hidden">
        {p.coverImageUrl ? (
          <img src={p.coverImageUrl} alt={p.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-token-violet/30 via-token-lavender/20 to-token-cyan/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-void via-bg-void/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg-void/80 to-transparent" />

        {/* Back button */}
        <div className="absolute top-6 left-6 z-10">
          <button
            onClick={() => navigate("/discover")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 text-white hover:bg-black/60 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>

        {/* Hero content */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12">
          <div className="container">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {/* Genre badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {p.genre && p.genre.split(",").map((g: string) => (
                  <span key={g.trim()} className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 backdrop-blur-sm border border-white/10 text-gray-300">
                    {g.trim()}
                  </span>
                ))}
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-token-violet/20 border border-token-violet/30 text-token-violet">
                  {p.animeStyle}
                </span>
              </div>

              <h1 className="text-4xl md:text-6xl font-display font-bold mb-3">{p.title}</h1>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 mb-4">
                <span className="flex items-center gap-1"><Film className="w-4 h-4" /> {episodes.length} Episodes</span>
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {new Date(p.createdAt).getFullYear()}</span>

              </div>

              {p.description && (
                <p className="text-gray-300 max-w-2xl leading-relaxed line-clamp-3 mb-6">{p.description}</p>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                {episodes.length > 0 && (
                  <Link href={`/watch/${slug}/${episodes[0].episodeNumber}`}>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-token-violet to-token-lavender text-white font-semibold shadow-lg shadow-[#7C4DFF]/25"
                    >
                      <Play className="w-5 h-5 fill-white" />
                      Watch Now
                    </motion.button>
                  </Link>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleWatchlistToggle}
                  className={`flex items-center gap-2 px-6 py-3.5 rounded-xl border font-semibold transition-colors ${
                    inWatchlist
                      ? "border-token-cyan/50 bg-token-cyan/10 text-token-cyan"
                      : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  {inWatchlist ? <Bookmark className="w-5 h-5 fill-token-cyan" /> : <BookmarkPlus className="w-5 h-5" />}
                  {inWatchlist ? "In Watchlist" : "Add to Watchlist"}
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleShare}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 font-semibold transition-colors"
                >
                  <Share2 className="w-5 h-5" />
                  Share
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="container py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left: Episode list */}
          <div className="lg:col-span-2">
            <ScrollReveal>
              <h2 className="text-2xl font-display font-bold mb-6 flex items-center gap-2">
                <Film className="w-5 h-5 text-token-violet" />
                Episodes
              </h2>

              {episodes.length === 0 ? (
                <div className="text-center py-16 rounded-xl border border-white/5 bg-surface-1/30">
                  <Sparkles className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">No episodes available yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {episodes.map((ep: any, i: number) => (
                    <EpisodeCard key={ep.id} episode={ep} slug={slug} index={i} />
                  ))}
                </div>
              )}
            </ScrollReveal>
          </div>

          {/* Right: Sticky sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-6">
              {/* Project info card */}
              <ScrollReveal delay={0.1}>
                <div className="rounded-xl border border-white/5 bg-surface-1/50 p-6">
                  <h3 className="text-lg font-semibold mb-4">About This Project</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Style</span>
                      <span className="text-white capitalize">{p.animeStyle}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-gray-400">Episodes</span>
                      <span className="text-white">{episodes.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Visibility</span>
                      <span className="text-token-cyan capitalize">{p.visibility}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Created</span>
                      <span className="text-white">{new Date(p.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </ScrollReveal>

              {/* Anime Status */}
              {p.id && (p.animeStatus === 'in_production' || p.animeStatus === 'completed') && (
                <ScrollReveal delay={0.15}>
                  <div className="rounded-xl border border-white/5 bg-surface-1/50 p-6">
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-amber-400" /> Anime Status
                    </h3>
                    {p.animeStatus === 'in_production' ? (
                      <div className="text-center py-3">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-400/20 text-amber-400 text-sm font-medium mb-2">
                          <Trophy className="w-4 h-4" />
                          In Production
                        </div>
                        <p className="text-xs text-gray-400">This manga is being converted to anime.</p>
                      </div>
                    ) : (
                      <div className="text-center py-3">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-400/20 text-cyan-400 text-sm font-medium">
                          <Sparkles className="w-4 h-4" /> Anime Complete
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollReveal>
              )}

              {/* Sneak Peek */}
              {p.id && (
                <ScrollReveal delay={0.2}>
                  <SneakPeekCard
                    projectId={p.id}
                    projectTitle={p.title}
                    coverUrl={p.coverImageUrl}
                  />
                </ScrollReveal>
              )}

              {/* Quick actions */}
              <ScrollReveal delay={0.25}>
                <div className="rounded-xl border border-white/5 bg-surface-1/50 p-6">
                  <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                  <div className="space-y-2">
                    {episodes.length > 0 && (
                      <Link href={`/watch/${slug}/1`}>
                        <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-token-violet/10 text-token-violet hover:bg-token-violet/20 transition-colors text-sm font-medium">
                          <Play className="w-4 h-4" />
                          Start from Episode 1
                        </button>
                      </Link>
                    )}
                    <button
                      onClick={handleWatchlistToggle}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm font-medium"
                    >
                      {inWatchlist ? <Check className="w-4 h-4 text-token-cyan" /> : <Plus className="w-4 h-4" />}
                      {inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
                    </button>
                    <button
                      onClick={handleShare}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm font-medium"
                    >
                      <Share2 className="w-4 h-4" />
                      Share Project
                    </button>
                    {isAuthenticated && (
                      <button
                        onClick={() => setShowDownload(true)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm font-medium"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    )}
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </div>
      {/* Download Modal */}
      {p.id && (
        <DownloadModal
          isOpen={showDownload}
          onClose={() => setShowDownload(false)}
          projectId={p.id}
          projectTitle={p.title}
          hasAnime={episodes.some((e: any) => e.videoUrl)}
        />
      )}

      {/* Share Sheet */}
      {p.id && (
        <ShareSheet
          isOpen={showShareSheet}
          onClose={() => setShowShareSheet(false)}
          projectId={p.id}
          projectTitle={p.title}
        />
      )}
    </div>
  );
}

// ─── Episode Card ──────────────────────────────────────────────────────────
function EpisodeCard({ episode, slug, index }: { episode: any; slug: string; index: number }) {

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
    >
      <Link href={`/watch/${slug}/${episode.episodeNumber}`}>
        <div className="group flex gap-4 p-4 rounded-xl border border-white/5 bg-surface-1/30 hover:bg-surface-1/60 hover:border-token-violet/20 transition-all cursor-pointer">
          {/* Episode number */}
          <div className="flex-shrink-0 w-14 h-14 rounded-lg bg-gradient-to-br from-token-violet/20 to-token-lavender/20 flex items-center justify-center border border-white/5">
            <span className="text-lg font-display font-bold text-white">{episode.episodeNumber}</span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white group-hover:text-token-violet transition-colors truncate">
              {episode.title || `Episode ${episode.episodeNumber}`}
            </h3>
            {episode.synopsis && (
              <p className="text-sm text-gray-400 mt-1 line-clamp-2">{episode.synopsis}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              {episode.panelCount && (
                <span className="flex items-center gap-1"><Film className="w-3 h-3" /> {episode.panelCount} panels</span>
              )}
              <span className="capitalize px-2 py-0.5 rounded bg-white/5 border border-white/10">
                {episode.status}
              </span>
            </div>
          </div>

          {/* Play icon */}
          <div className="flex-shrink-0 flex items-center">
            <div className="w-10 h-10 rounded-full bg-token-violet/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Play className="w-5 h-5 text-token-violet fill-token-violet ml-0.5" />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
