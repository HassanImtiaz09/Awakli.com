/**
 * D1.25 Layout Composer — Panel composition viewer/editor
 * Shows camera angles, character placements, depth layers per panel.
 * Integrated into the production pipeline after script + character sheets.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Camera, Check, X, ChevronDown, ChevronUp, Layers, Users,
  Eye, Maximize2, RotateCcw, Loader2, AlertTriangle,
} from "lucide-react";

interface LayoutComposerProps {
  episodeId: number;
  projectId: number;
  onLayoutsApproved?: () => void;
}

const CAMERA_ICONS: Record<string, string> = {
  wide: "🎬", medium: "📷", close_up: "🔍", extreme_close_up: "🔬",
  birds_eye: "🦅", worms_eye: "🐛", dutch_angle: "📐", over_shoulder: "👤",
};

export function LayoutComposer({ episodeId, projectId, onLayoutsApproved }: LayoutComposerProps) {
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<number | null>(null);

  const { data: layouts, isLoading, refetch } = trpc.layoutDirector.getByEpisode.useQuery({ episodeId });
  const approveMut = trpc.layoutDirector.approve.useMutation({ onSuccess: () => refetch() });
  const rejectMut = trpc.layoutDirector.reject.useMutation({ onSuccess: () => refetch() });
  const approveAllMut = trpc.layoutDirector.approveAll.useMutation({
    onSuccess: () => { refetch(); onLayoutsApproved?.(); },
  });

  // Group layouts by scene
  const sceneGroups = useMemo(() => {
    if (!layouts) return [];
    const groups = new Map<number, typeof layouts>();
    for (const layout of layouts) {
      const sn = (layout as any).sceneNumber || 0;
      if (!groups.has(sn)) groups.set(sn, []);
      groups.get(sn)!.push(layout);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [layouts]);

  const pendingCount = layouts?.filter(l => l.status === "pending").length || 0;
  const approvedCount = layouts?.filter(l => l.status === "approved").length || 0;
  const totalCount = layouts?.length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400 mr-2" />
        <span className="text-sm text-muted-foreground">Loading layouts...</span>
      </div>
    );
  }

  if (!layouts || layouts.length === 0) {
    return (
      <Card className="border-dashed border-purple-500/30 bg-purple-950/10">
        <CardContent className="py-8 text-center">
          <Camera className="h-8 w-8 mx-auto mb-3 text-purple-400/50" />
          <p className="text-sm text-muted-foreground">No layouts generated yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Generate layouts from the script to see panel compositions here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Panel Layouts</h3>
          <Badge variant="outline" className="text-xs">
            {approvedCount}/{totalCount} approved
          </Badge>
        </div>
        {pendingCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={() => approveAllMut.mutate({ episodeId })}
            disabled={approveAllMut.isPending}
          >
            {approveAllMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
            Approve All ({pendingCount})
          </Button>
        )}
      </div>

      {/* Scene groups */}
      {sceneGroups.map(([sceneNumber, scenePanels]) => {
        const isExpanded = expandedScene === sceneNumber;
        const sceneApproved = scenePanels.filter(p => p.status === "approved").length;

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
                    {scenePanels.length} panels
                  </Badge>
                </div>
                <Badge
                  variant={sceneApproved === scenePanels.length ? "default" : "outline"}
                  className={`text-[10px] ${sceneApproved === scenePanels.length ? "bg-green-600" : ""}`}
                >
                  {sceneApproved}/{scenePanels.length}
                </Badge>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 px-3 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {scenePanels.map((layout) => {
                    const lj = layout.layoutJson as any;
                    const isSelected = selectedLayout === layout.id;
                    const statusColor = layout.status === "approved" ? "border-green-500/50" :
                      layout.status === "rejected" ? "border-red-500/50" : "border-purple-500/30";

                    return (
                      <TooltipProvider key={layout.id}>
                        <div
                          className={`relative rounded-lg border p-2 cursor-pointer transition-all hover:bg-purple-500/5 ${statusColor} ${isSelected ? "ring-1 ring-purple-400" : ""}`}
                          onClick={() => setSelectedLayout(isSelected ? null : layout.id)}
                        >
                          {/* Panel number + camera */}
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono text-muted-foreground">
                              P{lj?.panelNumber || "?"}
                            </span>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="text-xs">{CAMERA_ICONS[lj?.cameraAngle] || "📷"}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">{lj?.cameraAngle || "medium"}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>

                          {/* Composition sketch placeholder */}
                          <div className="aspect-video bg-purple-950/30 rounded border border-purple-500/10 mb-1 flex items-center justify-center">
                            {layout.compositionSketchUrl ? (
                              <img
                                src={layout.compositionSketchUrl || ""}
                                alt={`Panel ${lj?.panelNumber}`}
                                className="w-full h-full object-cover rounded"
                              />
                            ) : (
                              <Layers className="h-4 w-4 text-purple-400/30" />
                            )}
                          </div>

                          {/* Character count + depth layers */}
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-0.5">
                              <Users className="h-3 w-3" />
                              {(lj?.characterPlacements || []).length}
                            </span>
                            <span className="flex items-center gap-0.5">
                              <Layers className="h-3 w-3" />
                              {Object.keys(lj?.depthLayers || {}).length}L
                            </span>
                          </div>

                          {/* Status badge */}
                          <div className="absolute top-1 right-1">
                            {layout.status === "approved" && (
                              <div className="h-4 w-4 rounded-full bg-green-600 flex items-center justify-center">
                                <Check className="h-2.5 w-2.5 text-white" />
                              </div>
                            )}
                            {layout.status === "rejected" && (
                              <div className="h-4 w-4 rounded-full bg-red-600 flex items-center justify-center">
                                <X className="h-2.5 w-2.5 text-white" />
                              </div>
                            )}
                          </div>

                          {/* Action buttons on hover */}
                          {isSelected && layout.status === "pending" && (
                            <div className="flex gap-1 mt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 h-6 text-[10px] border-green-500/30 text-green-400 hover:bg-green-500/10"
                                onClick={(e) => { e.stopPropagation(); approveMut.mutate({ id: layout.id }); }}
                                disabled={approveMut.isPending}
                              >
                                <Check className="h-2.5 w-2.5 mr-0.5" /> OK
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 h-6 text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                                onClick={(e) => { e.stopPropagation(); rejectMut.mutate({ id: layout.id, reason: "Needs revision" }); }}
                                disabled={rejectMut.isPending}
                              >
                                <X className="h-2.5 w-2.5 mr-0.5" /> Redo
                              </Button>
                            </div>
                          )}
                        </div>
                      </TooltipProvider>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default LayoutComposer;
