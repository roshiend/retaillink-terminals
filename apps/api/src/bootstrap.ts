const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

const [
  { app },
  { prisma },
  { registerDashboardRoutes },
  { registerRiskEnforcement },
  { registerApiObservability },
  { registerRbac },
  { registerMerchantSwitching },
  { registerPaymentCustomerAssociation },
  { registerBilling },
  { registerBillingRisk },
  { registerInvoicePaymentSync },
  { registerOperationalControls },
  { registerPaymentLinks },
  { registerRuntimeHardening, validateRuntimeConfig },
] = await Promise.all([
  import('./server.js'),
  import('@retaillink/database'),
  import('./dashboard-routes.js'),
  import('./risk-enforcement.js'),
  import('./api-observability.js'),
  import('./rbac.js'),
  import('./merchant-switching.js'),
  import('./payment-customer.js'),
  import('./billing.js'),
  import('./billing-risk.js'),
  import('./invoice-payment-sync.js'),
  import('./operational-controls.js'),
  import('./payment-links.js'),
  import('./runtime-hardening.js'),
]);

if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

registerRuntimeHardening(app);
registerRbac(app);
registerApiObservability(app);
registerPaymentCustomerAssociation(app);
registerRiskEnforcement(app);
registerBillingRisk(app);
registerInvoicePaymentSync(app);
registerDashboardRoutes(app);
registerMerchantSwitching(app);
registerBilling(app);
registerOperationalControls(app);
registerPaymentLinks(app);

export { app };

if (process.env.NODE_ENV !== 'test') {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Graceful shutdown started');
    try {
      await app.close();
      await prisma.$disconnect();
      process.exitCode = 0;
    } catch (error) {
      app.log.error(error, 'Graceful shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });

  try {
    validateRuntimeConfig();
    const port = Number(process.env.PORT ?? 3001);
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  }
}
