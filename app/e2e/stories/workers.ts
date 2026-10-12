/**
 * The simulators a run plays its stories on (ADR 0033): one prepared
 * simulator, cloned once per worker.
 *
 * A stock iPhone simulator starts about 270 background processes (widgets,
 * News, Health, Siri, wallpapers) and holds 5 GB; six of them once filled this
 * Mac's memory and then its disk. The prepared simulator has the ones no story
 * uses switched off, which leaves about 50 processes and under 1 GB, and it
 * boots in 3 s instead of 20. Clones inherit the installed app.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { simctl } from './simctl';

const BASE_NAME = 'sovran-e2e-base';
const WORKER_PREFIX = 'sovran-e2e-worker-';
const DEVICE_TYPE = 'iPhone 17 Pro';
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-1';
/** Written into the prepared simulator's folder: which build it carries and what was switched off. */
const STAMP_FILE = 'sovran-e2e-base.json';

/**
 * Background services of the simulator that no story needs, by launchd label
 * after `com.apple.`. Found by switching off everything that is not part of
 * drawing, touching, installing, networking, the keychain, the keyboard or
 * the pasteboard, then putting back what the boot waits for: with
 * `nanoregistryd` off, `simctl bootstatus` never returns, and with `sleepd` off
 * the home screen spends a whole processor core retrying it. The simulator reads
 * the list as it boots.
 */
const UNUSED_SERVICES = [
  'AssetCacheLocatorService',
  'ClipServices.clipserviced',
  'FamilyControlsAgent',
  'GameController.gamecontrollerd',
  'ManagedSettingsAgent',
  'MapKit.SnapshotService',
  'Maps.mapssyncd',
  'NPKCompanionAgent',
  'PosterBoard',
  'Safari.passwordbreachd',
  'SafariBookmarksSyncAgent',
  'ScreenTimeAgent',
  'SetStoreUpdateService',
  'StatusKitAgent',
  'UsageTrackingAgent',
  'WebBookmarks.webbookmarksd',
  'activityawardsd',
  'activitysharingd',
  'addressbooksyncd',
  'amsaccountsd',
  'amsengagementd',
  'ap.adprivacyd',
  'ap.promotedcontentd',
  'appconduitd',
  'appleaccountd',
  'appprotectiond',
  'appstored',
  'askpermissiond',
  'assetsubscriptiond',
  'assistant_cdmd',
  'assistant_service',
  'assistantd',
  'avatarsd',
  'biomed',
  'biomesyncd',
  'brook.brookcompaniond',
  'businessservicesd',
  'calaccessd',
  'carkitd',
  'cdpd',
  'chronod',
  'cloudd',
  'communicationtrustd',
  'companionappd',
  'contacts.postersyncd',
  'coreidvd',
  'corespeechd',
  'countryd',
  'dataaccess.dataaccessd',
  'deviceaccessd',
  'diagnosticextensionsd',
  'eligibilityd',
  'email.maild',
  'eventkitsyncd',
  'familycircled',
  'familynotification',
  'featureaccessd',
  'financed',
  'findmy.findmylocated',
  'finhealthd',
  'fitcore',
  'fitnesscoachingd',
  'fitnessintelligenced',
  'followupd',
  'gamed',
  'generativeexperiencesd',
  'geoanalyticsd',
  'geod',
  'healthappd',
  'healthd',
  'homed',
  'icloudmailagent',
  'identityservicesd',
  'ids_simd',
  'ind',
  'intelligenceplatformd',
  'itunescloudd',
  'itunesstored',
  'jetpackassetd',
  'liveactivitiesd',
  'localizationswitcherd',
  'managedassetsd',
  'mediaanalysisd',
  'medialibraryd',
  'mlhostd',
  'mobiletimerd',
  'modelcatalogd',
  'modelmanagerd',
  'nanoprefsyncd.2',
  'nanoregistrylaunchd',
  'nanotimekitcompaniond',
  'navd',
  'parsec-fbf',
  'parsecd',
  'passd',
  'peopled',
  'photoanalysisd',
  'purplebuddy.budd',
  'remindd',
  'replicatord',
  'revisiond',
  'routined',
  'searchd',
  'siri.context.service',
  'siriactionsd',
  'siriinferenced',
  'siriknowledged',
  'sirittsd',
  'sociallayerd',
  'spotlightknowledged',
  'spotlightknowledged.updater',
  'storekitd',
  'suggestd',
  'syncdefaultsd',
  'telephonyutilities.callservicesd',
  'textunderstandingd',
  'translationd',
  'triald',
  'tvremoted',
  'videosubscriptionsd',
  'voicebankingd',
  'wcd',
  'weatherd',
];

interface Device {
  name: string;
  udid: string;
  state: string;
  dataPath: string;
}

function devices(): Device[] {
  const listed = JSON.parse(simctl('list', 'devices', '-j')) as {
    devices: Record<string, Device[]>;
  };
  return Object.values(listed.devices).flat();
}

/** What the prepared simulator has to match to be used again. */
function wanted(appPath: string): string {
  const build = join(dirname(appPath), 'build.json');
  const artifact = existsSync(build)
    ? (JSON.parse(readFileSync(build, 'utf8')) as { artifactSha256?: string }).artifactSha256
    : undefined;
  return JSON.stringify({ artifact, runtime: RUNTIME, device: DEVICE_TYPE, off: UNUSED_SERVICES });
}

/**
 * Switch the unused services off for a simulator that is shut down. The
 * simulator keeps this list outside its own folder, so a clone does not
 * inherit it and each one is given its own.
 */
function switchOffUnusedServices(udid: string): void {
  const dir = `/private/var/tmp/com.apple.CoreSimulator.SimDevice.${udid}`;
  mkdirSync(dir, { recursive: true });
  const entries = UNUSED_SERVICES.map(
    (service) => `\t<key>com.apple.${service}</key>\n\t<true/>`
  ).join('\n');
  writeFileSync(
    join(dir, 'disabled.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${entries}\n</dict>\n</plist>\n`
  );
}

/**
 * The prepared simulator, shut down and ready to be cloned: made again only
 * when the build, the device or the list of services has changed.
 */
export function prepareBase(appPath: string): string {
  const stamp = wanted(appPath);
  const existing = devices().find((device) => device.name === BASE_NAME);
  if (existing) {
    const stampFile = join(existing.dataPath, '..', STAMP_FILE);
    if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
      if (existing.state !== 'Shutdown') simctl('shutdown', existing.udid);
      return existing.udid;
    }
    simctl('delete', existing.udid);
  }
  const udid = simctl('create', BASE_NAME, DEVICE_TYPE, RUNTIME);
  switchOffUnusedServices(udid);
  simctl('boot', udid);
  simctl('bootstatus', udid, '-b');
  simctl('install', udid, appPath);
  simctl('shutdown', udid);
  const made = devices().find((device) => device.udid === udid);
  if (!made) throw new Error('The prepared simulator disappeared while it was being made.');
  writeFileSync(join(made.dataPath, '..', STAMP_FILE), stamp);
  return udid;
}

/** Remove every worker simulator, from this run or one that was interrupted. */
export function removeWorkers(): void {
  for (const device of devices()) {
    if (device.name.startsWith(WORKER_PREFIX)) simctl('delete', device.udid);
  }
}

/** Clone the prepared simulator `count` times and boot the clones. */
export function startWorkers(baseUdid: string, count: number): string[] {
  removeWorkers();
  const udids = Array.from({ length: count }, (_, index) =>
    simctl('clone', baseUdid, `${WORKER_PREFIX}${index + 1}`)
  );
  for (const udid of udids) {
    switchOffUnusedServices(udid);
    simctl('boot', udid);
  }
  for (const udid of udids) simctl('bootstatus', udid, '-b');
  return udids;
}
