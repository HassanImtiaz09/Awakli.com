import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { MarketingLayout } from "@/components/awakli/Layouts";
import { SEOHead } from "@/components/awakli/SEOHead";
import { AwakliButton } from "@/components/awakli/AwakliButton";
import { AwakliInput, AwakliTextarea } from "@/components/awakli/AwakliInput";
import { toast } from "sonner";
import {
  ArrowRight, Check, Sparkles, Shield, Palette, Film,
  PenTool, Layers, ExternalLink,
} from "lucide-react";

/* ─── Scroll Reveal ───────────────────────────────────────────────────── */
function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 32 }}
      transition={{ duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── Output Track Selector ───────────────────────────────────────────── */
const OUTPUT_TRACKS = [
  {
    value: "manga" as const,
    label: "Manga",
    desc: "Publish manga chapters on the platform",
    icon: <PenTool size={18} />,
  },
  {
    value: "genga" as const,
    label: "Genga",
    desc: "Key animation frames and collector art",
    icon: <Layers size={18} />,
  },
  {
    value: "full_anime" as const,
    label: "Full Anime",
    desc: "End-to-end episodes through the 17-stage pipeline",
    icon: <Film size={18} />,
  },
];

/* ─── Value Prop Items ────────────────────────────────────────────────── */
const VALUE_PROPS = [
  {
    icon: <Sparkles size={20} className="text-[#E040FB]" />,
    title: "Free Studio-tier access for 6 months",
    detail: "1,800 credits/month plus on-demand compute covered by Awakli — capacity for ~200 episodes during the program. Worth ~$3,000.",
  },
  {
    icon: <Shield size={20} className="text-[#7C4DFF]" />,
    title: "Full IP retention",
    detail: "You own everything you make, on or off the platform. No lock-in, no licensing traps.",
  },
  {
    icon: <Palette size={20} className="text-[#FFD60A]" />,
    title: "70% revenue share from day one",
    detail: "Founders earn 70% on platform monetization — vs 50% for standard Pro+ creators.",
  },
  {
    icon: <Film size={20} className="text-[#00E5A0]" />,
    title: "Shape the platform's aesthetic",
    detail: "Your HITL decisions across all 17 pipeline stages train per-character LoRAs and the Sakufuu signature LoRA. You're literally defining how this tool sees anime.",
  },
  {
    icon: <Check size={20} className="text-[#E040FB]" />,
    title: "Founder-tier badge & permanent attribution",
    detail: "Your name in the platform credits. Permanent recognition as a founding creator.",
  },
  {
    icon: <ArrowRight size={20} className="text-[#9494B8]" />,
    title: "No rugpull",
    detail: "Auto-converts to Free tier after 6 months. All your work, LoRAs, and rights are preserved.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════
   FOUNDERS' STUDIO PAGE
   Pipeline Blueprint v1.9 §7C — Selective recruitment for ~20 creators
   ═══════════════════════════════════════════════════════════════════════ */
export default function Founders() {
  const { user } = useAuth();
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState("");
  const [outputTrack, setOutputTrack] = useState<"manga" | "genga" | "full_anime" | null>(null);
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [genreFocus, setGenreFocus] = useState("");
  const [pitch, setPitch] = useState("");

  const submitMutation = trpc.founders.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Interest submitted — we'll be in touch if there's a fit.");
    },
    onError: (err) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outputTrack) {
      toast.error("Please select your primary output track.");
      return;
    }
    if (pitch.length < 20) {
      toast.error("Tell us a bit more about what you'd make — at least a couple of sentences.");
      return;
    }
    submitMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      outputTrack,
      portfolioUrl: portfolioUrl.trim(),
      genreFocus: genreFocus.trim() || undefined,
      pitch: pitch.trim(),
    });
  };

  return (
    <MarketingLayout>
      <SEOHead
        title="Founders' Studio — Cohort 1"
        description="Join a hand-selected cohort of ~20 working creators shaping the future of anime production tooling. 6 months free Studio-tier access, 70% revenue share, full IP retention."
        type="website"
      />
      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#05050C] via-[#0D0D1A] to-[#05050C]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(124,77,255,0.12)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(224,64,251,0.08)_0%,transparent_60%)]" />

        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center pt-24 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Cohort badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#7C4DFF]/30 bg-[#7C4DFF]/5 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E040FB] animate-pulse" />
              <span className="text-xs font-medium tracking-widest uppercase text-[#9494B8]">
                Cohort 1 — 20 seats
              </span>
            </div>

            <h1 className="text-display mb-6">
              <span className="block text-[#F0F0F5]">Founders'</span>
              <span className="block bg-clip-text text-transparent bg-gradient-to-r from-[#E040FB] via-[#7C4DFF] to-[#FF6E7F]">
                Studio
              </span>
            </h1>

            <p className="text-lg md:text-xl text-[#9494B8] leading-relaxed max-w-2xl mx-auto mb-4" style={{ fontFamily: "'Inter', sans-serif" }}>
              We're inviting a small cohort of working creators to shape the future of anime production tooling — with real revenue share, real ownership, and six months of free Studio-tier access.
            </p>

            <p className="text-sm text-[#5C5C7A] mb-10" style={{ fontFamily: "'Inter', sans-serif" }}>
              This is not an open application. We're looking for indie creators with portfolio evidence of taste and follow-through.
            </p>

            <a href="#express-interest" className="inline-block">
              <AwakliButton variant="primary" size="lg" icon={<ArrowRight size={18} />} iconPosition="right">
                Express Interest
              </AwakliButton>
            </a>
          </motion.div>
        </div>
      </section>

      {/* ── THE OFFER ─────────────────────────────────────────────────── */}
      <section className="relative py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-h2 text-[#F0F0F5] mb-4">What founders get</h2>
              <p className="text-[#9494B8] max-w-xl mx-auto" style={{ fontFamily: "'Inter', sans-serif" }}>
                Concrete terms. No vague "early access" promises.
              </p>
            </div>
          </Reveal>

          <div className="grid md:grid-cols-2 gap-5">
            {VALUE_PROPS.map((prop, i) => (
              <Reveal key={prop.title} delay={i * 0.08}>
                <div className="group relative p-6 rounded-2xl border border-white/[0.06] bg-[#0D0D1A]/80 hover:border-white/[0.12] transition-all duration-300">
                  {/* Hover glow */}
                  <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(ellipse_at_center,rgba(124,77,255,0.04)_0%,transparent_70%)]" />

                  <div className="relative flex gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-[#151528] border border-white/[0.06] flex items-center justify-center">
                      {prop.icon}
                    </div>
                    <div>
                      <h3 className="text-[#F0F0F5] font-semibold text-sm mb-1.5" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                        {prop.title}
                      </h3>
                      <p className="text-[#9494B8] text-sm leading-relaxed" style={{ fontFamily: "'Inter', sans-serif" }}>
                        {prop.detail}
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ───────────────────────────────────────────── */}
      <section className="relative py-20 px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(124,77,255,0.06)_0%,transparent_60%)]" />
        <div className="relative max-w-3xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-h2 text-[#F0F0F5] mb-4">Who this is for</h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="space-y-6" style={{ fontFamily: "'Inter', sans-serif" }}>
              <div className="p-6 rounded-2xl border border-white/[0.06] bg-[#0D0D1A]/60">
                <h3 className="text-[#F0F0F5] font-semibold mb-3" style={{ fontFamily: "'Orbitron', sans-serif", fontSize: "0.9rem" }}>
                  Working anime and manga creators
                </h3>
                <p className="text-[#9494B8] text-sm leading-relaxed">
                  You have a portfolio. You've shipped work — manga chapters, animation sequences, short films, or illustration series. You don't need to be famous, but you need to have evidence of taste and follow-through.
                </p>
              </div>

              <div className="p-6 rounded-2xl border border-white/[0.06] bg-[#0D0D1A]/60">
                <h3 className="text-[#F0F0F5] font-semibold mb-3" style={{ fontFamily: "'Orbitron', sans-serif", fontSize: "0.9rem" }}>
                  Independent, not hobbyist
                </h3>
                <p className="text-[#9494B8] text-sm leading-relaxed">
                  You're capable of producing meaningful output during a 6-month program. You work at your own pace through the full 17-stage pipeline — from text prompt to finished episode. There are no specialized roles; every founder is a creator.
                </p>
              </div>

              <div className="p-6 rounded-2xl border border-white/[0.06] bg-[#0D0D1A]/60">
                <h3 className="text-[#F0F0F5] font-semibold mb-3" style={{ fontFamily: "'Orbitron', sans-serif", fontSize: "0.9rem" }}>
                  Mission-aligned
                </h3>
                <p className="text-[#9494B8] text-sm leading-relaxed">
                  You believe anime production tooling should serve creators, not replace them. You want to shape how these tools work — your approval and rejection decisions literally train the platform's aesthetic models.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
      <section className="relative py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-h2 text-[#F0F0F5] mb-4">How the program works</h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="relative pl-8 border-l border-white/[0.08] space-y-10" style={{ fontFamily: "'Inter', sans-serif" }}>
              {[
                {
                  step: "01",
                  title: "Express interest",
                  body: "Submit the form below. We review portfolios and reach out directly if there's a fit for the current cohort. No automated screening.",
                },
                {
                  step: "02",
                  title: "Onboard & create",
                  body: "Accepted founders get Studio-tier access immediately. Work through the 17-stage pipeline at your own pace — manga, genga, or full anime episodes.",
                },
                {
                  step: "03",
                  title: "Shape the tools",
                  body: "Every HITL approval or rejection you make trains the platform's per-character LoRAs and your Sakufuu signature LoRA. You're defining the aesthetic.",
                },
                {
                  step: "04",
                  title: "Earn from day one",
                  body: "70% revenue share on everything you publish. Your IP stays yours. After 6 months, you keep all your work and LoRAs on the Free tier.",
                },
              ].map((item, i) => (
                <div key={item.step} className="relative">
                  {/* Timeline dot */}
                  <div className="absolute -left-[calc(2rem+5px)] w-2.5 h-2.5 rounded-full bg-[#7C4DFF] border-2 border-[#05050C]" />
                  <span className="text-xs font-mono text-[#5C5C7A] tracking-wider mb-1 block">{item.step}</span>
                  <h3 className="text-[#F0F0F5] font-semibold text-sm mb-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                    {item.title}
                  </h3>
                  <p className="text-[#9494B8] text-sm leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── EXPRESS INTEREST FORM ─────────────────────────────────────── */}
      <section id="express-interest" className="relative py-24 px-6 scroll-mt-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(224,64,251,0.06)_0%,transparent_60%)]" />

        <div className="relative max-w-xl mx-auto">
          <Reveal>
            <div className="text-center mb-10">
              <h2 className="text-h2 text-[#F0F0F5] mb-3">Express interest</h2>
              <p className="text-sm text-[#5C5C7A]" style={{ fontFamily: "'Inter', sans-serif" }}>
                We'll be in touch if there's a fit for the current cohort.
              </p>
            </div>
          </Reveal>

          {submitted ? (
            <Reveal>
              <div className="text-center p-10 rounded-2xl border border-[#7C4DFF]/20 bg-[#0D0D1A]/80">
                <div className="w-14 h-14 rounded-full bg-[#7C4DFF]/10 border border-[#7C4DFF]/20 flex items-center justify-center mx-auto mb-5">
                  <Check size={24} className="text-[#E040FB]" />
                </div>
                <h3 className="text-[#F0F0F5] font-semibold text-lg mb-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                  Received
                </h3>
                <p className="text-[#9494B8] text-sm leading-relaxed max-w-sm mx-auto" style={{ fontFamily: "'Inter', sans-serif" }}>
                  Thank you for your interest. We review every submission personally and will reach out directly if there's a fit for Cohort 1.
                </p>
              </div>
            </Reveal>
          ) : (
            <Reveal delay={0.1}>
              <form onSubmit={handleSubmit} className="space-y-5 p-8 rounded-2xl border border-white/[0.06] bg-[#0D0D1A]/80">
                <AwakliInput
                  label="Name"
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />

                <AwakliInput
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />

                {/* Output track selector */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#9494B8]">Primary output track</label>
                  <div className="grid grid-cols-3 gap-3">
                    {OUTPUT_TRACKS.map((track) => (
                      <button
                        key={track.value}
                        type="button"
                        onClick={() => setOutputTrack(track.value)}
                        className={`relative p-3 rounded-xl border text-left transition-all duration-200 ${
                          outputTrack === track.value
                            ? "bg-[rgba(124,77,255,0.08)] border-[rgba(124,77,255,0.35)] shadow-[0_0_16px_rgba(124,77,255,0.1)]"
                            : "bg-[#151528] border-white/[0.06] hover:border-white/[0.12]"
                        }`}
                      >
                        <div className={`mb-1.5 ${outputTrack === track.value ? "text-[#E040FB]" : "text-[#5C5C7A]"}`}>
                          {track.icon}
                        </div>
                        <div className={`text-xs font-semibold ${outputTrack === track.value ? "text-[#F0F0F5]" : "text-[#9494B8]"}`}>
                          {track.label}
                        </div>
                        <div className="text-[10px] text-[#5C5C7A] mt-0.5 leading-tight">
                          {track.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <AwakliInput
                  label="Portfolio link"
                  placeholder="https://artstation.com/yourname"
                  value={portfolioUrl}
                  onChange={(e) => setPortfolioUrl(e.target.value)}
                  required
                  hint="ArtStation, Pixiv, personal site, or any public portfolio"
                  icon={<ExternalLink size={14} />}
                />

                <AwakliInput
                  label="Genre focus (optional)"
                  placeholder="Action, Sci-Fi, Slice of Life..."
                  value={genreFocus}
                  onChange={(e) => setGenreFocus(e.target.value)}
                />

                <AwakliTextarea
                  label="What would you make?"
                  placeholder="Tell us what you'd want to create during the 6-month program — a series, a short film, an art collection. A few sentences is enough."
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  required
                  hint={`${pitch.length}/2000 characters · minimum ~2 sentences`}
                  className="min-h-[120px]"
                />

                <div className="pt-2">
                  <AwakliButton
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-full"
                    loading={submitMutation.isPending}
                    disabled={!name.trim() || !email.trim() || !outputTrack || !portfolioUrl.trim() || pitch.length < 20}
                  >
                    Submit Interest
                  </AwakliButton>
                </div>

                <p className="text-[10px] text-[#5C5C7A] text-center leading-relaxed" style={{ fontFamily: "'Inter', sans-serif" }}>
                  Submitting does not guarantee acceptance. We review every portfolio personally and reach out if there's a fit.
                </p>
              </form>
            </Reveal>
          )}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="relative py-20 px-6 mb-12">
        <div className="max-w-2xl mx-auto">
          <Reveal>
            <h2 className="text-h2 text-[#F0F0F5] text-center mb-12">Questions</h2>
          </Reveal>

          <div className="space-y-6" style={{ fontFamily: "'Inter', sans-serif" }}>
            {[
              {
                q: "How many people are in Cohort 1?",
                a: "~20 creators, hand-selected. This is not a mass program.",
              },
              {
                q: "Do I need professional anime experience?",
                a: "You need a portfolio that shows taste and follow-through. Published manga, animation sequences, illustration series, or short films all count. We're looking for indie creators, not studio veterans.",
              },
              {
                q: "What happens after 6 months?",
                a: "Your account auto-converts to the Free tier. All your work, LoRAs, trained models, and IP rights are preserved. No data loss, no lock-in.",
              },
              {
                q: "Can I use the work I create commercially?",
                a: "Yes. Full IP retention. You own everything you make, on or off the platform.",
              },
              {
                q: "What's the time commitment?",
                a: "Work at your own pace. There's no minimum output requirement, but the program is designed for creators who will actively produce during the 6 months.",
              },
              {
                q: "How does the 70% revenue share work?",
                a: "When your published content earns on the platform (views, subscriptions, tips), you receive 70% of the revenue. Standard Pro+ creators receive 50%.",
              },
            ].map((item, i) => (
              <Reveal key={i} delay={i * 0.05}>
                <div className="p-5 rounded-xl border border-white/[0.04] bg-[#0D0D1A]/40">
                  <h3 className="text-[#F0F0F5] text-sm font-semibold mb-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                    {item.q}
                  </h3>
                  <p className="text-[#9494B8] text-sm leading-relaxed">{item.a}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
