const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

const [
  { app },
  { registerDashboardRoutes },
  { registerRiskEnforcement },
  { registerApiObservability },
  { registerRbac },
  { registerMerchantSwitching },
  { registerPaymentCustomerAssociation },
  { registerBilling },
  { registerBillingRisk },
  { registerInvoicePaymentSync },
  { registerPaymentIntentControl },
] = await Promise.all([
  import('./server.js'),
  import('./dashboard-routes.js'),
  import('./risk-enforcement.js'),
  import('./api-observability.js'),
  import('./rbac.js'),
  import('./merchant-switching.js'),
  import('./payment-customer.js'),
  import('./billing.js'),
  import('./billing-risk.js'),
  import('./invoice-payment-sync.js'),
  import('./payment-intent-control.js'),
]);

if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

registerRbac(app);
registerApiObservability(app);
registerPaymentCustomerAssociation(app);
registerRiskEnforcement(app);
registerBillingRisk(app);
registerInvoicePaymentSync(app);
registerDashboardRoutes(app);
registerMerchantSwitching(app);
registerBilling(app);
registerPaymentIntentControl(app);

export { app };

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: '0.0.0.0' }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
