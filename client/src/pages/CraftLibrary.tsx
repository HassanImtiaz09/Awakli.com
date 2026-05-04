/**
 * D10 Craft Library — Admin UI
 *
 * Source management, library stats, and query test panel.
 * Admin-only for source management; all authenticated users can query.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { MarketingLayout } from "@/components/awakli/Layouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  BookOpen, Database, Search, Plus, Archive,
  Loader2, BookMarked, Film, Pencil, Sparkles,
  BarChart3, MessageSquare, CheckCircle2, AlertTriangle,
  Download,
} from "lucide-react";
import { IngestionDashboard } from "@/components/awakli/IngestionDashboard";

// ─── Constants ──────────────────────────────────────────────────────────

const SUB_SENSEI_CONFIG = {
  anime: { label: "D10.A — Anime", icon: Film, color: "text-purple-400", bg: "bg-purple-500/10" },
  manga: { label: "D10.M — Manga", icon: BookMarked, color: "text-pink-400", bg: "bg-pink-500/10" },
  genga: { label: "D10.G — Genga", icon: Pencil, color: "text-cyan-400", bg: "bg-cyan-500/10" },
} as const;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  web_article: "Web Article",
  book_chapter: "Book Chapter",
  video_transcript: "Video Transcript",
  tutorial: "Tutorial",
  interview: "Interview",
  podcast_transcript: "Podcast",
  reference_image_set: "Reference Images",
};

const STATUS_BADGES: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "outline", label: "Pending" },
  ingesting: { variant: "secondary", label: "Ingesting" },
  ingested: { variant: "default", label: "Ingested" },
  failed: { variant: "destructive", label: "Failed" },
  archived: { variant: "outline", label: "Archived" },
};

const MODES = [
  { value: "direct" as const, label: "Direct", desc: "Ask a question", icon: MessageSquare },
  { value: "consult" as const, label: "Consult", desc: "Review artifact", icon: Sparkles },
  { value: "validate" as const, label: "Validate", desc: "Check principles", icon: CheckCircle2 },
];

// ─── Main Component ─────────────────────────────────────────────────────

export default function CraftLibrary() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<"overview" | "sources" | "query" | "ingestion">("overview");

  return (
    <MarketingLayout>
      <div className="min-h-screen bg-[#05050C] text-white">
        <div className="container max-w-7xl py-12">
          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-3">
              <BookOpen className="w-8 h-8 text-purple-400" />
              <h1 className="text-3xl font-bold tracking-tight">Craft Library</h1>
              <Badge variant="outline" className="text-purple-400 border-purple-400/30">D10</Badge>
            </div>
            <p className="text-zinc-400 max-w-2xl">
              Curated knowledge from anime production, manga craft, and genga technique.
              Three sub-senseis — D10.A (Anime), D10.M (Manga), D10.G (Genga) — each trained on domain-specific sources.
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-8 border-b border-zinc-800 pb-4">
            {([
              { key: "overview" as const, label: "Overview", icon: BarChart3 },
              { key: "sources" as const, label: "Sources", icon: Database },
              { key: "query" as const, label: "Query Test", icon: Search },
              ...(isAdmin ? [{ key: "ingestion" as const, label: "Ingestion", icon: Download }] : []),
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-purple-500/20 text-purple-300"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === "overview" && <OverviewTab />}
          {activeTab === "sources" && <SourcesTab isAdmin={isAdmin} />}
          {activeTab === "query" && <QueryTab />}
          {activeTab === "ingestion" && isAdmin && <IngestionDashboard />}
        </div>
      </div>
    </MarketingLayout>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────

function OverviewTab() {
  const { data: stats, isLoading } = trpc.craftLibrary.getStats.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!stats) return null;

  const senseis = (["anime", "manga", "genga"] as const).map(key => ({
    key,
    ...SUB_SENSEI_CONFIG[key],
    ...stats.bySubSensei[key],
  }));

  return (
    <div className="space-y-8">
      {/* Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="pb-2">
            <CardDescription className="text-zinc-500">Total Sources</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.totalSources}</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="pb-2">
            <CardDescription className="text-zinc-500">Total Chunks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.totalChunks.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="pb-2">
            <CardDescription className="text-zinc-500">Total Tokens</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{stats.totalTokens.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Sub-Sensei Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {senseis.map(s => {
          const Icon = s.icon;
          return (
            <Card key={s.key} className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${s.bg}`}>
                    <Icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white">{s.label}</CardTitle>
                    <CardDescription className="text-zinc-500">{s.key} production knowledge</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xl font-semibold text-white">{s.sources}</div>
                    <div className="text-xs text-zinc-500">Sources</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-white">{s.chunks.toLocaleString()}</div>
                    <div className="text-xs text-zinc-500">Chunks</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-white">{s.tokens.toLocaleString()}</div>
                    <div className="text-xs text-zinc-500">Tokens</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Status Breakdown */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white">Ingestion Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            {Object.entries(stats.byStatus).map(([status, count]) => {
              const badge = STATUS_BADGES[status] ?? { variant: "outline" as const, label: status };
              return (
                <div key={status} className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-zinc-400 text-sm">{count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sources Tab ────────────────────────────────────────────────────────

function SourcesTab({ isAdmin }: { isAdmin: boolean }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterSensei, setFilterSensei] = useState<string>("");

  const { data: sources, isLoading, refetch } = trpc.craftLibrary.listSources.useQuery(
    filterSensei ? { subSensei: filterSensei as "anime" | "manga" | "genga" } : undefined
  );

  const archiveMutation = trpc.craftLibrary.archiveSource.useMutation({
    onSuccess: () => {
      toast.success("Source archived");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setFilterSensei("")}
            className={`px-3 py-1.5 rounded-lg text-sm ${!filterSensei ? "bg-purple-500/20 text-purple-300" : "text-zinc-400 hover:bg-zinc-800"}`}
          >
            All
          </button>
          {(["anime", "manga", "genga"] as const).map(s => {
            const cfg = SUB_SENSEI_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setFilterSensei(s)}
                className={`px-3 py-1.5 rounded-lg text-sm ${filterSensei === s ? `${cfg.bg} ${cfg.color}` : "text-zinc-400 hover:bg-zinc-800"}`}
              >
                {cfg.label.split(" — ")[1]}
              </button>
            );
          })}
        </div>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Source
          </Button>
        )}
      </div>

      {/* Add Source Form */}
      {showAddForm && isAdmin && (
        <AddSourceForm onSuccess={() => { setShowAddForm(false); refetch(); }} />
      )}

      {/* Sources List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        </div>
      ) : !sources || sources.length === 0 ? (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="py-12 text-center">
            <Database className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400">No sources yet. Add your first knowledge source to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((source: any) => {
            const cfg = SUB_SENSEI_CONFIG[source.subSensei as keyof typeof SUB_SENSEI_CONFIG];
            const Icon = cfg?.icon ?? BookOpen;
            const statusBadge = STATUS_BADGES[source.status] ?? { variant: "outline" as const, label: source.status };
            return (
              <Card key={source.id} className="bg-zinc-900/50 border-zinc-800">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${cfg?.bg ?? "bg-zinc-800"} mt-0.5`}>
                        <Icon className={`w-4 h-4 ${cfg?.color ?? "text-zinc-400"}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-white">{source.title}</span>
                          <Badge variant={statusBadge.variant} className="text-xs">{statusBadge.label}</Badge>
                          <Badge variant="outline" className="text-xs text-zinc-500">
                            {SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}
                          </Badge>
                        </div>
                        {source.author && (
                          <p className="text-sm text-zinc-500">by {source.author}</p>
                        )}
                        {source.description && (
                          <p className="text-sm text-zinc-400 mt-1 line-clamp-2">{source.description}</p>
                        )}
                        <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                          <span>{source.chunkCount ?? 0} chunks</span>
                          <span>{(source.totalTokens ?? 0).toLocaleString()} tokens</span>
                          {source.url && (
                            <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">
                              Source URL
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    {isAdmin && source.status !== "archived" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => archiveMutation.mutate({ id: source.id })}
                        className="text-zinc-500 hover:text-red-400"
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Add Source Form ────────────────────────────────────────────────────

function AddSourceForm({ onSuccess }: { onSuccess: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [subSensei, setSubSensei] = useState<"anime" | "manga" | "genga">("anime");
  const [sourceType, setSourceType] = useState<string>("web_article");

  const addMutation = trpc.craftLibrary.addSource.useMutation({
    onSuccess: () => {
      toast.success("Source added — it will be ingested in the next batch.");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className="bg-zinc-900/50 border-purple-500/20">
      <CardHeader>
        <CardTitle className="text-white text-lg">Add Knowledge Source</CardTitle>
        <CardDescription className="text-zinc-500">Register a new source for ingestion into the Craft Library.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Title *</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Sakuga Blog — Timing in Action Scenes"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Author</label>
            <Input
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="e.g. Kevin Cirugeda"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Sub-Sensei *</label>
            <div className="flex gap-2">
              {(["anime", "manga", "genga"] as const).map(s => {
                const cfg = SUB_SENSEI_CONFIG[s];
                return (
                  <button
                    key={s}
                    onClick={() => setSubSensei(s)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      subSensei === s
                        ? `${cfg.bg} ${cfg.color} border-current`
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {cfg.label.split(" — ")[1]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Source Type *</label>
            <select
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm"
            >
              {Object.entries(SOURCE_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm text-zinc-400 mb-1 block">URL</label>
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://..."
            className="bg-zinc-800 border-zinc-700 text-white"
          />
        </div>

        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Description</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description of what this source covers..."
            className="bg-zinc-800 border-zinc-700 text-white resize-none"
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onSuccess} className="border-zinc-700 text-zinc-400">
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!title.trim()) {
                toast.error("Title is required");
                return;
              }
              addMutation.mutate({
                title: title.trim(),
                subSensei,
                sourceType: sourceType as any,
                url: url.trim() || undefined,
                author: author.trim() || undefined,
                description: description.trim() || undefined,
              });
            }}
            disabled={addMutation.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {addMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Add Source
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Query Tab ──────────────────────────────────────────────────────────

function QueryTab() {
  const [queryText, setQueryText] = useState("");
  const [subSensei, setSubSensei] = useState<"anime" | "manga" | "genga">("anime");
  const [mode, setMode] = useState<"direct" | "consult" | "validate">("direct");
  const [includeCrossTags, setIncludeCrossTags] = useState(false);
  const [artifactContext, setArtifactContext] = useState("");

  const queryMutation = trpc.craftLibrary.query.useMutation({
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Query Input */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">Query the Craft Library</CardTitle>
          <CardDescription className="text-zinc-500">
            Test semantic retrieval + LLM synthesis across the three sub-senseis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sub-Sensei Selector */}
          <div>
            <label className="text-sm text-zinc-400 mb-2 block">Sub-Sensei</label>
            <div className="flex gap-2">
              {(["anime", "manga", "genga"] as const).map(s => {
                const cfg = SUB_SENSEI_CONFIG[s];
                return (
                  <button
                    key={s}
                    onClick={() => setSubSensei(s)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      subSensei === s
                        ? `${cfg.bg} ${cfg.color} border-current`
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {cfg.label.split(" — ")[1]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode Selector */}
          <div>
            <label className="text-sm text-zinc-400 mb-2 block">Engagement Mode</label>
            <div className="flex gap-2">
              {MODES.map(m => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      mode === m.value
                        ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      {m.label}
                    </div>
                    <div className="text-xs opacity-60 mt-0.5">{m.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Query Input */}
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">
              {mode === "direct" ? "Your Question" : mode === "consult" ? "Consultation Request" : "Validation Criteria"}
            </label>
            <Textarea
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              placeholder={
                mode === "direct"
                  ? "e.g. What camera angles work best for shonen fight scenes?"
                  : mode === "consult"
                  ? "e.g. Review the timing of these genga keyframes for a chase scene"
                  : "e.g. Check if this panel layout follows manga pacing rules for action sequences"
              }
              className="bg-zinc-800 border-zinc-700 text-white resize-none"
              rows={3}
            />
          </div>

          {/* Artifact Context (for consult/validate) */}
          {(mode === "consult" || mode === "validate") && (
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Artifact Context (optional)</label>
              <Textarea
                value={artifactContext}
                onChange={e => setArtifactContext(e.target.value)}
                placeholder="Paste artifact description, URL, or metadata here..."
                className="bg-zinc-800 border-zinc-700 text-white resize-none"
                rows={3}
              />
            </div>
          )}

          {/* Options */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCrossTags}
                onChange={e => setIncludeCrossTags(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Include cross-tagged sources
            </label>
          </div>

          {/* Submit */}
          <Button
            onClick={() => {
              if (queryText.trim().length < 5) {
                toast.error("Query too short — minimum 5 characters.");
                return;
              }
              queryMutation.mutate({
                query: queryText.trim(),
                subSensei,
                mode,
                includeCrossTags,
                artifactContext: artifactContext.trim() || undefined,
              });
            }}
            disabled={queryMutation.isPending}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {queryMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Querying...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Query Craft Library
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {queryMutation.data && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-lg">Result</CardTitle>
              <div className="flex gap-2">
                {queryMutation.data.verdict && (
                  <Badge
                    variant={queryMutation.data.verdict === "pass" ? "default" : queryMutation.data.verdict === "fail" ? "destructive" : "secondary"}
                  >
                    {queryMutation.data.verdict === "pass" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
                    {queryMutation.data.verdict}
                  </Badge>
                )}
                <Badge variant="outline" className="text-zinc-500">
                  ${queryMutation.data.costUsd.toFixed(3)} · {queryMutation.data.durationMs}ms
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Guidance */}
            <div className="prose prose-invert prose-sm max-w-none">
              <div className="whitespace-pre-wrap text-zinc-300 leading-relaxed">
                {queryMutation.data.guidance}
              </div>
            </div>

            {/* Issues (validate mode) */}
            {queryMutation.data.issues && queryMutation.data.issues.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-red-400 mb-2">Issues Found</h4>
                <ul className="space-y-1">
                  {queryMutation.data.issues.map((issue: string, i: number) => (
                    <li key={i} className="text-sm text-zinc-400 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions (consult mode) */}
            {queryMutation.data.suggestions && queryMutation.data.suggestions.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-purple-400 mb-2">Suggestions</h4>
                <ul className="space-y-1">
                  {queryMutation.data.suggestions.map((sug: string, i: number) => (
                    <li key={i} className="text-sm text-zinc-400 flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                      {sug}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sources */}
            {queryMutation.data.sources.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-zinc-400 mb-2">Sources ({queryMutation.data.sources.length})</h4>
                <div className="space-y-2">
                  {queryMutation.data.sources.map((src: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-zinc-500">
                      <Badge variant="outline" className="text-xs">
                        {(src.relevanceScore * 100).toFixed(0)}%
                      </Badge>
                      <span className="font-medium text-zinc-400">{src.sourceTitle}</span>
                      {src.sourceAuthor && <span>by {src.sourceAuthor}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
