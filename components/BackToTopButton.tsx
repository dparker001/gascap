'use client';

import { useEffect, useState } from 'react';

export default function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className="fixed bottom-6 right-5 z-30 h-11 w-11 rounded-full bg-[#1E2D4A] text-white
                 shadow-lg flex items-center justify-center hover:bg-[#2a3d5f] active:scale-95
                 transition-all"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M10 3a.75.75 0 01.53.22l5.5 5.5a.75.75 0 01-1.06 1.06L10.75 5.56V16a.75.75 0 01-1.5 0V5.56L5.03 9.78a.75.75 0 01-1.06-1.06l5.5-5.5A.75.75 0 0110 3z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
