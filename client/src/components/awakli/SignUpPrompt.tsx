import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, Bookmark, MessageSquare, Sparkles, Crown, ArrowRight } from "lucide-react";
import { useState } from "react";
import { getLoginUrl } from "@/const";
import { AwakliButton } from "./AwakliButton";
import { cn } from "@/lib/utils";

// ─── Soft Sign-Up Prompt (inline banner) ────────────────────────────────────
export function SignUpBanner({ action = "discover", className }: { action?: "discover" | "comment" | "bookmark" | "create"; className?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const messages: Record<string, { icon: React.ReactNode; title: string; subtitle: string }> = {
    discover: {
      icon: <Heart size={20} className="text-[#E040FB]" />,
      title: "Like what you see?",
      subtitle: "Sign in to follow your favorite manga and watch them become anime.",
    },
    comment: {
      icon: <MessageSquare size={20} className="text-[#9B59B6]" />,
      title: "Join the conversation",
      subtitle: "Sign in to leave comments and connect with creators.",
    },
    bookmark: {
      icon: <Bookmark size={20} className="text-[#3498DB]" />,
      title: "Save for later",
      subtitle: "Sign in to add this to your watchlist and get notified of new episodes.",
    },
    create: {
      icon: <Sparkles size={20} className="text-[#E040FB]" />,
      title: "Ready to create?",
      subtitle: "Sign in to start turning your manga into anime with AI.",
    },
  };

  const msg = messages[action] ?? messages.discover;

  return (
    <motion.div
      className={cn(
        "relative rounded-xl border border-[#7C4DFF]/20 bg-gradient-to-r from-[#7C4DFF]/5 to-[#9B59B6]/5 p-4",
        className
      )}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <button
        className="absolute top-3 right-3 text-[#5C5C7A] hover:text-[#9494B8] transition-colors"
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{msg.icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#F0F0F5]">{msg.title}</p>
          <p className="text-xs text-[#9494B8] mt-0.5">{msg.subtitle}</p>
          <div className="flex items-center gap-2 mt-3">
            <a href={getLoginUrl()}>
              <AwakliButton variant="primary" size="sm">
                Sign in free
                <ArrowRight size={14} className="ml-1" />
              </AwakliButton>
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Floating Sign-Up Prompt (appears after scrolling) ──────────────────────
export function FloatingSignUpPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Show after user has scrolled a bit
  useState(() => {
    const timer = setTimeout(() => setVisible(true), 8000);
    return () => clearTimeout(timer);
  });

  if (dismissed || !visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-96 z-40 rounded-2xl border border-white/10 bg-[#151528]/95 backdrop-blur-xl shadow-2xl p-5"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: "spring", damping: 25 }}
      >
        <button
          className="absolute top-3 right-3 text-[#5C5C7A] hover:text-[#9494B8] transition-colors"
          onClick={() => setDismissed(true)}
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7C4DFF] to-[#B388FF] flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#F0F0F5]">Enjoying Awakli?</p>
            <p className="text-xs text-[#9494B8]">Create your own manga-to-anime for free</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={getLoginUrl()} className="flex-1">
            <AwakliButton variant="primary" size="md" className="w-full">
              Get Started Free
            </AwakliButton>
          </a>
          <button
            className="px-3 py-2 text-xs text-[#5C5C7A] hover:text-[#9494B8] transition-colors"
            onClick={() => setDismissed(true)}
          >
            Later
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Publish Upgrade Modal ──────────────────────────────────────────────────
export function PublishUpgradeModal({
  isOpen,
  onClose,
  projectTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectTitle?: string;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-md bg-[#151528] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header gradient */}
              <div className="relative h-32 bg-gradient-to-br from-[#E040FB] via-[#7C4DFF] to-[#B388FF] flex items-center justify-center">
                <Crown size={48} className="text-white/90" />
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIi8+PC9zdmc+')] opacity-50" />
              </div>

              <div className="p-6">
                <h2 className="text-xl font-display font-bold text-[#F0F0F5] mb-2">
                  Publish {projectTitle ? `"${projectTitle}"` : "Your Work"}
                </h2>
                <p className="text-sm text-[#9494B8] mb-6">
                  Publishing makes your content visible to everyone on Awakli. Upgrade to a paid plan to unlock publishing.
                </p>

                <div className="space-y-3 mb-6">
                  {[
                    "Publish unlimited manga & anime",
                    "Appear in Discover, Trending & Search",
                    "Build your audience and grow your reach",
                    "Creator analytics dashboard",
                    "Priority support",
                  ].map((feature, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      <div className="w-5 h-5 rounded-full bg-[#7C4DFF]/10 flex items-center justify-center shrink-0">
                        <Sparkles size={12} className="text-[#E040FB]" />
                      </div>
                      <span className="text-[#F0F0F5]">{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <a href="/pricing" className="flex-1">
                    <AwakliButton variant="primary" size="md" className="w-full">
                      View Plans
                      <ArrowRight size={14} className="ml-1" />
                    </AwakliButton>
                  </a>
                  <button
                    className="px-4 py-2.5 text-sm text-[#9494B8] hover:text-[#F0F0F5] transition-colors"
                    onClick={onClose}
                  >
                    Not now
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
