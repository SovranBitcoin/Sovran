/* global jest */
// RN's Jest transformer returns { testUri } instead of registering a Metro
// asset ID. Let Expo Asset resolve that test representation for bundled demos.
const { Asset } = require('expo-asset');
const fromModule = Asset.fromModule.bind(Asset);
jest.spyOn(Asset, 'fromModule').mockImplementation((source) => {
  if (source && typeof source === 'object' && typeof source.testUri === 'string') {
    return Asset.fromURI(source.testUri);
  }
  return fromModule(source);
});
