import Link from 'next/link';

const YEAR = new Date().getFullYear();

const NAV_LINKS = [
  { href: '/',         label: '← App'   },
  { href: '/help',     label: 'Help'    },
  { href: '/upgrade',  label: 'Upgrade' },
  { href: '/terms',    label: 'Terms'   },
  { href: '/privacy',  label: 'Privacy' },
  { href: '/contact',  label: 'Contact' },
];

interface StaticPageHeaderProps {
  /** Highlight the active page in the nav */
  active?: 'help' | 'terms' | 'privacy' | 'upgrade' | 'contact';
}

export default function StaticPageHeader({ active }: StaticPageHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-navy-700 shadow-md">
      <div className="max-w-4xl mx-auto px-4 py-0 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1.5 py-3 flex-shrink-0">
          <img
            src="/gascap-icon-raw.png"
            alt=""
            className="h-8 w-auto object-contain drop-shadow-sm"
            aria-hidden="true"
          />
          <span className="text-white font-black text-base leading-none tracking-tight">
            GasCap<sup className="text-xs font-bold" style={{ verticalAlign: '0.6em' }}>™</sup>
          </span>
          <span className="hidden sm:block text-white/30 text-[10px] font-medium ml-1">
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
