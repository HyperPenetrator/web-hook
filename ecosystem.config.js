module.exports = {
  apps: [
    {
      name: 'eduhook-backend',
      script: 'index.js',
      instances: 1,             // Keep at 1 — Baileys WebSocket is stateful (not cluster-safe)
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
