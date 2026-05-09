/**
 * Admin Pipeline Observability Dashboard (Wave 8 Item 2b)
 *
 * Route: /admin/pipeline
 *
 * Surfaces:
 * - All pipeline runs (last 7 days) with status, cost, duration
 * - Aggregate stats: success rate, avg cost, avg duration
 * - Quality harness layer scores
 * - Error breakdown by node
 * - Cost spot-check against §6 reference ($3.40/run)
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { PlatformLayout } from "@/components/awakli/Layouts";
import {
  Activity, BarChart3, CheckCircle, XCircle, Clock, DollarSign,
  Shield, AlertTriangle, Loader2, ArrowLeft, TrendingUp, Zap,
  Layers, Film, Mic, Music, Clapperboard, RefreshCw
} from "lucide-react";

// ─── Stat Card ──────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, subtext, color }: {
  icon: React.ElementType; label: string; value: string | number;
  subtext?: string; color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-xl border border-white/5 bg-[#0D0D1A]"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-display font-bold text-white">{value}</p>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </motion.div>
  );
}

// ─── Layer Score Bar ────────────────────────────────────────────────────
function LayerScoreBar({ layer, avgScore, passCount, totalCount }: {
  layer: string; avgScore: number; passCount: number; totalCount: number;
}) {
  const pct = totalCount > 0 ? (passCount / totalCount) * 100 : 0;
  const layerColors: Record<string, string> = {
    script: "#7C4DFF",
    visual: "#E040FB",
    video: "#06b6d4",
    audio: "#FFD60A",
    integration: "#2ECC71",
  };
  const color = layerColors[layer] || "#6b7280";
  return (
    <div className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0">
      <div className="w-24 text-sm text-gray-300 capitalize font-medium">{layer}</div>
      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-16 text-right text-sm text-gray-400">{avgScore.toFixed(1)}/10</div>
      <div className="w-20 text-right text-xs text-gray-500">{passCount}/{totalCount}</div>
    </div>
  );
}

// ─── Run Row ────────────────────────────────────────────────────────────
function RunRow({ run }: { run: any }) {
  const statusColors: Record<string, string> = {
    completed: "text-green-400 bg-green-500/10",
    failed: "text-red-400 bg-red-500/10",
    running: "text-cyan-400 bg-cyan-500/10",
    pending: "text-gray-400 bg-gray-500/10",
    cancelled: "text-amber-400 bg-amber-500/10",
  };
  const duration = run.startedAt && run.completedAt
    ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;
  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
      <div className="w-16 text-sm text-gray-300 font-mono">#{run.id}</div>
      <div className="w-24">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[run.status] || "text-gray-400"}`}>
          {run.status}
        </span>
      </div>
      <div className="w-20 text-sm text-gray-400">{run.progress}%</div>
      <div className="w-24 text-sm text-gray-300">${((run.totalCost || 0) / 100).toFixed(2)}</div>
      <div className="w-24 text-sm text-gray-400">
        {duration ? `${Math.floor(duration / 60)}m ${duration % 60}s` : "—"}
      </div>
      <div className="flex-1 text-xs text-gray-500 truncate">
        {run.currentNode || "—"}
      </div>
      <div className="w-32 text-xs text-gray-500">
        {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "—"}
      </div>
    </div>
  );
}

// ─── Cost Spot Check ────────────────────────────────────────────────────
function CostSpotCheck() {
  const spotCheck = trpc.admin.getCostSpotCheck.useQuery();
  if (spotCheck.isLoading) return <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" /></div>;
  if (!spotCheck.data) return null;
  const { referenceCosts, comparisons, avgVariancePct, allWithinTolerance } = spotCheck.data;
  return (
    <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
      <div className="p-5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-heading font-semibold text-white">Cost Spot-Check (§6 Reference)</h3>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full font-medium ${
          allWithinTolerance ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400"
        }`}>
          {allWithinTolerance ? "All within ±20%" : `Avg variance: ${avgVariancePct}%`}
        </span>
      </div>
      <div className="p-5">
        <div className="text-xs text-gray-500 mb-3">
          Reference: ${(referenceCosts.total / 100).toFixed(2)}/run (video={referenceCosts.video_gen}¢, voice={referenceCosts.voice_gen}¢, music={referenceCosts.music_gen}¢, assembly={referenceCosts.assembly}¢)
        </div>
        {comparisons.length === 0 ? (
          <p className="text-sm text-gray-400">No completed runs to compare.</p>
        ) : (
          <div className="space-y-2">
            {comparisons.slice(0, 10).map((c: any) => (
              <div key={c.runId} className="flex items-center gap-3 text-sm">
                <span className="text-gray-400 font-mono w-16">#{c.runId}</span>
                <span className="text-white w-20">${(c.actualCostCents / 100).toFixed(2)}</span>
                <span className={`w-20 ${c.withinTolerance ? "text-green-400" : "text-amber-400"}`}>
                  {c.variancePct > 0 ? "+" : ""}{c.variancePct}%
                </span>
                {c.withinTolerance ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────────
export default function AdminPipelineObservability() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const observability = trpc.admin.getPipelineObservability.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    refetchInterval: 30000,
  });

  if (!isAuthenticated || (user && user.role !== "admin")) {
    return (
      <PlatformLayout>
        <div className="container py-32 text-center">
          <Shield className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <h2 className="text-2xl font-heading font-bold text-white mb-3">Admin Access Required</h2>
          <p className="text-gray-400">This page is restricted to platform administrators.</p>
        </div>
      </PlatformLayout>
    );
  }

  const data = observability.data;
  const isLoading = observability.isLoading;

  // Aggregate layer scores
  const layerAggregates = useMemo(() => {
    if (!data?.layerScores) return [];
    const map = new Map<string, { totalScore: number; passCount: number; totalCount: number }>();
    for (const row of data.layerScores) {
      const existing = map.get(row.layer) || { totalScore: 0, passCount: 0, totalCount: 0 };
      existing.totalScore += (row.avgScore || 0) * Number(row.checkCount);
      existing.totalCount += Number(row.checkCount);
      if (row.result === "pass") existing.passCount += Number(row.checkCount);
      map.set(row.layer, existing);
    }
    return Array.from(map.entries()).map(([layer, agg]) => ({
      layer,
      avgScore: agg.totalCount > 0 ? agg.totalScore / agg.totalCount : 0,
      passCount: agg.passCount,
      totalCount: agg.totalCount,
    }));
  }, [data?.layerScores]);

  return (
    <PlatformLayout>
      <div className="container py-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate("/admin")} className="text-gray-400 hover:text-white transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-3xl md:text-4xl font-display font-bold text-white">Pipeline Observability</h1>
                <p className="text-gray-400 mt-1">Real-time pipeline health, quality scores, and cost analysis.</p>
              </div>
            </div>
            <button
              onClick={() => observability.refetch()}
              className="p-2 rounded-lg border border-white/10 hover:border-token-cyan/30 text-gray-400 hover:text-token-cyan transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${observability.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-token-cyan" />
            </div>
          ) : (
            <>
              {/* Stats Grid */}
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                  icon={Activity}
                  label="Total Runs (7d)"
                  value={data?.stats.totalRuns ?? 0}
                  subtext={`${data?.stats.runningRuns ?? 0} currently running`}
                  color="#06b6d4"
                />
                <StatCard
                  icon={CheckCircle}
                  label="Success Rate"
                  value={`${(data?.stats.successRate ?? 0).toFixed(1)}%`}
                  subtext={`${data?.stats.completedRuns ?? 0} completed, ${data?.stats.failedRuns ?? 0} failed`}
                  color="#10b981"
                />
                <StatCard
                  icon={DollarSign}
                  label="Avg Cost/Run"
                  value={`$${((data?.stats.avgCostCents ?? 0) / 100).toFixed(2)}`}
                  subtext={`Total: $${((data?.stats.totalCostCents ?? 0) / 100).toFixed(2)}`}
                  color="#FFD60A"
                />
                <StatCard
                  icon={Clock}
                  label="Avg Duration"
                  value={data?.duration.avgMs ? `${Math.round(data.duration.avgMs / 60000)}m` : "—"}
                  subtext={data?.duration.minMs ? `Min: ${Math.round(data.duration.minMs / 60000)}m / Max: ${Math.round(data.duration.maxMs / 60000)}m` : "No data"}
                  color="#7C4DFF"
                />
              </div>

              {/* Two Column: Layer Scores + Error Breakdown */}
              <div className="grid lg:grid-cols-2 gap-6 mb-8">
                {/* Quality Harness Layer Scores */}
                <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
                  <div className="p-5 border-b border-white/5 flex items-center gap-3">
                    <Layers className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-heading font-semibold text-white">Quality Harness Scores</h3>
                  </div>
                  <div className="p-5">
                    {layerAggregates.length === 0 ? (
                      <p className="text-sm text-gray-400">No harness data in the last 7 days.</p>
                    ) : (
                      layerAggregates.map(agg => (
                        <LayerScoreBar
                          key={agg.layer}
                          layer={agg.layer}
                          avgScore={agg.avgScore}
                          passCount={agg.passCount}
                          totalCount={agg.totalCount}
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Error Breakdown */}
                <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
                  <div className="p-5 border-b border-white/5 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <h3 className="text-lg font-heading font-semibold text-white">Error Breakdown by Node</h3>
                  </div>
                  <div className="p-5">
                    {(!data?.nodeErrors || data.nodeErrors.length === 0) ? (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        No failures in the last 7 days
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.nodeErrors.map((ne: any) => (
                          <div key={ne.currentNode} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                            <span className="text-sm text-gray-300 capitalize">{ne.currentNode || "unknown"}</span>
                            <span className="text-sm text-red-400 font-mono">{Number(ne.errorCount)} failures</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Cost Spot-Check */}
              <div className="mb-8">
                <CostSpotCheck />
              </div>

              {/* Recent Runs Table */}
              <div className="rounded-2xl border border-white/5 bg-[#0D0D1A] overflow-hidden">
                <div className="p-5 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-lg font-heading font-semibold text-white">Recent Pipeline Runs</h3>
                  </div>
                  <span className="text-xs text-gray-500">Last 7 days</span>
                </div>
                {/* Table Header */}
                <div className="flex items-center gap-4 py-2 px-4 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider">
                  <div className="w-16">Run</div>
                  <div className="w-24">Status</div>
                  <div className="w-20">Progress</div>
                  <div className="w-24">Cost</div>
                  <div className="w-24">Duration</div>
                  <div className="flex-1">Current Node</div>
                  <div className="w-32">Date</div>
                </div>
                {/* Rows */}
                <div className="max-h-96 overflow-y-auto">
                  {(!data?.recentRuns || data.recentRuns.length === 0) ? (
                    <div className="p-8 text-center text-sm text-gray-400">No pipeline runs in the last 7 days.</div>
                  ) : (
                    data.recentRuns.map((run: any) => <RunRow key={run.id} run={run} />)
                  )}
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </PlatformLayout>
  );
}
