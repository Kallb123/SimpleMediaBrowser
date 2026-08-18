import {
  REVEAL_MARGIN,
  TOP_MARGIN,
  planKeyboardScroll,
  planTopParkScroll,
} from '../useKeyboardAwareScroll';

// A representative screen: 800dp of content in a 600dp ScrollView, with a
// keyboard that leaves 350dp visible once it is open.
const CONTENT = 800;
const VIEWPORT = 600;
const VISIBLE_WITH_KEYBOARD = 350;

const plan = (overrides: Partial<Parameters<typeof planKeyboardScroll>[0]> = {}) =>
  planKeyboardScroll({
    inputTop: 700,
    inputHeight: 40,
    visibleHeight: VISIBLE_WITH_KEYBOARD,
    naturalContentHeight: CONTENT,
    scrollOffset: 0,
    ...overrides,
  });

describe('planKeyboardScroll', () => {
  it('scrolls a covered input to sit REVEAL_MARGIN above the keyboard', () => {
    // Input occupies 700–740 in the content; only 350dp is visible, so it has
    // to end up at 350 - 24 = 326 within the visible area.
    expect(plan().scrollTo).toBe(700 + 40 + REVEAL_MARGIN - VISIBLE_WITH_KEYBOARD);
  });

  it('leaves an input that is already clear of the keyboard alone', () => {
    expect(plan({ inputTop: 100, scrollOffset: 0 }).scrollTo).toBeNull();
  });

  it('never scrolls backwards, so focusing a visible input does not push it down', () => {
    // Scrolled to the very end: the input is visible near the top of the
    // remaining space and must not be dragged back towards the keyboard.
    expect(plan({ scrollOffset: 600 }).scrollTo).toBeNull();
  });

  it('is idempotent — re-running after it took effect is a no-op', () => {
    const first = plan();

    expect(first.scrollTo).not.toBeNull();
    expect(plan({ scrollOffset: first.scrollTo as number }).scrollTo).toBeNull();
  });

  it('reserves enough slack for an input at the very end to reach the top', () => {
    // The last input in the content: without extra space, scrolling stops at
    // CONTENT - visible = 450, which cannot bring an input at 780 into view.
    const { extraBottomSpace, scrollTo } = plan({ inputTop: 780, inputHeight: 20 });
    const maxScroll = CONTENT + extraBottomSpace - VISIBLE_WITH_KEYBOARD;

    expect(maxScroll).toBeGreaterThanOrEqual(planTopParkScroll(780));
    expect(maxScroll).toBeGreaterThanOrEqual(scrollTo as number);
  });

  it('reserves no slack when the content is already long enough', () => {
    expect(plan({ inputTop: 400 }).extraBottomSpace).toBe(0);
  });

  it('reserves slack when the content is shorter than the visible area', () => {
    // A short screen (first-run setup): nothing is scrollable at all, so every
    // dp of reach has to be reserved.
    const { extraBottomSpace } = plan({
      inputTop: 260,
      naturalContentHeight: 300,
      visibleHeight: 350,
    });

    expect(300 + extraBottomSpace - 350).toBeGreaterThanOrEqual(planTopParkScroll(260));
  });

  it('still reserves reach when nothing reports the keyboard', () => {
    // visibleHeight is the full viewport because neither the layout nor the
    // Keyboard module reacted — the Fire tablet case. The input only gets
    // scrolled as far as the layout thinks is needed, which leaves it behind the
    // keyboard, so the reserved slack has to be enough to park it at the top
    // (or drag it up by hand) instead.
    const { extraBottomSpace } = plan({
      inputTop: 780,
      inputHeight: 20,
      visibleHeight: VIEWPORT,
    });

    expect(CONTENT + extraBottomSpace - VIEWPORT).toBeGreaterThanOrEqual(
      planTopParkScroll(780),
    );
  });

  it('reserves reach for a mid-content input once the keyboard shrinks the view', () => {
    // Reaching the top needs 400 - 12 = 388, but plain scrolling stops at
    // 800 - 350 = 450, so no slack is needed here.
    expect(plan({ inputTop: 400 }).extraBottomSpace).toBe(0);
    // Past that point it is, and only by the shortfall.
    expect(plan({ inputTop: 600 }).extraBottomSpace).toBe(600 - TOP_MARGIN - (CONTENT - VISIBLE_WITH_KEYBOARD));
  });

  it('never returns a negative scroll offset', () => {
    expect(plan({ inputTop: 0, inputHeight: 10, visibleHeight: 5, scrollOffset: -50 }).scrollTo)
      .toBeGreaterThanOrEqual(0);
  });
});

describe('planTopParkScroll', () => {
  it('parks the input just below the top of the visible area', () => {
    expect(planTopParkScroll(500)).toBe(500 - TOP_MARGIN);
  });

  it('clamps to the top of the content', () => {
    expect(planTopParkScroll(4)).toBe(0);
  });
});
