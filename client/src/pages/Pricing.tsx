import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Check, X, Crown, Zap, Sparkles, ArrowRight, ChevronDown,
  Film, Palette, Mic, Download, Shield, Users, Star, Wand2,
  PenTool, Upload, Lock, BookOpen, Clapperboard, LayoutGrid, Table2,
  Building2, Layers, Timer, Cpu, CreditCard,
} from "lucide-react";
import { MarketingLayout } from "@/components/awakli/Layouts";
import PageBackground from "@/components/awakli/PageBackground";
import { toast } from "sonner";
import {
  TIER_DISPLAY_NAMES,
  TIER_MONTHLY_PRICE_CENTS,
  TIER_ANNUAL_MONTHLY_PRICE_CENTS,
  TIER_MONTHLY_CREDITS,
  TIER_TAGLINES,
  type TierKey,
} from "../../../shared/pricingCatalog";

type BillingInterval = "monthly" | "annual";
type PricingView = "cards" | "table";

/* ─── Tier Data (all 5 tiers from pricingCatalog) ────────────────────── */
interface TierDef {
  key: TierKey;
  name: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  narrative: string;
  icon: typeof BookOpen;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  popular?: boolean;
  ctaText: string;
  highlights: { icon: typeof BookOpen; text: string }[];
  limits: string[];
  isEnterprise?: boolean;
}

const TIERS: TierDef[] = [
  {
    key: "free_trial",
    name: TIER_DISPLAY_NAMES.free_trial,
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    narrative: "Start telling stories. Feel what creation feels like.",
    icon: BookOpen,
    accentColor: "#9494B8",
    gradientFrom: "#9494B8",
    gradientTo: "#5C5C7A",
    ctaText: "Start Creating Free",
    highlights: [
      { icon: PenTool, text: "3 manga projects" },
      { icon: Wand2, text: "AI script generation (Sonnet)" },
      { icon: Palette, text: "20 panels per chapter" },
      { icon: Users, text: "Publish & share with community" },
      { icon: Film, text: "1 anime episode (5 min, 720p)" },
      { icon: CreditCard, text: "15 credits to explore" },
    ],
    limits: [
      "3 chapters per project",
      "Watermarked output",
      "Budget model tier only",
      "14-day credit expiry",
    ],
  },
  {
    key: "creator",
    name: TIER_DISPLAY_NAMES.creator,
    monthlyPrice: TIER_MONTHLY_PRICE_CENTS.creator / 100,
    annualMonthlyPrice: TIER_ANNUAL_MONTHLY_PRICE_CENTS.creator / 100,
    narrative: "Become the animator you were always going to be.",
    icon: Zap,
    accentColor: "#7C4DFF",
    gradientFrom: "#7C4DFF",
    gradientTo: "#B388FF",
    popular: true,
    ctaText: `Upgrade to ${TIER_DISPLAY_NAMES.creator}`,
    highlights: [
      { icon: PenTool, text: "10 manga projects" },
      { icon: Wand2, text: "AI script generation (Opus)" },
      { icon: Palette, text: "30 panels per chapter" },
      { icon: Film, text: "5 anime episodes/month (15 min, 1080p)" },
      { icon: Mic, text: "2 voice clones" },
      { icon: Download, text: "Export manga (PDF, PNG) + anime (MP4)" },
      { icon: Star, text: "80% revenue share" },
      { icon: CreditCard, text: `${TIER_MONTHLY_CREDITS.creator} credits/month` },
      { icon: Layers, text: "Appearance LoRA (3 characters)" },
    ],
    limits: [],
  },
  {
    key: "creator_pro",
    name: TIER_DISPLAY_NAMES.creator_pro,
    monthlyPrice: TIER_MONTHLY_PRICE_CENTS.creator_pro / 100,
    annualMonthlyPrice: TIER_ANNUAL_MONTHLY_PRICE_CENTS.creator_pro / 100,
    narrative: "The full pipeline. Every tool. No compromises.",
    icon: Crown,
    accentColor: "#E040FB",
    gradientFrom: "#E040FB",
    gradientTo: "#AA00FF",
    ctaText: `Go ${TIER_DISPLAY_NAMES.creator_pro}`,
    highlights: [
      { icon: PenTool, text: "50 manga projects" },
      { icon: Palette, text: "50 panels per chapter" },
      { icon: Film, text: "15 anime episodes/month (30 min, 1080p)" },
      { icon: Mic, text: "10 voice clones + custom narrator" },
      { icon: Upload, text: "Upload your own manga" },
      { icon: Download, text: "Export all formats (PDF, PNG, ZIP, MP4)" },
      { icon: Star, text: "85% revenue share" },
      { icon: CreditCard, text: `${TIER_MONTHLY_CREDITS.creator_pro} credits/month + 20% rollover` },
      { icon: Zap, text: "Motion LoRA (5 trainings/mo)" },
      { icon: Users, text: "3 team seats" },
      { icon: Shield, text: "Priority generation queue" },
    ],
    limits: [],
  },
  {
    key: "studio",
    name: TIER_DISPLAY_NAMES.studio,
    monthlyPrice: TIER_MONTHLY_PRICE_CENTS.studio / 100,
    annualMonthlyPrice: TIER_ANNUAL_MONTHLY_PRICE_CENTS.studio / 100,
    narrative: "Run the studio. Ship the universe.",
    icon: Clapperboard,
    accentColor: "#00FFB2",
    gradientFrom: "#00FFB2",
    gradientTo: "#00BFA5",
    ctaText: `Go ${TIER_DISPLAY_NAMES.studio}`,
    highlights: [
      { icon: PenTool, text: "Unlimited projects" },
      { icon: Palette, text: "Unlimited panels" },
      { icon: Film, text: "Unlimited anime episodes (60 min, 4K)" },
      { icon: Mic, text: "Unlimited voice clones + custom narrator" },
      { icon: Upload, text: "Upload your own manga" },
      { icon: Download, text: "All exports (4K, ProRes, stems, SRT)" },
      { icon: Star, text: "90% revenue share" },
      { icon: CreditCard, text: `${TIER_MONTHLY_CREDITS.studio} credits/month + 50% rollover` },
      { icon: Zap, text: "Motion LoRA (20 trainings/mo) — Flagship stack" },
      { icon: Users, text: "10 team seats" },
      { icon: Shield, text: "Priority queue + priority support" },
      { icon: Cpu, text: "API access + analytics" },
    ],
    limits: [],
  },
  {
    key: "enterprise",
    name: TIER_DISPLAY_NAMES.enterprise,
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    narrative: "Custom solutions at scale. White-label. Dedicated infrastructure.",
    icon: Building2,
    accentColor: "#FFD700",
    gradientFrom: "#FFD700",
    gradientTo: "#FFA000",
    ctaText: "Contact Sales",
    isEnterprise: true,
    highlights: [
      { icon: PenTool, text: "Unlimited everything" },
      { icon: Film, text: "All model tiers including Ultra" },
      { icon: Cpu, text: "10 concurrent generations" },
      { icon: CreditCard, text: "Custom credit allocation + 100% rollover" },
      { icon: Users, text: "Unlimited team seats" },
      { icon: Shield, text: "Dedicated support + SLA" },
      { icon: Download, text: "30% credit pack discount" },
      { icon: Lock, text: "White-label + API access" },
    ],
    limits: [],
  },
];

/* ─── Comparison Table Data (all 5 tiers) ────────────────────────────── */
interface ComparisonRow {
  label: string;
  free_trial: string | boolean;
  creator: string | boolean;
  creator_pro: string | boolean;
  studio: string | boolean;
  enterprise: string | boolean;
}

const COMPARISON_SECTIONS: { title: string; rows: ComparisonRow[] }[] = [
  {
    title: "Manga Creation",
    rows: [
      { label: "Projects", free_trial: "3", creator: "10", creator_pro: "50", studio: "Unlimited", enterprise: "Unlimited" },
      { label: "Chapters per project", free_trial: "3", creator: "12", creator_pro: "50", studio: "Unlimited", enterprise: "Unlimited" },
      { label: "Panels per chapter", free_trial: "20", creator: "30", creator_pro: "50", studio: "Unlimited", enterprise: "Unlimited" },
      { label: "Script AI model", free_trial: "Claude Sonnet", creator: "Claude Opus", creator_pro: "Claude Opus", studio: "Claude Opus", enterprise: "Claude Opus" },
      { label: "Image generation", free_trial: "FLUX 1.1 Pro", creator: "FLUX 1.1 Pro", creator_pro: "FLUX 1.1 Pro", studio: "FLUX 1.1 Pro", enterprise: "FLUX 1.1 Pro" },
      { label: "Upload your own manga", free_trial: false, creator: false, creator_pro: true, studio: true, enterprise: true },
    ],
  },
  {
    title: "Anime Production",
    rows: [
      { label: "Anime episodes/month", free_trial: "1", creator: "5", creator_pro: "15", studio: "Unlimited", enterprise: "Unlimited" },
      { label: "Episode length cap", free_trial: "5 min", creator: "15 min", creator_pro: "30 min", studio: "60 min", enterprise: "120 min" },
      { label: "Video resolution", free_trial: "720p", creator: "1080p", creator_pro: "1080p", studio: "4K", enterprise: "4K" },
      { label: "Model tiers", free_trial: "Budget", creator: "Budget + Standard", creator_pro: "Budget–Premium", studio: "All (incl. Ultra)", enterprise: "All (incl. Ultra)" },
      { label: "Concurrent generations", free_trial: "1", creator: "2", creator_pro: "3", studio: "5", enterprise: "10" },
      { label: "LoRA character models", free_trial: "0", creator: "3", creator_pro: "10", studio: "Unlimited", enterprise: "Unlimited" },
      { label: "LoRA stack layers", free_trial: "None", creator: "Appearance", creator_pro: "Appearance + Motion", studio: "All 4 (Flagship)", enterprise: "All 4 (Flagship)" },
      { label: "Motion LoRA trainings/mo", free_trial: "\u2014", creator: "\u2014", creator_pro: "5", studio: "20", enterprise: "Unlimited" },
      { label: "Voice clones", free_trial: "0", creator: "2", creator_pro: "10", studio: "Unlimited", enterprise: "Unlimited" },
      { label: "Custom narrator voice", free_trial: false, creator: false, creator_pro: true, studio: true, enterprise: true },
    ],
  },
  {
    title: "Credits & Economy",
    rows: [
      { label: "Monthly credits", free_trial: "15", creator: "200", creator_pro: "600", studio: "2,000", enterprise: "Custom" },
      { label: "Credit rollover", free_trial: "\u2014", creator: "\u2014", creator_pro: "20% (cap 240)", studio: "50% (cap 1,800)", enterprise: "100% (no cap)" },
      { label: "Credit pack discount", free_trial: "\u2014", creator: "\u2014", creator_pro: "10%", studio: "20%", enterprise: "30%" },
      { label: "Credit expiry", free_trial: "14 days", creator: "End of period", creator_pro: "End of period", studio: "End of period", enterprise: "Never" },
    ],
  },
  {
    title: "Export & Monetization",
    rows: [
      { label: "Manga export (PDF/PNG)", free_trial: false, creator: true, creator_pro: true, studio: true, enterprise: true },
      { label: "Anime export (MP4)", free_trial: false, creator: true, creator_pro: true, studio: true, enterprise: true },
      { label: "ProRes / stems export", free_trial: false, creator: false, creator_pro: false, studio: true, enterprise: true },
      { label: "Subtitle export (SRT)", free_trial: false, creator: true, creator_pro: true, studio: true, enterprise: true },
      { label: "Watermark-free", free_trial: false, creator: true, creator_pro: true, studio: true, enterprise: true },
      { label: "Revenue share", free_trial: "\u2014", creator: "80%", creator_pro: "85%", studio: "90%", enterprise: "90%" },
    ],
  },
  {
    title: "Platform & Support",
    rows: [
      { label: "Team seats", free_trial: "1", creator: "1", creator_pro: "3", studio: "10", enterprise: "Unlimited" },
      { label: "Publish to Discover", free_trial: true, creator: true, creator_pro: true, studio: true, enterprise: true },
      { label: "Priority generation queue", free_trial: false, creator: false, creator_pro: true, studio: true, enterprise: true },
      { label: "Priority support", free_trial: false, creator: false, creator_pro: false, studio: true, enterprise: true },
      { label: "API access", free_trial: false, creator: false, creator_pro: false, studio: true, enterprise: true },
      { label: "Dedicated SLA", free_trial: false, creator: false, creator_pro: false, studio: false, enterprise: true },
    ],
  },
];

const TIER_COLUMN_KEYS: TierKey[] = ["free_trial", "creator", "creator_pro", "studio", "enterprise"];

const FAQS = [
  {
    q: "What\u2019s the difference between Apprentice and Mangaka?",
    a: `Apprentice lets you create manga from text and publish to the community with 15 credits. ${TIER_DISPLAY_NAMES.creator} unlocks anime production (5 episodes/month), voice clones, manga export, and monetization with 80% revenue share. Think of Apprentice as your playground and ${TIER_DISPLAY_NAMES.creator} as your studio.`,
  },
  {
    q: `What does ${TIER_DISPLAY_NAMES.creator_pro} add over ${TIER_DISPLAY_NAMES.creator}?`,
    a: `${TIER_DISPLAY_NAMES.creator_pro} unlocks the full pipeline: 15 anime episodes/month (30 min each), custom narrator voice, Motion LoRA (5 trainings/mo), upload your own manga, 3 team seats, priority queue, 20% credit rollover, and 85% revenue share. It\u2019s the tier for serious creators who want every tool at their disposal.`,
  },
  {
    q: `Why would I need ${TIER_DISPLAY_NAMES.studio}?`,
    a: `${TIER_DISPLAY_NAMES.studio} is for production teams: unlimited episodes at 4K, all model tiers including Ultra, the Flagship LoRA stack (all 4 layers), 20 Motion LoRA trainings/month, ProRes/stems export, 10 team seats, API access, and 90% revenue share. If you\u2019re running a studio or producing at scale, this is your tier.`,
  },
  {
    q: "Can I upgrade or downgrade anytime?",
    a: "Yes! Upgrades are prorated and take effect immediately. Downgrades apply at the end of your current billing cycle. You keep access to all features until then.",
  },
  {
    q: "What happens to my content if I downgrade?",
    a: "Your content is never deleted. You keep everything you\u2019ve created. You just won\u2019t be able to create new content beyond the lower tier\u2019s limits until you upgrade again.",
  },
  {
    q: "What are credits and how do they work?",
    a: "Credits are Awakli\u2019s universal currency for AI generation. Each action (script generation, panel creation, video rendering, voice synthesis) costs a set number of credits. Your tier includes a monthly allocation, and you can buy top-up packs anytime. Higher tiers get pack discounts and credit rollover.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards, debit cards, and Apple Pay / Google Pay through Stripe. All payments are processed securely.",
  },
  {
    q: "Is there a refund policy?",
    a: "We offer a 14-day no-questions refund on subscriptions. Credits already consumed are non-refundable. See our full Refund Policy for details.",
  },
];

/* ─── Scroll Reveal ───────────────────────────────────────────────────── */
function ScrollReveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40, scale: 0.96 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 40, scale: 0.96 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   NARRATIVE TIER SCENE
   Each tier is a cinematic scene, not a box
   ═══════════════════════════════════════════════════════════════════════ */
function TierScene({
  tier,
  interval,
  onSubscribe,
  isPending,
  index,
}: {
  tier: TierDef;
  interval: BillingInterval;
  onSubscribe: (key: TierKey) => void;
  isPending: boolean;
  index: number;
}) {
  const Icon = tier.icon;
  const price = interval === "annual" ? tier.annualMonthlyPrice : tier.monthlyPrice;

  return (
    <ScrollReveal delay={index * 0.08}>
      <motion.section
        className="relative min-h-[60vh] flex items-center overflow-hidden rounded-3xl border border-white/5 mb-8 transition-all"
        style={{
          background: `linear-gradient(135deg, ${tier.gradientFrom}08, ${tier.gradientTo}04, #0D0D1A)`,
        }}
        whileHover={{ borderColor: `${tier.accentColor}30`, boxShadow: `0 0 60px ${tier.accentColor}15, 0 8px 32px ${tier.accentColor}10` }}
      >
        {/* Accent glow */}
        <div
          className="absolute top-1/2 right-0 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[150px] opacity-15"
          style={{ backgroundColor: tier.accentColor }}
        />

        <div className="relative z-10 w-full px-8 md:px-16 py-12">
          <div className={`flex flex-col ${index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} items-center gap-12 md:gap-20`}>
            {/* Text side */}
            <div className="flex-1 max-w-lg">
              {/* Badge */}
              {tier.popular && (
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#7C4DFF]/10 border border-[#7C4DFF]/30 text-[#E040FB] text-xs font-semibold mb-4">
                  <Star className="w-3 h-3 fill-current" />
                  Most Popular
                </div>
              )}

              {/* Icon + Name */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${tier.gradientFrom}, ${tier.gradientTo})`,
                  }}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-3xl md:text-4xl font-display font-bold text-white">
                  {tier.name}
                </h2>
              </div>

              {/* Narrative copy */}
              <p
                className="text-xl md:text-2xl font-heading leading-relaxed mb-6"
                style={{ color: tier.accentColor }}
              >
                {tier.narrative}
              </p>

              {/* Price */}
              <div className="mb-8">
                {tier.isEnterprise ? (
                  <>
                    <span className="text-4xl font-display font-bold text-white">Custom</span>
                    <span className="text-[#5C5C7A] ml-2 text-lg">pricing</span>
                  </>
                ) : (
                  <>
                    <span className="text-5xl font-display font-bold text-white">
                      ${price === 0 ? "0" : price}
                    </span>
                    <span className="text-[#5C5C7A] ml-2 text-lg">
                      {price === 0 ? "/forever" : "/mo"}
                    </span>
                    {interval === "annual" && price > 0 && (
                      <p className="text-xs text-[#E040FB] mt-1 font-mono">
                        Billed ${price * 12}/year (save ${(tier.monthlyPrice - tier.annualMonthlyPrice) * 12}/yr)
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* CTA */}
              <motion.button
                whileHover={{ scale: 1.03, boxShadow: `0 0 40px ${tier.accentColor}40` }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onSubscribe(tier.key)}
                disabled={isPending}
                className="px-8 py-4 rounded-xl font-semibold text-white text-base transition-all disabled:opacity-50 shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${tier.gradientFrom}, ${tier.gradientTo})`,
                  boxShadow: `0 8px 32px ${tier.accentColor}25`,
                }}
              >
                {isPending ? "Processing..." : tier.ctaText}
              </motion.button>

              {/* Limits for free tier */}
              {tier.limits.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2">
                  {tier.limits.map((l) => (
                    <span key={l} className="px-3 py-1 rounded-full bg-white/5 text-[#5C5C7A] text-xs border border-white/5">
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Feature list side */}
            <div className="flex-1 max-w-md">
              <div className="space-y-3">
                {tier.highlights.map((h, j) => {
                  const HIcon = h.icon;
                  return (
                    <motion.div
                      key={j}
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: j * 0.05 + 0.2 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${tier.accentColor}15` }}
                      >
                        <HIcon className="w-4 h-4" style={{ color: tier.accentColor }} />
                      </div>
                      <span className="text-sm text-[#F0F0F5]">{h.text}</span>
                    </motion.div>
                  );
                })}
              </div>

              {/* Refund policy card */}
              <div className="mt-6 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <p className="text-xs text-[#5C5C7A] leading-relaxed">
                  <Shield className="w-3.5 h-3.5 inline mr-1.5 text-[#00FFB2]" />
                  14-day no-questions refund. Credits consumed are non-refundable.{" "}
                  <Link href="/refund">
                    <span className="text-[#E040FB] hover:underline cursor-pointer">Full policy</span>
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.section>
    </ScrollReveal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPARISON TABLE CELL
   ═══════════════════════════════════════════════════════════════════════ */
function ComparisonCell({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return (
      <div className="flex justify-center">
        {value ? (
          <Check className="w-5 h-5 text-[#00FFB2]" />
        ) : (
          <X className="w-5 h-5 text-[#2A2A40]" />
        )}
      </div>
    );
  }
  return (
    <div className="text-sm text-white text-center font-medium">
      {value === "0" || value === "\u2014" ? (
        <span className="text-[#5C5C7A]">{value}</span>
      ) : (
        value
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PRICING PAGE
   ═══════════════════════════════════════════════════════════════════════ */
export default function Pricing() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [view, setView] = useState<PricingView>("cards");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const checkout = trpc.billing.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Redirecting to checkout...");
        window.open(data.url, "_blank");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create checkout session");
    },
  });

  const handleSubscribe = (tierKey: TierKey) => {
    if (tierKey === "enterprise") {
      toast.info("Enterprise inquiries — contact us at hello@awakli.com");
      return;
    }
    if (!isAuthenticated) {
      navigate("/signup");
      return;
    }
    if (tierKey === "free_trial") {
      navigate("/create");
      return;
    }
    // tierKey is "creator" | "creator_pro" | "studio" — matches server enum
    checkout.mutate({ tier: tierKey as "creator" | "creator_pro" | "studio", interval });
  };

  return (
    <MarketingLayout>
      <PageBackground src="https://d2xsxph8kpxj0f.cloudfront.net/310519663430072618/4V9sAd2k2m2djZEsU8bXCJ/page-bg-pricing-HaVAWWEjDUAQYS42eNKgym.webp" opacity={0.35} />
      <div className="pt-28 pb-24 relative" style={{ zIndex: 1 }}>
        <div className="container">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#7C4DFF]/30 bg-[#7C4DFF]/5 text-[#E040FB] text-xs font-semibold mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              Choose your story
            </div>
            <h1 className="text-display text-white mb-4">
              Every creator has a{" "}
              <span className="text-gradient-opening">chapter one.</span>
            </h1>
            <p className="text-[#9494B8] max-w-2xl mx-auto text-lg mb-8">
              Start free. Upgrade when your story demands it.
            </p>

            {/* Controls row: billing toggle + view toggle */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {/* Billing toggle */}
              <div className="inline-flex items-center gap-1 p-1 rounded-full bg-[#0D0D1A] border border-white/10">
                <button
                  onClick={() => setInterval("monthly")}
                  className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                    interval === "monthly"
                      ? "bg-opening-sequence text-white shadow-lg"
                      : "text-[#5C5C7A] hover:text-white"
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setInterval("annual")}
                  className={`px-5 py-2 rounded-full text-sm font-medium transition-all relative ${
                    interval === "annual"
                      ? "bg-opening-sequence text-white shadow-lg"
                      : "text-[#5C5C7A] hover:text-white"
                  }`}
                >
                  Annual
                  <span className="ml-2 text-xs text-[#E040FB] font-bold">Save 20%</span>
                </button>
              </div>

              {/* View toggle */}
              <div className="inline-flex items-center gap-1 p-1 rounded-full bg-[#0D0D1A] border border-white/10">
                <button
                  onClick={() => setView("cards")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    view === "cards"
                      ? "bg-white/10 text-white"
                      : "text-[#5C5C7A] hover:text-white"
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Cards
                </button>
                <button
                  onClick={() => setView("table")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    view === "table"
                      ? "bg-white/10 text-white"
                      : "text-[#5C5C7A] hover:text-white"
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  Compare
                </button>
              </div>
            </div>
          </motion.div>

          {/* Five narrative scenes OR comparison table */}
          {view === "cards" ? (
            <>
              {TIERS.map((tier, i) => (
                <TierScene
                  key={tier.key}
                  tier={tier}
                  interval={interval}
                  onSubscribe={handleSubscribe}
                  isPending={checkout.isPending}
                  index={i}
                />
              ))}
            </>
          ) : (
            /* Comparison table — all 5 tiers */
            <ScrollReveal>
              <div className="max-w-7xl mx-auto mb-8 overflow-x-auto">
                <div className="min-w-[800px] rounded-2xl border border-white/5 overflow-hidden bg-[#0D0D1A]">
                  {/* Header */}
                  <div className="grid grid-cols-6 gap-2 p-4 border-b border-white/10 bg-[#151528] sticky top-16 z-10">
                    <div className="text-sm font-semibold text-[#9494B8]">Feature</div>
                    {TIERS.map((t) => (
                      <div key={t.key} className="text-sm font-semibold text-white text-center">
                        <span style={{ color: t.accentColor }}>{t.name}</span>
                        <span className="block text-xs text-[#5C5C7A] font-normal mt-0.5">
                          {t.isEnterprise
                            ? "Custom"
                            : t.monthlyPrice === 0
                            ? "Free"
                            : `$${interval === "annual" ? t.annualMonthlyPrice : t.monthlyPrice}/mo`}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Sections */}
                  {COMPARISON_SECTIONS.map((section) => (
                    <div key={section.title}>
                      <div className="px-4 py-3 bg-[#0A0A18] border-b border-white/5">
                        <span className="text-xs font-bold text-[#E040FB] uppercase tracking-wider">
                          {section.title}
                        </span>
                      </div>
                      {section.rows.map((row, i) => (
                        <div
                          key={row.label}
                          className={`grid grid-cols-6 gap-2 px-4 py-3 ${
                            i < section.rows.length - 1 ? "border-b border-white/5" : ""
                          } hover:bg-white/[0.02] transition-colors`}
                        >
                          <div className="text-sm text-[#9494B8]">{row.label}</div>
                          {TIER_COLUMN_KEYS.map((tierKey) => (
                            <ComparisonCell key={tierKey} value={row[tierKey]} />
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* CTA row at bottom of table */}
                  <div className="grid grid-cols-6 gap-2 p-4 border-t border-white/10 bg-[#151528]">
                    <div />
                    {TIERS.map((t) => (
                      <div key={t.key} className="flex justify-center">
                        <button
                          onClick={() => handleSubscribe(t.key)}
                          disabled={checkout.isPending}
                          className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 whitespace-nowrap"
                          style={{
                            background: `linear-gradient(135deg, ${t.gradientFrom}, ${t.gradientTo})`,
                          }}
                        >
                          {t.ctaText}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollReveal>
          )}

          {/* Anime Preview Callout */}
          <ScrollReveal>
            <div className="max-w-3xl mx-auto my-16 p-8 rounded-2xl border border-[#E040FB]/20 bg-gradient-to-r from-[#E040FB]/5 to-transparent">
              <div className="flex items-start gap-6">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#E040FB] to-[#AA00FF] flex items-center justify-center shrink-0">
                  <Film className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-heading font-bold text-white mb-2">
                    Free Anime Preview for Everyone
                  </h3>
                  <p className="text-[#9494B8] text-sm leading-relaxed mb-4">
                    Every user gets one complimentary 15-second anime preview. See your manga come alive
                    with AI-generated animation, voice acting, and music. No credit card required.
                  </p>
                  <Link href="/create" className="inline-flex items-center gap-2 text-[#E040FB] text-sm font-semibold hover:underline">
                    Create your first manga <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Full comparison table (always visible, below cards) */}
          <ScrollReveal>
            <div className="max-w-7xl mx-auto mb-24 overflow-x-auto">
              <h2 className="text-h1 text-white text-center mb-4">
                Full Feature Comparison
              </h2>
              <p className="text-[#5C5C7A] text-center mb-10">
                Every detail, side by side
              </p>

              <div className="min-w-[800px] rounded-2xl border border-white/5 overflow-hidden bg-[#0D0D1A]">
                {/* Header */}
                <div className="grid grid-cols-6 gap-2 p-4 border-b border-white/10 bg-[#151528] sticky top-0 z-10">
                  <div className="text-sm font-semibold text-[#9494B8]">Feature</div>
                  {TIERS.map((t) => (
                    <div key={t.key} className="text-sm font-semibold text-white text-center">
                      <span style={{ color: t.accentColor }}>{t.name}</span>
                      <span className="block text-xs text-[#5C5C7A] font-normal mt-0.5">
                        {t.isEnterprise
                          ? "Custom"
                          : t.monthlyPrice === 0
                          ? "Free"
                          : `$${interval === "annual" ? t.annualMonthlyPrice : t.monthlyPrice}/mo`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Sections */}
                {COMPARISON_SECTIONS.map((section) => (
                  <div key={section.title}>
                    <div className="px-4 py-3 bg-[#0A0A18] border-b border-white/5">
                      <span className="text-xs font-bold text-[#E040FB] uppercase tracking-wider">
                        {section.title}
                      </span>
                    </div>
                    {section.rows.map((row, i) => (
                      <div
                        key={row.label}
                        className={`grid grid-cols-6 gap-2 px-4 py-3 ${
                          i < section.rows.length - 1 ? "border-b border-white/5" : ""
                        } hover:bg-white/[0.02] transition-colors`}
                      >
                        <div className="text-sm text-[#9494B8]">{row.label}</div>
                        {TIER_COLUMN_KEYS.map((tierKey) => (
                          <ComparisonCell key={tierKey} value={row[tierKey]} />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </ScrollReveal>

          {/* FAQ */}
          <ScrollReveal>
            <div className="max-w-3xl mx-auto mb-24">
              <h2 className="text-h1 text-white text-center mb-4">
                Frequently Asked Questions
              </h2>
              <p className="text-[#5C5C7A] text-center mb-10">
                Everything you need to know about Awakli plans
              </p>

              <div className="space-y-3">
                {FAQS.map((faq, i) => (
                  <motion.div
                    key={i}
                    initial={false}
                    className="rounded-xl border border-white/5 bg-[#0D0D1A] overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                      className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <span className="text-sm font-semibold text-white pr-4">{faq.q}</span>
                      <ChevronDown
                        className={`w-5 h-5 text-[#5C5C7A] shrink-0 transition-transform ${
                          expandedFaq === i ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    <AnimatePresence>
                      {expandedFaq === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <p className="px-5 pb-5 text-sm text-[#9494B8] leading-relaxed">
                            {faq.a}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </div>
          </ScrollReveal>

          {/* Bottom CTA */}
          <ScrollReveal>
            <div className="text-center">
              <h3 className="text-h2 text-white mb-3">
                Ready to bring your stories to life?
              </h3>
              <p className="text-[#5C5C7A] mb-6">
                Start creating manga for free. No credit card required.
              </p>
              <Link href="/create">
                <motion.span
                  whileHover={{ scale: 1.03, boxShadow: "0 0 40px rgba(124,77,255,0.4)" }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-opening-sequence text-white font-semibold shadow-lg shadow-[#7C4DFF]/25 cursor-pointer"
                >
                  <Wand2 className="w-5 h-5" />
                  Start Creating Free
                  <ArrowRight className="w-5 h-5" />
                </motion.span>
              </Link>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </MarketingLayout>
  );
}
