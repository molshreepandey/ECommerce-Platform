export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { validateStartupConfiguration } = await import('./instrumentation-node');
  validateStartupConfiguration();
}
