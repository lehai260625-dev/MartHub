import { redirect } from 'next/navigation';

export default function WishlistRedirect() {
  redirect('/account/my-items?tab=wishlist');
}
