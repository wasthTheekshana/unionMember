module.exports = {
  apps: [{
    name: 'union-members-backend',
    cwd: './backend',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5003,
      LD_LIBRARY_PATH: '/opt/oracle/product/21c/dbhomeXE/lib',
      ORACLE_HOME: '/opt/oracle/product/21c/dbhomeXE'
    },
    error_file: './logs/backend-error.log',
    out_file: './logs/backend-out.log',
    log_file: './logs/backend-combined.log',
    time: true
  }]
};
