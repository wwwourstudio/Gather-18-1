// Going live through gather's own server (no separate relay, no RELAY_URL): the Google AI Studio setup.
process.env.LIVE_BUILTIN = '1';
require('./live.test.js');
