import { createHash, sign } from 'node:crypto';
import { config, check, request, required, identifier, uuid, published, download } from './core.mjs';

export class Apple {
  async api(route, method = 'GET', body) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = encode({ alg: 'ES256', kid: required('ASC_KEY_ID'), typ: 'JWT' });
    const claims = { aud: 'appstoreconnect-v1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 };
    if (process.env.ASC_ISSUER_ID) claims.iss = process.env.ASC_ISSUER_ID; else claims.sub = 'user';
    const payload = encode(claims);
    const signature = sign('sha256', Buffer.from(`${head}.${payload}`), { key: required('ASC_PRIVATE_KEY'), dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const url = new URL(route, 'https://api.appstoreconnect.apple.com/v1/');
    return request(url.href, { hosts: ['api.appstoreconnect.apple.com'], token: `${head}.${payload}.${signature}`, method, body });
  }
  async list(route) {
    const all = []; const visited = new Set();
    while (route) {
      check(!visited.has(route) && visited.size < 100, 'ASC pagination cycle'); visited.add(route);
      const response = await this.api(route); all.push(...response.data); route = response.links?.next;
    }
    return all;
  }
}
const relationship = (type, id) => ({ data: { type, id: identifier(id) } });

export async function copyScreenshots(apple, sourceLocale, targetLocale) {
  const oldSets = await apple.list(`appStoreVersionLocalizations/${sourceLocale.id}/appScreenshotSets`);
  const newSets = await apple.list(`appStoreVersionLocalizations/${targetLocale.id}/appScreenshotSets`);
  for (const oldSet of oldSets) {
    const display = oldSet.attributes.screenshotDisplayType;
    let newSet = newSets.find((s) => s.attributes.screenshotDisplayType === display);
    if (!newSet) newSet = (await apple.api('appScreenshotSets', 'POST', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: display }, relationships: { appStoreVersionLocalization: relationship('appStoreVersionLocalizations', targetLocale.id) } } })).data;
    const oldShots = await apple.list(`appScreenshotSets/${oldSet.id}/appScreenshots`);
    const newShots = await apple.list(`appScreenshotSets/${newSet.id}/appScreenshots`);
    const prefix = `sovran-${identifier(targetLocale.id)}-`;
    if (newShots.some((s) => !s.attributes.fileName?.startsWith(prefix))) {
      if (newShots.some((s) => s.attributes.assetDeliveryState?.state !== 'COMPLETE')) return false;
      continue; // Human-authored media owns this complete set, including its count.
    }
    for (const old of oldShots) {
      const name = `${prefix}${identifier(old.id)}.png`;
      const existing = newShots.find((s) => s.attributes.fileName === name);
      if (existing?.attributes.assetDeliveryState?.state === 'COMPLETE') continue;
      if (existing?.attributes.assetDeliveryState?.state === 'UPLOAD_COMPLETE') return false;
      check(existing?.attributes.assetDeliveryState?.state !== 'FAILED', 'ASC screenshot processing failed');
      const asset = old.attributes.imageAsset;
      check(asset?.templateUrl, 'Previous screenshot has no source asset');
      const url = asset.templateUrl.replace('{w}', asset.width).replace('{h}', asset.height).replace('{f}', 'png');
      const bytes = await download(url, ['is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com', 'is4-ssl.mzstatic.com', 'is5-ssl.mzstatic.com'], 30_000_000);
      const shot = existing ? (await apple.api(`appScreenshots/${existing.id}`)).data : (await apple.api('appScreenshots', 'POST', { data: { type: 'appScreenshots', attributes: { fileName: name, fileSize: bytes.length }, relationships: { appScreenshotSet: relationship('appScreenshotSets', newSet.id) } } })).data;
      check(shot.attributes.fileSize === bytes.length && Array.isArray(shot.attributes.uploadOperations) && shot.attributes.uploadOperations.length > 0, 'ASC upload reservation cannot be resumed');
      for (const op of shot.attributes.uploadOperations) {
        const u = new URL(op.url);
        check(u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname.endsWith('.apple.com') || u.hostname.endsWith('.icloud.com')), 'Unapproved ASC upload destination');
        check(op.method === 'PUT' && Number.isSafeInteger(op.offset) && Number.isSafeInteger(op.length) && op.offset >= 0 && op.length > 0 && op.offset + op.length <= bytes.length, 'Invalid ASC upload range');
        let response;
        try { response = await fetch(u, { method: 'PUT', headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: bytes.subarray(op.offset, op.offset + op.length), redirect: 'error', signal: AbortSignal.timeout(120_000) }); }
        catch { throw new Error('ASC screenshot upload failed'); }
        check(response.ok, 'ASC screenshot upload rejected'); await response.body?.cancel();
      }
      await apple.api(`appScreenshots/${shot.id}`, 'PATCH', { data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') } } });
    }
    const ready = await apple.list(`appScreenshotSets/${newSet.id}/appScreenshots`);
    if (ready.length !== oldShots.length || ready.some((s) => s.attributes.assetDeliveryState?.state !== 'COMPLETE')) return false;
  }
  return true;
}

export async function prepareListing(apple, previous, target, version) {
  const detail = await apple.api(`appStoreVersions/${target.id}/appStoreReviewDetail`).catch((e) => { if (e.status === 404) return null; throw e; });
  const contactFields = ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'];
  if (!detail?.data || contactFields.some((key) => !detail.data.attributes[key])) {
    const oldDetail = (await apple.api(`appStoreVersions/${previous.id}/appStoreReviewDetail`)).data;
    check(oldDetail, 'Previous ASC review contact is missing');
    const attributes = {};
    // Review-account credentials stay at Apple; never persist or log them.
    const fields = detail?.data ? contactFields : [...contactFields, 'demoAccountName', 'demoAccountPassword', 'demoAccountRequired', 'notes'];
    for (const key of fields) if (!detail?.data?.attributes[key] && oldDetail.attributes[key] != null) attributes[key] = oldDetail.attributes[key];
    check(contactFields.every((key) => detail?.data?.attributes[key] || attributes[key]), 'ASC review contact incomplete');
    if (detail?.data) await apple.api(`appStoreReviewDetails/${detail.data.id}`, 'PATCH', { data: { type: 'appStoreReviewDetails', id: detail.data.id, attributes } });
    else await apple.api('appStoreReviewDetails', 'POST', { data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: relationship('appStoreVersions', target.id) } } });
  }
  const oldLocales = await apple.list(`appStoreVersions/${previous.id}/appStoreVersionLocalizations`);
  const newLocales = await apple.list(`appStoreVersions/${target.id}/appStoreVersionLocalizations`);
  let mediaReady = true;
  for (const old of oldLocales) {
    let locale = newLocales.find((l) => l.attributes.locale === old.attributes.locale);
    if (!locale) {
      const attributes = { locale: old.attributes.locale, whatsNew: `Sovran ${version}. Improvements and fixes.` };
      for (const key of ['description', 'keywords', 'marketingUrl', 'supportUrl', 'promotionalText']) if (old.attributes[key] != null) attributes[key] = old.attributes[key];
      locale = (await apple.api('appStoreVersionLocalizations', 'POST', { data: { type: 'appStoreVersionLocalizations', attributes, relationships: { appStoreVersion: relationship('appStoreVersions', target.id) } } })).data;
    }
    const missing = {};
    for (const key of ['description', 'keywords', 'supportUrl']) {
      if (!locale.attributes[key]) {
        check(old.attributes[key], 'Previous ASC required locale metadata missing');
        missing[key] = old.attributes[key];
      }
    }
    if (!locale.attributes.whatsNew) missing.whatsNew = `Sovran ${version}. Improvements and fixes.`;
    if (Object.keys(missing).length) await apple.api(`appStoreVersionLocalizations/${locale.id}`, 'PATCH', { data: { type: 'appStoreVersionLocalizations', id: locale.id, attributes: missing } });
    if (!(await copyScreenshots(apple, old, locale))) mediaReady = false;
  }
  return mediaReady;
}

export async function appleRelease(ledger) {
  const state = ledger.state;
  if (!state.builds.ios?.ready) return;
  const apple = new Apple();
  const app = (await apple.api(`apps/${config.appleAppId}`)).data;
  check(app.attributes.bundleId === config.bundleId, 'ASC app identity mismatch');
  const builds = await apple.api(`builds?filter[app]=${config.appleAppId}&filter[version]=${state.builds.ios.number}&include=preReleaseVersion`);
  const candidates = builds.data.filter((b) => builds.included?.some((p) => p.type === 'preReleaseVersions' && p.id === b.relationships.preReleaseVersion.data.id && p.attributes.version === state.version && p.attributes.platform === 'IOS'));
  check(candidates.length <= 1, 'Ambiguous ASC build');
  if (!candidates.length) return; // EAS upload/Apple processing may take hours.
  const build = candidates[0];
  check(!build.attributes.expired && !['FAILED', 'INVALID'].includes(build.attributes.processingState), 'ASC build invalid');
  if (build.attributes.processingState !== 'VALID') return;
  const versions = await apple.list(`apps/${config.appleAppId}/appStoreVersions?filter[platform]=IOS&limit=200`);
  const previousVersion = versions.find((v) => ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(v.attributes.appVersionState ?? v.attributes.appStoreState));
  let target = versions.find((v) => v.attributes.versionString === state.version);
  if (!target) {
    check(previousVersion?.attributes.copyright, 'Prepare initial ASC copyright before automated updates');
    target = (await apple.api('appStoreVersions', 'POST', { data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: state.version, releaseType: 'AFTER_APPROVAL', copyright: previousVersion.attributes.copyright }, relationships: { app: relationship('apps', config.appleAppId), build: relationship('builds', build.id) } } })).data;
  }
  const currentBuild = (await apple.api(`appStoreVersions/${target.id}/relationships/build`)).data;
  if (currentBuild?.id !== build.id) {
    check((target.attributes.appVersionState ?? target.attributes.appStoreState) === 'PREPARE_FOR_SUBMISSION', 'Existing ASC version uses a different build');
    await apple.api(`appStoreVersions/${target.id}/relationships/build`, 'PATCH', relationship('builds', build.id));
  }
  state.appleVersionId = target.id;
  const status = target.attributes.appVersionState ?? target.attributes.appStoreState;
  if (['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(status)) {
    state.channels.appStore = published(state, 'appStore', state.builds.ios.number, `https://apps.apple.com/app/id${config.appleAppId}`);
    let adp = await apple.api(`appStoreVersions/${target.id}/alternativeDistributionPackage`).catch((e) => { if (e.status === 404) return null; throw e; });
    if (!adp?.data && await ledger.intent('create-adp')) adp = await apple.api('alternativeDistributionPackages', 'POST', { data: { type: 'alternativeDistributionPackages', relationships: { appStoreVersion: relationship('appStoreVersions', target.id) } } });
    if (!adp?.data) check(Date.now() - Date.parse(state.intents['create-adp']) < 86_400_000, 'Apple package creation unacknowledged after one day; reconcile ASC before resetting intent');
    if (adp?.data) state.adpId = uuid(adp.data.id);
    // Apple/AltStore generates the package after approval when marketplace
    // linkage is configured. Never guess an ID or reuse the previous version.
    await ledger.save(); return;
  }
  if (status === 'PENDING_DEVELOPER_RELEASE') {
    await apple.api('appStoreVersionReleaseRequests', 'POST', { data: { type: 'appStoreVersionReleaseRequests', relationships: { appStoreVersion: relationship('appStoreVersions', target.id) } } }); return;
  }
  check(!['REJECTED', 'METADATA_REJECTED', 'DEVELOPER_REJECTED', 'INVALID_BINARY', 'REMOVED_FROM_SALE', 'DEVELOPER_REMOVED_FROM_SALE'].includes(status), 'Apple review requires attention');
  if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(status)) { await ledger.save(); return; }
  if (status === 'PREPARE_FOR_SUBMISSION') {
    check(previousVersion, 'Prepare initial App Store listing before automated updates');
    if (!(await prepareListing(apple, previousVersion, target, state.version))) { await ledger.save(); return; }
  }
  const submissions = await apple.list(`apps/${config.appleAppId}/reviewSubmissions?filter[platform]=IOS`);
  let submission;
  for (const candidate of submissions.filter((s) => s.attributes.state === 'READY_FOR_REVIEW')) {
    const items = await apple.list(`reviewSubmissions/${candidate.id}/items?include=appStoreVersion`);
    check(items.length <= 1, 'Apple submission contains unrelated additional items');
    if (items.some((i) => i.relationships?.appStoreVersion?.data?.id === target.id)) submission = candidate;
    else check(!items.length, 'Unrelated Apple review submission is open');
    if (!submission && !items.length) submission = candidate;
  }
  if (!submission) submission = (await apple.api('reviewSubmissions', 'POST', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: relationship('apps', config.appleAppId) } } })).data;
  const items = await apple.list(`reviewSubmissions/${submission.id}/items?include=appStoreVersion`);
  check(items.length <= 1 && (!items.length || items[0].relationships?.appStoreVersion?.data?.id === target.id), 'Apple submission contains an unrelated item');
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === target.id)) await apple.api('reviewSubmissionItems', 'POST', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: relationship('reviewSubmissions', submission.id), appStoreVersion: relationship('appStoreVersions', target.id) } } });
  await apple.api(`reviewSubmissions/${submission.id}`, 'PATCH', { data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } } });
  await ledger.save();
}
