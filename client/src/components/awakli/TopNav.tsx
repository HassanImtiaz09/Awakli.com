import { motion, AnimatePresence } from "framer-motion";
import {
  Menu, Search, X, LogOut, User, LayoutDashboard, Trophy,
  PenTool, Wand2, Upload, Compass, BookOpen, Swords, Settings,
  CreditCard, BarChart3, Crown, Play, Users, Tag, ListVideo, Store
} from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { AwakliButton } from "./AwakliButton";
import { cn } from "@/lib/utils";
import SearchOverlay from "./SearchOverlay";
import { NotificationBell } from "./NotificationCenter";
import { Logo } from "./Logo";

/* ─── Creator Loop — left cluster ──────────────────────────────────────── */
const CREATOR_NAV = [
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/create", label: "Create", icon: Wand2 },
  { href: "/characters", label: "Characters", icon: BookOpen },
];
/* ─── Audience / Commerce Loop — right cluster ───────────────────────── */
const AUDIENCE_NAV = [
  { href: "/marketplace", label: "LoRA Market", icon: Store },
  { href: "/pricing", label: "Pricing", icon: Tag },
];
/* Combined for mobile tab bar */
const PRIMARY_NAV = [...CREATOR_NAV, ...AUDIENCE_NAV];
/* ─── Desktop Top Nav Link ─────────────────────────────────────────────── */
function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <motion.span
        className={cn(
          "relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all",
          active
            ? "text-[#F0F0F5]"
            : "text-[#B0B0CC] hover:text-[#F0F0F5] hover:bg-white/5"
        )}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
                <Icon size={16} className={active ? "text-[#E040FB]" : ""} />
        {children}
        {/* Active indicator — Opening Sequence gradient sweep */}
        {active && (
          <motion.div
            layoutId="nav-active"
            className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-opening-sequence"
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
      </motion.span>
    </Link>
  );
}

/* ─── Dropdown Item ────────────────────────────────────────────────────── */
function DropdownItem({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <span className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#9494B8] hover:text-[#F0F0F5] hover:bg-[#1C1C35] transition-colors cursor-pointer">
        {icon}
        {children}
      </span>
    </Link>
  );
}

/* ─── Mobile Bottom Tab Bar ────────────────────────────────────────────── */
export function MobileTabBar() {
  const [location] = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0D0D1A]/95 backdrop-blur-xl border-t border-white/5 safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {PRIMARY_NAV.map((item) => {
          const active =
            item.href === "/discover"
              ? location === "/discover" || location === "/trending" || location === "/explore"
              : location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <motion.span
                className="flex flex-col items-center gap-0.5 px-3 py-1 cursor-pointer relative"
                whileTap={{ scale: 0.9 }}
              >
                <item.icon
                  size={20}
                  className={cn(
                    "transition-colors",
                    active ? "text-[#E040FB]" : "text-[#5C5C7A]"
                  )}
                />
                <span
                  className={cn(
                    "text-[10px] font-medium transition-colors",
                    active ? "text-[#F0F0F5]" : "text-[#5C5C7A]"
                  )}
                >
                  {item.label}
                </span>
                {/* Active dot */}
                {active && (
                  <motion.div
                    layoutId="tab-active"
                    className="absolute -top-0.5 w-5 h-0.5 rounded-full bg-opening-sequence"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </motion.span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ─── Top Nav ──────────────────────────────────────────────────────────── */
export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      logout();
      window.location.href = "/";
    },
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {/* Skip to main — §3.10 Accessibility */}
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>

      <motion.header
        className="fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300 border-b border-white/[0.06]"
        style={{
          backdropFilter: "blur(18px) saturate(140%)",
          WebkitBackdropFilter: "blur(18px) saturate(140%)",
          background: scrolled
            ? "rgba(5, 5, 12, 0.88)"
            : "rgba(5, 5, 12, 0)",
          borderBottomColor: scrolled ? "rgba(255,255,255,0.06)" : "transparent",
          boxShadow: scrolled ? "0 4px 24px rgba(0,0,0,0.4)" : "none",
        }}
        initial={{ y: -64 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="container h-full flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/">
            <motion.div
              className="cursor-pointer select-none shrink-0"
              whileHover={{ filter: "drop-shadow(0 0 12px rgba(224,64,251,0.4))" }}
              transition={{ duration: 0.2 }}
            >
              <Logo variant="horizontal" theme="dark" size={28} animate />
            </motion.div>
          </Link>

          {/* Desktop nav — creator cluster | search divider | audience cluster */}
          <nav className="hidden md:flex items-center gap-1">
            {/* Creator loop: Watch · Create · Characters */}
            {CREATOR_NAV.map((item) => {
              const active =
                item.href === "/discover"
                  ? location === "/discover" ||
                    location === "/trending" ||
                    location === "/explore"
                  : location.startsWith(item.href);
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  active={active}
                  icon={item.icon}
                >
                  {item.label}
                </NavLink>
              );
            })}

            {/* Audience loop: Market · Pricing */}
            {AUDIENCE_NAV.map((item) => {
              const active = location.startsWith(item.href);
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  active={active}
                  icon={item.icon}
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* Search toggle */}
            <motion.button
              className="hidden md:flex items-center justify-center gap-2 h-9 px-3 rounded-lg text-[#9494B8] hover:text-[#F0F0F5] bg-[#1C1C35]/50 hover:bg-[#1C1C35] border border-white/5 transition-colors text-xs"
              onClick={() => setSearchOpen(true)}
              whileTap={{ scale: 0.95 }}
            >
              <Search size={14} />
              <span>Search</span>
              <kbd className="hidden lg:inline-block px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-[#5C5C7A] font-mono">
                ⌘K
              </kbd>
            </motion.button>

            {isAuthenticated ? (
              <>
                {/* Notification bell */}
                <NotificationBell />

                {/* Avatar dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <motion.button
                    className="flex items-center gap-2 rounded-full border border-white/10 hover:border-[#E040FB]/40 transition-colors p-0.5 pr-3"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <div className="w-7 h-7 rounded-full bg-opening-sequence flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {user?.name?.[0]?.toUpperCase() ?? "U"}
                    </div>
                    <span className="hidden lg:block text-sm text-[#F0F0F5] max-w-[100px] truncate">
                      {user?.name ?? "User"}
                    </span>
                  </motion.button>

                  <AnimatePresence>
                    {dropdownOpen && (
                      <motion.div
                        className="absolute right-0 top-full mt-2 w-56 bg-[#151528] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
                        initial={{ opacity: 0, scale: 0.95, y: -8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -8 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div className="p-3 border-b border-white/5">
                          <p className="text-sm font-medium text-[#F0F0F5] truncate">
                            {user?.name}
                          </p>
                          <p className="text-xs text-[#5C5C7A] truncate">
                            {user?.email}
                          </p>
                        </div>
                        <div className="p-1.5 space-y-0.5">
                          <DropdownItem
                            href={`/profile/${user?.id}`}
                            icon={<User size={15} />}
                          >
                            My Profile
                          </DropdownItem>
                          <DropdownItem
                            href="/studio"
                            icon={<LayoutDashboard size={15} />}
                          >
                            Studio
                          </DropdownItem>
                          <DropdownItem
                            href="/studio/byo-upload"
                            icon={<Upload size={15} />}
                          >
                            Upload Manga
                          </DropdownItem>
                          <DropdownItem
                            href="/studio/batch-assembly"
                            icon={<ListVideo size={15} />}
                          >
                            Batch Assembly
                          </DropdownItem>
                          <div className="border-t border-white/5 my-1" />
                          <DropdownItem
                            href="/pricing"
                            icon={<Crown size={15} />}
                          >
                            Upgrade Plan
                          </DropdownItem>
                          <DropdownItem
                            href="/usage"
                            icon={<BarChart3 size={15} />}
                          >
                            Usage & Credits
                          </DropdownItem>
                          <DropdownItem
                            href="/earnings"
                            icon={<CreditCard size={15} />}
                          >
                            Earnings
                          </DropdownItem>
                          <div className="border-t border-white/5 my-1" />
                          <button
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#E74C3C] hover:bg-[rgba(231,76,60,0.1)] transition-colors"
                            onClick={() => logoutMutation.mutate()}
                          >
                            <LogOut size={15} />
                            Sign out
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <a href={getLoginUrl()}>
                  <AwakliButton variant="ghost" size="sm">
                    Sign in
                  </AwakliButton>
                </a>
                <a href={getLoginUrl()}>
                  <AwakliButton variant="primary" size="sm">
                    Get Started
                  </AwakliButton>
                </a>
              </div>
            )}

            {/* Mobile hamburger — only for secondary menu, primary nav is bottom bar */}
            <motion.button
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-[#9494B8] hover:text-[#F0F0F5] hover:bg-[#1C1C35] transition-colors"
              onClick={() => setDrawerOpen(true)}
              whileTap={{ scale: 0.9 }}
            >
              <Menu size={20} />
            </motion.button>
          </div>
        </div>
      </motion.header>

      {/* Search overlay */}
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Mobile drawer — secondary navigation */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              className="fixed top-0 right-0 bottom-0 z-50 w-72 bg-[#0D0D1A] border-l border-white/5 flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <Logo variant="horizontal" theme="dark" size={24} />
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#9494B8] hover:text-[#F0F0F5] hover:bg-[#1C1C35]"
                  onClick={() => setDrawerOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                {/* Studio link */}
                <Link href="/studio">
                  <span
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                      location.startsWith("/studio")
                        ? "bg-[#1C1C35] text-[#F0F0F5] font-semibold"
                        : "text-[#9494B8] hover:bg-[#1C1C35]/50 hover:text-[#F0F0F5]"
                    )}
                  >
                    <LayoutDashboard size={16} />
                    Studio
                  </span>
                </Link>
                <Link href="/studio/byo-upload">
                  <span
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                      location === "/studio/byo-upload"
                        ? "bg-[#1C1C35] text-[#F0F0F5] font-semibold"
                        : "text-[#9494B8] hover:bg-[#1C1C35]/50 hover:text-[#F0F0F5]"
                    )}
                  >
                    <Upload size={16} />
                    Upload Manga
                  </span>
                </Link>
                <Link href="/trending">
                  <span
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                      location === "/trending"
                        ? "bg-[#1C1C35] text-[#F0F0F5] font-semibold"
                        : "text-[#9494B8] hover:bg-[#1C1C35]/50 hover:text-[#F0F0F5]"
                    )}
                  >
                    <Trophy size={16} />
                    Trending
                  </span>
                </Link>

                <div className="border-t border-white/5 my-3" />

                <Link href="/pricing">
                  <span className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-[#9494B8] hover:bg-[#1C1C35]/50 hover:text-[#F0F0F5] transition-colors">
                    <Crown size={16} />
                    Upgrade Plan
                  </span>
                </Link>
                <Link href="/usage">
                  <span className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-[#9494B8] hover:bg-[#1C1C35]/50 hover:text-[#F0F0F5] transition-colors">
                    <BarChart3 size={16} />
                    Usage & Credits
                  </span>
                </Link>
                <Link href="/earnings">
                  <span className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-[#9494B8] hover:bg-[#1C1C35]/50 hover:text-[#F0F0F5] transition-colors">
                    <CreditCard size={16} />
                    Earnings
                  </span>
                </Link>

                <div className="border-t border-white/5 my-3" />

                <Link href="/terms">
                  <span className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-[#5C5C7A] hover:text-[#9494B8] transition-colors">
                    Terms
                  </span>
                </Link>
                <Link href="/privacy">
                  <span className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-[#5C5C7A] hover:text-[#9494B8] transition-colors">
                    Privacy
                  </span>
                </Link>
              </nav>

              {/* Auth section at bottom of drawer */}
              <div className="p-4 border-t border-white/5">
                {isAuthenticated ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 px-2 py-1">
                      <div className="w-8 h-8 rounded-full bg-opening-sequence flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {user?.name?.[0]?.toUpperCase() ?? "U"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#F0F0F5] truncate">
                          {user?.name}
                        </p>
                        <p className="text-xs text-[#5C5C7A] truncate">
                          {user?.email}
                        </p>
                      </div>
                    </div>
                    <button
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-[#E74C3C] hover:bg-[rgba(231,76,60,0.1)] transition-colors"
                      onClick={() => logoutMutation.mutate()}
                    >
                      <LogOut size={15} />
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <a href={getLoginUrl()} className="block">
                      <AwakliButton variant="primary" size="sm" className="w-full">
                        Get Started
                      </AwakliButton>
                    </a>
                    <a href={getLoginUrl()} className="block">
                      <AwakliButton variant="ghost" size="sm" className="w-full">
                        Sign in
                      </AwakliButton>
                    </a>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
