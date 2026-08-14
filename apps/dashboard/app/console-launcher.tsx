'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function ConsoleLauncher() {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const response = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
        if (active) setAuthenticated(response.ok);
      } catch {
        if (active) setAuthenticated(false);
      }
    }
    void check();
    const interval = window.setInterval(check, authenticated ? 15000 : 2500);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [pathname, authenticated]);

  if (!authenticated || pathname === '/invite') return null;

  const links = [
    ['/', 'Overview'],
    ['/payment-intents', 'Payment Intents'],
    ['/payment-links', 'Payment Links'],
    ['/finance', 'Finance'],
    ['/billing', 'Billing'],
    ['/customers', 'Customers'],
    ['/analytics', 'Analytics'],
    ['/webhook-deliveries', 'Webhooks'],
    ['/risk', 'Risk'],
    ['/api-logs', 'API Logs'],
    ['/team', 'Team'],
    ['/merchants', 'Merchants'],
  ];

  return <nav className="consoleLauncher" aria-label="Console modules">
    {links.map(([href, label]) => <a key={href} className={pathname === href ? 'active' : ''} href={href}>{label}</a>)}
  </nav>;
}
