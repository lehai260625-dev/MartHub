export const catalogLinks = [
  { label: 'Trang chủ', href: '/' },
  { label: 'Danh mục', href: '/categories' },
];
export const customerLinks = [
  { label: 'My Items', href: '/account/my-items?tab=reorder' },
  { label: 'Đơn hàng', href: '/account/orders' },
  { label: 'Hồ sơ', href: '/account/profile' },
  { label: 'Địa chỉ', href: '/account/addresses' },
];
export function accountLinks(auth) {
  if (auth.status === 'guest')
    return [
      { label: 'Đăng nhập', href: '/login' },
      { label: 'Đăng ký', href: '/register' },
    ];
  if (auth.status !== 'authenticated') return [];
  return auth.user.role === 'ADMIN'
    ? [{ label: 'Quản trị', href: '/admin' }]
    : customerLinks;
}
export function canUseCustomerShopping(auth) {
  return (
    auth.status === 'guest' ||
    (auth.status === 'authenticated' && auth.user.role === 'CUSTOMER')
  );
}
