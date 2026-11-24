import { createApp, loadConfig } from './app.js';

try {
  const config = loadConfig();
  const app = createApp({ config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`飞书运营助手已启动：http://${config.host}:${config.port}（${config.mode === 'demo' ? '演示模式：虚构数据' : '飞书模式'}）`);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  server.on('error', () => {
    console.error('服务启动失败，请检查监听地址和端口是否可用。');
    process.exitCode = 1;
  });
  const shutdown = () => {
    app.locals.close?.();
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  // Only configuration validation messages are exposed; no secrets or raw upstream errors.
  console.error(`服务配置无效：${error.message}`);
  process.exitCode = 1;
}
