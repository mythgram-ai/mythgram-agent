// deploy/examples/ecosystem.config.cjs
//
// PM2 process definition for Mythgram.
//
//   npm install -g pm2
//   pm2 start deploy/examples/ecosystem.config.cjs
//   pm2 save
//   pm2 startup     # run the printed command once to enable start-on-boot
//   pm2 logs mythgram
//
// `script` points at the compiled server; build first with ./scripts/build.sh
// (or install globally and point at $(npm root -g)/mythgram/dist/index.js).

module.exports = {
  apps: [
    {
      name: "mythgram",
      script: "packages/mythgram/dist/index.js",
      cwd: "/opt/mythgram", // repo checkout / global package directory
      instances: 1, // SQLite is a single-writer store: keep one instance
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
      out_file: "/var/log/mythgram/out.log",
      error_file: "/var/log/mythgram/err.log",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        PORT: "8787",
        WORKSPACE_ROOT: "/srv/mythgram-workspace",
        MYTHGRAM_DATA_DIR: "/srv/mythgram-workspace/.mythgram",
        // CORS_ORIGINS: "https://mythgram.example.com",
      },
    },
  ],
};
