'use client';

import { useEffect, useState } from 'react';

interface SessionDetail {
  id: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  rentalCompany: string;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  returnLocation: string | null;
  fuelFeeCharged: boolean | null;
  fuelFeeAmount: number | null;
  fuelFeeGallonsClaimed: number | null;
  fuelFeeRentalReportedLevel: number | null;
  disputeNotes: string | null;
  pickupVehiclePhotoThumb: string | null;
  pickupGaugePhotoThumb: string | null;
  pickupAgreementPhotoThumb: string | null;
  returnGaugePhotoThumb: string | null;
  returnReceiptPhotoThumb: string | null;
  createdAt: string;
  completedAt: string | null;
}

const PHOTO_FIELDS: [keyof SessionDetail, string][] = [
  ['pickupVehiclePhotoThumb',   'Pickup — Vehicle'],
  ['pickupGaugePhotoThumb',     'Pickup — Gauge'],
  ['pickupAgreementPhotoThumb', 'Pickup — Agreement'],
  ['returnGaugePhotoThumb',     'Return — Gauge'],
  ['returnReceiptPhotoThumb',   'Return — Receipt'],
];

export default function RentalSessionDetail({ sessionId, savedPw, onChanged }: { sessionId: string; savedPw: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/rental-pilot/${sessionId}`, { headers: { 'x-admin-password': savedPw } })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.session) setDetail(d.session); })
      .finally(() => setLoading(false));
  }, [sessionId, savedPw]);

  async function handleAction(action: 'complete' | 'cancel') {
    setActing(true);
    try {
      await fetch(`/api/admin/rental-pilot/${sessionId}`, {
        method:  'PATCH',
        headers: { 'x-admin-password': savedPw, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      });
      onChanged();
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="h-20 bg-slate-100 rounded-xl animate-pulse mt-2" />;
  if (!detail) return <p className="text-xs text-red-500 mt-2">Failed to load session detail.</p>;

  const photos = PHOTO_FIELDS.filter(([key]) => !!detail[key]);

  return (
    <div className="mt-2 bg-slate-50 rounded-xl p-3 space-y-3">
      <div className="text-[11px] text-slate-600 space-y-0.5">
        <p><span className="font-bold">{detail.userName}</span> · {detail.userEmail}</p>
        <p>{detail.rentalCompany} · {[detail.vehicleYear, detail.vehicleMake, detail.vehicleModel].filter(Boolean).join(' ')}</p>
        {detail.returnLocation && <p>Return: {detail.returnLocation}</p>}
        <p>Created {new Date(detail.createdAt).toLocaleString()}{detail.completedAt ? ` · Completed ${new Date(detail.completedAt).toLocaleString()}` : ''}</p>
      </div>

      {detail.fuelFeeCharged && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 text-[11px] text-red-700">
          <p className="font-bold">Fuel fee dispute reported</p>
          {detail.fuelFeeAmount != null && <p>Amount: ${detail.fuelFeeAmount.toFixed(2)}</p>}
          {detail.fuelFeeGallonsClaimed != null && <p>Gallons claimed: {detail.fuelFeeGallonsClaimed}</p>}
          {detail.disputeNotes && <p>Notes: {detail.disputeNotes}</p>}
        </div>
      )}

      {photos.length > 0 ? (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Photos</p>
          <div className="grid grid-cols-3 gap-2">
            {photos.map(([key, label]) => (
              <a key={key} href={detail[key] as string} target="_blank" rel="noopener noreferrer" className="block">
                <img src={detail[key] as string} alt={label} className="w-full aspect-square object-cover rounded-lg border border-slate-200" />
                <p className="text-[9px] text-slate-500 mt-0.5 truncate">{label}</p>
              </a>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">No photos attached to this session.</p>
      )}

      {detail.status === 'active' && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => handleAction('complete')} disabled={acting}
            className="flex-1 text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg py-1.5 disabled:opacity-40">
            Force Complete
          </button>
          <button onClick={() => handleAction('cancel')} disabled={acting}
            className="flex-1 text-[11px] font-bold text-white bg-slate-500 hover:bg-slate-600 rounded-lg py-1.5 disabled:opacity-40">
            Cancel Session
          </button>
        </div>
      )}
    </div>
  );
}
