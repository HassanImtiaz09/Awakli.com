import { useEffect } from "react";

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: "website" | "article" | "video.other";
  jsonLd?: Record<string, any>;
}

const DEFAULT_TITLE = "Awakli — Turn Your Ideas Into Anime";
const DEFAULT_DESCRIPTION = "Create manga from your story ideas and watch them become anime with AI.";
const DEFAULT_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/hero-anime-1-XN9AD8awyDsfJqHWbpYC62.webp";

/**
 * SEOHead: updates document <head> meta tags dynamically for each page.
 * For SSR-rendered OG tags, see the server-side /api/og/:slug endpoint.
 */
export function SEOHead({ title, description, image, url, type = "website", jsonLd }: SEOProps) {
  useEffect(() => {
    const fullTitle = title ? `${title} | Awakli` : DEFAULT_TITLE;
    const desc = description || DEFAULT_DESCRIPTION;
    const img = image || DEFAULT_IMAGE;
    const pageUrl = url || window.location.href;

    // Update document title
    document.title = fullTitle;

    // Helper to set/create meta tags
    const setMeta = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    // Standard meta
    setMeta("name", "description", desc);

    // Open Graph
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:image", img);
    setMeta("property", "og:url", pageUrl);
    setMeta("property", "og:type", type);

    // Twitter Card
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", desc);
    setMeta("name", "twitter:image", img);

    // JSON-LD structured data
    const existingLd = document.querySelector('script[data-seo-jsonld]');
    if (existingLd) existingLd.remove();

    if (jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute("data-seo-jsonld", "true");
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      // Cleanup JSON-LD on unmount
      const ld = document.querySelector('script[data-seo-jsonld]');
      if (ld) ld.remove();
    };
  }, [title, description, image, url, type, jsonLd]);

  return null;
}

// ─── JSON-LD helpers ────────────────────────────────────────────────────────

export function buildMangaJsonLd(project: {
  title: string;
  description?: string | null;
  coverImageUrl?: string | null;
  slug?: string | null;
  userName?: string | null;
  genre?: string | null;
  createdAt?: string | number | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: project.title,
    description: project.description || `${project.title} on Awakli`,
    image: project.coverImageUrl || DEFAULT_IMAGE,
    url: project.slug ? `${window.location.origin}/watch/${project.slug}` : window.location.href,
    author: project.userName ? { "@type": "Person", name: project.userName } : undefined,
    genre: project.genre || undefined,
    datePublished: project.createdAt ? new Date(project.createdAt).toISOString() : undefined,
    publisher: {
      "@type": "Organization",
      name: "Awakli",
      url: window.location.origin,
    },
  };
}

export function buildEpisodeJsonLd(episode: {
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  projectTitle: string;
  projectSlug: string;
  episodeNumber: number;
  duration?: number | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${episode.projectTitle} - Episode ${episode.episodeNumber}: ${episode.title}`,
    description: episode.description || `Episode ${episode.episodeNumber} of ${episode.projectTitle}`,
    thumbnailUrl: episode.thumbnailUrl || DEFAULT_IMAGE,
    url: `${window.location.origin}/watch/${episode.projectSlug}/${episode.episodeNumber}`,
    duration: episode.duration ? `PT${Math.round(episode.duration)}S` : undefined,
    uploadDate: new Date().toISOString(),
    publisher: {
      "@type": "Organization",
      name: "Awakli",
      url: window.location.origin,
    },
  };
}
