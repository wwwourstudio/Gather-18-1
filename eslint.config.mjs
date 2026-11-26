import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'public/**/*', 'node_modules/**/*', 'scripts/**/*', 'lib/**/*', 'api/**/*', 'tests/**/*', 'relay/**/*', 'src/**/*', 'server.js'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
