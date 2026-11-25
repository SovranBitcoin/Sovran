/**
 * @jest-environment node
 */

import { RuleTester } from 'eslint';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the plugin is CommonJS, loaded by eslint.config.js.
const plugin = require('../eslint-plugin-view-state');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// RuleTester declares its own describe/it blocks: one test per case.
tester.run('no-jsx-loading-branch', plugin.rules['no-jsx-loading-branch'], {
  valid: [
    'const a = <Button disabled={isLoading} />;',
    'const a = <Row loading={isLoading && !data} />;',
    'const a = <View>{!isLoading && <List />}</View>;',
    'const a = <View>{isLoading ? <Skeleton /> : <List />}</View>;',
    'const a = <View>{isReady && <List />}</View>;',
    'const a = <View>{isLoading && count}</View>;',
    'const a = <StateSwitch state={state} renderLoading={() => <Skeleton />} />;',
  ],
  invalid: [
    {
      code: 'const a = <View>{isLoading && <Spinner />}</View>;',
      errors: [{ messageId: 'branch', data: { flag: 'isLoading' } }],
    },
    {
      code: 'const a = <View>{query.isLoading && <Spinner />}</View>;',
      errors: [{ messageId: 'branch', data: { flag: 'query.isLoading' } }],
    },
    {
      code: 'const a = <>{__DEV__ && isLoading && (<Spinner />)}</>;',
      errors: [{ messageId: 'branch' }],
    },
    {
      code: 'const a = <View>{isFetching && <Spinner />}</View>;',
      options: [{ names: ['isFetching'] }],
      errors: [{ messageId: 'branch', data: { flag: 'isFetching' } }],
    },
  ],
});
