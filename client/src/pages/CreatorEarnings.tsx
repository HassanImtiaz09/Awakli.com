import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { getLoginUrl } from "@/const";
import {
  DollarSign, TrendingUp, Users, Heart, ArrowRight, AlertCircle,
  Calendar, Gift, Lock, Unlock, Crown, Star, BarChart3, Eye,
  Printer, Package,
} from "lucide-react";
import { PlatformLayout } from "@/components/awakli/Layouts";
import { useState } from "react";
import { toast } from "sonner";

function StatCard({ icon: Icon, label, value, sub, color = "#7C4DFF", trend }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string; trend?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="p-5 rounded-xl border border-white/5 bg-[#0D0D1A]"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-gray-400">{label}</span>
        {trend && (
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
            trend.startsWith("+") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          }`}>
            {trend}
          </span>
        )}
      </div>
      <p className="text-2xl font-display font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </motion.div>
  );
}

function EarningsBreakdown({ earnings }: { earnings: any }) {
  const sources = [
    { label: "Tips", amount: earnings?.totalEarnings ?? 0, color: "#B388FF", icon: Heart },
    { label: "Premium Episodes", amount: 0, color: "#E040FB", icon: Crown },
    { label: "Subscriptions", amount: 0, color: "#2ECC71", icon: Star },
  ];
  const total = sources.reduce((s, r) => s + r.amount, 0) || 1;

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-token-violet" />
        <h2 className="text-lg font-heading font-semibold text-white">Earnings Breakdown</h2>
      </div>
      <div className="p-6">
        {/* Bar */}
        <div className="h-3 rounded-full bg-white/5 overflow-hidden flex mb-6">
          {sources.map((s) => (
            <div
              key={s.label}
              className="h-full transition-all duration-500"
              style={{ width: `${Math.max((s.amount / total) * 100, 2)}%`, backgroundColor: s.color }}
            />
          ))}
        </div>
        {/* Legend */}
        <div className="grid grid-cols-3 gap-4">
          {sources.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-sm font-semibold text-white">${(s.amount / 100).toFixed(2)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PrintRoyaltiesSection() {
  const payouts = trpc.print.getMyPayouts.useQuery();
  const data = payouts.data ?? [];

  const pending = data.filter(p => p.status === 'pending' || p.status === 'approved');
  const paid = data.filter(p => p.status === 'paid');
  const pendingTotal = pending.reduce((s, p) => s + p.amountCents, 0);
  const paidTotal = paid.reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden mb-8">
      <div className="p-6 border-b border-white/5 flex items-center gap-3">
        <Printer className="w-5 h-5 text-token-cyan" />
        <h2 className="text-lg font-heading font-semibold text-white">Print Royalties</h2>
        <span className="ml-auto text-xs text-gray-500">{data.length} total</span>
      </div>

      {data.length === 0 ? (
        <div className="p-8 text-center">
          <Package className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No print royalties yet. You'll earn 15% of revenue when readers order prints of your manga.</p>
        </div>
      ) : (
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-[#08080F] border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Pending</p>
              <p className="text-xl font-bold text-yellow-400">${(pendingTotal / 100).toFixed(2)}</p>
              <p className="text-xs text-gray-600">{pending.length} payouts</p>
            </div>
            <div className="p-4 rounded-xl bg-[#08080F] border border-white/5">
              <p className="text-xs text-gray-500 mb-1">Paid</p>
              <p className="text-xl font-bold text-green-400">${(paidTotal / 100).toFixed(2)}</p>
              <p className="text-xs text-gray-600">{paid.length} payouts</p>
            </div>
          </div>

          {/* Recent payouts */}
          <div className="space-y-2">
            {data.slice(0, 5).map((payout: any) => (
              <div key={payout.id} className="flex items-center justify-between p-3 rounded-lg bg-[#08080F] border border-white/5">
                <div>
                  <p className="text-sm text-white">Order #{payout.printOrderId}</p>
                  <p className="text-xs text-gray-500">
                    {payout.createdAt ? new Date(payout.createdAt).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-400">+${(payout.amountCents / 100).toFixed(2)}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    payout.status === 'paid' ? 'bg-green-500/10 text-green-400' :
                    payout.status === 'approved' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {payout.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PremiumEpisodeManager() {
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const projects = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();

  const setPremium = trpc.premium.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Premium status updated!");
      utils.premium.getStatus.invalidate();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center gap-3">
        <Crown className="w-5 h-5 text-yellow-400" />
        <h2 className="text-lg font-heading font-semibold text-white">Premium Episodes</h2>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 text-xs font-semibold">
          Creator+
        </span>
      </div>
      <div className="p-6">
        <p className="text-sm text-gray-400 mb-4">
          Lock episodes behind a paywall. Readers need a Creator subscription to access premium content.
          You earn 80% of subscription revenue attributed to your content.
        </p>

        {!projects.data || projects.data.length === 0 ? (
          <div className="p-8 text-center">
            <Lock className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Create and publish manga to enable premium episodes.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.data.slice(0, 5).map((project: any) => (
              <div
                key={project.id}
                className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-[#08080F] hover:border-white/10 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0">
                  {project.coverImageUrl ? (
                    <img src={project.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-token-violet/20 to-token-cyan/20" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{project.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Eye className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-500">{project.viewCount ?? 0} views</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    toast("Feature coming soon", { description: "Premium episode management will be available in the next update." });
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  Manage
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CreatorEarnings() {
  const { isAuthenticated } = useAuth();

  const earnings = trpc.marketplace.getEarnings.useQuery(undefined, { enabled: isAuthenticated });
  const tips = trpc.marketplace.getTips.useQuery(undefined, { enabled: isAuthenticated });
  const tierStatus = trpc.tier.getStatus.useQuery(undefined, { enabled: isAuthenticated });

  if (!isAuthenticated) {
    return (
      <PlatformLayout>
        <div className="container py-32 text-center">
          <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <h2 className="text-2xl font-heading font-bold text-white mb-3">Sign in to view earnings</h2>
          <p className="text-gray-400 mb-6">Track your tips, earnings, and creator analytics.</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#E040FB] to-[#7C4DFF] text-white font-semibold">
            Sign In <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </PlatformLayout>
    );
  }

  const e = earnings.data;
  const t = tips.data ?? [];
  const tier = tierStatus.data;

  return (
    <PlatformLayout>
      <div className="container py-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="flex items-start justify-between mb-10">
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Creator Earnings</h1>
              <p className="text-gray-400">Track your tips, revenue, and supporter activity.</p>
            </div>
            {tier && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-[#0D0D1A]">
                <Crown className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold text-white capitalize">{tier.tier}</span>
                <span className="text-xs text-gray-500">plan</span>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid md:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon={DollarSign}
              label="Total Earnings"
              value={`$${((e?.totalEarnings ?? 0) / 100).toFixed(2)}`}
              sub="all time"
              color="#2ECC71"
            />
            <StatCard
              icon={TrendingUp}
              label="This Month"
              value={`$${((e?.monthlyEarnings?.[0]?.amount ?? 0) / 100).toFixed(2)}`}
              sub="current period"
              color="#7C4DFF"
            />
            <StatCard
              icon={Heart}
              label="Total Tips"
              value={e?.totalTips ?? 0}
              sub="received"
              color="#B388FF"
            />
            <StatCard
              icon={Users}
              label="Supporters"
              value={t.length}
              sub="unique tippers"
              color="#E040FB"
            />
          </div>

          {/* Earnings Breakdown + Premium Episodes */}
          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <EarningsBreakdown earnings={e} />
            <PremiumEpisodeManager />
          </div>

          {/* Recent Tips */}
          <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden mb-8">
            <div className="p-6 border-b border-white/5 flex items-center gap-3">
              <Gift className="w-5 h-5 text-token-violet" />
              <h2 className="text-lg font-heading font-semibold text-white">Recent Tips</h2>
              <span className="ml-auto text-xs text-gray-500">{t.length} total</span>
            </div>

            {t.length === 0 ? (
              <div className="p-12 text-center">
                <Gift className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 text-sm mb-4">No tips received yet. Share your creations to start earning!</p>
                <Link
                  href="/discover"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-token-violet/10 text-token-violet text-sm font-semibold hover:bg-token-violet/20 transition-colors"
                >
                  Explore Community <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {t.map((tip: any) => (
                  <div key={tip.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-token-violet to-token-cyan flex items-center justify-center text-xs font-bold text-white">
                        {(tip.senderName || "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm text-white font-medium">{tip.senderName || "Anonymous"}</p>
                        {tip.message && <p className="text-xs text-gray-500 truncate max-w-xs">"{tip.message}"</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-green-400">+${(tip.amount / 100).toFixed(2)}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(tip.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upgrade CTA for free users */}
          {tier?.tier === "free_trial" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-8 rounded-2xl border border-token-violet/20 bg-gradient-to-r from-token-violet/5 to-token-cyan/5 text-center"
            >
              <Crown className="w-10 h-10 text-yellow-400 mx-auto mb-4" />
              <h3 className="text-xl font-heading font-bold text-white mb-2">Unlock Creator Monetization</h3>
              <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
                Upgrade to Creator ($19/mo) to enable premium episodes, higher tip limits,
                and priority anime production for your manga.
              </p>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#E040FB] to-[#7C4DFF] text-white font-semibold shadow-lg shadow-[#7C4DFF]/20 hover:shadow-[#7C4DFF]/40 transition-all"
              >
                View Plans <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>
          )}

          {/* Print Royalties */}
          <PrintRoyaltiesSection />

          {/* Payout info */}
          <div className="mt-8 p-6 rounded-2xl border border-token-cyan/20 bg-token-cyan/5">
            <div className="flex items-start gap-4">
              <Calendar className="w-6 h-6 text-token-cyan mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">Payout Information</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Earnings are paid out monthly via manual Stripe transfer. Minimum payout threshold is $10.00.
                  Print royalties are 15% of revenue (after printing costs). Awakli takes a 20% platform fee.
                  Payouts are processed within 30 days of order shipment.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </PlatformLayout>
  );
}
