import { CocoCoreLogger } from '@/shared/lib/cashu/cocoLogger';
import { cashuLog } from '@/shared/lib/logger';

jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { isLevelEnabled: jest.fn(() => false), debug: jest.fn() },
}));

it('does not traverse metadata when a log level is disabled', () => {
  const inspect = jest.fn(() => 'unused');
  const metadata = Object.defineProperty({}, 'payload', { enumerable: true, get: inspect });
  new CocoCoreLogger('test').debug('Disabled request', metadata);
  expect(inspect).not.toHaveBeenCalled();
  expect(cashuLog.debug).not.toHaveBeenCalled();
});
