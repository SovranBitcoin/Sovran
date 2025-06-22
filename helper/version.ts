import * as Application from 'expo-application';

const name = Application.applicationName;

export const isTestFlight = name === 'TestFlight';
export const isExpoGo = name === 'Expo Go';
export const isProduction = name === 'Sovran';

export const isDev = isTestFlight || isExpoGo;
