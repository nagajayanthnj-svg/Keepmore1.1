import { Storefront } from './storefront';

export const metadata = { title: 'Neel Pottery (demo shop)' };
export const dynamic = 'force-dynamic';

export default function StorePage() {
  return <Storefront clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ''} />;
}
