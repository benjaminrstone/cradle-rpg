// pm2 config for the hosted site (cradle.ben-stone.xyz, behind nginx on Ben's EC2 box).
// Deploys put each release in /srv/cradle/current; data (Claude sync, saved fights, the sync
// key) lives in /srv/cradle/data and survives deploys.
module.exports = {
  apps: [
    {
      name: 'cradle',
      script: 'serve.py',
      interpreter: 'python3',
      args: '3010',
      cwd: '/srv/cradle/current',
      env: { CRADLE_DATA: '/srv/cradle/data', PYTHONUNBUFFERED: '1' },
    },
  ],
};
