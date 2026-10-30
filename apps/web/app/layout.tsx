import type { Metadata } from 'next';
import { Providers } from '../components/providers';
import { Shell } from '../components/shell';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'PixUP — Collect what moves you.', template: '%s · PixUP' },
  description:
    'Discover, collect, and give extraordinary collectibles their next chapter. A working PixUP demonstration.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
