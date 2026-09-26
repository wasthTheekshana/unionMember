module.exports = {
  apps: [{
    name: 'union-members-backend',
    cwd: '/home/itasset/apps/UNION-Members-Management/backend',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5003
    },
    error_file: '/home/itasset/apps/UNION-Members-Management/logs/backend-error.log',
    out_file: '/home/itasset/apps/UNION-Members-Management/logs/backend-out.log',
    log_file: '/home/itasset/apps/UNION-Members-Management/logs/backend-combined.log',
    time: true
  }]
};
