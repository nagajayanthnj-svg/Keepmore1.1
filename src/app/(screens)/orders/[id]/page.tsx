export const metadata = { title: 'Order · KeepMore' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Order {id}</h1>
      <p className="mt-2 text-neutral-700">
        The order timeline: what was sold, what PayPal charged, and where each number comes from. Arrives in a later
        step.
      </p>
    </>
  );
}
