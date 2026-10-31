'use client';
import { LanguageSelector, useI18n } from './i18n';
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
  Bot,
} from 'lucide-react';
import { useSession } from './providers';
const main = [
  ['/', 'Discover', Compass],
  ['/marketplace', 'Marketplace', Store],
  ['/collections', 'Collections', Layers],
  ['/channels', 'Channels', Store],
  ['/community', 'Community Hub', Activity],
  ['/assistant', 'AI assistant', Bot],
] as const;
const personal = [
  ['/account/collection', 'My collection', Layers],
  ['/account/saved', 'Saved items', Heart],
  ['/account/orders', 'Orders', Package],
  ['/account/credits', 'Credits', Wallet],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const { t: tr } = useI18n();

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
        <span>{tr(label)}</span>
        {href === '/marketplace' && <span className="nav-new">{tr('NEW')}</span>}
      </Link>
    ));
  return (
    <>
      <a className="skip-link" href="#main-content">
        {tr('Skip to content')}
      </a>
      {open && (
        <button
          className="sidebar-scrim"
          onClick={() => setOpen(false)}
          aria-label={tr('Close navigation')}
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
          {tr('PixUP')}
          <span className="brand-dot">®</span>
        </Link>
        <div className="sidebar-inner">
          <span className="nav-label">{tr('EXPLORE')}</span>
          <nav aria-label={tr('Explore')}>{nav(main)}</nav>
          <span className="nav-label">{tr('YOUR SPACE')}</span>
          <nav aria-label={tr('Your space')}>{nav(personal)}</nav>
          <div className="nav-divider" />
          <span className="nav-label">{tr('WORKSPACE')}</span>
          <nav aria-label={tr('Workspaces')}>
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
              {tr('Your creativity.')}
              <br />
              {tr('Their next favorite.')}
            </strong>
            <p>{tr('Give your collection a home.')}</p>
            <Link href="/workspace/creator">
              {tr('Meet creator studio ')}
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="sidebar-bottom">
            <LanguageSelector />
            <Link href="/account/support">
              <LifeBuoy size={17} />
              {tr('Help & support')}
            </Link>
            <Link href="/account/settings">
              <Settings size={17} />
              {tr('Settings')}
            </Link>
            <span className="demo-pill">
              <i />
              {tr(' Interactive demo · No real money')}
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setOpen(true)}
            aria-label={tr('Open navigation')}
          >
            <Menu size={22} />
          </button>
          <div className="top-context">
            {tr('The home of your next find')}
            <span> / </span>
            <b>
              {path.startsWith('/workspace')
                ? tr('Workspace')
                : path.startsWith('/ops')
                  ? tr('Operations')
                  : tr('Explore')}
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
                aria-label={tr('Search collectibles')}
                placeholder={tr('Search collectibles…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌕</kbd>
            </form>
            <Link
              href="/account/activity"
              className="notification-button"
              aria-label={tr('Activity and notifications')}
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
                {tr('Sign in ')}
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <footer>
          <span>
            © {new Date().getFullYear()}
            {tr(' PixUP. Culture circulates.')}
          </span>
          <span>{tr('Original demo artwork · Simulated transactions')}</span>
          <Link href="/account/support">
            {tr('Support ')}
            <ArrowUpRight size={13} />
          </Link>
        </footer>
      </div>
      {path !== '/assistant' && (
        <nav aria-label={tr('Assistant shortcut')}>
          <Link className="assistant-launcher" href="/assistant">
            <Bot size={20} />
            {tr(' Ask PixUP')}
          </Link>
        </nav>
      )}
    </>
  );
}
