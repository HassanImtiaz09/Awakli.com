import { motion } from "framer-motion";
import { Twitter, MessageCircle, Youtube } from "lucide-react";
import React from "react";
import { Link } from "wouter";
import { Logo } from "./Logo";

const MARQUEE_TEXT = "AWAKLI \u00B7 WHERE IDEAS BECOME ANIME \u00B7 CREATE \u00B7 ANIMATE \u00B7 ";

const FOOTER_LINKS = [
  { label: "Discover", href: "/discover" },
  { label: "Create", href: "/create" },
  { label: "Characters", href: "/characters" },
  { label: "Pricing", href: "/pricing" },
  { label: "Studio", href: "/studio" },
];

const LEGAL_LINKS = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Refund", href: "/refund" },
];

const SOCIAL_LINKS = [
  { icon: <Twitter size={16} />, href: "https://x.com/awakli_ai", label: "X (Twitter)" },
  { icon: <MessageCircle size={16} />, href: "https://discord.gg/awakli", label: "Discord" },
  { icon: <Youtube size={16} />, href: "https://youtube.com/@awakli", label: "YouTube" },
];

export function MarketingFooter() {
  return (
    <footer className="bg-[#05050C] border-t border-white/5 mt-auto overflow-hidden">
      {/* Marquee band */}
      <div className="relative py-4 overflow-hidden border-b border-white/5">
        <div className="flex whitespace-nowrap animate-[marquee_20s_linear_infinite]">
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className="font-display text-2xl md:text-4xl font-bold text-white/[0.04] tracking-widest mx-4 select-none"
            >
              {MARQUEE_TEXT}
            </span>
          ))}
        </div>
        <style>{`
          @keyframes marquee {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </div>

      <div className="container py-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          {/* Left: logo + tagline */}
          <div className="space-y-3">
            <Logo variant="horizontal" theme="dark" size={32} />
            <p className="text-sm text-[#5C5C7A] max-w-xs leading-relaxed">
              Where stories become manga, and manga becomes anime.
            </p>
          </div>

          {/* Center: nav links */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                <span className="text-sm text-[#9494B8] hover:text-[#F0F0F5] transition-colors cursor-pointer">
                  {link.label}
                </span>
              </Link>
            ))}
          </div>

          {/* Right: social */}
          <div className="flex items-center gap-2">
            {SOCIAL_LINKS.map((social) => (
              <motion.a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-[#5C5C7A] hover:text-[#F0F0F5] hover:bg-[#1C1C35] transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                {social.icon}
              </motion.a>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-[#5C5C7A]">
            &copy; {new Date().getFullYear()} Awakli. All rights reserved.
          </span>
          <div className="flex items-center gap-4">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                <span className="text-xs text-[#5C5C7A] hover:text-[#9494B8] transition-colors cursor-pointer">
                  {link.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
