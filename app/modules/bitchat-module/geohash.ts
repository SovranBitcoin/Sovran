// Pure-JS subpath. Importing `bitchat-module/geohash` gives geohash helpers
// without evaluating the native-binding module — the seam that keeps the
// contacts surface (parseGeohashQuery) and the location-tier helper from
// transitively depending on the iOS-only BitChat native module.
export { encodeGeohash, isValidGeohash } from './src/geohash';
