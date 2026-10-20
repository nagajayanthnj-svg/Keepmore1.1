export const metadata = { title: 'Dispute · KeepMore' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dispute {id}</h1>
      <p className="mt-2 text-neutral-700">
        The dispute workbench: what PayPal allows, the evidence we hold, and what you approve before anything is sent.
        Arrives in a later step.
      </p>
    </>
  );
}
