const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

const [{ app }, { registerDashboardRoutes }, { registerRiskEnforcement }, { registerApiObservability }] = await Promise.all([
  import('./server.js'),
  import('./dashboard-routes.js'),
  import('./risk-enforcement.js'),
  import('./api-observability.js'),
]);

if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

registerApiObservability(app);
registerRiskEnforcement(app);
registerDashboardRoutes(app);

export { app };

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: '0.0.0.0' }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
