import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Check Your Lot',
  description:
    'See the buildable area, setbacks, and ADU feasibility verdict for any California parcel on an interactive map.',
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
