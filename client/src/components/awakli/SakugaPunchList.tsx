/**
 * D2.5 Sakuga Punch List — Read-only consistency review display
 * MVP: Shows punch list items with severity badges and scores.
 * No inline editing or auto-fix — flags for human review only.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, AlertCircle, Info, Check, Eye,
  Loader2, BarChart3, ChevronDown, ChevronUp,
  Target, Compass, Zap, Palette, Move, Layers, Frame,
} from "lucide-react";

interface SakugaPunchListProps {
  episodeId: number;
  projectId: number;
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "Critical" },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Warning" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", label: "Info" },
};

const ISSUE_TYPE_CONFIG: Record<string, { icon: any; label: string }> = {
  character_scale_drift: { icon: Target, label: "Scale Drift" },
  perspective_break: { icon: Compass, label: "Perspective Break" },
  motion_arc_violation: { icon: Zap, label: "Motion Arc" },
  color_inconsistency: { icon: Palette, label: "Color" },
  pose_continuity: { icon: Move, label: "Pose Continuity" },
  depth_layer_error: { icon: Layers, label: "Depth Layer" },
  framing_mismatch: { icon: Frame, label: "Framing" },
  general: { icon: Eye, label: "General" },
};

function ScoreGauge({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? "text-green-400" : score >= 60 ? "text-amber-400" : "text-red-400";
  const bgColor = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-10 w-10">
        <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-950/50"
          />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeDasharray={`${score}, 100`}
            className={color}
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${color}`}>
          {score}
        </span>
      </div>
      <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

export function SakugaPunchList({ episodeId, projectId }: SakugaPunchListProps) {
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null);

  const { data: latestReview, isLoading } = trpc.sakugaKantoku.getLatest.useQuery({ episodeId });
  const acknowledgeMut = trpc.sakugaKantoku.acknowledge.useMutation();

  const punchList = useMemo(() => {
    if (!latestReview?.punchList) return [];
    const items = latestReview.punchList as any[];
    if (filterSeverity) return items.filter(i => i.severity === filterSeverity);
    return items;
  }, [latestReview, filterSeverity]);

  const scores = useMemo(() => {
    if (!latestReview) return null;
    return {
      overall: Number(latestReview.overallScore) || 0,
      characterConsistency: Number(latestReview.characterConsistencyScore) || 0,
      perspective: Number(latestReview.perspectiveScore) || 0,
      motionArc: Number(latestReview.motionArcScore) || 0,
      colorConsistency: Number(latestReview.colorConsistencyScore) || 0,
    };
  }, [latestReview]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400 mr-2" />
        <span className="text-sm text-muted-foreground">Loading review...</span>
      </div>
    );
  }

  if (!latestReview) {
    return (
      <Card className="border-dashed border-purple-500/30 bg-purple-950/10">
        <CardContent className="py-8 text-center">
          <BarChart3 className="h-8 w-8 mx-auto mb-3 text-purple-400/50" />
          <p className="text-sm text-muted-foreground">No Sakuga review yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Run a consistency review on approved genga to see the punch list.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Sakuga Review</h3>
          <Badge variant={latestReview.status === "acknowledged" ? "default" : "outline"} className="text-xs">
            {latestReview.status === "acknowledged" ? "Acknowledged" : "Pending Review"}
          </Badge>
        </div>
        {latestReview.status === "completed" && (
          <Button
            size="sm" variant="outline"
            className="text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={() => acknowledgeMut.mutate({ reviewId: latestReview.id })}
            disabled={acknowledgeMut.isPending}
          >
            <Check className="h-3 w-3 mr-1" /> Acknowledge
          </Button>
        )}
      </div>

      {/* Score gauges */}
      {scores && (
        <Card className="border-purple-500/20 bg-card/50">
          <CardContent className="py-3 px-4">
            <div className="flex justify-around">
              <ScoreGauge label="Overall" score={scores.overall} />
              <ScoreGauge label="Character" score={scores.characterConsistency} />
              <ScoreGauge label="Perspective" score={scores.perspective} />
              <ScoreGauge label="Motion" score={scores.motionArc} />
              <ScoreGauge label="Color" score={scores.colorConsistency} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Issue summary + filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm" variant={filterSeverity === null ? "default" : "outline"}
          className="h-6 text-[10px]"
          onClick={() => setFilterSeverity(null)}
        >
          All ({(latestReview.punchList as any[])?.length || 0})
        </Button>
        {(["critical", "warning", "info"] as const).map(sev => {
          const count = (latestReview.punchList as any[])?.filter((i: any) => i.severity === sev).length || 0;
          if (count === 0) return null;
          const config = SEVERITY_CONFIG[sev];
          return (
            <Button
              key={sev}
              size="sm"
              variant={filterSeverity === sev ? "default" : "outline"}
              className={`h-6 text-[10px] ${filterSeverity !== sev ? `${config.border} ${config.color}` : ""}`}
              onClick={() => setFilterSeverity(filterSeverity === sev ? null : sev)}
            >
              <config.icon className="h-2.5 w-2.5 mr-0.5" />
              {config.label} ({count})
            </Button>
          );
        })}
      </div>

      {/* Punch list items */}
      <div className="space-y-2">
        {punchList.map((item: any, idx: number) => {
          const sevConfig = SEVERITY_CONFIG[item.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.info;
          const typeConfig = ISSUE_TYPE_CONFIG[item.type] || ISSUE_TYPE_CONFIG.general;
          const isExpanded = expandedIssue === idx;

          return (
            <Card
              key={idx}
              className={`${sevConfig.border} ${sevConfig.bg} cursor-pointer transition-all hover:brightness-110`}
              onClick={() => setExpandedIssue(isExpanded ? null : idx)}
            >
              <CardContent className="py-2 px-3">
                <div className="flex items-start gap-2">
                  <sevConfig.icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${sevConfig.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className="text-[9px] h-4">
                        <typeConfig.icon className="h-2.5 w-2.5 mr-0.5" />
                        {typeConfig.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        S{item.sceneNumber} P{item.panelNumber}
                        {item.referencePanel ? ` → P${item.referencePanel}` : ""}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/90 leading-relaxed">{item.description}</p>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5">
                        {item.affectedCharacters?.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] text-muted-foreground">Characters:</span>
                            {item.affectedCharacters.map((c: string) => (
                              <Badge key={c} variant="secondary" className="text-[9px] h-4">{c}</Badge>
                            ))}
                          </div>
                        )}
                        <div className="p-2 rounded bg-purple-950/30 border border-purple-500/10">
                          <span className="text-[10px] text-muted-foreground block mb-0.5">Suggestion:</span>
                          <p className="text-xs text-purple-300">{item.suggestion}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {punchList.length === 0 && (
        <div className="text-center py-6">
          <Check className="h-6 w-6 mx-auto mb-2 text-green-400" />
          <p className="text-sm text-green-400">No issues found{filterSeverity ? ` for ${filterSeverity}` : ""}!</p>
        </div>
      )}
    </div>
  );
}

export default SakugaPunchList;
