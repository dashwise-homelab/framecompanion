const { execFileSync } = require('node:child_process');
const appJson = require('./app.json');

function getBuildCommit() {
  const configuredCommit = process.env.EAS_BUILD_GIT_COMMIT_HASH || process.env.GITHUB_SHA;
  if (configuredCommit) return configuredCommit;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      buildCommit: getBuildCommit(),
    },
  },
};
