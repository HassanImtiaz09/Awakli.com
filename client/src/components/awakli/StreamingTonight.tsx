import { motion } from "framer-motion";
import { Play, Eye } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   B4 — "What's Streaming Tonight" band
   Shows 6 real manga covers with play overlay, genre chip, title, author.
   Falls back to "More coming tonight" if fewer than 1 live title.
   ═══════════════════════════════════════════════════════════════════════ */

const GENRE_COLORS: Record<string, string> = {
  action:    "var(--token-cyan)",
  romance:   "var(--token-violet)",
  fantasy:   "var(--token-gold)",
  horror:    "#FF4444",
  comedy:    "#FF6E7F",
  drama:     "#B8B8CC",
  scifi:     "var(--token-cyan)",
  slice:     "#88CC88",
};

function getGenreColor(genre?: string): string {
  if (!genre) return "var(--token-cyan)";
  const key = genre.toLowerCase().replace(/[^a-z]/g, "");
  return GENRE_COLORS[key] ?? "var(--token-cyan)";
}

export function StreamingTonight() {
  const trending = trpc.discover.trending.useQuery(undefined, { staleTime: 60_000 });

  const liveProjects = useMemo(() => {
    if (!trending.data) return [];
    return trending.data
      .filter((p: any) => p.title && p.coverUrl && p.slug)
      .slice(0, 6);
  }, [trending.data]);

  if (trending.isLoading) {
    return (
      <section className="py-16" data-component="streaming-tonight">
        <div className="container">
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-48 shrink-0 animate-pulse">
                <div className="aspect-[3/4] rounded-xl bg-white/5" />
                <div className="h-4 mt-3 rounded bg-white/5 w-3/4" />
                <div className="h-3 mt-2 rounded bg-white/5 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (liveProjects.length === 0) {
    return (
      <section className="py-12" data-component="streaming-tonight">
        <div className="container text-center">
          <p className="text-[#6B6B8A] text-sm">More titles streaming tonight — check back soon.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative py-16 overflow-hidden" data-component="streaming-tonight">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-10 blur-[100px]"
          style={{ background: "var(--token-cyan)" }}
        />
      </div>

      <div className="container relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-between mb-8"
        >
          <div>
            <h2 className="text-h2 text-white flex items-center gap-3">
              <Eye size={24} className="text-[var(--token-cyan)]" />
              What&rsquo;s streaming tonight
            </h2>
            <p className="text-[#6B6B8A] text-sm mt-1">
              Free to watch &middot; no sign-in required
            </p>
          </div>
          <Link
            href="/discover"
            className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 text-white/70 text-sm hover:text-white hover:border-white/20 transition-colors"
          >
            See all
          </Link>
        </motion.div>

        {/* Cover grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {liveProjects.map((project: any, i: number) => {
            const genreColor = getGenreColor(project.genre);
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <Link href={`/watch/${project.slug}`}>
                  <div className="group relative aspect-[3/4] rounded-xl overflow-hidden border border-white/5 hover:border-white/15 transition-all cursor-pointer">
                    {/* Cover image */}
                    <img
                      src={project.coverUrl}
                      alt={project.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />

                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                        <Play size={20} className="text-white ml-0.5" fill="white" />
                      </div>
                    </div>

                    {/* Genre chip */}
                    {project.genre && (
                      <span
                        className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                        style={{
                          color: genreColor,
                          background: `color-mix(in oklch, ${genreColor}, transparent 85%)`,
                          border: `1px solid color-mix(in oklch, ${genreColor}, transparent 60%)`,
                        }}
                      >
                        {project.genre}
                      </span>
                    )}

                    {/* Title + author */}
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="text-white text-sm font-semibold truncate">{project.title}</p>
                      {project.authorName && (
                        <p className="text-white/50 text-xs mt-0.5 truncate">by {project.authorName}</p>
                      )}
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default StreamingTonight;
