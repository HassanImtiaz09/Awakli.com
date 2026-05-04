import { useState } from "react";
import { motion } from "framer-motion";
import {
  Eye, Heart, BookOpen, TrendingUp, BarChart3, Monitor, Smartphone,
  Tablet, Globe, Clock, Play, ChevronDown, ChevronUp, Film,
} from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { TopNav } from "@/components/awakli/TopNav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const deviceIcons: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  unknown: Globe,
};

const deviceColors: Record<string, string> = {
  desktop: "#3498DB",
  mobile: "#E040FB",
  tablet: "#2ECC71",
  unknown: "#5C5C7A",
};

// ─── Main Page ──────────────────────────────────────────────────────────

export default function CreatorAnalytics() {
  const { user, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<"overview" | "episodes">("overview");
  const [timeRange, setTimeRange] = useState(30);
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null);

  // Existing analytics
  const overviewQuery = trpc.creatorAnalytics.overview.useQuery(undefined, { enabled: isAuthenticated });
  const contentQuery = trpc.creatorAnalytics.contentBreakdown.useQuery(undefined, { enabled: isAuthenticated });

  // New episode analytics
  const dashboardQuery = trpc.episodeAnalytics.dashboard.useQuery(
    { days: timeRange },
    { enabled: isAuthenticated },
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#08080F] text-[#F0F0F5]">
        <TopNav />
        <div className="pt-24 pb-16 container max-w-4xl text-center">
          <BarChart3 size={48} className="mx-auto text-[#5C5C7A] mb-4" />
          <h1 className="text-2xl font-display font-bold mb-2">Creator Analytics</h1>
          <p className="text-[#9494B8]">Sign in to view your content analytics.</p>
        </div>
      </div>
    );
  }

  const overview = overviewQuery.data;
  const content = contentQuery.data ?? [];
  const epDash = dashboardQuery.data;

  const projectStats = [
    { label: "Total Views", value: overview?.totalViews ?? 0, icon: Eye, color: "#3498DB" },
    { label: "Published", value: overview?.publishedProjects ?? 0, icon: TrendingUp, color: "#2ECC71" },
    { label: "Total Projects", value: overview?.totalProjects ?? 0, icon: BookOpen, color: "#9B59B6" },
  ];

  const episodeStats = [
    { label: "Episode Views", value: epDash?.totalEpisodeViews ?? 0, icon: Play, color: "#E040FB" },
    { label: "Unique Viewers", value: epDash?.totalUniqueViewers ?? 0, icon: Eye, color: "#3498DB" },
    { label: "Avg Watch Time", value: formatDuration(epDash?.avgWatchDuration ?? 0), icon: Clock, color: "#F39C12" },
    { label: "Avg Completion", value: `${epDash?.avgCompletionPercent ?? 0}%`, icon: Film, color: "#2ECC71" },
  ];

  return (
    <div className="min-h-screen bg-[#08080F] text-[#F0F0F5]">
      <TopNav />
      <div className="pt-24 pb-16 container max-w-6xl">
        {/* Header */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-display font-bold mb-1">
            Creator <span className="text-gradient-pink">Analytics</span>
          </h1>
          <p className="text-[#9494B8] text-sm">Track how your content is performing across Awakli.</p>
        </motion.div>

        {/* Tab switcher */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setTab("overview")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              tab === "overview"
                ? "bg-[#E040FB]/10 text-[#E040FB] border border-[#E040FB]/20"
                : "text-[#9494B8] hover:text-[#F0F0F5] hover:bg-[#1C1C35]/50",
            )}
          >
            Project Overview
          </button>
          <button
            onClick={() => setTab("episodes")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              tab === "episodes"
                ? "bg-[#E040FB]/10 text-[#E040FB] border border-[#E040FB]/20"
                : "text-[#9494B8] hover:text-[#F0F0F5] hover:bg-[#1C1C35]/50",
            )}
          >
            Episode Analytics
          </button>
        </div>

        {/* ─── Overview Tab ──────────────────────────────────────────── */}
        {tab === "overview" && (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {projectStats.map((stat, i) => {
                const Icon = stat.icon;
                return (
                  <motion.div
                    key={stat.label}
                    className="rounded-xl border border-white/5 bg-[#0D0D1A] p-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${stat.color}15` }}
                      >
                        <Icon size={16} style={{ color: stat.color }} />
                      </div>
                      <span className="text-xs text-[#9494B8]">{stat.label}</span>
                    </div>
                    <p className="text-2xl font-bold text-[#F0F0F5]">
                      {overviewQuery.isLoading ? "—" : formatNumber(stat.value)}
                    </p>
                  </motion.div>
                );
              })}
            </div>

            {/* Content breakdown */}
            <motion.div
              className="rounded-xl border border-white/5 bg-[#0D0D1A] overflow-hidden"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="p-4 border-b border-white/5">
                <h2 className="text-lg font-semibold text-[#F0F0F5]">Content Performance</h2>
              </div>
              {contentQuery.isLoading ? (
                <div className="p-8 text-center text-[#5C5C7A]">Loading...</div>
              ) : content.length === 0 ? (
                <div className="p-8 text-center">
                  <BookOpen size={32} className="mx-auto text-[#5C5C7A] mb-3" />
                  <p className="text-[#9494B8] text-sm">No content yet. Create your first project!</p>
                  <Link href="/create">
                    <span className="inline-block mt-3 text-sm text-[#E040FB] hover:underline cursor-pointer">
                      Start creating →
                    </span>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {content.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-[#1C1C35]/30 transition-colors">
                      <div className="w-12 h-16 rounded-lg overflow-hidden bg-[#1C1C35] shrink-0">
                        {item.coverImageUrl ? (
                          <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#5C5C7A]">
                            <BookOpen size={16} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-[#F0F0F5] truncate">{item.title}</h3>
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                            item.publicationStatus === "published"
                              ? "bg-[#2ECC71]/10 text-[#2ECC71]"
                              : "bg-[#5C5C7A]/10 text-[#5C5C7A]",
                          )}>
                            {item.publicationStatus ?? "draft"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[#5C5C7A]">
                          <span className="flex items-center gap-1"><Eye size={12} />{item.viewCountFormatted ?? item.viewCount ?? 0}</span>
                          {item.publishedAt && <span>Published {new Date(item.publishedAt).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}

        {/* ─── Episode Analytics Tab ─────────────────────────────────── */}
        {tab === "episodes" && (
          <>
            {/* Time range selector */}
            <div className="flex items-center gap-2 mb-6">
              {[7, 14, 30, 60, 90].map(d => (
                <button
                  key={d}
                  onClick={() => setTimeRange(d)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    timeRange === d
                      ? "bg-[#3498DB]/10 text-[#3498DB] border border-[#3498DB]/20"
                      : "text-[#5C5C7A] hover:text-[#9494B8] hover:bg-[#1C1C35]/30",
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>

            {/* Episode stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {episodeStats.map((stat, i) => {
                const Icon = stat.icon;
                return (
                  <motion.div
                    key={stat.label}
                    className="rounded-xl border border-white/5 bg-[#0D0D1A] p-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${stat.color}15` }}
                      >
                        <Icon size={16} style={{ color: stat.color }} />
                      </div>
                      <span className="text-xs text-[#9494B8]">{stat.label}</span>
                    </div>
                    <p className="text-2xl font-bold text-[#F0F0F5]">
                      {dashboardQuery.isLoading ? "—" : typeof stat.value === "number" ? formatNumber(stat.value) : stat.value}
                    </p>
                  </motion.div>
                );
              })}
            </div>

            {/* Views time series chart (simple bar visualization) */}
            {epDash?.viewsTimeSeries && epDash.viewsTimeSeries.length > 0 && (
              <motion.div
                className="rounded-xl border border-white/5 bg-[#0D0D1A] p-4 mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h2 className="text-lg font-semibold text-[#F0F0F5] mb-4">Views Over Time</h2>
                <div className="flex items-end gap-[2px] h-32">
                  {epDash.viewsTimeSeries.map((point, i) => {
                    const maxViews = Math.max(...epDash.viewsTimeSeries.map(p => p.views), 1);
                    const height = (point.views / maxViews) * 100;
                    return (
                      <div
                        key={point.date}
                        className="flex-1 group relative"
                        title={`${point.date}: ${point.views} views`}
                      >
                        <div
                          className="w-full rounded-t bg-[#E040FB]/60 hover:bg-[#E040FB] transition-colors min-h-[2px]"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-[#1C1C35] text-[#F0F0F5] text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                          {point.date}: {point.views}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-[#5C5C7A]">
                  <span>{epDash.viewsTimeSeries[0]?.date}</span>
                  <span>{epDash.viewsTimeSeries[epDash.viewsTimeSeries.length - 1]?.date}</span>
                </div>
              </motion.div>
            )}

            {/* Device + Country breakdown */}
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {/* Device breakdown */}
              <motion.div
                className="rounded-xl border border-white/5 bg-[#0D0D1A] p-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <h2 className="text-sm font-semibold text-[#F0F0F5] mb-4">Device Breakdown</h2>
                {!epDash?.deviceBreakdown?.length ? (
                  <p className="text-[#5C5C7A] text-xs">No data yet</p>
                ) : (
                  <div className="space-y-3">
                    {epDash.deviceBreakdown.map(d => {
                      const Icon = deviceIcons[d.device] ?? Globe;
                      const color = deviceColors[d.device] ?? "#5C5C7A";
                      return (
                        <div key={d.device} className="flex items-center gap-3">
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${color}15` }}
                          >
                            <Icon size={14} style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-[#F0F0F5] capitalize">{d.device}</span>
                              <span className="text-[#9494B8]">{d.percentage}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#1C1C35] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${d.percentage}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>

              {/* Top countries */}
              <motion.div
                className="rounded-xl border border-white/5 bg-[#0D0D1A] p-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <h2 className="text-sm font-semibold text-[#F0F0F5] mb-4">Top Countries</h2>
                {!epDash?.topCountries?.length ? (
                  <p className="text-[#5C5C7A] text-xs">No data yet</p>
                ) : (
                  <div className="space-y-2">
                    {epDash.topCountries.map((c, i) => (
                      <div key={c.country} className="flex items-center gap-3">
                        <span className="text-xs text-[#5C5C7A] w-4 text-right">{i + 1}</span>
                        <span className="text-sm text-[#F0F0F5] flex-1">{c.country}</span>
                        <span className="text-xs text-[#9494B8]">{formatNumber(c.count)}</span>
                        <span className="text-xs text-[#5C5C7A] w-10 text-right">{c.percentage}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </div>

            {/* Per-episode stats table */}
            <motion.div
              className="rounded-xl border border-white/5 bg-[#0D0D1A] overflow-hidden"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <div className="p-4 border-b border-white/5">
                <h2 className="text-lg font-semibold text-[#F0F0F5]">Episode Performance</h2>
              </div>
              {dashboardQuery.isLoading ? (
                <div className="p-8 text-center text-[#5C5C7A]">Loading...</div>
              ) : !epDash?.episodeStats?.length ? (
                <div className="p-8 text-center">
                  <Film size={32} className="mx-auto text-[#5C5C7A] mb-3" />
                  <p className="text-[#9494B8] text-sm">No episode view data yet. Publish your anime to start tracking!</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {epDash.episodeStats.map(ep => {
                    const isExpanded = expandedEpisode === ep.episodeId;
                    return (
                      <div key={ep.episodeId}>
                        <button
                          onClick={() => setExpandedEpisode(isExpanded ? null : ep.episodeId)}
                          className="w-full flex items-center gap-4 p-4 hover:bg-[#1C1C35]/30 transition-colors text-left"
                        >
                          <div className="w-8 h-8 rounded-lg bg-[#E040FB]/10 flex items-center justify-center text-[#E040FB] text-xs font-bold shrink-0">
                            {ep.episodeNumber}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium text-[#F0F0F5] truncate">{ep.episodeTitle}</h3>
                            <div className="flex items-center gap-3 mt-1 text-xs text-[#5C5C7A]">
                              <span className="flex items-center gap-1"><Eye size={12} />{formatNumber(ep.totalViews)}</span>
                              <span className="flex items-center gap-1"><Clock size={12} />{formatDuration(ep.avgWatchDuration)}</span>
                              <span>{ep.avgCompletionPercent}% avg completion</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {ep.viewsToday > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-[#2ECC71]/10 text-[#2ECC71]">
                                +{ep.viewsToday} today
                              </span>
                            )}
                            {isExpanded ? <ChevronUp size={16} className="text-[#5C5C7A]" /> : <ChevronDown size={16} className="text-[#5C5C7A]" />}
                          </div>
                        </button>
                        {isExpanded && (
                          <motion.div
                            className="px-4 pb-4 pt-0"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                          >
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-[#1C1C35]/30">
                              <div>
                                <p className="text-[10px] text-[#5C5C7A] uppercase tracking-wider">Total Views</p>
                                <p className="text-lg font-bold text-[#F0F0F5]">{formatNumber(ep.totalViews)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-[#5C5C7A] uppercase tracking-wider">Unique Viewers</p>
                                <p className="text-lg font-bold text-[#F0F0F5]">{formatNumber(ep.uniqueViewers)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-[#5C5C7A] uppercase tracking-wider">This Week</p>
                                <p className="text-lg font-bold text-[#F0F0F5]">{formatNumber(ep.viewsThisWeek)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-[#5C5C7A] uppercase tracking-wider">Avg Completion</p>
                                <p className="text-lg font-bold text-[#F0F0F5]">{ep.avgCompletionPercent}%</p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
