import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prime Technical Live Scanner',
  description: 'Live intraday Prime Technical scanner powered by Upstox.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
