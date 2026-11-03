import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Send ADUalign a bug report, question, or feedback.',
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
