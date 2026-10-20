import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">KeepMore</h1>
      <nav aria-label="Start" className="flex gap-4 text-sm underline">
        <Link href="/overview">Overview</Link>
        <Link href="/store">Demo shop</Link>
      </nav>
    </main>
  );
}
