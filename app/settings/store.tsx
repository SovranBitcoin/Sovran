import React from 'react';
import { useSelector } from 'react-redux';
import Container from 'components/layout/Container';
import { Text } from 'components/common/Themed';
import * as Clipboard from 'expo-clipboard';
import _ from 'lodash';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { ScrollView } from 'react-native';

export default function ModalScreen() {
  const store = useSelector((state) => state);

  const getStructure = (obj: any): any => {
    // Handle primitive values
    if (!_.isObject(obj) || obj === null) {
      if (_.isString(obj) && obj.startsWith('http')) {
        return 'url:example.com';
      }
      return typeof obj;
    }

    // Handle arrays
    if (_.isArray(obj)) {
      if (obj.length === 0) return [];

      // If array contains only primitives
      if (_.every(obj, (item) => !_.isObject(item) || item === null)) {
        if (_.isString(obj[0]) && obj[0].startsWith('http')) {
          return ['url:example.com'];
        }
        return [typeof obj[0]];
      }

      // For arrays of objects
      const objectItems = obj.filter((item) => _.isObject(item) && item !== null);
      if (objectItems.length === 0) return [{}];

      // Get all unique keys from object items
      const allKeys = _.uniq(_.flatMap(objectItems, Object.keys));

      // Create structure based on all objects
      const structure = {};
      allKeys.forEach((key) => {
        const firstItemWithKey = objectItems.find((item) => key in item);
        structure[key] = firstItemWithKey ? getStructure(firstItemWithKey[key]) : 'undefined';
      });

      return [structure];
    }

    // Handle objects
    return _.mapValues(
      _.mapKeys(obj, (value, key) => (key.includes('https://') ? 'https://mint.example.com' : key)),
      getStructure
    );
  };

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(JSON.stringify(store, null, 2));
  };

  return (
    <Container>
      <ScrollView>
        <Text style={{ color: 'white' }}>{JSON.stringify(store, null, 2)}</Text>
        <TouchableOpacity onPress={copyToClipboard}>
          <Text style={{ color: 'red', backgroundColor: 'pink' }}>Copy Store to Clipboard</Text>
        </TouchableOpacity>
      </ScrollView>
    </Container>
  );
}
