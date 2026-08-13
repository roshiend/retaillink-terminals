import './styles.css';
import './modules.css';
import ConsoleLauncher from './console-launcher';

export const metadata = {
  title: 'Retaillink Terminals Dashboard',
  description: 'Sandbox merchant dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ConsoleLauncher />
      </body>
    </html>
  );
}
