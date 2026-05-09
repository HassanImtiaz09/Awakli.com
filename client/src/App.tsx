import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { AnimatePresence } from "framer-motion";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import UpgradeModal from "./components/awakli/UpgradeModal";
import { ThemeProvider } from "./contexts/ThemeContext";
import { STORAGE_KEY_RETURN_PATH } from "./const";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Discover from "./pages/Discover";
import Explore from "./pages/Explore";
import StudioDashboard from "./pages/StudioDashboard";
import MangaUpload from "./pages/MangaUpload";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectWizard from "./pages/ProjectWizard";
import ScriptEditor from "./pages/ScriptEditor";
import CharacterCreator from "./pages/CharacterCreator";
import PanelReview from "./pages/PanelReview";
import StoryboardPreview from "./pages/StoryboardPreview";
import WatchProject from "./pages/WatchProject";
import EpisodePlayer from "./pages/EpisodePlayer";
import UserProfile from "./pages/UserProfile";
import PipelineDashboard from "./pages/PipelineDashboard";
import QAReview from "./pages/QAReview";
import GateReview from "./pages/GateReview";
import BatchGateReview from "./pages/BatchGateReview";
import AdminGateAnalytics from "./pages/AdminGateAnalytics";
import QualityInsights from "./pages/QualityInsights";
import VoiceCloning from "./pages/VoiceCloning";
import Pricing from "./pages/Pricing";
import UsageDashboard from "./pages/UsageDashboard";
import CreatorEarnings from "./pages/CreatorEarnings";
import AdminDashboard from "./pages/AdminDashboard";
import AdminPrintPayouts from "./pages/AdminPrintPayouts";
import ResolutionFlow from "./pages/ResolutionFlow";
import ProviderAdmin from "./pages/ProviderAdmin";
import Onboarding from "./pages/Onboarding";
import Create from "./pages/Create";
import CreateDashboard from "./pages/CreateDashboard";
import PreProduction from "./pages/PreProduction";
import MusicStudio from "./pages/MusicStudio";
import VocalRecordingStudio from "./pages/VocalRecordingStudio";
import CreateGenerate from "./pages/CreateGenerate";
import CreateReader from "./pages/CreateReader";
import CharacterBible from "./pages/CharacterBible";
import DemoRecording from "./pages/DemoRecording";
import Trending from "./pages/Trending";
import BYOUpload from "./pages/BYOUpload";
import CreatorAnalytics from "./pages/CreatorAnalytics";
import CharacterLibrary from "./pages/CharacterLibrary";
import CharacterDetail from "./pages/CharacterDetail";
import BatchTraining from "./pages/BatchTraining";
import BatchAssemblyQueue from "./pages/BatchAssemblyQueue";
import ConsistencyReport from "./pages/ConsistencyReport";
import LineartPipeline from "./pages/LineartPipeline";
import DebugTokens from "./pages/DebugTokens";
import LoraMarketplace from "./pages/LoraMarketplace";
import LoraMarketplaceDetail from "./pages/LoraMarketplaceDetail";
import LocationLibrary from "./pages/LocationLibrary";
import GenerationDashboard from "./pages/GenerationDashboard";
import MangaReader from "./pages/MangaReader";
import WizardInput from "./pages/create/input";
import WizardSetup from "./pages/create/setup";
import WizardScript from "./pages/create/script";
import WizardPanels from "./pages/create/panels";
import WizardAnimeGate from "./pages/create/anime-gate";
import WizardVideo from "./pages/create/video";
import WizardCharacterSetup from "./pages/create/character-setup";
import WizardPublish from "./pages/create/publish";
import WizardStoryboard from "./pages/create/storyboard";
import TierSampler from "./pages/TierSampler";
import AnimeWatchPage from "./pages/AnimeWatchPage";
import CostDashboard from "./pages/CostDashboard";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Refund from "./pages/Refund";
import Founders from "./pages/Founders";
import CraftLibrary from "./pages/CraftLibrary";
import AdminFoundersDashboard from "./pages/AdminFoundersDashboard";
import AdminPipelineObservability from "./pages/AdminPipelineObservability";
import { StudioLayout } from "./components/awakli/Layouts";

function Router() {
  const [location, navigate] = useLocation();

  // After OAuth callback redirects to /, check if there's a stored return path
  useEffect(() => {
    const returnPath = sessionStorage.getItem(STORAGE_KEY_RETURN_PATH);
    if (returnPath && location === "/") {
      sessionStorage.removeItem(STORAGE_KEY_RETURN_PATH);
      navigate(returnPath, { replace: true });
    }
  }, [location, navigate]);

  return (
    <AnimatePresence mode="wait">
      <Switch key={location}>
        {/* Marketing / public */}
        <Route path="/" component={Home} />
        <Route path="/signin" component={SignIn} />
        <Route path="/signup" component={SignUp} />
        <Route path="/discover" component={Discover} />
        <Route path="/explore" component={Explore} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/trending" component={Trending} />
        <Route path="/founders" component={Founders} />
        <Route path="/studio/craft-library" component={CraftLibrary} />
        <Route path="/marketplace" component={LoraMarketplace} />
        <Route path="/marketplace/:id" component={LoraMarketplaceDetail} />
        <Route path="/onboarding" component={Onboarding} />

        {/* Creation wizard (7-stage pipeline) */}
        <Route path="/create/input" component={WizardInput} />
        <Route path="/create/setup" component={WizardSetup} />
        <Route path="/create/script" component={WizardScript} />
        <Route path="/create/panels" component={WizardPanels} />
        <Route path="/create/storyboard" component={WizardStoryboard} />
        <Route path="/create/anime-gate" component={WizardAnimeGate} />
        <Route path="/create/character-setup" component={WizardCharacterSetup} />
        <Route path="/create/video" component={WizardVideo} />
        <Route path="/create/publish" component={WizardPublish} />

        {/* Project dashboard (list user's projects) */}
        <Route path="/create" component={CreateDashboard} />
        <Route path="/create/:projectId" component={CreateGenerate} />
        <Route path="/create/:projectId/read" component={CreateReader} />
        <Route path="/create/:projectId/character-bible" component={CharacterBible} />

        {/* Public manga reader */}
        <Route path="/m/:slug" component={MangaReader} />

        {/* Watch / community */}
        <Route path="/watch/:slug" component={WatchProject} />
        <Route path="/watch/:slug/:episodeNumber" component={EpisodePlayer} />

        {/* Anime episode player (Cloudflare Stream) */}
        <Route path="/anime/:projectId/:episodeId" component={AnimeWatchPage} />

        {/* User profiles */}
        <Route path="/profile/:userId" component={UserProfile} />

        {/* Character Library */}
        <Route path="/characters" component={CharacterLibrary} />
        <Route path="/characters/:id" component={CharacterDetail} />
        <Route path="/characters/:id/consistency" component={ConsistencyReport} />
        <Route path="/batch-training" component={BatchTraining} />
        <Route path="/studio/batch-assembly" component={BatchAssemblyQueue} />
        <Route path="/studio/locations" component={LocationLibrary} />
        <Route path="/studio/generation" component={GenerationDashboard} />

        {/* Account / billing */}
        <Route path="/usage" component={UsageDashboard} />
        <Route path="/earnings" component={CreatorEarnings} />
        <Route path="/analytics" component={CreatorAnalytics} />

        {/* Admin */}
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/providers" component={ProviderAdmin} />
        <Route path="/admin/gates" component={AdminGateAnalytics} />
        <Route path="/admin/print-payouts" component={AdminPrintPayouts} />
        <Route path="/admin/founders" component={AdminFoundersDashboard} />
        <Route path="/admin/pipeline" component={AdminPipelineObservability} />
        <Route path="/studio/resolution-flow" component={ResolutionFlow} />
        <Route path="/studio/quality-insights" component={QualityInsights} />
        <Route path="/demo-recording" component={DemoRecording} />

        {/* Legal */}
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/refund" component={Refund} />

        {/* Studio */}
        <Route path="/studio" component={StudioDashboard} />
        <Route path="/studio/new" component={ProjectWizard} />
        <Route path="/studio/upload" component={MangaUpload} />
        <Route path="/studio/byo-upload" component={BYOUpload} />
        <Route path="/studio/projects/:id" component={ProjectDetail} />

        {/* Studio — per-project tools (wrapped in StudioLayout) */}
        <Route path="/studio/project/:projectId/script">
          {(params) => (
            <StudioLayout>
              <ScriptEditor />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/characters">
          {(params) => (
            <StudioLayout>
              <CharacterCreator />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/byo-upload/:projectId" component={BYOUpload} />
        <Route path="/studio/project/:projectId/upload">
          {(params) => (
            <StudioLayout>
              <MangaUpload />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/panels">
          {(params) => (
            <StudioLayout>
              <PanelReview />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/storyboard">
          {(params) => (
            <StudioLayout>
              <StoryboardPreview />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/pipeline">
          {(params) => (
            <StudioLayout>
              <PipelineDashboard />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/pipeline/:runId/review">
          {(params) => (
            <StudioLayout>
              <QAReview />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/pipeline/:runId/gate/:gateId">
          {(params) => (
            <StudioLayout>
              <GateReview />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/lineart">
          {(params) => (
            <StudioLayout>
              <LineartPipeline />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/tier-sampler">
          {(params) => (
            <StudioLayout>
              <TierSampler />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/cost-dashboard">
          {() => (
            <StudioLayout>
              <CostDashboard />
            </StudioLayout>
          )}
        </Route>

        <Route path="/studio/project/:projectId/pipeline/:runId/batch-review">
          {(params) => (
            <StudioLayout>
              <BatchGateReview />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId/characters/:characterId/voice">
          {(params) => (
            <StudioLayout>
              <VoiceCloning />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/project/:projectId">
          {(params) => (
            <StudioLayout>
              <ProjectDetail />
            </StudioLayout>
          )}
        </Route>
        <Route path="/studio/:projectId/pre-production" component={PreProduction} />
        <Route path="/studio/:projectId/music" component={MusicStudio} />
        <Route path="/studio/:projectId/vocal-recording" component={VocalRecordingStudio} />

        {/* Debug */}
        <Route path="/debug/tokens" component={DebugTokens} />

        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </AnimatePresence>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: "#151528",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#F0F0F5",
              },
            }}
          />
          <Router />
          <UpgradeModal />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
