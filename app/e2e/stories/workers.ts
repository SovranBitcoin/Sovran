/**
 * The simulators a run plays its stories on (ADR 0033): one prepared
 * simulator, cloned once per worker.
 *
 * A stock iPhone simulator starts about 270 background processes (widgets,
 * News, Health, Siri, wallpapers) and holds 5 GB; six of them once filled this
 * Mac's memory and then its disk. The prepared simulator has the ones no story
 * uses switched off, which leaves about 50 processes and under 1 GB, and it
 * boots in 3 s instead of 20. Clones inherit the installed app.
 *
 * Every checkout has its own: several worktrees run stories at once, and a
 * run that removed "the" workers used to delete another checkout's in the
 * middle of its stories. None of them opens a window: `simctl` boots without
 * Simulator.app, which only shows them if someone has it open.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdNativeLease } from './machine';
import { simctl } from './simctl';

/** The checkout these simulators belong to: its folder name, and a hash of its path so two folders of one name differ. */
export function checkoutLane(root: string): string {
  const name = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${name || 'checkout'}-${createHash('sha256').update(root).digest('hex').slice(0, 6)}`;
}

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LANE = checkoutLane(CHECKOUT);
const BASE_NAME = `sovran-e2e-${LANE}-base`;
const WORKER_PREFIX = `sovran-e2e-${LANE}-worker-`;
/** The one simulator a person or agent plays single stories on in this checkout, kept between runs. */
const OWN_NAME = `sovran-e2e-${LANE}`;
const DEVICE_TYPE = 'iPhone 17 Pro';
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-1';
/**
 * Written into the prepared simulator's folder: which build it carries, what
 * was switched off, and the checkout it belongs to, so `machine.ts reclaim`
 * knows it can go once that checkout has.
 */
export const STAMP_FILE = 'sovran-e2e-base.json';

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
  return JSON.stringify({
    artifact,
    runtime: RUNTIME,
    device: DEVICE_TYPE,
    off: UNUSED_SERVICES,
    checkout: CHECKOUT,
  });
}

/** Where a simulator keeps its launch settings: outside its own folder, and left behind when it is deleted. */
const launchFolder = (udid: string) => `/private/var/tmp/com.apple.CoreSimulator.SimDevice.${udid}`;

function remove(udid: string): void {
  simctl('delete', udid);
  rmSync(launchFolder(udid), { recursive: true, force: true });
}

/**
 * Switch the unused services off for a simulator that is shut down. The
 * simulator keeps this list outside its own folder, so a clone does not
 * inherit it and each one is given its own.
 */
function switchOffUnusedServices(udid: string): void {
  const dir = launchFolder(udid);
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
    if (readStamp(existing) === stamp) {
      if (existing.state !== 'Shutdown') simctl('shutdown', existing.udid);
      return existing.udid;
    }
    remove(existing.udid);
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

/** Remove this checkout's worker simulators, from this run or one that was interrupted. */
export function removeWorkers(): void {
  for (const device of devices()) {
    if (device.name.startsWith(WORKER_PREFIX)) remove(device.udid);
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

/**
 * This checkout's own simulator for playing one story at a time, booted and
 * ready: cloned from the prepared one, and used again by later stories, which
 * can start from the states earlier ones saved, until the build changes or
 * `playedOn` says it has already played this one. Nothing else here removes it.
 */
export async function ownSimulator(
  appPath: string,
  playedOn?: (udid: string) => boolean
): Promise<string> {
  const stamp = wanted(appPath);
  const ready = () => {
    const own = devices().find((device) => device.name === OWN_NAME);
    return own && readStamp(own) === stamp ? own : undefined;
  };
  const boot = (udid: string) => {
    try {
      simctl('boot', udid);
    } catch {
      // Already booted, perhaps by another story of this checkout a moment ago.
    }
    simctl('bootstatus', udid, '-b');
    return udid;
  };
  const existing = ready();
  if (existing && !playedOn?.(boot(existing.udid))) return existing.udid;
  // Making a simulator is native work: queue for it, and look again once it is our turn.
  const release = await holdNativeLease(`this checkout's simulator`);
  try {
    const own = ready();
    if (own && own.udid !== existing?.udid && !playedOn?.(boot(own.udid))) return own.udid;
    const base = prepareBase(appPath);
    for (const stale of devices().filter((device) => device.name === OWN_NAME)) {
      if (stale.state !== 'Shutdown') simctl('shutdown', stale.udid);
      remove(stale.udid);
    }
    const udid = simctl('clone', base, OWN_NAME);
    switchOffUnusedServices(udid);
    const made = devices().find((device) => device.udid === udid);
    if (!made) throw new Error("This checkout's simulator disappeared while it was being made.");
    writeFileSync(join(made.dataPath, '..', STAMP_FILE), stamp);
    return boot(udid);
  } finally {
    release();
  }
}

function readStamp(device: Device): string | undefined {
  const file = join(device.dataPath, '..', STAMP_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}
