import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PRICING_ENABLED } from '@/lib/utils/constants';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PricingSection } from '@/components/PricingSection';

export const metadata: Metadata = {
  title: 'Pricing | ADUalign',
  description:
    'Check any California lot for free. Upgrade when you are ready to model the numbers and take a real ADU plan to a contractor.',
};

export default function PricingPage() {
  if (!PRICING_ENABLED) {
    redirect('/');
  }
  return (
    <div className="min-h-screen flex flex-col bg-surface-0 font-sans">
      <Header />
      <main className="flex-1">
        <PricingSection />
      </main>
      <Footer />
    </div>
  );
}
