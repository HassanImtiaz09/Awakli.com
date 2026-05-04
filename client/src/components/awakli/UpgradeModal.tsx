/**
 * UpgradeModal — Full-featured upgrade + top-up modal.
 *
 * Two tabs: "Upgrade tier" and "Top up credits".
 * Triggered by tier-gate, credit-critical, or voluntary click.
 * Uses Zustand store for state, Radix Dialog for focus-trap.
 *
 * No dark patterns: no countdown timers, no pre-checked boxes, no "limited offer" copy.
 */
import { useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crown,
  Zap,
  Check,
  Loader2,
  X,
  Sparkles,
  ArrowRight,
  CreditCard,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  useUpgradeModal,
  type UpgradePayload,
  type ActiveTab,
} from "@/store/upgradeModal";
import { TIER_ORDER, TIER_META, type TierName } from "@shared/tierMatrix";
import {
  TIER_DISPLAY_NAMES,
  TIER_MONTHLY_PRICE_CENTS,
  TIER_MONTHLY_CREDITS,
  TIER_TAGLINES,
  tierPriceLabel,
  formatPrice,
} from "@shared/pricingCatalog";

// ─── Legacy Event Bus (backward compat with withTier + tierErrorLink) ───────
type Listener = (payload: UpgradePayload) => void;
const listeners = new Set<Listener>();

export type { UpgradePayload };

export const UpgradeModalBus = {
  open(payload: UpgradePayload) {
    // Route through Zustand store
    useUpgradeModal.getState().openFromGate(payload);
    listeners.forEach((fn) => fn(payload));
  },
  openCredits() {
    useUpgradeModal.getState().openFromCredits();
  },
  openVoluntary(defaultTab?: ActiveTab) {
    useUpgradeModal.getState().openVoluntary(defaultTab);
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

// ─── Credit Pack Definitions (spec: 5 packs) ───────────────────────────────
const CREDIT_PACKS = [
  { key: "spark",     name: "Spark",     credits: 100,   priceCents: 1500,  savings: null,      packSize: "small" as const },
  { key: "flame",     name: "Flame",     credits: 500,   priceCents: 6000,  savings: "20%",     packSize: "medium" as const },
  { key: "blaze",     name: "Blaze",     credits: 1500,  priceCents: 15000, savings: "33%",     packSize: "large" as const },
  { key: "inferno",   name: "Inferno",   credits: 5000,  priceCents: 40000, savings: "47%",     packSize: "large" as const },
  { key: "supernova", name: "Supernova", credits: 15000, priceCents: 97500, savings: "57%",     packSize: "large" as const },
];

// ─── Tier Display Config (for upgrade cards) ───────────────────────────────
const UPGRADE_TIERS: {
  key: TierName;
  displayName: string;
  price: string;
  priceNote: string;
  features: string[];
  accent: string;
  icon: typeof Crown;
}[] = [
  {
    key: "creator",
    displayName: TIER_DISPLAY_NAMES.creator,
    price: formatPrice(TIER_MONTHLY_PRICE_CENTS.creator),
    priceNote: "/mo",
    features: [
      `${TIER_MONTHLY_CREDITS.creator} credits/month`,
      "Anime previews & HD generation",
      "HD export (PDF, PNG, MP4)",
      "3 LoRA characters",
      "Creator analytics",
    ],
    accent: "from-token-cyan to-token-violet",
    icon: Sparkles,
  },
  {
    key: "creator_pro",
    displayName: TIER_DISPLAY_NAMES.creator_pro,
    price: formatPrice(TIER_MONTHLY_PRICE_CENTS.creator_pro),
    priceNote: "/mo",
    features: [
      `${TIER_MONTHLY_CREDITS.creator_pro} credits/month`,
      "Full anime pipeline (video + publish)",
      "Priority queue",
      "10 LoRA characters + voice cloning",
      "Batch generation",
      "20% credit rollover",
    ],
    accent: "from-token-violet to-token-magenta",
    icon: Crown,
  },
  {
    key: "studio",
    displayName: TIER_DISPLAY_NAMES.studio,
    price: formatPrice(TIER_MONTHLY_PRICE_CENTS.studio),
    priceNote: "/mo",
    features: [
      `${TIER_MONTHLY_CREDITS.studio} credits/month`,
      "4K resolution + all export formats",
      "Unlimited LoRA + voice clones",
      "Team collaboration (10 seats)",
      "API access",
      "50% credit rollover",
    ],
    accent: "from-token-gold to-amber-500",
    icon: Crown,
  },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export default function UpgradeModal() {
  const {
    isOpen,
    phase,
    trigger,
    activeTab,
    payload,
    selectedTier,
    selectedPack,
    successTierName,
    errorMessage,
    close,
    forceClose,
    setActiveTab,
    setSelectedTier,
    setSelectedPack,
    startProcessing,
    incrementPoll,
    setSuccess,
    setError,
  } = useUpgradeModal();

  const { user } = useAuth();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stripe checkout mutation
  const createCheckout = trpc.billing.createCheckout.useMutation();
  const createPackCheckout = trpc.billing.createPackCheckout.useMutation();
  const getSub = trpc.billing.getSubscription.useQuery(undefined, {
    enabled: false,
    refetchOnWindowFocus: false,
  });

  // ─── Polling for subscription confirmation ────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    let count = 0;
    pollRef.current = setInterval(async () => {
      count++;
      incrementPoll();
      if (count > 45) {
        // 90s timeout (45 * 2s)
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setError("Checkout timed out. If you completed payment, your subscription will activate shortly.");
        return;
      }
      try {
        const result = await getSub.refetch();
        const sub = result.data;
        if (sub && sub.tier !== "free_trial" && sub.status === "active") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          const tierMeta = TIER_META[sub.tier as TierName];
          setSuccess(tierMeta?.displayName || sub.tier);
          toast.success(`Welcome to ${tierMeta?.displayName || sub.tier}. Your next render is on us.`);
          // Auto-close after 1.4s
          successTimerRef.current = setTimeout(() => {
            forceClose();
          }, 1400);
        }
      } catch {
        // Silently retry
      }
    }, 2000);
  }, [incrementPoll, setSuccess, setError, forceClose, getSub]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleUpgrade = async () => {
    if (!selectedTier) return;
    try {
      emitAnalytics("upgrade_tier_confirm", { tier: selectedTier });
      const result = await createCheckout.mutateAsync({
        tier: selectedTier as "creator" | "creator_pro" | "studio",
        interval: "monthly",
      });
      if (result.url) {
        window.open(result.url, "_blank");
        startProcessing(result.url);
        startPolling();
        toast.info("Redirecting to checkout — complete payment in the new tab.");
      } else if (result.upgraded) {
        setSuccess(TIER_META[selectedTier as TierName]?.displayName || selectedTier);
        toast.success(`Welcome to ${TIER_META[selectedTier as TierName]?.displayName || selectedTier}. Your next render is on us.`);
        successTimerRef.current = setTimeout(() => forceClose(), 1400);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    }
  };

  const handleTopUp = async () => {
    if (!selectedPack) return;
    const pack = CREDIT_PACKS.find((p) => p.key === selectedPack);
    if (!pack) return;
    try {
      emitAnalytics("topup_pack_confirm", { pack: selectedPack, credits: pack.credits });
      const result = await createPackCheckout.mutateAsync({
        packSize: pack.packSize,
      });
      if (result.url) {
        window.open(result.url, "_blank");
        startProcessing(result.url);
        toast.info("Redirecting to checkout — complete payment in the new tab.");
        // For packs, just close after a delay since we don't poll subscription
        setTimeout(() => {
          if (useUpgradeModal.getState().phase === "processing") {
            forceClose();
            toast.success("Credits will be added once payment is confirmed.");
          }
        }, 10000);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "processing") {
        close();
      }
    },
    [phase, close]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Determine which tiers to show (at or above required)
  const requiredTier = payload?.required || "creator";
  const requiredIdx = TIER_ORDER.indexOf(requiredTier as TierName);
  const visibleTiers =
    trigger === "gate"
      ? UPGRADE_TIERS.filter((t) => TIER_ORDER.indexOf(t.key) >= requiredIdx)
      : UPGRADE_TIERS;

  // Modal title based on trigger
  const modalTitle =
    trigger === "gate"
      ? "Unlock this stage"
      : trigger === "credits"
        ? "You're running low on credits"
        : "Upgrade your plan";

  const currentTierName = payload?.currentTier || "free_trial";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="upgrade-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => phase !== "processing" && close()}
            className="fixed inset-0 z-[100] bg-ink/60 backdrop-blur-md"
          />

          {/* Modal */}
          <motion.div
            key="upgrade-panel"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={modalTitle}
          >
            <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0D0D1A] shadow-[0_24px_80px_rgba(124,77,255,0.28)] overflow-hidden max-h-[90vh] flex flex-col">
              {/* Gradient accent bar */}
              <div className="h-1 bg-gradient-to-r from-token-violet via-token-cyan to-token-magenta flex-shrink-0" />

              {/* Close button */}
              <button
                onClick={close}
                disabled={phase === "processing"}
                className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>

              {/* ─── Success State ──────────────────────────────────────── */}
              {phase === "success" && (
                <div className="p-12 flex flex-col items-center justify-center text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 12, stiffness: 200 }}
                    className="w-20 h-20 rounded-full bg-token-mint/20 flex items-center justify-center mb-6"
                  >
                    <Check className="w-10 h-10 text-token-mint" />
                  </motion.div>
                  <h2 className="text-2xl font-bold text-white/90 mb-2">
                    Welcome to {successTierName}
                  </h2>
                  <p className="text-sm text-white/50">
                    Your next render is on us.
                  </p>
                </div>
              )}

              {/* ─── Processing State ──────────────────────────────────── */}
              {phase === "processing" && (
                <div className="p-12 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-12 h-12 text-token-violet animate-spin mb-6" />
                  <h2 className="text-xl font-bold text-white/90 mb-2">
                    Waiting for payment confirmation
                  </h2>
                  <p className="text-sm text-white/50 mb-1">
                    Complete checkout in the new tab. This will update automatically.
                  </p>
                  <p className="text-xs text-white/30">
                    Do not close this window.
                  </p>
                </div>
              )}

              {/* ─── Error State ────────────────────────────────────────── */}
              {phase === "error" && (
                <div className="p-8">
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
                    <p className="text-sm text-red-400">{errorMessage}</p>
                  </div>
                  <Button
                    onClick={() => useUpgradeModal.getState().reset()}
                    variant="ghost"
                    className="w-full text-white/50 hover:text-white/70"
                  >
                    Try again
                  </Button>
                </div>
              )}

              {/* ─── Browsing State (main content) ─────────────────────── */}
              {phase === "browsing" && (
                <div className="flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="p-6 pb-0 flex-shrink-0">
                    <h2 className="text-xl font-bold text-white/90 mb-1">
                      {modalTitle}
                    </h2>
                    {trigger === "gate" && payload && (
                      <p className="text-sm text-white/40">
                        This feature requires{" "}
                        <span className="text-token-violet font-medium">
                          {payload.requiredDisplayName}
                        </span>{" "}
                        or higher.
                      </p>
                    )}
                  </div>

                  {/* Tab bar */}
                  <div className="flex gap-1 mx-6 mt-4 p-1 bg-white/5 rounded-xl flex-shrink-0">
                    <TabButton
                      active={activeTab === "upgrade"}
                      onClick={() => setActiveTab("upgrade")}
                      icon={<Crown className="w-3.5 h-3.5" />}
                      label="Upgrade tier"
                    />
                    <TabButton
                      active={activeTab === "topup"}
                      onClick={() => setActiveTab("topup")}
                      icon={<Zap className="w-3.5 h-3.5" />}
                      label="Top up credits"
                    />
                  </div>

                  {/* Tab content */}
                  <div className="p-6 overflow-y-auto flex-1">
                    <AnimatePresence mode="wait">
                      {activeTab === "upgrade" ? (
                        <motion.div
                          key="upgrade-tab"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.15 }}
                        >
                          <UpgradeTab
                            tiers={visibleTiers}
                            selectedTier={selectedTier}
                            currentTier={currentTierName}
                            onSelect={setSelectedTier}
                            onUpgrade={handleUpgrade}
                            isLoading={createCheckout.isPending}
                          />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="topup-tab"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.15 }}
                        >
                          <TopUpTab
                            selectedPack={selectedPack}
                            onSelect={setSelectedPack}
                            onPurchase={handleTopUp}
                            isLoading={createPackCheckout.isPending}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Tab Button ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
        active
          ? "bg-white/10 text-white shadow-sm"
          : "text-white/40 hover:text-white/60"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Upgrade Tab ────────────────────────────────────────────────────────────

function UpgradeTab({
  tiers,
  selectedTier,
  currentTier,
  onSelect,
  onUpgrade,
  isLoading,
}: {
  tiers: typeof UPGRADE_TIERS;
  selectedTier: string | null;
  currentTier: string;
  onSelect: (tier: string) => void;
  onUpgrade: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Tier cards */}
      <div className="space-y-3">
        {tiers.map((tier) => {
          const isSelected = selectedTier === tier.key;
          const isCurrent = currentTier === tier.key;
          const Icon = tier.icon;

          return (
            <button
              key={tier.key}
              onClick={() => !isCurrent && onSelect(tier.key)}
              disabled={isCurrent}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                isSelected
                  ? "ring-2 ring-token-violet border-token-violet/40 bg-token-violet/5 shadow-[0_0_20px_rgba(124,77,255,0.15)]"
                  : isCurrent
                    ? "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tier.accent} flex items-center justify-center`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white/90">
                        {tier.displayName}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-token-mint bg-token-mint/10 px-2 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-white/40">
                      <span className="text-white/70 font-semibold">
                        {tier.price}
                      </span>
                      {tier.priceNote}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <div className="w-6 h-6 rounded-full bg-token-violet flex items-center justify-center flex-shrink-0">
                    <Check className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {tier.features.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs text-white/40"
                  >
                    <Check className="w-3 h-3 text-token-mint/60 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* CTA */}
      <Button
        onClick={onUpgrade}
        disabled={!selectedTier || isLoading || currentTier === selectedTier}
        className="w-full bg-gradient-to-r from-token-violet to-token-cyan text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <CreditCard className="w-4 h-4 mr-2" />
        )}
        {selectedTier
          ? `Upgrade to ${UPGRADE_TIERS.find((t) => t.key === selectedTier)?.displayName || selectedTier}`
          : "Select a plan"}
        {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
      </Button>

      <p className="text-center text-[11px] text-white/25">
        You can cancel or change plans anytime from your billing settings.
      </p>
    </div>
  );
}

// ─── Top-Up Tab ─────────────────────────────────────────────────────────────

function TopUpTab({
  selectedPack,
  onSelect,
  onPurchase,
  isLoading,
}: {
  selectedPack: string | null;
  onSelect: (pack: string) => void;
  onPurchase: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/40">
        Credits never expire while your subscription is active. Pick the pack
        that fits your workflow.
      </p>

      {/* Pack cards */}
      <div className="space-y-2">
        {CREDIT_PACKS.map((pack) => {
          const isSelected = selectedPack === pack.key;
          const priceStr = `$${(pack.priceCents / 100).toFixed(0)}`;
          const perCredit = `$${(pack.priceCents / pack.credits / 100).toFixed(2)}`;

          return (
            <button
              key={pack.key}
              onClick={() => onSelect(pack.key)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                isSelected
                  ? "ring-2 ring-token-violet border-token-violet/40 bg-token-violet/5"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      isSelected
                        ? "bg-token-violet/20 text-token-violet"
                        : "bg-white/5 text-white/30"
                    }`}
                  >
                    <Flame className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white/90 text-sm">
                        {pack.name}
                      </span>
                      <span className="text-white/30 text-xs">
                        {pack.credits.toLocaleString()} credits
                      </span>
                      {pack.savings && (
                        <span className="text-[10px] font-medium text-token-mint bg-token-mint/10 px-1.5 py-0.5 rounded-full">
                          save {pack.savings}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/30">
                      {perCredit}/credit
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-white/80">{priceStr}</div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-token-violet flex items-center justify-center ml-auto mt-1">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Spec copy: exact label format */}
      {selectedPack && (
        <div className="text-center text-xs text-white/30">
          {(() => {
            const pack = CREDIT_PACKS.find((p) => p.key === selectedPack);
            if (!pack) return null;
            const priceStr = `$${(pack.priceCents / 100).toFixed(0)}`;
            return pack.savings
              ? `${pack.name} — ${pack.credits.toLocaleString()} credits · ${priceStr} · save ${pack.savings}`
              : `${pack.name} — ${pack.credits.toLocaleString()} credits · ${priceStr}`;
          })()}
        </div>
      )}

      {/* CTA */}
      <Button
        onClick={onPurchase}
        disabled={!selectedPack || isLoading}
        className="w-full bg-gradient-to-r from-token-violet to-token-magenta text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <Zap className="w-4 h-4 mr-2" />
        )}
        {selectedPack
          ? `Buy ${CREDIT_PACKS.find((p) => p.key === selectedPack)?.credits.toLocaleString() || ""} credits`
          : "Select a pack"}
        {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
      </Button>

      <p className="text-center text-[11px] text-white/25">
        One-time purchase. Credits are added to your balance immediately after payment.
      </p>
    </div>
  );
}

// ─── Analytics Helper ───────────────────────────────────────────────────────

function emitAnalytics(event: string, data?: Record<string, unknown>) {
  try {
    window.dispatchEvent(
      new CustomEvent("awakli:analytics", {
        detail: { event, ...data, timestamp: Date.now() },
      })
    );
  } catch {
    // Silently fail
  }
}
