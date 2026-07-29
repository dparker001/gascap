'use client';

/**
 * GaugeScanModal — multi-stage fuel gauge scan pipeline.
 * Phase 1: capture UX with camera overlay guide and preview.
 * Phase 2: client-side image preprocessing (resize, contrast, EXIF rotation).
 * Phase 3: structured AI response (handled by /api/gauge/scan).
 * Phase 4: confirmation UI with confidence bar and adjustment slider.
 */

import { useState, useCallback } from 'react';
import type { GaugeScanResult, GaugeType } from '@/app/api/gauge/scan/route';
import { useTranslation } from '@/contexts/LanguageContext';
import { compressImageForUpload } from '@/lib/imageUtils';

// ── Types ──────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'preview' | 'analyzing' | 'confirm' | 'error';

interface ConfirmPayload {
  percent:    number;
  confidence: number;
  gaugeType:  GaugeType;
  detected:   number | null;
  reason:     string;
}

interface Props {
  onConfirm: (payload: ConfirmPayload) => void;
  onClose:   () => void;
}

// ── Image preprocessing ────────────────────────────────────────────────────

// 1536px longest edge: Claude's vision downsamples to ~1568px anyway, so this keeps
// maximum gauge detail without wasting upload bandwidth on a WKWebView.
const MAX_DIM    = 1536;
const JPEG_QUAL  = 0.9;

// preprocessImage replaced by compressImageForUpload from lib/imageUtils
// (createImageBitmap crashed WKWebView on HEIC photos from iOS camera roll)

// ── Helpers ────────────────────────────────────────────────────────────────

const GAUGE_TYPE_LABELS: Record<GaugeType, string> = {
  analog_needle:      'Analog needle',
  digital_percentage: 'Digital %',
  digital_bars:       'Digital bars',
  unknown:            'Unknown',
};

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${value}%` }} />
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GaugeScanModal({ onConfirm, onClose }: Props) {
  const { t } = useTranslation();

  const [stage,        setStage]        = useState<Stage>('idle');
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null);
  const [scanResult,   setScanResult]   = useState<GaugeScanResult | null>(null);
  const [adjustedPct,  setAdjustedPct]  = useState<number>(50);
  const [errorMsg,     setErrorMsg]     = useState<string>('');
  const [isUpgrade,    setIsUpgrade]    = useState(false);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [aspect,        setAspect]        = useState<number>(1);

  // Called when a file is selected (camera or gallery)
  const handleFile = useCallback(async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setStage('preview');

    // Read the image aspect ratio (width/height) so the server geometry can
    // correct angles on non-square photos. Aspect is preserved by compression.
    const dimImg = new Image();
    dimImg.onload = () => {
      if (dimImg.naturalWidth && dimImg.naturalHeight) {
        setAspect(dimImg.naturalWidth / dimImg.naturalHeight);
      }
    };
    dimImg.src = objectUrl;

    try {
      // compressImageForUpload uses <img>+canvas — safe in WKWebView and handles HEIC
      const processed = await compressImageForUpload(file, MAX_DIM, JPEG_QUAL);
      setProcessedBlob(processed);
    } catch {
      // Fall back to original if compression fails
      setProcessedBlob(file);
    }
  }, []);

  async function handleAnalyze() {
    if (!processedBlob) return;
    setStage('analyzing');
    setErrorMsg('');
    setIsUpgrade(false);

    try {
      const fd = new FormData();
      fd.append('image', processedBlob, 'gauge.jpg');
      fd.append('aspect', String(aspect));
      const res  = await fetch('/api/gauge/scan', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as GaugeScanResult & { error?: string; upgrade?: boolean };

      // Pro gate
      if (res.status === 403 && data.upgrade) {
        setIsUpgrade(true);
        setErrorMsg(data.error ?? t.scan.proRequired);
        setStage('error');
        return;
      }

      if (!res.ok) {
        setErrorMsg(data.error ?? t.calc.scanFailed);
        setStage('error');
        return;
      }

      // Truly unreadable (no gauge / no value) → force a retake.
      if (!data.gaugeDetected || data.fuelPercent === null) {
        const q = data.imageQualityStatus ?? '';
        let hint = t.scan.retakeHint;
        if      (q === 'dark')                      hint = t.scan.errDark;
        else if (q === 'glare')                     hint = t.scan.errGlare;
        else if (q === 'too_far' || q === 'partial') hint = t.scan.errTooFar;
        else if (data.reason)                       hint = data.reason;
        setErrorMsg(hint);
        setStage('error');
        return;
      }

      // We have a value. If confidence is low / retake advised, the confirm stage
      // shows the warning and keeps the slider active so the user can adjust or retake.
      setScanResult(data);
      setAdjustedPct(data.fuelPercent);
      setStage('confirm');
    } catch {
      setErrorMsg(t.calc.scanNetworkError);
      setStage('error');
    }
  }

  function handleRetake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setProcessedBlob(null);
    setScanResult(null);
    setErrorMsg('');
    setIsUpgrade(false);
    setStage('idle');
  }

  function handleConfirm() {
    onConfirm({
      percent:    adjustedPct,
      confidence: scanResult?.confidence ?? 0,
      gaugeType:  scanResult?.gaugeType  ?? 'unknown',
      detected:   scanResult?.fuelPercent ?? null,
      reason:     scanResult?.reason      ?? '',
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">{t.scan.modalTitle}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── IDLE: capture options ── */}
          {stage === 'idle' && (
            <div className="px-4 py-5 space-y-4">
              {/* Guided-capture framing guide — center the gauge so E, F, and the
                  needle are all clearly inside the frame (the accuracy depends on it). */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="mx-auto mb-2 w-full max-w-[220px]">
                  <svg viewBox="0 0 220 120" className="w-full h-auto" role="img" aria-label={t.scan.guideText}>
                    {/* target frame */}
                    <rect x="6" y="6" width="208" height="108" rx="10" fill="none"
                          stroke="#f59e0b" strokeWidth="2" strokeDasharray="7 6" />
                    {/* corner ticks */}
                    <g stroke="#f59e0b" strokeWidth="3" strokeLinecap="round">
                      <path d="M20 6 V16 M6 20 H16" /><path d="M200 6 V16 M214 20 H204" />
                      <path d="M20 114 V104 M6 100 H16" /><path d="M200 114 V104 M214 100 H204" />
                    </g>
                    {/* gauge arc */}
                    <path d="M60 92 A50 50 0 0 1 160 92" fill="none" stroke="#94a3b8" strokeWidth="3" />
                    {/* needle (points to ~half) */}
                    <line x1="110" y1="92" x2="110" y2="46" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="110" cy="92" r="4" fill="#475569" />
                    {/* E and F labels */}
                    <text x="52" y="104" fontSize="15" fontWeight="800" fill="#475569" textAnchor="middle">E</text>
                    <text x="168" y="104" fontSize="15" fontWeight="800" fill="#475569" textAnchor="middle">F</text>
                  </svg>
                </div>
                <p className="text-sm font-semibold text-amber-800 text-center">{t.scan.guideText}</p>
              </div>

              {/* Tips */}
              <ul className="text-[11px] text-slate-500 space-y-1 leading-relaxed">
                <li>• {t.scan.tip1}</li>
                <li>• {t.scan.tip2}</li>
                <li>• {t.scan.tip3}</li>
              </ul>

              {/* Capture buttons — label-wrapped so the tap goes straight to OS picker */}
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-white text-sm font-bold shadow hover:bg-amber-400 active:bg-amber-600 transition-colors cursor-pointer">
                  <span>📷</span><span>{t.scan.useCamera}</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
                </label>
                <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:border-amber-300 hover:text-amber-700 transition-colors cursor-pointer">
                  <span>🖼️</span><span>{t.scan.uploadPhoto}</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
                </label>
              </div>
            </div>
          )}

          {/* ── PREVIEW: show image before analysis ── */}
          {stage === 'preview' && previewUrl && (
            <div className="px-4 py-5 space-y-4">
              <p className="text-xs font-semibold text-slate-700">{t.scan.previewTitle}</p>
              <div className="rounded-xl overflow-hidden bg-slate-100 aspect-[4/3]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Gauge preview" className="w-full h-full object-contain" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleRetake}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:border-slate-300 transition-colors">
                  {t.scan.retake}
                </button>
                <button type="button" onClick={handleAnalyze}
                  className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-bold shadow hover:bg-amber-400 active:bg-amber-600 transition-colors">
                  {t.scan.analyze}
                </button>
              </div>
            </div>
          )}

          {/* ── ANALYZING ── */}
          {stage === 'analyzing' && (
            <div className="px-4 py-10 flex flex-col items-center gap-3">
              <div className="text-3xl animate-spin">🔄</div>
              <p className="text-sm font-medium text-slate-600">{t.scan.analyzing}</p>
              {previewUrl && (
                <div className="w-40 rounded-xl overflow-hidden bg-slate-100 opacity-50 aspect-[4/3]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="" className="w-full h-full object-contain" />
                </div>
              )}
            </div>
          )}

          {/* ── CONFIRM: result + slider ── */}
          {stage === 'confirm' && scanResult && (
            <div className="px-4 py-5 space-y-4">
              {/* Thumbnail */}
              {previewUrl && (
                <div className="w-full rounded-xl overflow-hidden bg-slate-100 aspect-[4/3]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="" className="w-full h-full object-contain" />
                </div>
              )}

              {/* Detected result */}
              <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{t.scan.detected}</span>
                  <span className="text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                    {GAUGE_TYPE_LABELS[scanResult.gaugeType]}
                  </span>
                </div>
                <div className="text-3xl font-black text-slate-800">{scanResult.fuelPercent}%</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t.scan.confidence}</span>
                    <span className={scanResult.confidence >= 80 ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>
                      {scanResult.confidence}%
                    </span>
                  </div>
                  <ConfidenceBar value={scanResult.confidence} />
                </div>
                {scanResult.reason && (
                  <p className="text-[10px] text-slate-400 italic leading-snug">{scanResult.reason}</p>
                )}
              </div>

              {/* Low confidence warning */}
              {scanResult.needsUserConfirmation && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="text-amber-500 mt-0.5">⚠️</span>
                  <p className="text-[11px] text-amber-700 leading-snug">{t.scan.lowConfidenceNote}</p>
                </div>
              )}

              {/* Adjustment slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">{t.scan.adjustLabel}</label>
                  <span className="text-sm font-black text-amber-600">{adjustedPct}%</span>
                </div>
                <input
                  type="range"
                  min={0} max={100} step={5}
                  value={adjustedPct}
                  onChange={(e) => setAdjustedPct(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-[9px] text-slate-400">
                  <span>E (0%)</span><span>¼</span><span>½</span><span>¾</span><span>F (100%)</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleRetake}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:border-slate-300 transition-colors">
                  {t.scan.retake}
                </button>
                <button type="button" onClick={handleConfirm}
                  className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-sm font-bold shadow hover:bg-amber-400 active:bg-amber-600 transition-colors">
                  {t.scan.looksRight}
                </button>
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {stage === 'error' && (
            <div className="px-4 py-6 space-y-4">
              {previewUrl && !isUpgrade && (
                <div className="w-full rounded-xl overflow-hidden bg-slate-100 aspect-[4/3] opacity-60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="" className="w-full h-full object-contain" />
                </div>
              )}
              <div className={`flex items-start gap-2 rounded-xl px-3 py-3 ${isUpgrade ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
                <span className={`mt-0.5 ${isUpgrade ? 'text-amber-500' : 'text-red-400'}`}>{isUpgrade ? '🔒' : '✕'}</span>
                <p className={`text-sm font-medium leading-snug ${isUpgrade ? 'text-amber-800' : 'text-red-700'}`}>{errorMsg}</p>
              </div>
              {isUpgrade ? (
                <a href="/upgrade"
                  className="block w-full text-center py-3 rounded-xl bg-brand-orange text-white text-sm font-bold shadow hover:opacity-90 transition-opacity">
                  {t.scan.upgradeCta}
                </a>
              ) : (
                <button type="button" onClick={handleRetake}
                  className="w-full py-3 rounded-xl bg-amber-500 text-white text-sm font-bold shadow hover:bg-amber-400 transition-colors">
                  {t.scan.tryAgain}
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
