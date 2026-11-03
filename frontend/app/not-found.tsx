import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
        <h1 className="text-9xl font-extrabold text-slate-200">404</h1>
        <h2 className="text-3xl font-bold text-slate-900 mt-4 mb-2">Page Not Found</h2>
        <p className="text-slate-500 max-w-md mx-auto mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild size="lg">
          <Link href="/">Back to Home</Link>
        </Button>
      </main>
      <Footer />
    </>
  );
}
