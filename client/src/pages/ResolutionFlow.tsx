import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type IssueStatus = "open" | "in_progress" | "resolved" | "approved" | "escalated" | "wont_fix";
type IssueType = "proportion_drift" | "color_inconsistency" | "off_model_face" | "pose_break" | "bg_mismatch" | "style_deviation" | "line_weight_mismatch";

const SEVERITY_COLORS: Record<number, string> = {
  1: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  2: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  3: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  4: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  5: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
};

const STATUS_COLORS: Record<IssueStatus, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  escalated: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  wont_fix: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  proportion_drift: "Proportion Drift",
  color_inconsistency: "Color Inconsistency",
  off_model_face: "Off-Model Face",
  pose_break: "Pose Break",
  bg_mismatch: "BG Mismatch",
  style_deviation: "Style Deviation",
  line_weight_mismatch: "Line Weight",
};

export default function ResolutionFlow() {
  const { user } = useAuth();
  // Using sonner toast
  const [selectedProjectId] = useState<number>(1);
  const [selectedEpisodeId] = useState<number>(1);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("punch-list");

  // Queries
  const issuesQuery = trpc.resolution.getIssues.useQuery({
    projectId: selectedProjectId,
    episodeId: selectedEpisodeId,
  });

  const summaryQuery = trpc.resolution.getIssueSummary.useQuery({
    projectId: selectedProjectId,
  });

  const consistencyQuery = trpc.resolution.getConsistencyScores.useQuery({
    projectId: selectedProjectId,
  });

  const issueDetailQuery = trpc.resolution.getIssueDetail.useQuery(
    { issueId: selectedIssueId! },
    { enabled: !!selectedIssueId }
  );

  // Mutations
  const triggerRegen = trpc.resolution.triggerRegen.useMutation({
    onSuccess: (result) => {
      toast.success(result.action === "regen_triggered" ? "Regen Triggered" : `Issue ${result.action}`, {
        description: result.reason,
      });
      issuesQuery.refetch();
      if (selectedIssueId) issueDetailQuery.refetch();
    },
  });

  const reviewRound = trpc.resolution.reviewRound.useMutation({
    onSuccess: () => {
      toast.success("Review Submitted");
      issuesQuery.refetch();
      if (selectedIssueId) issueDetailQuery.refetch();
    },
  });

  const batchApprove = trpc.resolution.batchApprove.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.approved} issues approved`);
      issuesQuery.refetch();
    },
  });

  const dismissIssue = trpc.resolution.dismissIssue.useMutation({
    onSuccess: () => {
      toast.success("Issue dismissed");
      issuesQuery.refetch();
      setSelectedIssueId(null);
    },
  });

  // Derived data
  const issues = issuesQuery.data ?? [];
  const summary = summaryQuery.data;
  const consistencyScores = consistencyQuery.data ?? [];

  const groupedByPanel = useMemo(() => {
    const groups: Record<number, typeof issues> = {};
    for (const issue of issues) {
      if (!groups[issue.panelId]) groups[issue.panelId] = [];
      groups[issue.panelId].push(issue);
    }
    return groups;
  }, [issues]);

  const lowSeverityIds = useMemo(
    () => issues.filter((i: any) => i.severity <= 2 && i.status === "open").map((i: any) => i.id),
    [issues]
  );

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Please log in to access the Resolution Flow.</p>
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Sakuga Kantoku Resolution Flow</h1>
        <p className="text-muted-foreground mt-1">
          Multi-round consistency resolution for genga sets
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold">{summary.total}</div>
              <div className="text-xs text-muted-foreground">Total Issues</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-blue-600">{summary.open}</div>
              <div className="text-xs text-muted-foreground">Open</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-purple-600">{summary.inProgress}</div>
              <div className="text-xs text-muted-foreground">In Progress</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-green-600">{summary.resolved}</div>
              <div className="text-xs text-muted-foreground">Resolved</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-red-600">{summary.escalated}</div>
              <div className="text-xs text-muted-foreground">Escalated</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold">
                {summary.bySeverity.critical}
              </div>
              <div className="text-xs text-muted-foreground">Critical</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Consistency Scores */}
      {consistencyScores.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Episode Consistency Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 flex-wrap">
              {consistencyScores.map((score: any) => (
                <div
                  key={score.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                >
                  <span className="text-sm font-medium">Ep {score.episodeId}</span>
                  <span
                    className={`text-sm font-bold ${
                      score.consistencyScore >= 80
                        ? "text-green-600"
                        : score.consistencyScore >= 60
                        ? "text-yellow-600"
                        : "text-red-600"
                    }`}
                  >
                    {score.consistencyScore}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({score.driftPanelCount}/{score.totalPanelCount} drift)
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="punch-list">Punch List</TabsTrigger>
            <TabsTrigger value="detail">Issue Detail</TabsTrigger>
            <TabsTrigger value="history">Round History</TabsTrigger>
          </TabsList>

          {lowSeverityIds.length > 0 && activeTab === "punch-list" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => batchApprove.mutate({ issueIds: lowSeverityIds })}
              disabled={batchApprove.isPending}
            >
              Batch Approve Low-Severity ({lowSeverityIds.length})
            </Button>
          )}
        </div>

        {/* Punch List Tab */}
        <TabsContent value="punch-list">
          {issuesQuery.isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading issues...</div>
          ) : issues.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No consistency issues found. The genga set looks clean!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByPanel).map(([panelId, panelIssues]) => (
                <Card key={panelId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      Panel #{panelId}
                      <Badge variant="outline">{panelIssues.length} issues</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {panelIssues.map((issue: any) => (
                        <div
                          key={issue.id}
                          className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors ${
                            selectedIssueId === issue.id ? "ring-2 ring-primary" : ""
                          }`}
                          onClick={() => {
                            setSelectedIssueId(issue.id);
                            setActiveTab("detail");
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <Badge className={SEVERITY_COLORS[issue.severity] ?? ""}>
                              S{issue.severity}
                            </Badge>
                            <Badge className={STATUS_COLORS[issue.status as IssueStatus] ?? ""}>
                              {issue.status}
                            </Badge>
                            <span className="text-sm font-medium">
                              {ISSUE_TYPE_LABELS[issue.issueType as IssueType] ?? issue.issueType}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {issue.roundCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {issue.roundCount} rounds
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerRegen.mutate({ issueId: issue.id });
                              }}
                              disabled={triggerRegen.isPending || issue.status === "resolved" || issue.status === "approved"}
                            >
                              Regen
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Issue Detail Tab */}
        <TabsContent value="detail">
          {!selectedIssueId ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">Select an issue from the punch list to view details.</p>
              </CardContent>
            </Card>
          ) : issueDetailQuery.isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : issueDetailQuery.data ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Issue Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Issue #{issueDetailQuery.data.issue.id}
                    <Badge className={SEVERITY_COLORS[issueDetailQuery.data.issue.severity] ?? ""}>
                      Severity {issueDetailQuery.data.issue.severity}
                    </Badge>
                    <Badge className={STATUS_COLORS[issueDetailQuery.data.issue.status as IssueStatus] ?? ""}>
                      {issueDetailQuery.data.issue.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Type</div>
                    <div>{ISSUE_TYPE_LABELS[issueDetailQuery.data.issue.issueType as IssueType]}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Description</div>
                    <div className="text-sm">{issueDetailQuery.data.issue.description}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Panel</div>
                    <div>#{issueDetailQuery.data.issue.panelId}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Rounds</div>
                    <div>{issueDetailQuery.data.issue.roundCount ?? 0} / 3 max</div>
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button
                      onClick={() => triggerRegen.mutate({ issueId: selectedIssueId })}
                      disabled={triggerRegen.isPending || issueDetailQuery.data.issue.status === "resolved"}
                    >
                      {triggerRegen.isPending ? "Processing..." : "Trigger Regen"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => dismissIssue.mutate({ issueId: selectedIssueId })}
                      disabled={dismissIssue.isPending}
                    >
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Side-by-side Comparison Placeholder */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                      <span className="text-sm text-muted-foreground">Original Panel</span>
                    </div>
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                      <span className="text-sm text-muted-foreground">
                        {issueDetailQuery.data.rounds.length > 0
                          ? "Latest Regen"
                          : "No regen yet"}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        {/* Round History Tab */}
        <TabsContent value="history">
          {!selectedIssueId ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">Select an issue to view its round history.</p>
              </CardContent>
            </Card>
          ) : issueDetailQuery.data?.rounds.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No regeneration rounds yet for this issue.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {issueDetailQuery.data?.rounds.map((round: any) => (
                <Card key={round.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold">
                          {round.roundNumber}
                        </div>
                        <div>
                          <div className="text-sm font-medium">Round {round.roundNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {round.reviewerVerdict
                              ? `Verdict: ${round.reviewerVerdict}`
                              : "Pending review"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {round.improvementScore !== null && (
                          <span className="text-sm">
                            {Math.round((round.improvementScore ?? 0) * 100)}% improved
                          </span>
                        )}
                        {!round.reviewerVerdict && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() =>
                                reviewRound.mutate({
                                  roundId: round.id,
                                  issueId: selectedIssueId!,
                                  verdict: "approved",
                                  improvementScore: 1.0,
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                reviewRound.mutate({
                                  roundId: round.id,
                                  issueId: selectedIssueId!,
                                  verdict: "rejected",
                                  improvementScore: 0.2,
                                })
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    {round.reviewerNotes && (
                      <p className="text-sm text-muted-foreground mt-2 pl-11">
                        {round.reviewerNotes}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
