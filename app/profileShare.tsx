import React from 'react';
import Modal from 'components/layout/Modal';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { useTypedRoute } from 'helper/navigation';
import { withSheetProvider } from 'hocs/withSheetProvider';

function ModalScreen() {
  const { npub } = useTypedRoute<'profileShare'>();
  return (
    <Modal showClose title="Profile Details" buttons={<></>}>
      <PaymentInfo popupMessage={'npub_copied'} link={npub} data={npub} unit="nostr" />
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
