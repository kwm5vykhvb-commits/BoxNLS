import React from 'react';
import { 
  Check, 
  Cpu, 
  Gauge, 
  Globe, 
  HardDrive, 
  Radio, 
  RotateCcw, 
  ShieldCheck, 
  Sliders, 
  Sparkles, 
  Volume2, 
  Zap 
} from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onResetData: () => void;
}

const USER_AGENT_PRESETS = [
  {
    name: '1DM+ Mobile Android 14 (Recommandé)',
    value: 'Mozilla/5.0 (Linux; Android 14; 1DM+ NLSbox/6.0) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36',
  },
  {
    name: 'Chrome 128 Desktop Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  },
  {
    name: 'Safari iPhone iOS 17',
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onResetData,
}) => {
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-28">
      {/* Title */}
      <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-5 shadow-xl flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[#00F0FF]" />
            <span>Paramètres de Téléchargement & Sniffer NLSbox</span>
          </h2>
          <p className="text-xs text-[#9496A1] mt-0.5">
            Configurez le multi-threading, l'intercepteur réseau et la capture anti-403.
          </p>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#7000FF]/20 text-[#00F0FF] border border-[#7000FF]/40">
          v6.2 1DM-CORE
        </span>
      </div>

      {/* Section 1: Multi-Threading & Accélération */}
      <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-[#232332] pb-3">
          <Cpu className="w-4 h-4 text-[#00F0FF]" />
          <span>Moteur d'Accélération par Morceaux (Range Multi-Thread)</span>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[#9496A1]">Nombre de threads simultanés par téléchargement :</span>
            <span className="font-mono text-sm font-extrabold text-[#00F0FF] bg-[#00F0FF]/10 px-2.5 py-0.5 rounded-lg border border-[#00F0FF]/30">
              {settings.threadsCount} Threads
            </span>
          </div>

          {/* Quick thread preset buttons */}
          <div className="grid grid-cols-5 gap-2">
            {[2, 4, 8, 16, 32].map((threads) => (
              <button
                key={threads}
                onClick={() => onUpdateSettings({ ...settings, threadsCount: threads })}
                className={`py-2 rounded-xl text-xs font-mono font-bold transition-all flex flex-col items-center gap-0.5 ${
                  settings.threadsCount === threads
                    ? 'bg-gradient-to-tr from-[#7000FF] to-[#00F0FF] text-[#0B0B0E] shadow-lg shadow-[#00F0FF]/20 scale-102'
                    : 'bg-[#0B0B0E] text-[#9496A1] hover:text-white border border-[#232332]'
                }`}
              >
                <span>{threads}</span>
                <span className="text-[9px] font-normal opacity-80">parts</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#6B6E7D] mt-2">
            8 à 16 threads recommandés pour saturer la bande passante sans bloquer les connexions du serveur hôte.
          </p>
        </div>

        {/* Speed limiter */}
        <div className="pt-3 border-t border-[#232332] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-[#7000FF]" />
              <span className="text-xs font-semibold text-white">Limiteur de bande passante</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.speedLimitEnabled}
                onChange={(e) => onUpdateSettings({ ...settings, speedLimitEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#232332] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00F0FF]"></div>
            </label>
          </div>

          {settings.speedLimitEnabled && (
            <div className="flex items-center gap-2 animate-in fade-in">
              <input
                type="number"
                min={100}
                max={50000}
                step={500}
                value={settings.speedLimitKBps || 2048}
                onChange={(e) => onUpdateSettings({ ...settings, speedLimitKBps: parseInt(e.target.value, 10) || 0 })}
                className="w-32 px-3 py-1.5 bg-[#0B0B0E] border border-[#232332] rounded-lg text-xs font-mono text-white outline-none focus:border-[#00F0FF]"
              />
              <span className="text-xs text-[#9496A1]">Ko/s (ex: 2048 Ko/s = 2 Mo/s)</span>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Sniffer & Formats Réseau */}
      <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-[#232332] pb-3">
          <Radio className="w-4 h-4 text-[#00F0FF]" />
          <span>Filtres de Détection Média du Sniffer</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { key: 'detectMp4', label: '.MP4 (Vidéos standard)', desc: 'MPEG-4 H.264/AVC' },
            { key: 'detectM3u8', label: '.M3U8 (Flux HLS)', desc: 'Playlists adaptatives' },
            { key: 'detectWebm', label: '.WEBM (VP9/AV1)', desc: 'Vidéos HTML5 web' },
            { key: 'detectTs', label: '.TS (Segments)', desc: 'MPEG Transport Stream' },
          ].map((fmt) => (
            <label
              key={fmt.key}
              className="flex flex-col p-3 rounded-xl bg-[#0B0B0E] border border-[#232332] hover:border-[#00F0FF]/30 cursor-pointer select-none transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-bold text-white">{fmt.label.split(' ')[0]}</span>
                <input
                  type="checkbox"
                  checked={(settings as any)[fmt.key]}
                  onChange={(e) => onUpdateSettings({ ...settings, [fmt.key]: e.target.checked })}
                  className="rounded bg-[#16161E] border-[#232332] text-[#00F0FF] focus:ring-0"
                />
              </div>
              <span className="text-[10px] text-[#9496A1]">{fmt.desc}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Section 2: Format Vidéo & Économie de Données (Poids des fichiers) */}
      <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#232332] pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles className="w-4 h-4 text-[#00F0FF]" />
            <span>Format Vidéo & Économie de Données (Poids des fichiers)</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#00F0FF]/15 text-[#00F0FF] font-bold">
            COMPRESSION DISPONIBLE
          </span>
        </div>

        <p className="text-xs text-[#9496A1]">
          Choisissez la résolution par défaut pour vos téléchargements afin d'éviter les fichiers trop lourds (ex: 700 Mo en 1080p).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              id: '480p',
              title: '🍃 480p SD - Éco Data',
              size: '~120 à 180 Mo',
              desc: 'Ultra léger. Idéal pour économiser le stockage et les forfaits mobiles 4G/5G.',
              badgeColor: 'bg-[#00FF9D]/20 text-[#00FF9D]',
            },
            {
              id: '720p',
              title: '⚡ 720p HD - Équilibré',
              size: '~300 à 400 Mo',
              desc: 'Recommandé. Image nette et claire avec une taille de fichier réduite de moitié.',
              badgeColor: 'bg-[#00F0FF]/20 text-[#00F0FF]',
            },
            {
              id: '1080p',
              title: '💎 1080p FHD - Ultra Net',
              size: '~650 à 850 Mo',
              desc: 'Fichier lourd. Définition maximale pour grands écrans sans compression.',
              badgeColor: 'bg-[#7000FF]/20 text-purple-300',
            },
            {
              id: 'auto',
              title: '✨ Auto - Adaptatif',
              size: 'Selon source',
              desc: 'Prend la version équilibrée recommandée par le flux ou l hébergeur.',
              badgeColor: 'bg-amber-400/20 text-amber-300',
            },
          ].map((item) => {
            const isSelected = (settings.preferredQuality || '720p') === item.id;
            return (
              <div
                key={item.id}
                onClick={() => onUpdateSettings({ ...settings, preferredQuality: item.id as any })}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between space-y-2 ${
                  isSelected
                    ? 'bg-[#00F0FF]/10 border-[#00F0FF] text-white shadow-lg shadow-[#00F0FF]/10'
                    : 'bg-[#0B0B0E] border-[#232332] text-[#9496A1] hover:text-white hover:border-[#2C2C3E]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white flex items-center gap-1.5">
                    {item.title}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${item.badgeColor}`}>
                    {item.size}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6E7D] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Anti-403 & User-Agent */}
      <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#232332] pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <ShieldCheck className="w-4 h-4 text-[#00FF9D]" />
            <span>Anti-403 Forbidden & Émulation Client</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#00FF9D]/15 text-[#00FF9D] font-bold">
            BYPASS ACTIF
          </span>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-[#9496A1] block">
            Profil User-Agent transmis aux serveurs de streaming :
          </label>
          <div className="space-y-1.5">
            {USER_AGENT_PRESETS.map((preset) => (
              <div
                key={preset.name}
                onClick={() => onUpdateSettings({ ...settings, userAgent: preset.value })}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                  settings.userAgent === preset.value
                    ? 'bg-[#00F0FF]/10 border-[#00F0FF] text-white'
                    : 'bg-[#0B0B0E] border-[#232332] text-[#9496A1] hover:text-white'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold">{preset.name}</div>
                  <div className="text-[10px] font-mono text-[#6B6E7D] truncate max-w-xl mt-0.5">
                    {preset.value}
                  </div>
                </div>
                {settings.userAgent === preset.value && (
                  <Check className="w-4 h-4 text-[#00F0FF] shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 4: Réinitialisation & Données */}
      <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-5 shadow-xl flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white">Réinitialiser l'application</h4>
          <p className="text-xs text-[#9496A1] mt-0.5">
            Remet à zéro l'historique des téléchargements et recharge les flux de démonstration.
          </p>
        </div>
        <button
          onClick={onResetData}
          className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-xs font-bold transition-colors flex items-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Réinitialiser</span>
        </button>
      </div>
    </div>
  );
};
