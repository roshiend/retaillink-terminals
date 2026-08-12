import './styles.css';

export const metadata = {
  title: 'Retaillink Checkout',
  description: 'Retaillink Terminals sandbox checkout',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
