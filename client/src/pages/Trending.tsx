import { motion } from "framer-motion";
import { TrendingUp, Eye, Heart, Sparkles, Clock, Flame, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { TopNav } from "@/components/awakli/TopNav";
import { cn } from "@/lib/utils";
import { TiltCard } from "@/components/awakli/TiltCard";
import PageBackground from "@/components/awakli/PageBackground";

const TABS = [
  { id: "trending", label: "Trending", icon: Flame },
  { id: "most_viewed", label: "Most Viewed", icon: Eye },
  { id: "most_liked", label: "Most Liked", icon: Heart },
  { id: "newest", label: "New Releases", icon: Sparkles },
] as const;

type TabId = typeof TABS[number]["id"];

export default function Trending() {
  const [activeTab, setActiveTab] = useState<TabId>("trending");
  const [limit] = useState(30);

  const trendingQuery = trpc.publicContent.trending.useQuery(
    { limit },
    { enabled: activeTab === "trending" }
  );

  const discoverQuery = trpc.publicContent.discover.useQuery(
    { sort: activeTab === "trending" ? "trending" : activeTab, limit, offset: 0 },
    { enabled: activeTab !== "trending" }
  );

  const items = activeTab === "trending"
    ? trendingQuery.data ?? []
    : discoverQuery.data?.items ?? [];
  const isLoading = activeTab === "trending" ? trendingQuery.isLoading : discoverQuery.isLoading;

  return (
    <div className="min-h-screen bg-[#08080F] text-[#F0F0F5] relative">
      <PageBackground src="https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/page-bg-trending-3QUFzdQqTZN6CGE2jXahLc.webp" opacity={0.4} />
      <TopNav />
      <div className="pt-24 pb-16 container max-w-6xl relative" style={{ zIndex: 1 }}>
        {/* Header */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
            <span className="text-gradient-pink">Trending</span> on Awakli
          </h1>
          <p className="text-[#9494B8] text-sm md:text-base">
            Discover what the community is watching, voting, and creating right now.
          </p>
        </motion.div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2 scrollbar-hide">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <motion.button
                key={tab.id}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-[#7C4DFF]/20 to-[#B388FF]/20 text-[#F0F0F5] border border-[#7C4DFF]/30 shadow-lg shadow-[#7C4DFF]/10"
                    : "text-[#9494B8] hover:text-[#F0F0F5] hover:bg-[#1C1C35] border border-transparent"
                )}
                onClick={() => setActiveTab(tab.id)}
                whileTap={{ scale: 0.97 }}
              >
                <Icon size={16} className={activeTab === tab.id ? "text-[#E040FB]" : ""} />
                {tab.label}
              </motion.button>
            );
          })}
        </div>

        {/* Content grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[3/4] rounded-xl bg-[#1C1C35]" />
                <div className="mt-2 h-4 bg-[#1C1C35] rounded w-3/4" />
                <div className="mt-1 h-3 bg-[#1C1C35] rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <TrendingUp size={48} className="mx-auto text-[#5C5C7A] mb-4" />
            <p className="text-[#9494B8]">No content found yet. Be the first to create!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {items.map((item: any, index: number) => (
              <ContentCard
                key={item.id}
                item={item}
                rank={activeTab === "trending" ? index + 1 : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentCard({ item, rank }: { item: any; rank?: number }) {
  return (
    <Link href={`/watch/${item.slug}`}>
      <TiltCard color="#7C4DFF" className="cursor-pointer" asLink>
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[#1C1C35] border border-white/5 group-hover:border-[#7C4DFF]/30 transition-all group-hover:shadow-lg group-hover:shadow-[#7C4DFF]/10">
          {item.coverImageUrl ? (
            <img
              src={item.coverImageUrl}
              alt={item.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#5C5C7A]">
              <Sparkles size={32} />
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          
          {/* Rank badge */}
          {rank && rank <= 10 && (
            <div className={cn(
              "absolute top-2 left-2 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
              rank <= 3
                ? "bg-gradient-to-br from-[#E040FB] to-[#7C4DFF] text-white shadow-lg shadow-[#7C4DFF]/30"
                : "bg-[#1C1C35]/90 text-[#9494B8] border border-white/10"
            )}>
              {rank}
            </div>
          )}

          {/* Stats overlay */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-xs text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="flex items-center gap-1">
              <Eye size={12} />
              {item.viewCountFormatted ?? item.viewCount ?? 0}
            </span>
          </div>

          {/* Anime badge */}
          {item.animeStatus === "completed" && (
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-[#7C4DFF]/90 text-[10px] font-bold text-white uppercase tracking-wide">
              Anime
            </div>
          )}
        </div>

        <div className="mt-2 px-0.5">
          <h3 className="text-sm font-medium text-[#F0F0F5] line-clamp-1 group-hover:text-[#E040FB] transition-colors">
            {item.title}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[#5C5C7A]">{item.userName ?? "Anonymous"}</span>
            {item.genre && (
              <>
                <span className="text-[#5C5C7A]">·</span>
                <span className="text-xs text-[#5C5C7A]">{item.genre.split(",")[0]}</span>
              </>
            )}
          </div>
        </div>
      </TiltCard>
    </Link>
  );
}
