import React from 'react';
import { Compass, Download, Settings, Zap } from 'lucide-react';
import { formatSpeed } from '../utils/formatters';

interface BottomNavProps {
  activeTab: 'browser' | 'downloads' | 'settings';
  setActiveTab: (tab: 'browser' | 'downloads' | 'settings') => void;
  activeCount: number;
  completedCount: number;
  errorCount?: number;
  totalSpeed: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  activeCount,
  completedCount,
  errorCount = 0,
  totalSpeed,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0B0B0E]/95 backdrop-blur-lg border-t border-[#232332] px-4 py-2">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {/* Tab 1: Navigateur Sniffer */}
        <button
          onClick={() => setActiveTab('browser')}
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            activeTab === 'browser'
              ? 'text-[#00F0FF] bg-[#00F0FF]/10 font-semibold'
              : 'text-[#9496A1] hover:text-[#F3F4F8]'
          }`}
        >
          <div className="relative">
            <Compass className={`w-5 h-5 ${activeTab === 'browser' ? 'stroke-[2.5px]' : ''}`} />
            {activeTab === 'browser' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#00F0FF] shadow-sm shadow-[#00F0FF]" />
            )}
          </div>
          <span className="text-[11px] tracking-wide">Navigateur Sniffer</span>
        </button>

        {/* Tab 2: Téléchargements */}
        <button
          onClick={() => setActiveTab('downloads')}
          className={`relative flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            activeTab === 'downloads'
              ? 'text-[#00F0FF] bg-[#00F0FF]/10 font-semibold'
              : 'text-[#9496A1] hover:text-[#F3F4F8]'
          }`}
        >
          <div className="relative">
            <Download className={`w-5 h-5 ${activeTab === 'downloads' ? 'stroke-[2.5px]' : ''}`} />
            {errorCount > 0 ? (
              <span className="absolute -top-1.5 -right-2.5 px-1.5 py-0.2 bg-rose-500 text-white font-extrabold text-[9px] rounded-full shadow-md animate-pulse">
                {errorCount}
              </span>
            ) : activeCount > 0 ? (
              <span className="absolute -top-1.5 -right-2.5 px-1.5 py-0.2 bg-[#00F0FF] text-[#0B0B0E] font-extrabold text-[9px] rounded-full shadow-md animate-pulse">
                {activeCount}
              </span>
            ) : completedCount > 0 ? (
              <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-[#00FF9D]" />
            ) : null}
            {activeTab === 'downloads' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#00F0FF] shadow-sm shadow-[#00F0FF]" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] tracking-wide">Téléchargements</span>
            {totalSpeed > 0 && (
              <span className="text-[9px] font-mono text-[#00F0FF] hidden sm:inline">
                ({formatSpeed(totalSpeed)})
              </span>
            )}
          </div>
        </button>

        {/* Tab 3: Paramètres */}
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            activeTab === 'settings'
              ? 'text-[#00F0FF] bg-[#00F0FF]/10 font-semibold'
              : 'text-[#9496A1] hover:text-[#F3F4F8]'
          }`}
        >
          <div className="relative">
            <Settings className={`w-5 h-5 ${activeTab === 'settings' ? 'stroke-[2.5px]' : ''}`} />
            {activeTab === 'settings' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#00F0FF] shadow-sm shadow-[#00F0FF]" />
            )}
          </div>
          <span className="text-[11px] tracking-wide">Paramètres</span>
        </button>
      </div>
    </nav>
  );
};
