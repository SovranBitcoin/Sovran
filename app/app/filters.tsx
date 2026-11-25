import { FiltersScreen } from '@/features/transactions';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

/** The transaction filters: a sheet over Transactions, which it returns to with the new filters. */
export default function FiltersRoute() {
  return (
    <FormSheetChrome route="filters" title="Filters">
      <FiltersScreen />
    </FormSheetChrome>
  );
}
