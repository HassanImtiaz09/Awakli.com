/**
 * D10 Craft Library — Ingestion Dashboard
 *
 * Admin-only component for managing web corpus ingestion.
 * Shows available sources, active jobs, and progress tracking.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Database, Play, Pause, RefreshCw, Clock,
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  Globe, BookOpen, Image, Palette,
} from "lucide-react";

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  sakugablog: <Globe className="h-5 w-5" />,
  sakugabooru: <Image className="h-5 w-5" />,
  animation_obsessive: <BookOpen className="h-5 w-5" />,
  pixiv_tutorials: <Palette className="h-5 w-5" />,
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-500/20 text-yellow-400",
  scraping: "bg-blue-500/20 text-blue-400",
  chunking: "bg-purple-500/20 text-purple-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  paused: "bg-orange-500/20 text-orange-400",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function IngestionDashboard() {
  const [maxItems, setMaxItems] = useState<Record<string, string>>({});

  const sourceSummary = trpc.ingestion.getSourceSummary.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const jobsList = trpc.ingestion.listJobs.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const startMutation = trpc.ingestion.startIngestion.useMutation({
    onSuccess: (data) => {
      toast.success(`Ingestion started: ${data.jobId}`);
      sourceSummary.refetch();
      jobsList.refetch();
    },
    onError: (err) => {
      toast.error(`Failed to start: ${err.message}`);
    },
  });

  const pauseMutation = trpc.ingestion.pauseJob.useMutation({
    onSuccess: () => {
      toast.success("Job paused");
      jobsList.refetch();
    },
    onError: (err) => {
      toast.error(`Failed to pause: ${err.message}`);
    },
  });

  const handleStart = (sourceKey: string) => {
    const max = maxItems[sourceKey] ? parseInt(maxItems[sourceKey], 10) : undefined;
    startMutation.mutate({
      sourceKey: sourceKey as any,
      maxItems: max && max > 0 ? max : undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Database className="h-5 w-5 text-purple-400" />
            Corpus Ingestion
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage web scraping and chunking for the Craft Library knowledge base
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { sourceSummary.refetch(); jobsList.refetch(); }}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Source Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sourceSummary.data?.map((source) => {
          const isRunning = source.lastJob?.status === "scraping" || source.lastJob?.status === "chunking";

          return (
            <Card key={source.key} className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {SOURCE_ICONS[source.key]}
                    <CardTitle className="text-base">{source.label}</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {source.subSensei.toUpperCase()}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  ~{source.estimatedArticles} articles · ~${source.estimatedCostUsd} estimated cost
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Last job status */}
                {source.lastJob && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge className={STATUS_COLORS[source.lastJob.status] ?? "bg-muted"}>
                      {source.lastJob.status}
                    </Badge>
                    {source.lastJob.chunkingStats && (
                      <span className="text-muted-foreground">
                        {source.lastJob.chunkingStats.totalChunks} chunks · {source.lastJob.chunkingStats.totalTokens.toLocaleString()} tokens
                      </span>
                    )}
                    {source.lastJob.scrapeProgress && isRunning && (
                      <span className="text-muted-foreground">
                        {source.lastJob.scrapeProgress.processedUrls}/{source.lastJob.scrapeProgress.totalUrls} pages
                      </span>
                    )}
                  </div>
                )}

                {/* Progress bar for running jobs */}
                {isRunning && source.lastJob?.scrapeProgress && (
                  <div className="space-y-1">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round((source.lastJob.scrapeProgress.processedUrls / Math.max(source.lastJob.scrapeProgress.totalUrls, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    {source.lastJob.scrapeProgress.estimatedRemainingMs && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        ~{formatDuration(source.lastJob.scrapeProgress.estimatedRemainingMs)} remaining
                      </p>
                    )}
                  </div>
                )}

                {/* Controls */}
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Max items (optional)"
                    className="h-8 text-xs w-36"
                    value={maxItems[source.key] ?? ""}
                    onChange={(e) => setMaxItems(prev => ({ ...prev, [source.key]: e.target.value }))}
                  />
                  {isRunning ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => source.lastJob && pauseMutation.mutate({ jobId: source.lastJob.id })}
                      disabled={pauseMutation.isPending}
                    >
                      <Pause className="h-3 w-3 mr-1" />
                      Pause
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 bg-purple-600 hover:bg-purple-700"
                      onClick={() => handleStart(source.key)}
                      disabled={startMutation.isPending}
                    >
                      {startMutation.isPending ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3 mr-1" />
                      )}
                      Start
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Active Jobs */}
      {jobsList.data && jobsList.data.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {jobsList.data.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm"
                >
                  <div className="flex items-center gap-3">
                    {job.status === "scraping" || job.status === "chunking" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    ) : job.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : job.status === "failed" ? (
                      <XCircle className="h-4 w-4 text-red-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-400" />
                    )}
                    <div>
                      <span className="font-medium">{job.sourceKey.replace(/_/g, " ")}</span>
                      <Badge className={`ml-2 text-xs ${STATUS_COLORS[job.status] ?? ""}`}>
                        {job.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {job.chunkingStats && (
                      <span>{job.chunkingStats.totalChunks} chunks</span>
                    )}
                    {job.startedAt && (
                      <span>{new Date(job.startedAt).toLocaleTimeString()}</span>
                    )}
                    {job.completedAt && job.startedAt && (
                      <span>{formatDuration(job.completedAt - job.startedAt)}</span>
                    )}
                    {job.error && (
                      <span className="text-red-400 max-w-[200px] truncate" title={job.error}>
                        {job.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
