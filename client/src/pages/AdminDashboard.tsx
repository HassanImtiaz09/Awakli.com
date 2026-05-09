import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Users, DollarSign, Film, Zap, Shield, AlertTriangle,
  CheckCircle, XCircle, Eye, ChevronRight, Crown, TrendingUp,
  Clock, BarChart3, Video, RefreshCw, ExternalLink
} from "lucide-react";
import { PlatformLayout } from "@/components/awakli/Layouts";
import { toast } from "sonner";

// ─── Metric Card ───────────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, change, color = "#7C4DFF" }: {
  icon: any; label: string; value: string | number; change?: string; color?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="p-6 rounded-xl border border-white/5 bg-[#0D0D1A]"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
          <Icon className="w-5 h-5" />
        </div>
        {change && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
            change.startsWith("+") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          }`}>
            {change}
          </span>
        )}
      </div>
      <p className="text-2xl font-display font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </motion.div>
  );
}

// ─── Moderation Queue ──────────────────────────────────────────────────────
function ModerationQueue() {
  const queue = trpc.admin.getModerationQueue.useQuery({ status: "pending" });
  const moderate = trpc.admin.reviewModeration.useMutation({
    onSuccess: () => {
      queue.refetch();
      toast.success("Item moderated");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const items = queue.data ?? [];

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-heading font-semibold text-white">Moderation Queue</h2>
        </div>
        <span className="text-xs text-gray-500">{items.length} pending</span>
      </div>

      {items.length === 0 ? (
        <div className="p-12 text-center">
          <CheckCircle className="w-10 h-10 text-green-400/50 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">All clear! No items pending review.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {items.slice(0, 10).map((item: any) => (
            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  item.severity === "high" ? "bg-red-400" :
                  item.severity === "medium" ? "bg-amber-400" : "bg-blue-400"
                }`} />
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    {item.contentType}: {item.reason || "Flagged for review"}
                  </p>
                  <p className="text-xs text-gray-500">
                    ID: {item.contentId} · {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => moderate.mutate({ id: item.id, status: "approved" })}
                  className="w-8 h-8 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center hover:bg-green-500/20 transition-colors"
                  title="Approve"
                >
                  <CheckCircle className="w-4 h-4" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => moderate.mutate({ id: item.id, status: "removed" })}
                  className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                  title="Reject"
                >
                  <XCircle className="w-4 h-4" />
                </motion.button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── User List ─────────────────────────────────────────────────────────────
function UserList() {
  const [page, setPage] = useState(1);
  const users = trpc.admin.getUsers.useQuery({ page, limit: 20 });
  const data = users.data;

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-token-cyan" />
          <h2 className="text-lg font-heading font-semibold text-white">Users</h2>
        </div>
        <span className="text-xs text-gray-500">{data?.total ?? 0} total</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left text-xs text-gray-500 font-medium p-4">User</th>
              <th className="text-left text-xs text-gray-500 font-medium p-4">Role</th>
              <th className="text-left text-xs text-gray-500 font-medium p-4">Tier</th>
              <th className="text-left text-xs text-gray-500 font-medium p-4">Projects</th>
              <th className="text-left text-xs text-gray-500 font-medium p-4">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {(data?.users ?? []).map((u: any) => (
              <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-token-violet to-token-cyan flex items-center justify-center text-xs font-bold text-white">
                      {(u.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium">{u.name || "Unknown"}</p>
                      <p className="text-xs text-gray-500">{u.email || ""}</p>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    u.role === "admin" ? "bg-amber-500/10 text-amber-400" : "bg-white/5 text-gray-400"
                  }`}>
                    {u.role || "user"}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    u.tier === "studio" ? "bg-token-cyan/10 text-token-cyan" :
                    u.tier === "creator_pro" ? "bg-token-violet/10 text-token-violet" :
                    "bg-white/5 text-gray-400"
                  }`}>
                    {u.tier || "free"}
                  </span>
                </td>
                <td className="p-4 text-sm text-gray-400">{u.projectCount ?? 0}</td>
                <td className="p-4 text-xs text-gray-500">
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="p-4 border-t border-white/5 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {Math.ceil(data.total / 20)}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page * 20 >= data.total}
            className="text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Subscription Overview ─────────────────────────────────────────────────
function SubscriptionOverview() {
  const subs = trpc.admin.getSubscriptions.useQuery();
  const data = subs.data ?? [];

  const tierCounts: Record<string, number> = { free_trial: 0, creator: 0, creator_pro: 0, studio: 0 };
  data.forEach((s: any) => {
    const t = s.tier as string;
    if (t in tierCounts) tierCounts[t]++;
    else if (t === "free") tierCounts.free_trial++;
    else if (t === "pro") tierCounts.creator++;
  });

  const total = data.length || 1;

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] p-6">
      <div className="flex items-center gap-3 mb-6">
        <Crown className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-heading font-semibold text-white">Subscription Distribution</h2>
      </div>

      <div className="space-y-4">
        {(["free_trial", "creator", "creator_pro", "studio"] as const).map((tier) => {
          const count = tierCounts[tier];
          const pct = (count / total) * 100;
          const colors: Record<string, { bar: string; label: string }> = {
            free_trial: { bar: "#6B7280", label: "text-gray-400" },
            creator: { bar: "#7C4DFF", label: "text-token-violet" },
            creator_pro: { bar: "#F59E0B", label: "text-amber-400" },
            studio: { bar: "#E040FB", label: "text-token-cyan" },
          };
          return (
            <div key={tier}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-medium capitalize ${colors[tier].label}`}>{tier}</span>
                <span className="text-xs text-gray-500">{count} ({pct.toFixed(0)}%)</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: colors[tier].bar }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Demo Video Card ──────────────────────────────────────────────────────
function DemoVideoCard() {
  const config = trpc.admin.getDemoConfig.useQuery(undefined, { refetchInterval: 5000 });
  const regenerate = trpc.admin.regenerateDemo.useMutation({
    onSuccess: () => {
      toast.success("Demo asset generation started!");
      config.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });
  const [, navigate] = useLocation();

  const status = config.data?.status || "not_started";
  const updatedAt = config.data?.updatedAt;
  const panelCount = config.data?.panelUrls?.filter(Boolean).length || 0;
  const hasVideo = !!config.data?.streamId;

  const statusColors: Record<string, string> = {
    not_started: "text-gray-400",
    generating: "text-amber-400",
    assets_ready: "text-blue-400",
    recording: "text-purple-400",
    processing: "text-cyan-400",
    complete: "text-green-400",
    failed: "text-red-400",
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-pink-400" />
          <h3 className="text-lg font-heading font-semibold text-white">Demo Video Pipeline</h3>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full bg-white/5 ${statusColors[status] || "text-gray-400"}`}>
          {status.replace("_", " ").toUpperCase()}
        </span>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-white">{panelCount}/6</p>
            <p className="text-xs text-gray-500">Panels</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{hasVideo ? "Yes" : "No"}</p>
            <p className="text-xs text-gray-500">Video Ready</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">{updatedAt ? new Date(updatedAt).toLocaleDateString() : "Never"}</p>
            <p className="text-xs text-gray-500">Last Updated</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending || status === "generating"}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${status === "generating" ? "animate-spin" : ""}`} />
            {status === "generating" ? "Generating..." : "Regenerate Assets"}
          </button>
          <button
            onClick={() => navigate("/demo-recording")}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-gray-300 hover:bg-white/10 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Preview
          </button>
        </div>

        {/* Mini panel preview */}
        {panelCount > 0 && (
          <div className="flex gap-1.5 mt-2">
            {config.data?.panelUrls?.slice(0, 6).map((url, i) => (
              url ? (
                <img key={i} src={url} alt={`Panel ${i+1}`} className="w-12 h-12 rounded object-cover border border-white/10" />
              ) : (
                <div key={i} className="w-12 h-12 rounded bg-white/5" />
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Credit Analytics Panel ───────────────────────────────────────────────
function CreditAnalytics() {
  const analytics = trpc.admin.getCreditAnalytics.useQuery();
  const topConsumers = trpc.admin.getCreatorCostBreakdown.useQuery({ limit: 10 });
  const [promoUserId, setPromoUserId] = useState("");
  const [promoAmount, setPromoAmount] = useState("");
  const [promoReason, setPromoReason] = useState("");

  const issuePromo = trpc.admin.issuePromoCredits.useMutation({
    onSuccess: () => {
      toast.success("Promotional credits issued!");
      setPromoUserId(""); setPromoAmount(""); setPromoReason("");
      analytics.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const a = analytics.data;

  return (
    <div className="space-y-6">
      {/* Revenue & Economics */}
      <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] p-6">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-5 h-5 text-green-400" />
          <h2 className="text-lg font-heading font-semibold text-white">Credit Economics</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">MRR</p>
            <p className="text-2xl font-display font-bold text-green-400">${((a?.mrr?.totalCents || 0) / 100).toLocaleString()}</p>
            <p className="text-xs text-gray-500">{a?.mrr?.activeSubscriptions || 0} active subs</p>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Pack Revenue</p>
            <p className="text-2xl font-display font-bold text-token-cyan">${((a?.packs?.revenueCents || 0) / 100).toLocaleString()}</p>
            <p className="text-xs text-gray-500">{a?.packs?.count || 0} packs sold</p>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">COGS</p>
            <p className="text-2xl font-display font-bold text-red-400">${((a?.economics?.cogsUsdCents || 0) / 100).toLocaleString()}</p>
            <p className="text-xs text-gray-500">{a?.credits?.consumedThisMonth || 0} credits consumed</p>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Margin</p>
            <p className={`text-2xl font-display font-bold ${
              (a?.economics?.marginPct || 0) >= (a?.economics?.targetMarginPct || 33) ? "text-green-400" : "text-amber-400"
            }`}>{a?.economics?.marginPct?.toFixed(1) || 0}%</p>
            <p className="text-xs text-gray-500">target: {a?.economics?.targetMarginPct || 33}%</p>
          </div>
        </div>

        {/* Credit Flow */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/10 text-center">
            <p className="text-lg font-bold text-green-400">{a?.credits?.grantedThisMonth?.toLocaleString() || 0}</p>
            <p className="text-xs text-gray-500">Granted This Month</p>
          </div>
          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-center">
            <p className="text-lg font-bold text-red-400">{a?.credits?.consumedThisMonth?.toLocaleString() || 0}</p>
            <p className="text-xs text-gray-500">Consumed This Month</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10 text-center">
            <p className="text-lg font-bold text-amber-400">{a?.credits?.activeHolds?.toLocaleString() || 0}</p>
            <p className="text-xs text-gray-500">Active Holds</p>
          </div>
        </div>
      </div>

      {/* Top Consumers */}
      <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
        <div className="p-6 border-b border-white/5 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-token-violet" />
          <h2 className="text-lg font-heading font-semibold text-white">Top Consumers (This Month)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs text-gray-500 font-medium p-4">Creator</th>
                <th className="text-left text-xs text-gray-500 font-medium p-4">Tier</th>
                <th className="text-right text-xs text-gray-500 font-medium p-4">Credits Used</th>
                <th className="text-right text-xs text-gray-500 font-medium p-4">COGS Est.</th>
                <th className="text-right text-xs text-gray-500 font-medium p-4">API Calls</th>
                <th className="text-right text-xs text-gray-500 font-medium p-4">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(topConsumers.data ?? []).map((c: any) => (
                <tr key={c.userId} className="hover:bg-white/[0.02] transition-colors">
                  <td className="p-4">
                    <p className="text-sm text-white font-medium">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.email}</p>
                  </td>
                  <td className="p-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      c.tier === "studio" ? "bg-token-cyan/10 text-token-cyan" :
                      c.tier === "creator_pro" ? "bg-token-violet/10 text-token-violet" :
                      c.tier === "creator" ? "bg-purple-400/10 text-purple-400" :
                      "bg-white/5 text-gray-400"
                    }`}>{c.tier}</span>
                  </td>
                  <td className="p-4 text-right text-sm text-white font-mono">{c.creditsConsumed}</td>
                  <td className="p-4 text-right text-sm text-red-400 font-mono">${(c.cogsEstimateCents / 100).toFixed(2)}</td>
                  <td className="p-4 text-right text-sm text-gray-400">{c.apiCalls}</td>
                  <td className="p-4 text-right text-sm text-green-400 font-mono">{c.currentBalance}</td>
                </tr>
              ))}
              {(!topConsumers.data || topConsumers.data.length === 0) && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500 text-sm">No usage data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Issue Promo Credits */}
      <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] p-6">
        <div className="flex items-center gap-3 mb-4">
          <Zap className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-heading font-semibold text-white">Issue Promotional Credits</h2>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <input
            type="number"
            placeholder="User ID"
            value={promoUserId}
            onChange={(e) => setPromoUserId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-gray-500 focus:border-token-violet/50 outline-none"
          />
          <input
            type="number"
            placeholder="Credits"
            value={promoAmount}
            onChange={(e) => setPromoAmount(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-gray-500 focus:border-token-violet/50 outline-none"
          />
          <input
            type="text"
            placeholder="Reason code"
            value={promoReason}
            onChange={(e) => setPromoReason(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-gray-500 focus:border-token-violet/50 outline-none"
          />
          <button
            onClick={() => {
              if (!promoUserId || !promoAmount || !promoReason) return toast.error("Fill all fields");
              issuePromo.mutate({ userId: parseInt(promoUserId), amount: parseInt(promoAmount), reasonCode: promoReason });
            }}
            disabled={issuePromo.isPending}
            className="px-4 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
          >
            {issuePromo.isPending ? "Issuing..." : "Issue Credits"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Dashboard ──────────────────────────────────────────────────
export default function AdminDashboard() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const metrics = trpc.admin.getMetrics.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  // Redirect non-admins
  if (!isAuthenticated || (user && user.role !== "admin")) {
    return (
      <PlatformLayout>
        <div className="container py-32 text-center">
          <Shield className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <h2 className="text-2xl font-heading font-bold text-white mb-3">Admin Access Required</h2>
          <p className="text-gray-400 mb-6">This page is restricted to platform administrators.</p>
        </div>
      </PlatformLayout>
    );
  }

  const m = metrics.data;

  return (
    <PlatformLayout>
      <div className="container py-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Admin Dashboard</h1>
            <p className="text-gray-400">Platform overview and content moderation.</p>
          </div>

          {/* Metric Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard icon={Users} label="Total Users" value={m?.totalUsers ?? 0} change="+12%" color="#E040FB" />
            <MetricCard icon={Film} label="Total Projects" value={m?.totalProjects ?? 0} change="+8%" color="#7C4DFF" />
            <MetricCard icon={Zap} label="Total Creators" value={m?.totalCreators ?? 0} color="#FFD60A" />
            <MetricCard icon={DollarSign} label="Revenue" value={`$${((m?.totalRevenue ?? 0) / 100).toFixed(0)}`} change="+15%" color="#2ECC71" />
          </div>

          {/* Two column layout */}
          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <SubscriptionOverview />
            <ModerationQueue />
          </div>

          {/* Credit Analytics */}
          <div className="mb-8">
            <CreditAnalytics />
          </div>

          {/* Pipeline Observability */}
          <div className="mb-8">
            <a href="/admin/pipeline" className="block p-6 rounded-2xl border border-white/5 bg-[#0D0D1A] hover:border-purple-500/30 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-purple-500/10">
                    <Film className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-heading font-semibold text-white">Pipeline Observability</h3>
                    <p className="text-sm text-gray-500">Pipeline runs, quality harness scores, error breakdown, and cost spot-checks</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-purple-400 transition-colors" />
              </div>
            </a>
          </div>

          {/* Provider Router Admin */}
          <div className="mb-8">
            <a href="/admin/providers" className="block p-6 rounded-2xl border border-white/5 bg-[#0D0D1A] hover:border-token-cyan/30 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-token-cyan/10">
                    <Zap className="w-5 h-5 text-token-cyan" />
                  </div>
                  <div>
                    <h3 className="text-lg font-heading font-semibold text-white">Provider Router</h3>
                    <p className="text-sm text-gray-500">Manage AI providers, API keys, circuit breakers, and health monitoring</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-token-cyan transition-colors" />
              </div>
            </a>
          </div>

          {/* Demo Video Pipeline */}
          <div className="mb-8">
            <DemoVideoCard />
          </div>

          {/* User List */}
          <UserList />
        </motion.div>
      </div>
    </PlatformLayout>
  );
}
