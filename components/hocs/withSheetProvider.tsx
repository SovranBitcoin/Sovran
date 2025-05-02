import { SheetProvider } from 'react-native-actions-sheet';

export const withSheetProvider = (WrappedComponent) => {
  const WithSheetProvider = (props) => {
    return (
      <SheetProvider>
        <WrappedComponent {...props} />
      </SheetProvider>
    );
  };

  return WithSheetProvider;
};
