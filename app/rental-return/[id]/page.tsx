'use client';

/** Direct-linkable rental session dashboard — used by return-reminder notifications and page refresh. */

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import BrandBar from '@/components/BrandBar';
import BackToCalculatorBar from '@/components/rental-return/BackToCalculatorBar';
import RentalDashboard from '@/components/rental-return/RentalDashboard';

export default function RentalSessionPage() {
  const { data: authSession, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { t } = useTranslation();
  const id = params.id as string;

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#eef1f7]">
        <BrandBar />
        <BackToCalculatorBar />
        <div className="px-4"><div className="h-32 bg-white rounded-2xl animate-pulse max-w-lg mx-auto" /></div>
      </div>
    );
  }

  if (!authSession) {
    return (
      <div className="min-h-screen bg-[#eef1f7]">
        <BrandBar />
        <BackToCalculatorBar />
        <div className="px-4 text-center max-w-sm mx-auto">
          <p className="text-sm text-slate-500 mb-4">{t.rentalReturn.signInRequired}</p>
          <Link href={`/signin?next=/rental-return/${id}`} className="inline-block px-6 py-3 rounded-2xl bg-[#005F4A] text-white font-black text-sm">
            {t.rentalReturn.signIn}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <BrandBar />
      <BackToCalculatorBar />
      <div>
        <RentalDashboard sessionId={id} onCompleted={() => router.push('/rental-return/history')} />
      </div>
    </div>
  );
}
