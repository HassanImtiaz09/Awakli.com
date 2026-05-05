/**
 * Admin Founders' Dashboard — Per-Creator Status Tracking
 *
 * Wave 5C Gap 2c: Founder dashboard UI routes for per-creator tracking.
 * Displays cohort metrics, outreach pipeline, and per-creator status.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, UserPlus, Send, Calendar, MessageSquare, TrendingUp,
  ExternalLink, Crown, AlertCircle, CheckCircle2, Clock,
} from "lucide-react";

// ─── Status badge colors ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  identified: "bg-gray-500/20 text-gray-300",
  draft_ready: "bg-blue-500/20 text-blue-300",
  contacted: "bg-yellow-500/20 text-yellow-300",
  responded: "bg-purple-500/20 text-purple-300",
  onboarding: "bg-indigo-500/20 text-indigo-300",
  active: "bg-green-500/20 text-green-300",
  paused: "bg-orange-500/20 text-orange-300",
  churned: "bg-red-500/20 text-red-300",
  declined: "bg-red-500/20 text-red-300",
  // Inbound statuses
  new: "bg-blue-500/20 text-blue-300",
  reviewing: "bg-yellow-500/20 text-yellow-300",
  shortlisted: "bg-green-500/20 text-green-300",
};

const SOURCE_PLATFORMS = [
  "twitter", "artstation", "pixiv", "deviantart", "instagram",
  "youtube", "tiktok", "webtoon", "tapas", "personal_site", "referral", "inbound",
] as const;

export default function AdminFoundersDashboard() {
  const { user } = useAuth();
  // toast from sonner (no destructure needed)
  const [activeTab, setActiveTab] = useState("overview");

  // ─── Queries ────────────────────────────────────────────────────────────
  const cohortMetrics = trpc.foundersOutbound.cohortMetrics.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const inboundList = trpc.founders.list.useQuery(
    { status: "all", limit: 50, offset: 0 },
    { enabled: user?.role === "admin" },
  );

  const integrationStatus = trpc.foundersIntegrations.integrationStatus.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const officeHours = trpc.foundersIntegrations.getOfficeHours.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  // ─── Mutations ──────────────────────────────────────────────────────────
  const addProspect = trpc.foundersOutbound.addProspect.useMutation({
    onSuccess: (data) => {
      toast.success("Prospect added: " + data.draft.subject);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const sendAnnouncement = trpc.foundersIntegrations.sendAnnouncement.useMutation({
    onSuccess: () => toast.success("Announcement sent to Discord"),
    onError: (err: any) => toast.error(err.message),
  });

  const initiateOnboarding = trpc.founders.initiateStripeConnectOnboarding.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      if (data.onboardingUrl) {
        window.open(data.onboardingUrl, "_blank");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  // ─── Prospect Form State ───────────────────────────────────────────────
  const [prospectForm, setProspectForm] = useState({
    name: "",
    sourcePlatform: "twitter" as typeof SOURCE_PLATFORMS[number],
    profileUrl: "",
    genres: "",
    artStyle: "",
  });

  // ─── Discord Announcement State ────────────────────────────────────────
  const [announcement, setAnnouncement] = useState({ content: "", title: "" });

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <p className="text-lg">Admin access required</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = cohortMetrics.data;

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Crown className="w-8 h-8 text-purple-400" />
            Founders' Studio Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Per-creator tracking, outbound pipeline, and cohort management
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="outbound">Outbound</TabsTrigger>
          <TabsTrigger value="inbound">Inbound</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
        </TabsList>

        {/* ─── Overview Tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          {/* Cohort Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Creators</CardDescription>
                <CardTitle className="text-2xl">{metrics?.total ?? 0}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span>{metrics?.activeCreators ?? 0} active</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Conversion Rate</CardDescription>
                <CardTitle className="text-2xl">
                  {((metrics?.conversionRate ?? 0) * 100).toFixed(1)}%
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <TrendingUp className="w-4 h-4" />
                  <span>contacted → active</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Avg Episodes/Creator</CardDescription>
                <CardTitle className="text-2xl">
                  {(metrics?.avgEpisodesPerCreator ?? 0).toFixed(1)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>delivered</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Blocked</CardDescription>
                <CardTitle className="text-2xl">{metrics?.blockedCreators ?? 0}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span>need attention</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Status Breakdown */}
          {metrics?.byStatus && (
            <Card>
              <CardHeader>
                <CardTitle>Pipeline Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {Object.entries(metrics.byStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-2">
                      <Badge className={STATUS_COLORS[status] || "bg-gray-500/20"}>
                        {status.replace("_", " ")}
                      </Badge>
                      <span className="text-sm font-mono">{count as number}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Office Hours */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Upcoming Office Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              {officeHours.data?.configured === false ? (
                <p className="text-muted-foreground text-sm">
                  Cal.com not configured. Set CALCOM_API_KEY to enable scheduling.
                </p>
              ) : officeHours.data?.bookings.length === 0 ? (
                <p className="text-muted-foreground text-sm">No upcoming sessions scheduled.</p>
              ) : (
                <div className="space-y-2">
                  {officeHours.data?.bookings.map((booking) => (
                    <div key={booking.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="font-medium">{booking.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(booking.startTime).toLocaleString()} • {booking.attendeeCount} attendee(s)
                        </p>
                      </div>
                      {booking.meetingUrl && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={booking.meetingUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4 mr-1" /> Join
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Outbound Tab ────────────────────────────────────────────── */}
        <TabsContent value="outbound" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5" />
                Add New Prospect
              </CardTitle>
              <CardDescription>
                Add a creator to the outbound pipeline and generate an outreach draft.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  placeholder="Creator name"
                  value={prospectForm.name}
                  onChange={(e) => setProspectForm(p => ({ ...p, name: e.target.value }))}
                />
                <Select
                  value={prospectForm.sourcePlatform}
                  onValueChange={(v) => setProspectForm(p => ({ ...p, sourcePlatform: v as any }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Source platform" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_PLATFORMS.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Profile URL"
                  value={prospectForm.profileUrl}
                  onChange={(e) => setProspectForm(p => ({ ...p, profileUrl: e.target.value }))}
                />
                <Input
                  placeholder="Genres (comma-separated)"
                  value={prospectForm.genres}
                  onChange={(e) => setProspectForm(p => ({ ...p, genres: e.target.value }))}
                />
              </div>
              <Input
                placeholder="Art style description (optional)"
                value={prospectForm.artStyle}
                onChange={(e) => setProspectForm(p => ({ ...p, artStyle: e.target.value }))}
              />
              <Button
                onClick={() => {
                  addProspect.mutate({
                    name: prospectForm.name,
                    sourcePlatform: prospectForm.sourcePlatform,
                    profileUrl: prospectForm.profileUrl,
                    genres: prospectForm.genres.split(",").map(g => g.trim()).filter(Boolean),
                    artStyle: prospectForm.artStyle || undefined,
                  });
                }}
                disabled={!prospectForm.name || !prospectForm.profileUrl || addProspect.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                {addProspect.isPending ? "Adding..." : "Add & Generate Draft"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Inbound Tab ─────────────────────────────────────────────── */}
        <TabsContent value="inbound" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Inbound Interest Submissions</CardTitle>
              <CardDescription>
                Express Interest form submissions for triage.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {inboundList.isLoading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : inboundList.data?.items.length === 0 ? (
                <p className="text-muted-foreground">No submissions yet.</p>
              ) : (
                <div className="space-y-3">
                  {inboundList.data?.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          <Badge className={STATUS_COLORS[item.status || "new"] || ""}>
                            {item.status}
                          </Badge>
                          <Badge variant="outline">{item.outputTrack}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.email}</p>
                        <p className="text-sm text-muted-foreground line-clamp-1">{item.pitch}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(item.portfolioUrl, "_blank")}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        {(item.status === "shortlisted" || item.status === "contacted") && (
                          <Button
                            size="sm"
                            onClick={() => {
                              initiateOnboarding.mutate({
                                founderInterestId: item.id,
                                origin: window.location.origin,
                              });
                            }}
                            disabled={initiateOnboarding.isPending}
                          >
                            Stripe Onboard
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Integrations Tab ────────────────────────────────────────── */}
        <TabsContent value="integrations" className="space-y-6">
          {/* Integration Status */}
          <Card>
            <CardHeader>
              <CardTitle>Integration Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-5 h-5 text-blue-400" />
                    <span className="font-medium">Cal.com</span>
                    {integrationStatus.data?.calcom.configured ? (
                      <Badge className="bg-green-500/20 text-green-300">Connected</Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-300">Not configured</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Weekly office hours scheduling for cohort members.
                  </p>
                </div>
                <div className="p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-5 h-5 text-indigo-400" />
                    <span className="font-medium">Discord</span>
                    {integrationStatus.data?.discord.configured ? (
                      <Badge className="bg-green-500/20 text-green-300">Connected</Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-300">Not configured</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Private cohort channel, announcements, and role management.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Discord Announcement */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Send Cohort Announcement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Announcement title (optional)"
                value={announcement.title}
                onChange={(e) => setAnnouncement(a => ({ ...a, title: e.target.value }))}
              />
              <Textarea
                placeholder="Message content..."
                value={announcement.content}
                onChange={(e) => setAnnouncement(a => ({ ...a, content: e.target.value }))}
                rows={4}
              />
              <Button
                onClick={() => {
                  sendAnnouncement.mutate({
                    content: announcement.content,
                    title: announcement.title || undefined,
                  });
                }}
                disabled={!announcement.content || sendAnnouncement.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                {sendAnnouncement.isPending ? "Sending..." : "Send to Discord"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Onboarding Tab ──────────────────────────────────────────── */}
        <TabsContent value="onboarding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stripe Connect Onboarding</CardTitle>
              <CardDescription>
                Initiate Stripe Connect Express accounts for approved founders.
                Use the "Stripe Onboard" button on shortlisted/contacted submissions in the Inbound tab.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Onboarding Flow
                </h4>
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                  <li>Admin shortlists a founder from inbound submissions</li>
                  <li>Admin clicks "Stripe Onboard" → Express account created</li>
                  <li>Onboarding URL shared with founder (opens Stripe's hosted flow)</li>
                  <li>Founder completes KYC/bank details on Stripe</li>
                  <li>Webhook confirms onboarding complete → creator marked active</li>
                  <li>Automated payouts begin via Wave 5B Connect infrastructure</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
