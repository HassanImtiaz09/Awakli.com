/**
 * D5.5 Quality Dashboard
 *
 * Visualizes per-clip quality review results for an episode.
 * Shows overall pass rate, per-slice scores, and drill-down into retry history.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  Eye, Zap, Palette, Film, BarChart3
} from "lucide-react";

interface QualityDashboardProps {
  episodeId: number;
}

// Score color mapping
function scoreColor(score: number): string {
  if (score >= 4) return "text-emerald-400";
  if (score >= 3) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 4) return "bg-emerald-500/10 border-emerald-500/20";
  if (score >= 3) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: any }) {
  const pct = (score / 5) * 100;
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${score >= 4 ? "bg-emerald-500" : score >= 3 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-sm font-mono font-medium w-8 text-right ${scoreColor(score)}`}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function SliceCard({ slice, episodeId }: { slice: any; episodeId: number }) {
  const [expanded, setExpanded] = useState(false);

  const { data: history } = trpc.clipQuality.getSliceHistory.useQuery(
    { episodeId, sliceId: slice.sliceId },
    { enabled: expanded }
  );

  return (
    <div className={`border rounded-lg p-3 transition-all ${scoreBg(slice.scores.overall)}`}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {slice.passed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : slice.routingDecision === "escalate" ? (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-sm font-medium">Slice {slice.sliceId}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Attempt {slice.attempt}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono font-bold ${scoreColor(slice.scores.overall)}`}>
            {slice.scores.overall.toFixed(1)}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          <ScoreBar label="Character" score={slice.scores.characterConsistency} icon={Eye} />
          <ScoreBar label="Style" score={slice.scores.style} icon={Palette} />
          <ScoreBar label="Prompt Align" score={slice.scores.promptAlignment} icon={Zap} />
          <ScoreBar label="Motion" score={slice.scores.motionQuality} icon={Film} />

          {slice.issues && slice.issues.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <p className="text-xs text-muted-foreground mb-1">Issues:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {slice.issues.map((issue: any, i: number) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-red-400">•</span>
                    <span>{typeof issue === "string" ? issue : issue.description || JSON.stringify(issue)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {history && history.length > 1 && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <p className="text-xs text-muted-foreground mb-1">Retry History:</p>
              <div className="space-y-1">
                {history.map((h: any) => (
                  <div key={h.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Attempt {h.attempt} — {h.passed ? "✓ Pass" : "✗ Fail"}
                    </span>
                    <span className={`font-mono ${scoreColor(h.scores.overall)}`}>
                      {h.scores.overall.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
            <span>Cost: ${slice.costUsd.toFixed(3)}</span>
            <span>Routing: {slice.routingDecision}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function QualityDashboard({ episodeId }: QualityDashboardProps) {
  const { data, isLoading, error } = trpc.clipQuality.getEpisodeSummary.useQuery(
    { episodeId },
    { enabled: !!episodeId }
  );

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4" />
            Quality Gate (D5.5)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4" />
            Quality Gate (D5.5)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {data === undefined && !error ? "No quality reviews yet. Reviews run automatically during production." : "Unable to load quality data."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.totalSlices === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4" />
            Quality Gate (D5.5)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No clips reviewed yet. D5.5 runs automatically after each clip is generated.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4" />
            Quality Gate (D5.5)
          </CardTitle>
          <Badge
            variant={data.canProceedToAssembly ? "default" : "destructive"}
            className="text-xs"
          >
            {data.canProceedToAssembly ? "Ready for Assembly" : "Issues Pending"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-400">{data.passed}</p>
            <p className="text-[10px] text-muted-foreground">Passed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-400">{data.failed}</p>
            <p className="text-[10px] text-muted-foreground">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-400">{data.escalated}</p>
            <p className="text-[10px] text-muted-foreground">Escalated</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${scoreColor(data.avgOverallScore)}`}>
              {data.avgOverallScore.toFixed(1)}
            </p>
            <p className="text-[10px] text-muted-foreground">Avg Score</p>
          </div>
        </div>

        {/* Pass Rate Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Pass Rate</span>
            <span className="font-mono font-medium">{data.passRate}%</span>
          </div>
          <Progress value={data.passRate} className="h-2" />
        </div>

        {/* Per-Slice Grid */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {data.slices.map((slice: any) => (
            <SliceCard key={slice.sliceId} slice={slice} episodeId={episodeId} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default QualityDashboard;
