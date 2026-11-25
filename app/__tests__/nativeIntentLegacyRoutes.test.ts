/**
 * @jest-environment node
 *
 * Links into the seven route groups flattened onto the root keep working: the
 * native-intent rewrite sends each to the same page's root path, query and
 * fragment untouched, after the pairing-secret check has had its say.
 */
import { rewriteSystemPath } from '@/app/+native-intent';

describe('links into flattened route groups', () => {
  it.each([
    ['/(map-flow)', '/map'],
    ['/(map-flow)/', '/map'],
    ['/(map-flow)/index', '/map'],
    ['sovran://(map-flow)', '/map'],
    ['/(map-flow)/detail?placeId=42', '/detail?placeId=42'],
    ['/(theme-flow)/preview', '/preview'],
    ['/(theme-flow)/background?unit=sat', '/background?unit=sat'],
    ['/(theme-flow)/gallery', '/gallery'],
    ['/(filter-flow)/filters?currency=sat&status=All', '/filters?currency=sat&status=All'],
    [
      '/(transactions-flow)/transactions?filterStatus=Pending',
      '/transactions?filterStatus=Pending',
    ],
    ['/(transactions-flow)/swap?groupId=g1', '/swap?groupId=g1'],
    ['/(transactions-flow)/aiRequest?groupId=g1', '/aiRequest?groupId=g1'],
    [
      '/(transactions-flow)/sendToken?sendHistoryEntry=%7B%22id%22%3A1%7D&historyView=1',
      '/sendToken?sendHistoryEntry=%7B%22id%22%3A1%7D&historyView=1',
    ],
    ['/(user-flow)/profile?npub=npub1abc', '/profile?npub=npub1abc'],
    ['sovran://(user-flow)/profile?npub=npub1abc', '/profile?npub=npub1abc'],
    ['sovran:///(user-flow)/geohashChat?geohash=u4pru', '/geohashChat?geohash=u4pru'],
    ['https://sovran.money/(profile-flow)/profile?pubkey=ab#top', '/profile?pubkey=ab#top'],
    ['/(user-flow)/share?type=npub&data=npub1abc', '/share?type=npub&data=npub1abc'],
    [
      '/(profile-flow)/bitchatDM?transport=ble-dm&peerID=0011',
      '/bitchatDM?transport=ble-dm&peerID=0011',
    ],
    ['/(prompt-flow)/cta?id=backup-recovery-phrase', '/cta?id=backup-recovery-phrase'],
    ['/(prompt-flow)/backup-intro', '/backup-intro'],
  ])('opens %s at %s', (url, rewritten) => {
    expect(rewriteSystemPath(url)).toBe(rewritten);
  });

  it.each([
    '/(send-flow)/send',
    '/(receive-flow)/receive?unit=sat',
    '/(mint-flow)/info?mintUrl=https%3A%2F%2Fmint.example',
    '/(settings-flow)/profile',
    '/(user-flow)',
    '/(user-flow)x/profile',
    '/(wallet-flow)/profile',
    '/profile?npub=npub1abc',
    '/map',
  ])('leaves %s, which names no flattened group page, alone', (url) => {
    expect(rewriteSystemPath(url)).toBe(url);
  });

  it('rejects a pairing secret before any rewrite', () => {
    expect(rewriteSystemPath('/(user-flow)/profile?uri=bunker%3A%2F%2Fabc%3Fsecret%3Ds')).toBe('/');
    expect(rewriteSystemPath('sovran://(map-flow)/detail?x=nostrconnect://abc')).toBe('/');
  });
});
