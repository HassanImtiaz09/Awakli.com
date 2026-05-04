import { trpc } from "@/lib/trpc";
import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  Search, Film, ThumbsUp, Eye, Filter, ChevronDown, Sparkles, Grid3X3
} from "lucide-react";
import PageBackground from "@/components/awakli/PageBackground";

const GENRES = [
  "All", "Action", "Romance", "Fantasy", "Sci-Fi", "Horror", "Comedy",
  "Drama", "Mystery", "Slice of Life", "Mecha", "Supernatural"
];

const SORT_OPTIONS = [
  { value: "trending", label: "Trending" },
  { value: "newest", label: "Newest" },
  { value: "top_rated", label: "Top Rated" },
  { value: "most_viewed", label: "Most Viewed" },
];

export default function Explore() {
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [sortBy, setSortBy] = useState("trending");

  const genreQuery = selectedGenre === "All" ? undefined : selectedGenre;

  // Use discover.byGenre for genre filtering, or discover.trending/newReleases/topRated
  const projects = trpc.discover.byGenre.useQuery(
    { genre: genreQuery },
    { enabled: true }
  );

  const items = (projects.data ?? []) as Array<any>;

  // Client-side sort (since we have all results)
  const sorted = [...items].sort((a, b) => {
    switch (sortBy) {
      case "newest": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "top_rated": return (b.viewCount ?? 0) - (a.viewCount ?? 0);
      case "most_viewed": return (b.viewCount ?? 0) - (a.viewCount ?? 0);
      default: return (b.viewCount ?? 0) - (a.viewCount ?? 0);
    }
  });

  return (
    <div className="min-h-screen bg-bg-void text-white relative">
      <PageBackground src="https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/page-bg-explore-PGcasWryCa5q8RLdhrz68f.webp" opacity={0.4} />
      {/* Hero */}
      <section className="relative py-16 overflow-hidden" style={{ zIndex: 1 }}>
        <div className="absolute inset-0 bg-gradient-to-b from-token-lavender/5 via-transparent to-transparent" />
        <div className="container relative">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <Grid3X3 className="w-12 h-12 text-token-cyan mx-auto mb-4" />
            <h1 className="text-4xl md:text-5xl font-display font-bold mb-3">Explore</h1>
            <p className="text-gray-400 max-w-lg mx-auto">Discover AI-generated anime from creators worldwide</p>
          </motion.div>
        </div>
      </section>

      {/* Filters */}
      <section className="container pb-4 relative" style={{ zIndex: 1 }}>
        {/* Genre pills */}
        <div className="flex flex-wrap gap-2 mb-6">
          {GENRES.map((genre) => (
            <button
              key={genre}
              onClick={() => setSelectedGenre(genre)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedGenre === genre
                  ? "bg-token-violet text-white shadow-lg shadow-[#7C4DFF]/20"
                  : "bg-surface-1/50 border border-white/5 text-gray-400 hover:text-white hover:bg-surface-1/80"
              }`}
            >
              {genre}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-400">{sorted.length} projects found</p>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-surface-1/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-token-violet/50"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-surface-1 text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="container pb-20 relative" style={{ zIndex: 1 }}>
        {projects.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[...Array(15)].map((_, i) => (
              <div key={i} className="aspect-[2/3] bg-surface-1/30 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20">
            <Sparkles className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No projects found for this genre.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {sorted.map((item: any, i: number) => (
              <ExploreCard key={item.id} item={item} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ExploreCard({ item, index }: { item: any; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, delay: (index % 5) * 0.05 }}
    >
      <Link href={item.slug ? `/watch/${item.slug}` : "#"}>
        <div className="group relative rounded-xl overflow-hidden border border-white/5 bg-surface-1/30 hover:border-token-violet/20 transition-all cursor-pointer">
          <div className="aspect-[2/3] bg-surface-2 relative overflow-hidden">
            {item.coverImageUrl ? (
              <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-token-violet/20 to-token-lavender/20 flex items-center justify-center">
                <Film className="w-10 h-10 text-gray-600" />
              </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
              {item.description && (
                <p className="text-xs text-gray-300 line-clamp-3 mb-2">{item.description}</p>
              )}
              <button className="w-full py-2 rounded-lg bg-token-violet text-white text-sm font-medium">
                Watch Now
              </button>
            </div>

            {/* Genre badge */}
            {item.genre && (
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-medium bg-black/60 backdrop-blur-sm text-gray-300 border border-white/10">
                {item.genre.split(",")[0]}
              </span>
            )}
          </div>

          <div className="p-3">
            <h3 className="text-sm font-medium text-white truncate group-hover:text-token-violet transition-colors">{item.title}</h3>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {item.viewCount ?? 0}</span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
