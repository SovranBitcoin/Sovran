/**
 * @jest-environment node
 *
 * Native bars centre a title only while it clears the busier side mirrored onto
 * both sides; a wider title is slid toward the emptier side. The budget has to
 * come from that mirrored reservation, not from what each side happens to hold.
 */
import { centeredTitleMaxWidth, HEADER_TITLE_MIN_WIDTH } from '@/navigation/headerLayout';
import { headerButtonSize, headerIdentity } from '@/shared/styles/tokens';

const reservation = (actions: number) => 16 + actions * (headerButtonSize + 8);

it('leaves the title the space between the busier side mirrored onto both', () => {
  // Two actions on one side only: the empty side reserves the same two.
  expect(centeredTitleMaxWidth(393, 2)).toBe(393 - 2 * reservation(2));
});

it('shrinks the budget as one side gains actions, even though the other side is unchanged', () => {
  expect(centeredTitleMaxWidth(393, 2)).toBeLessThan(centeredTitleMaxWidth(393, 1));
});

it('caps a title on a wide window and keeps a usable floor on a crowded bar', () => {
  expect(centeredTitleMaxWidth(1024, 1)).toBe(220);
  expect(centeredTitleMaxWidth(320, 3)).toBe(HEADER_TITLE_MIN_WIDTH);
});

it('fits the identity stack exactly inside the header-button box', () => {
  const { iconSize, gap, nameLineHeight, height } = headerIdentity;
  expect(height).toBe(headerButtonSize);
  expect(iconSize + gap + nameLineHeight).toBe(headerButtonSize);
});
