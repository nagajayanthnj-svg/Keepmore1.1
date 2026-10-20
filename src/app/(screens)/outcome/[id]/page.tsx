export const metadata = { title: 'Outcome · KeepMore' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Outcome for {id}</h1>
      <p className="mt-2 text-neutral-700">
        What the dispute cost or returned, with each amount and its source. Arrives in a later step.
      </p>
    </>
  );
}
