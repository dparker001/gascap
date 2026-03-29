import Link from 'next/link';

const YEAR = new Date().getFullYear();

const NAV_LINKS = [
  { href: '/',        label: '← App'   },
  { href: '/help',    label: 'Help'    },
  { href: '/upgrade', label: 'Upgrade' },
  { href: '/terms',   label: 'Terms'   },
  { href: '/privacy', label: 'Privacy' },
];

interface StaticPageHeaderProps {
  /** Highlight the active page in the nav */
  active?: 'help' | 'terms' | 'privacy' | 'upgrade';
}

export default function StaticPageHeader({ active }: StaticPageHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-navy-700 shadow-md">
      <div className="max-w-4xl mx-auto px-4 py-0 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 py-3 flex-shrink-0">
          <div className="w-7 h-7 rounded-xl bg-amber-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
              <rect x="2" y="6" width="11" height="16" rx="1.5" />
              <rect x="4" y="9" width="7" height="4" rx="0.75" />
              <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
              <circle cx="18.5" cy="18.5" r="1.5" />
            </svg>
          </div>
          <span className="text-white font-black text-base leading-none">
            GasCap<sup className="text-amber-400 text-[9px] ml-0.5">™</sup>
          </span>
          <span className="hidden sm:block text-white/30 text-[10px] font-medium ml-0.5">
            © {YEAR}
          </span>
        </Link>

        {/* Nav links */}
        <nav aria-label="Page navigation" className="flex items-center gap-0.5 overflow-x-auto py-3">
          {NAV_LINKS.map(({ href, label }) => {
            const key     = href.replace('/', '') || 'app';
            const isActive = active === key;
            return (
              <Link
                key={href}
                href={href}
                className={[
                  'px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-amber-500 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/10',
                ].join(' ')}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
