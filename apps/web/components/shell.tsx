'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Compass,
  Store,
  Layers,
  Heart,
  Wallet,
  ArrowUpRight,
  Plus,
  Search,
  Bell,
  ChevronDown,
  PanelLeftClose,
  Menu,
  ShieldCheck,
  LifeBuoy,
  Package,
  Palette,
  Settings,
  Activity,
} from 'lucide-react';
import { useSession } from './providers';
const main = [
  ['/', 'Discover', Compass],
  ['/marketplace', 'Marketplace', Store],
  ['/collections', 'Collections', Layers],
  ['/channels', 'Channels', Store],
] as const;
const personal = [
  ['/account/collection', 'My collection', Layers],
  ['/account/saved', 'Saved items', Heart],
  ['/account/orders', 'Orders', Package],
  ['/account/credits', 'Credits', Wallet],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    router = useRouter();
  const { user } = useSession();
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const nav = (items: readonly (readonly [string, string, any])[]) =>
    items.map(([href, label, Icon]) => (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        className={`nav-link ${(href === '/' ? path === href : path.startsWith(href)) ? 'active' : ''}`}
      >
        <Icon size={19} />
        <span>{label}</span>
        {href === '/marketplace' && <span className="nav-new">NEW</span>}
      </Link>
    ));
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-scrim"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          PixUP<span className="brand-dot">®</span>
        </Link>
        <div className="sidebar-inner">
          <span className="nav-label">EXPLORE</span>
          <nav aria-label="Explore">{nav(main)}</nav>
          <span className="nav-label">YOUR SPACE</span>
          <nav aria-label="Your space">{nav(personal)}</nav>
          <div className="nav-divider" />
          <span className="nav-label">WORKSPACE</span>
          <nav aria-label="Workspaces">
            {nav([
              ['/workspace/seller', 'Seller studio', Store],
              ['/workspace/creator', 'Creator studio', Palette],
              ['/workspace/channels', 'Channel workspace', Package],
              ['/workspace/developer', 'Developer tools', Activity],
            ])}
            {user?.is_staff && nav([['/ops', 'Operations', ShieldCheck]])}
          </nav>
          <div className="creator-promo">
            <span className="mini-spark">✳</span>
            <strong>
              Your creativity.
              <br />
              Their next favorite.
            </strong>
            <p>Give your collection a home.</p>
            <Link href="/workspace/creator">
              Meet creator studio <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="sidebar-bottom">
            <Link href="/account/support">
              <LifeBuoy size={17} />
              Help & support
            </Link>
            <Link href="/account/settings">
              <Settings size={17} />
              Settings
            </Link>
            <span className="demo-pill">
              <i /> Interactive demo · No real money
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>
          <div className="top-context">
            The home of your next find<span> / </span>
            <b>
              {path.startsWith('/workspace')
                ? 'Workspace'
                : path.startsWith('/ops')
                  ? 'Operations'
                  : 'Explore'}
            </b>
          </div>
          <div className="top-actions">
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/marketplace?q=${encodeURIComponent(search)}`);
              }}
            >
              <Search size={17} />
              <input
                aria-label="Search collectibles"
                placeholder="Search collectibles…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌕</kbd>
            </form>
            <Link
              href="/account/activity"
              className="notification-button"
              aria-label="Activity and notifications"
            >
              <Bell size={19} />
              <i />
            </Link>
            {user ? (
              <Link className="profile" href="/account/settings">
                <span className="avatar">
                  {user.name
                    .split(' ')
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <ChevronDown size={14} />
              </Link>
            ) : (
              <Link className="sign-in" href="/login">
                Sign in <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <footer>
          <span>© {new Date().getFullYear()} PixUP. Culture circulates.</span>
          <span>Original demo artwork · Simulated transactions</span>
          <Link href="/account/support">
            Support <ArrowUpRight size={13} />
          </Link>
        </footer>
      </div>
    </>
  );
}
