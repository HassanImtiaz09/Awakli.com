/**
 * D1.5 Genga Viewer — Keyframe viewer with rough/clean toggle and flip-book preview
 * Shows genga keyframes organized by scene with approval workflow.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pencil, Sparkles, Play, Check, X, RotateCcw,
  Loader2, Film, ChevronDown, ChevronUp, Eye,
} from "lucide-react";

interface GengaViewerProps {
  episodeId: number;
  projectId: number;
  onGengaApproved?: () => void;
}

export function GengaViewer({ episodeId, projectId, onGengaApproved }: GengaViewerProps) {
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"rough" | "clean">("rough");
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);

  const { data: keyframes, isLoading, refetch } = trpc.gengaDirector.getByEpisode.useQuery({ episodeId });
  const { data: flipBooks } = trpc.gengaDirector.getFlipBooks.useQuery({ episodeId });

  const approveRoughMut = trpc.gengaDirector.approveRough.useMutation({ onSuccess: () => refetch() });
  const approveCleanMut = trpc.gengaDirector.approveClean.useMutation({ onSuccess: () => refetch() });
  const rejectMut = trpc.gengaDirector.reject.useMutation({ onSuccess: () => refetch() });
  const generateCleanMut = trpc.gengaDirector.generateClean.useMutation({ onSuccess: () => refetch() });
  const regenerateMut = trpc.gengaDirector.regenerate.useMutation({ onSuccess: () => refetch() });

  // Group keyframes by scene
  const sceneGroups = useMemo(() => {
    if (!keyframes) return [];
    const groups = new Map<number, typeof keyframes>();
    for (const kf of keyframes) {
      const sn = kf.sceneNumber;
      if (!groups.has(sn)) groups.set(sn, []);
      groups.get(sn)!.push(kf);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [keyframes]);

  // Flip-book lookup
  const flipBookMap = useMemo(() => {
    const map = new Map<number, any>();
    for (const fb of flipBooks || []) {
      map.set(fb.sceneNumber, fb);
    }
    return map;
  }, [flipBooks]);

  const totalKeyframes = keyframes?.length || 0;
  const roughApproved = keyframes?.filter(kf => kf.status === "approved_rough" || kf.status === "clean_ready" || kf.status === "approved").length || 0;
  const cleanApproved = keyframes?.filter(kf => kf.status === "approved").length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400 mr-2" />
        <span className="text-sm text-muted-foreground">Loading keyframes...</span>
      </div>
    );
  }

  if (!keyframes || keyframes.length === 0) {
    return (
      <Card className="border-dashed border-purple-500/30 bg-purple-950/10">
        <CardContent className="py-8 text-center">
          <Pencil className="h-8 w-8 mx-auto mb-3 text-purple-400/50" />
          <p className="text-sm text-muted-foreground">No genga keyframes yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Generate rough genga from approved layouts to begin.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Genga Keyframes</h3>
          <Badge variant="outline" className="text-xs">
            {totalKeyframes} frames
          </Badge>
        </div>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "rough" | "clean")}>
          <TabsList className="h-7">
            <TabsTrigger value="rough" className="text-[10px] h-5 px-2">
              <Pencil className="h-3 w-3 mr-1" /> Rough
            </TabsTrigger>
            <TabsTrigger value="clean" className="text-[10px] h-5 px-2">
              <Sparkles className="h-3 w-3 mr-1" /> Clean
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Rough: {roughApproved}/{totalKeyframes}</span>
          <span>Clean: {cleanApproved}/{totalKeyframes}</span>
        </div>
        <div className="h-1.5 bg-purple-950/30 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${(roughApproved / Math.max(totalKeyframes, 1)) * 50}%` }}
          />
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${(cleanApproved / Math.max(totalKeyframes, 1)) * 50}%` }}
          />
        </div>
      </div>

      {/* Scene groups */}
      {sceneGroups.map(([sceneNumber, sceneKeyframes]) => {
        const isExpanded = expandedScene === sceneNumber;
        const flipBook = flipBookMap.get(sceneNumber);

        return (
          <Card key={sceneNumber} className="border-purple-500/20 bg-card/50">
            <CardHeader
              className="py-2 px-3 cursor-pointer hover:bg-purple-500/5 transition-colors"
              onClick={() => setExpandedScene(isExpanded ? null : sceneNumber)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-purple-400" /> : <ChevronDown className="h-4 w-4 text-purple-400" />}
                  <CardTitle className="text-xs font-medium">Scene {sceneNumber}</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    {sceneKeyframes.length} keyframes
                  </Badge>
                  {flipBook && (
                    <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">
                      <Film className="h-2.5 w-2.5 mr-0.5" /> Flip-book
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 px-3 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {sceneKeyframes.map((kf) => {
                    const isSelected = selectedKeyframe === kf.id;
                    const imageUrl = viewMode === "clean" ? kf.cleanGengaUrl : kf.roughGengaUrl;
                    const statusColor =
                      kf.status === "approved" ? "border-green-500/50" :
                      kf.status === "approved_rough" || kf.status === "clean_ready" ? "border-amber-500/50" :
                      kf.status === "rejected" ? "border-red-500/50" : "border-purple-500/30";

                    return (
                      <div
                        key={kf.id}
                        className={`relative rounded-lg border p-2 cursor-pointer transition-all hover:bg-purple-500/5 ${statusColor} ${isSelected ? "ring-1 ring-purple-400" : ""}`}
                        onClick={() => setSelectedKeyframe(isSelected ? null : kf.id)}
                      >
                        {/* Panel number */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            P{kf.panelNumber}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[8px] h-4 ${
                              kf.status === "approved" ? "border-green-500/50 text-green-400" :
                              kf.status === "approved_rough" ? "border-amber-500/50 text-amber-400" :
                              kf.status === "rejected" ? "border-red-500/50 text-red-400" :
                              "border-purple-500/30 text-purple-400"
                            }`}
                          >
                            {kf.status.replace(/_/g, " ")}
                          </Badge>
                        </div>

                        {/* Keyframe image */}
                        <div className="aspect-video bg-purple-950/30 rounded border border-purple-500/10 mb-1 flex items-center justify-center overflow-hidden">
                          {imageUrl ? (
                            <img src={imageUrl} alt={`Keyframe S${kf.sceneNumber}P${kf.panelNumber}`} className="w-full h-full object-cover" />
                          ) : (
                            <Pencil className="h-4 w-4 text-purple-400/30" />
                          )}
                        </div>

                        {/* Actions */}
                        {isSelected && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {kf.status === "rough_ready" && (
                              <>
                                <Button
                                  size="sm" variant="outline"
                                  className="flex-1 h-6 text-[10px] border-green-500/30 text-green-400"
                                  onClick={(e) => { e.stopPropagation(); approveRoughMut.mutate({ keyframeId: kf.id }); }}
                                  disabled={approveRoughMut.isPending}
                                >
                                  <Check className="h-2.5 w-2.5 mr-0.5" /> Approve
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  className="flex-1 h-6 text-[10px] border-red-500/30 text-red-400"
                                  onClick={(e) => { e.stopPropagation(); rejectMut.mutate({ keyframeId: kf.id, reason: "Needs revision" }); }}
                                >
                                  <X className="h-2.5 w-2.5 mr-0.5" /> Reject
                                </Button>
                              </>
                            )}
                            {kf.status === "approved_rough" && (
                              <Button
                                size="sm" variant="outline"
                                className="w-full h-6 text-[10px] border-purple-500/30 text-purple-400"
                                onClick={(e) => { e.stopPropagation(); generateCleanMut.mutate({ keyframeId: kf.id, projectId }); }}
                                disabled={generateCleanMut.isPending}
                              >
                                {generateCleanMut.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" /> : <Sparkles className="h-2.5 w-2.5 mr-0.5" />}
                                Generate Clean
                              </Button>
                            )}
                            {kf.status === "clean_ready" && (
                              <Button
                                size="sm" variant="outline"
                                className="w-full h-6 text-[10px] border-green-500/30 text-green-400"
                                onClick={(e) => { e.stopPropagation(); approveCleanMut.mutate({ keyframeId: kf.id }); }}
                              >
                                <Check className="h-2.5 w-2.5 mr-0.5" /> Approve Clean
                              </Button>
                            )}
                            {kf.status === "rejected" && (
                              <Button
                                size="sm" variant="outline"
                                className="w-full h-6 text-[10px] border-amber-500/30 text-amber-400"
                                onClick={(e) => { e.stopPropagation(); regenerateMut.mutate({ keyframeId: kf.id, projectId }); }}
                                disabled={regenerateMut.isPending}
                              >
                                <RotateCcw className="h-2.5 w-2.5 mr-0.5" /> Regenerate
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Flip-book preview */}
                {flipBook && (
                  <div className="mt-3 p-2 rounded-lg border border-blue-500/20 bg-blue-950/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Film className="h-4 w-4 text-blue-400" />
                        <span className="text-xs font-medium text-blue-300">Flip-book Preview</span>
                        <Badge variant="outline" className="text-[10px] border-blue-500/30">
                          {flipBook.frameCount} frames
                        </Badge>
                      </div>
                      {flipBook.status === "ready" && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px] border-blue-500/30 text-blue-400">
                          <Play className="h-2.5 w-2.5 mr-0.5" /> Play
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default GengaViewer;
