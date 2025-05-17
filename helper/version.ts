import * as Application from 'expo-application';

const name = Application.applicationName;
const version = Application.nativeApplicationVersion;
const buildNumber = Application.nativeBuildVersion;

export const isTestFlight = name === 'TestFlight';
export const isExpoGo = name === 'Expo Go';
export const isProduction = name === 'Sovran';

export const isDev = isTestFlight || isExpoGo;
