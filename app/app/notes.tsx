/**
 * @fileoverview The note picker modal: the ecash held at one mint, to choose
 * from by hand.
 *
 * A route of its own, like Details (ADR 0026): the system page sheet on
 * iPhone, a pushed page on Android (ADR 0025). The amount screen puts the
 * notes in `notePickerStore` before opening it.
 */

import { NotePickerScreen } from '@/features/send/screens/NotePickerScreen';

export default NotePickerScreen;
