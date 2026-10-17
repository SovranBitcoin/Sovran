/**
 * @fileoverview The picker sheet: choosing one of several things.
 *
 * A route of its own, like Details (ADR 0026): the same sheet as Select mint
 * on iPhone, a pushed page on Android (ADR 0025). Opened by `openPicker`,
 * which hands the rows over through `pickerSheetStore`.
 */

import { PickerSheetScreen } from '@/shared/ui/composed/PickerSheet';

export default PickerSheetScreen;
