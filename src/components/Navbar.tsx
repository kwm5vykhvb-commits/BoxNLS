import React from 'react';
import { Download, Globe, Radio, Settings, ShieldCheck, Zap } from 'lucide-react';
import { formatSpeed } from '../utils/formatters';

interface NavbarProps {
  activeTab: 'browser' | 'downloads' | 'settings';
  setActiveTab: (tab: 'browser' | 'downloads' | 'settings') => void;
  activeDownloadsCount: number;
  totalSpeed: number;
  onOpenQuickSniffer: () => void;
  sniffedCount: number;
  onOpenSniffedModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  activeDownloadsCount,
  totalSpeed,
  onOpenQuickSniffer,
  sniffedCount,
  onOpenSniffedModal,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#232332] bg-[#0B0B0E]/95 backdrop-blur-md px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Brand */}
        <div 
          onClick={() => setActiveTab('browser')}
          className="flex items-center gap-2.5 cursor-pointer select-none group"
        >
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-[#7000FF] to-[#00F0FF] p-[1.5px] shadow-lg shadow-[#00F0FF]/20 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-[#0B0B0E] rounded-[10px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-[#00F0FF]" />
            </div>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#00FF9D] rounded-full ring-2 ring-[#0B0B0E] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-[#F3F4F8] to-[#00F0FF] bg-clip-text text-transparent">
                NLSbox
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#7000FF]/30 text-[#00F0FF] border border-[#7000FF]/40 tracking-wider">
                1DM CORE
              </span>
            </div>
            <p className="text-[10px] text-[#9496A1] hidden sm:block">
              Sniffer Multimédia & Téléchargement Accéléré
            </p>
          </div>
        </div>

        {/* Global Live Speed Ticker & Sniffer Status */}
        <div className="flex items-center gap-2">
          {totalSpeed > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#16161E] border border-[#00F0FF]/40 shadow-sm shadow-[#00F0FF]/10">
              <span className="w-2 h-2 rounded-full bg-[#00F0FF] animate-ping" />
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-[#00F0FF]">
                  {formatSpeed(totalSpeed)}
                </div>
                <div className="text-[9px] text-[#9496A1] leading-none">
                  {activeDownloadsCount} flux actif{activeDownloadsCount > 1 ? 's' : ''}
                </div>
              </div>
            </div>
          )}

          {/* Quick Sniff Link Trigger */}
          <button
            onClick={onOpenQuickSniffer}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16161E] hover:bg-[#232332] text-xs font-medium text-[#F3F4F8] border border-[#232332] transition-colors"
            title="Sniffer une URL vidéo directe"
          >
            <Radio className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span className="hidden md:inline">Sniffer une URL</span>
          </button>

          {/* Sniffed Videos Badge Button */}
          {sniffedCount > 0 && (
            <button
              onClick={onOpenSniffedModal}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#7000FF]/40 to-[#00F0FF]/30 hover:from-[#7000FF]/60 hover:to-[#00F0FF]/50 text-xs font-semibold text-white border border-[#00F0FF]/50 shadow-md shadow-[#00F0FF]/20 animate-pulse-ring"
            >
              <span className="text-sm">🎬</span>
              <span>{sniffedCount} détectée{sniffedCount > 1 ? 's' : ''}</span>
            </button>
          )}

          {/* Anti-403 Protection Indicator */}
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#16161E] border border-[#232332] text-[11px] text-[#9496A1]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00FF9D]" />
            <span>Anti-403 Header Lock</span>
          </div>
        </div>
      </div>
    </header>
  );
};
