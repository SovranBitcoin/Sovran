import Message from './message';
import { withSheetProvider } from 'hocs/withSheetProvider';

function ModalScreen() {
  return <Message />;
}

export default withSheetProvider(ModalScreen);
