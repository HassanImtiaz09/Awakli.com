import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Link } from "wouter";
import {
  Bell, Check, CheckCheck, ThumbsUp, MessageSquare, UserPlus,
  Film, Sparkles, X
} from "lucide-react";

const ICON_MAP: Record<string, typeof Bell> = {
  follow: ThumbsUp,
  comment: MessageSquare,
  new_follower: UserPlus,
  job_complete: Film,
  job_failed: Sparkles,
};

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const notifications = trpc.notifications.list.useQuery(undefined, { enabled: isOpen });
  const unreadCount = trpc.notifications.unreadCount.useQuery();
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { notifications.refetch(); unreadCount.refetch(); },
  });

  const items = (notifications.data ?? []) as Array<any>;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed top-16 right-4 w-96 max-h-[70vh] z-[91] rounded-2xl border border-white/10 bg-surface-1/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Bell className="w-5 h-5 text-token-violet" />
                Notifications
              </h3>
              <div className="flex items-center gap-2">
                {items.some((n: any) => !n.isRead) && (
                  <button
                    onClick={() => markAllRead.mutate()}
                    className="text-xs text-token-cyan hover:text-token-cyan/80 transition-colors flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
              {notifications.isLoading ? (
                <div className="space-y-2 p-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No notifications yet</p>
                </div>
              ) : (
                <div className="py-2">
                  {items.map((notif) => {
                    const Icon = ICON_MAP[notif.type] || Bell;
                    const content = (
                      <div
                        className={`flex gap-3 px-5 py-3 hover:bg-white/5 transition-colors cursor-pointer ${
                          !notif.isRead ? "bg-token-violet/5" : ""
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                          !notif.isRead ? "bg-token-violet/10" : "bg-white/5"
                        }`}>
                          <Icon className={`w-4 h-4 ${!notif.isRead ? "text-token-violet" : "text-gray-500"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${!notif.isRead ? "text-white font-medium" : "text-gray-300"}`}>
                            {notif.title}
                          </p>
                          {notif.content && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{notif.content}</p>
                          )}
                          <p className="text-xs text-gray-600 mt-1">
                            {new Date(notif.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        {!notif.isRead && (
                          <div className="w-2 h-2 rounded-full bg-token-violet flex-shrink-0 mt-2" />
                        )}
                      </div>
                    );

                    return notif.linkUrl ? (
                      <Link key={notif.id} href={notif.linkUrl} onClick={onClose}>
                        {content}
                      </Link>
                    ) : (
                      <div key={notif.id}>{content}</div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Notification Bell Button ──────────────────────────────────────────────
export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = trpc.notifications.unreadCount.useQuery();
  const count = (unreadCount.data as any)?.count ?? 0;

  return (
    <>
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
      >
        <Bell className="w-5 h-5 text-gray-400" />
        {count > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-token-violet text-[10px] font-bold flex items-center justify-center text-white"
          >
            {count > 9 ? "9+" : count}
          </motion.span>
        )}
      </button>
      <NotificationCenter isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
