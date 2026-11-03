import type { Metadata } from 'next';
import { Inter, Outfit, Instrument_Serif } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/context/AuthContext';
import { SavedProvider } from '@/lib/context/SavedContext';
import { UsageBudgetProvider } from '@/lib/context/UsageBudgetContext';
import { FeedbackTab } from '@/components/feedback/FeedbackTab';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
});

const SITE_URL = 'https://www.adualign.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ADUalign | California ADU Feasibility',
    template: '%s | ADUalign',
  },
  description:
    'Type any California address for an instant ADU feasibility verdict, cost estimate, and AI permit advisor.',
  openGraph: {
    siteName: 'ADUalign',
    url: SITE_URL,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: 'ADUalign', url: SITE_URL, logo: `${SITE_URL}/icon.svg` },
    { '@type': 'WebSite', name: 'ADUalign', url: SITE_URL },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth" data-scroll-behavior="smooth">
      <body
        className={`${inter.variable} ${outfit.variable} ${instrumentSerif.variable} font-sans min-h-screen bg-slate-50 flex flex-col`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <AuthProvider>
          <UsageBudgetProvider>
            <SavedProvider>
              {children}
              <FeedbackTab />
            </SavedProvider>
          </UsageBudgetProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
